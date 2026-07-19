# -*- coding: utf-8 -*-
"""修仙・问道 — Python 游戏状态中心 (GameState)

移植自 server/state.js (State) + server.js 的文件存档 (Save) 与 stateSnapshot()。

数据契约 (Data Contract)
========================
输入数据 (data/ 目录为权威数据源, 直接编辑 JSON 即可, 中文 key 原样保留):
  data/config.json         必需  游戏参数: startScene / originStartScene{出身id:场景id} /
                                 initialAttrs{中文属性键} / equipSlots[中文槽位] / maxSaveSlots /
                                 realms[{name,toNext,lifespan}] / playerName
  data/char_creation.json  必需  角色创建表: linggen[{id,rate,cultRate,breakBonus}] /
                                 constitution[{id,rate,passive}] /
                                 origin[{id,rate,desc,items,initAttrs,initStones}] /
                                 names{given,family}
  data/items.json          可选  物品表 {id:{name,type,rarity,desc,slot?,stats?,...}}
                                 —— equip()/effective()/to_dict() 需要
  data/gongfa.json         可选  功法表 {id:{name,grade,kind,passive,cultivateRate,desc}}
                                 —— learn_gongfa()/active_gongfa() 需要
  data/scenes.json         可选  场景表 —— 仅用于存档 meta.sceneTitle

属性键映射 (JSON 数据/存档一律中文键, 本模块内部存储一律 ASCII 键):
  气血→hp  灵力→mp  攻击→atk  防御→def  悟性→wisdom  勇气→courage
  * attrs 与 effective() 返回的三组属性均为 AttrDict: 读写时中文键自动归一化为
    ASCII 键 (attrs["气血"] 与 attrs["hp"] 等价), 迭代/序列化始终只见 ASCII 键
  * mod_attr() 等接口同样中文/ASCII 双兼容
  * 装备槽位 (武器/防具/饰品/法宝) 与物品/功法 id 属数据 ID, 不做映射

体质被动 (constitution.passive, 逗号分隔 "key:value" 串):
  cult_extra   修炼倍率加成 (灵体+1 / 道胎+0.5, 计入 cult_rate)
  break_bonus  突破率加成   (灵体+0.10, 计入 break_bonus)
  hp_bonus / atk_bonus  先天属性 (武骨 hp+10 atk+3, new_game 时并入初始属性)
  regen / limit_break   由战斗/突破逻辑各自读取 (has_const_passive/get_const_passive)

内部 state 结构 (self.data, ASCII 属性键):
  {scene, attrs{hp,mp,atk,def,wisdom,courage,...}, realm, day, stones,
   items[物品id], equipment{槽位:物品id|None},
   gongfa{learned[],equipped_heart[],equipped_skill[]},
   log[], flags{名:True}, char{name, linggen, constitution, origin}}

存档格式 (saves/slot_<slot>.json, 与 Node 版 server/saves/ 完全兼容, UTF-8):
  {"version": 3,
   "meta": {"name", "realm", "sceneTitle", "time"(毫秒时间戳)},
   "state": {... 同内部结构, 但 attrs 为中文键 ...}}
  load() 时自动升级旧档 (公开方法 upgrade()): 补缺属性/槽位/功法/日志等,
  null 属性回填初始值, char 条目按 id 用当前数据表还原 (兼容旧客户端缩写字段格式)。
  export_data() 返回存档格式的 state (中文属性键), 供导出接口使用。

to_dict() 输出 = server.js stateSnapshot() 结构 (attrs/attrsBase 为中文键, 供前端渲染):
  {name, realm, realmIdx, linggen, constitution, day, stones, attrs, attrsBase,
   items[{id,name,type,rarity,desc}], equipment{槽位:{id,name,rarity,stats}|None},
   gongfa{learned[{id,name,cultivateRate}], active}, flags[], log[-20:], realmInfo}
"""

import json
import os
import random
import time
from typing import Any, Optional

# ---------- 属性键映射表 ----------
ATTR_CN2EN = {"气血": "hp", "灵力": "mp", "攻击": "atk", "防御": "def", "悟性": "wisdom",
               "勇气": "courage", "神识": "awareness", "根骨": "bone",
               "魅力": "charm", "机缘": "fortune"}
ATTR_EN2CN = {v: k for k, v in ATTR_CN2EN.items()}
# 五行←→二级属性映射
WUXING_DIMS = {"金": "神识", "木": "根骨", "水": "魅力", "火": "悟性", "土": "机缘"}
DIM_WUXING = {v: k for k, v in WUXING_DIMS.items()}


def _map_keys(d: Optional[dict], mapping: dict) -> dict:
    """按映射表转换 dict 的键, 未知键原样保留。"""
    if not d:
        return {}
    return {mapping.get(k, k): v for k, v in d.items()}


def _en2cn(d: Optional[dict]) -> dict:
    """内部 ASCII 属性键 → 存档/快照用中文键 (未知键原样保留)。"""
    return _map_keys(d, ATTR_EN2CN)


class AttrDict(dict):
    """属性字典: 键自动归一化 (中文属性键 → ASCII), 存储与迭代/序列化始终为 ASCII 键。

    使 attrs["气血"] 与 attrs["hp"] 指向同一存储, 引擎层可用任一命名读写。
    """

    @staticmethod
    def _k(k):
        return ATTR_CN2EN.get(k, k)

    def __init__(self, data: Optional[dict] = None):
        super().__init__()
        if data:
            for k, v in dict(data).items():
                self[k] = v

    def __getitem__(self, k):
        return super().__getitem__(self._k(k))

    def __setitem__(self, k, v):
        super().__setitem__(self._k(k), v)

    def __delitem__(self, k):
        super().__delitem__(self._k(k))

    def __contains__(self, k):
        return super().__contains__(self._k(k))

    def get(self, k, default=None):
        return super().get(self._k(k), default)

    def setdefault(self, k, default=None):
        return super().setdefault(self._k(k), default)

    def pop(self, k, *args):
        return super().pop(self._k(k), *args)


class GameState:
    """全游戏唯一状态中心, 含角色创建 / 属性境界 / 物品装备 / 功法 / 标记 / 存档。"""

    SAVE_VERSION = 3      # 与 server/save.js 的 VERSION 一致
    AUTO_SLOT = "auto"    # 自动存档槽位名 → saves/slot_auto.json
    LOG_MAX = 60          # 与 state.js pushLog 上限一致

    def __init__(self, data_dir: Optional[str] = None, saves_dir: Optional[str] = None):
        base = os.path.dirname(os.path.abspath(__file__))
        self.data_dir = data_dir or os.path.join(base, "data")
        self.saves_dir = saves_dir or os.path.join(base, "saves")
        self.config: dict = self._load_json("config.json", required=True)
        self.char_tables: dict = self._load_json("char_creation.json", required=True)
        self.items_table: dict = self._load_json("items.json") or {}
        self.gongfa_table: dict = self._load_json("gongfa.json") or {}
        self.scenes_table: dict = self._load_json("scenes.json") or {}

        # Load sects table
        sects_path = os.path.join(self.data_dir, "sects.json")
        self.sects_table = {}
        if os.path.exists(sects_path):
            with open(sects_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            self.sects_table = raw if isinstance(raw, dict) else {}

        # Load regions table
        regions_path = os.path.join(self.data_dir, "regions.json")
        self.regions_table = {}
        if os.path.exists(regions_path):
            with open(regions_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            self.regions_table = raw if isinstance(raw, dict) else {}

        self.data: Optional[dict] = None  # new_game()/load() 之后可用

    # ================= 数据文件 =================

    def _load_json(self, name: str, required: bool = False):
        path = os.path.join(self.data_dir, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError) as e:
            if required:
                raise RuntimeError(f"数据文件缺失或损坏: {path} — {e}")
            return None

    def _find(self, table: str, entry_id) -> Optional[dict]:
        """在角色创建表 char_tables[table] 中按 id 查条目。"""
        for entry in self.char_tables.get(table, []):
            if entry.get("id") == entry_id:
                return entry
        return None

    def _resolve_entry(self, table: str, value, default_id: str) -> Optional[dict]:
        """把 灵根/体质/出身 字段归一化为数据表条目。

        dict → 按其 id 用服务端权威数据替换 (id 未知则保留原 dict, 兼容旧档);
        str  → 按 id 查表 (未知回退默认); None → 默认条目。
        """
        if isinstance(value, dict):
            return self._find(table, value.get("id")) or value
        if isinstance(value, str):
            return self._find(table, value) or self._find(table, default_id)
        return self._find(table, default_id)

    # ================= 开新档 =================

    def new_game(self, char_data: Optional[dict] = None) -> dict:
        """开新档。char_data 允许为 None (全部走默认: 随机姓名/伪灵根/无体质/农家子弟)。

        char_data: {name, linggen, constitution, origin} —— 后三者可为数据表条目 dict 或 id 字符串。
        """
        cfg = self.config
        char_data = char_data or {}
        lg = self._resolve_entry("linggen", char_data.get("linggen"), "伪灵根")
        cn = self._resolve_entry("constitution", char_data.get("constitution"), "无")
        origin = self._resolve_entry("origin", char_data.get("origin"), "农家子弟") or {}
        name = char_data.get("name") or self._random_name()

        # 初始属性 = 全局初始 + 出身 initAttrs (AttrDict 自动把中文键归一化为 ASCII)
        attrs = AttrDict(cfg.get("initialAttrs", {}))
        for k, v in (origin.get("initAttrs") or {}).items():
            attrs[k] = attrs.get(k, 0) + v

        # 体质先天被动 (武骨: hp_bonus:10, atk_bonus:3)
        passives = self._parse_passive((cn or {}).get("passive"))
        if "hp_bonus" in passives:
            attrs["hp"] = attrs.get("hp", 0) + int(float(passives["hp_bonus"]))
        if "atk_bonus" in passives:
            attrs["atk"] = attrs.get("atk", 0) + int(float(passives["atk_bonus"]))

        # 四种出身按 originStartScene 路由开场
        origin_id = origin.get("id", "农家子弟")
        start_scene = cfg.get("originStartScene", {}).get(origin_id) or cfg.get("startScene")

        self.data = {
            "scene": start_scene,
            "attrs": attrs,
            "realm": 0,
            "realmStage": 0,
            "day": 1,
            "stones": origin.get("initStones") or 0,
            "items": [],
            "equipment": {slot: None for slot in cfg.get("equipSlots", [])},
            "faqi": {"array": [None] * self.faqi_capacity(0), "deployed": [None] * int(cfg.get("faqiDeployMax", 3))},
            "gongfa": {"learned": [], "equipped_heart": [], "equipped_skill": []},
            "log": [],
            "flags": {},
            "sect": None,
            "char": {"name": name, "linggen": lg, "constitution": cn, "origin": origin},
        }

        # 出身初始物品
        for item_id in origin.get("items") or []:
            self.add_item(item_id)

        # 灵根标记
        if lg:
            if lg.get("id") in ("天灵根", "地灵根"):
                self.set_flag("天灵根")
            elif lg.get("id") != "真灵根":
                self.set_flag("伪灵根")
            # 五行亲和初始化：灵根的五行元素赋予对应二级属性 +2（在初始基础上追加）
            wuxing_elements = lg.get("wuxing") or []
            for el in wuxing_elements:
                dim = WUXING_DIMS.get(el)
                if dim:
                    self.mod_attr(dim, 2)
        return self.data

    # ================= 五行系统 =================

    def wuxing_elements(self) -> list:
        """玩家当前灵根的五行元素列表。"""
        lg = (self.data.get("char") or {}).get("linggen") or {}
        return lg.get("wuxing") or []

    def wuxing_dims(self) -> dict:
        """五行→二级属性值映射表。"""
        eff = self.effective()
        return {el: eff["eff"].get(DIM_WUXING.get(el, ""), 0)
                for el in (self.config.get("wuxing") or {}).get("elements", [])}

    def wuxing_affinity(self) -> dict:
        """五行亲和度 (0~100): 按二级属性值加权。"""
        dims = self.wuxing_dims()
        total = sum(dims.values()) or 1
        return {el: min(100, max(0, round(v / total * 100))) for el, v in dims.items()}

    def _random_name(self) -> str:
        names = self.char_tables.get("names", {})
        given = names.get("given") or ["林"]
        family = names.get("family") or ["尘"]
        return random.choice(given) + random.choice(family)

    # ================= 角色信息 =================

    @property
    def _d(self) -> dict:
        if self.data is None:
            raise RuntimeError("尚未开始游戏: 请先调用 new_game() 或 load()")
        return self.data

    def char_name(self) -> str:
        return self._d["char"].get("name") or ""

    def ling_gen(self) -> str:
        lg = self._d["char"].get("linggen")
        return lg.get("id", "未测") if lg else "未测"

    def ling_gen_data(self) -> Optional[dict]:
        return self._d["char"].get("linggen")

    def const_data(self) -> dict:
        return self._d["char"].get("constitution") or {}

    # ---- 体质被动 ----

    @staticmethod
    def _parse_passive(passive) -> dict:
        """'cult_extra:1,break_bonus:0.10' → {'cult_extra': '1', 'break_bonus': '0.10'}"""
        result = {}
        if not passive:
            return result
        for part in str(passive).split(","):
            if ":" in part:
                k, v = part.split(":", 1)
                result[k.strip()] = v.strip()
        return result

    def has_const_passive(self, key: str) -> bool:
        return key in self._parse_passive(self.const_data().get("passive"))

    def get_const_passive(self, key: str) -> Optional[str]:
        return self._parse_passive(self.const_data().get("passive")).get(key)

    # ---- 修炼倍率 = 灵根 cultRate + 体质 cult_extra ----

    def cult_rate(self) -> float:
        lg = self._d["char"].get("linggen")
        rate = lg.get("cultRate", 0.5) if lg else 0.5
        extra = self.get_const_passive("cult_extra")
        if extra is not None:
            rate += float(extra)
        return rate

    # ---- 突破加成 = 灵根 breakBonus + 体质 break_bonus ----

    def break_bonus(self) -> float:
        lg = self._d["char"].get("linggen")
        bonus = lg.get("breakBonus", 0) if lg else 0
        extra = self.get_const_passive("break_bonus")
        if extra is not None:
            bonus += float(extra)
        return bonus

    # ================= 属性 / 境界 =================

    @staticmethod
    def _attr_key(k: str) -> str:
        """中文属性键归一化为 ASCII (未知键原样保留)。"""
        return ATTR_CN2EN.get(k, k)

    def mod_attr(self, k: str, d) -> None:
        k = self._attr_key(k)
        attrs = self._d["attrs"]
        attrs[k] = attrs.get(k, 0) + d
        if attrs[k] < 0:
            attrs[k] = 0

    def set_realm(self, i: int) -> None:
        self._d["realm"] = i
        self._d["realmStage"] = 0  # 新境界从小阶段 0 开始
        self.faqi_sync_capacity()
        self._gongfa_sync_slots()

    def daily_passive_mp(self) -> int:
        """每日被动修炼灵力（灵根决定基础效率）。天灵根 3/日，地灵根/真灵根 2，伪灵根/凡体 1。"""
        rate = self.cult_rate()  # 灵根倍率（不含功法/体质叠加）
        # cult_rate() 已含体质 passives，这里只取灵根原始倍率
        lg = (self.data.get("char") or {}).get("linggen") or {}
        base = (lg.get("cultRate") or 0.5) * 1.5
        return max(1, round(base))

    def realm_stage_max(self) -> bool:
        """当前小阶段是否为该境界最后一阶（满阶需手动突破）。"""
        info = self.realm_info()
        if not info:
            return True
        return self._d.get("realmStage", 0) >= (info.get("stageMax") or 0)

    def realm_stage_up(self) -> bool:
        """修炼满当前阶段灵气后自动提升一阶（最后一阶返回 False 表示需手动突破）。"""
        info = self.realm_info()
        if not info or not info.get("toNext"):
            return False
        stage = self._d.get("realmStage", 0)
        if stage >= (info.get("stageMax") or 0):
            return False
        # 消耗灵力 + 发放小阶段属性
        cost = info["toNext"]
        cur_mp = self._d["attrs"].get("mp", 0)
        if cur_mp < cost:
            return False
        self.mod_attr("灵力", -cost)
        self._d["realmStage"] = stage + 1
        gains = (info.get("stageGain") or [None] * (stage + 1))
        if stage < len(gains) and gains[stage]:
            for k, v in gains[stage].items():
                self.mod_attr(k, v)
        return True

    def realm_name(self) -> str:
        info = self.realm_info()
        if not info:
            return "未知"
        base = info.get("name", "未知")
        stage = self._d.get("realmStage", 0)
        labels = info.get("stageLabels") or []
        if labels and 0 <= stage < len(labels):
            return "%s%s" % (base, labels[stage])
        return base

    def realm_info(self) -> Optional[dict]:
        realms = self.config.get("realms", [])
        i = self._d["realm"]
        if not (isinstance(i, int) and 0 <= i < len(realms)):
            return None
        info = dict(realms[i])
        stage = self._d.get("realmStage", 0)
        to_next_list = info.get("stageToNext") or []
        if to_next_list and 0 <= stage < len(to_next_list):
            info["toNext"] = to_next_list[stage]
        info["stage"] = stage
        info["stageMax"] = len(to_next_list) - 1 if to_next_list else 0
        return info

    # ---- 三组属性: 基础 / 加成(装备+功法) / 生效 ----

    def effective(self) -> dict:
        base = AttrDict(self._d["attrs"])
        bonus = AttrDict()

        def add(stats):
            for k, v in (stats or {}).items():
                bonus[k] = bonus.get(k, 0) + v

        for item_id in self._d["equipment"].values():
            item = self.items_table.get(item_id) if item_id else None
            if item and item.get("stats"):
                add(item["stats"])
        # 法器阵列：存放即提供属性加成（无需上阵）
        for item_id in self.faqi_data()["array"]:
            item = self.items_table.get(item_id) if item_id else None
            if item and item.get("stats"):
                add(item["stats"])
        for gf in self._equipped_hearts():
            if gf and gf.get("passive"):
                add(gf["passive"])

        eff = AttrDict(base)
        for k, v in bonus.items():
            eff[k] = eff.get(k, 0) + v
        return {"base": base, "bonus": bonus, "eff": eff}

    # ================= 物品 / 灵石 =================

    def add_item(self, item_id: str) -> None:
        self._d["items"].append(item_id)

    def remove_item(self, item_id: str) -> None:
        items = self._d["items"]
        if item_id in items:
            items.remove(item_id)

    def has_item(self, item_id: str) -> bool:
        return item_id in self._d["items"]

    def mod_stones(self, d) -> None:
        self._d["stones"] = max(0, self._d.get("stones", 0) + d)

    # ================= 装备 =================

    def equip(self, item_id: str) -> bool:
        item = self.items_table.get(item_id)
        if not item or not item.get("slot") or not self.has_item(item_id):
            return False
        slot = item["slot"]
        self.unequip(slot)
        self.remove_item(item_id)
        self._d["equipment"][slot] = item_id
        return True

    def unequip(self, slot: str) -> None:
        current = self._d["equipment"].get(slot)
        if current:
            self._d["equipment"][slot] = None
            self.add_item(current)

    # ================= 法器阵列 =================
    # array: 仓库网格 [id|None]*capacity，存放即提供 stats 加成
    # deployed: 上阵 [id|None]*3，战斗中概率触发 battle 效果；必须是 array 中的法器

    def faqi_capacity(self, realm_idx: Optional[int] = None) -> int:
        caps = self.config.get("faqiCapacity") or [6]
        i = self._d["realm"] if (realm_idx is None and self.data) else (realm_idx or 0)
        return caps[i] if 0 <= i < len(caps) else caps[-1]

    def faqi_data(self) -> dict:
        """兼容旧档：缺失时按当前境界初始化。"""
        fq = self._d.get("faqi")
        if not isinstance(fq, dict):
            fq = {"array": [None] * self.faqi_capacity(),
                  "deployed": [None] * int(self.config.get("faqiDeployMax", 3))}
            self._d["faqi"] = fq
        return fq

    def faqi_sync_capacity(self) -> None:
        """境界提升后扩容（只增不减）。"""
        fq = self.faqi_data()
        cap = self.faqi_capacity()
        while len(fq["array"]) < cap:
            fq["array"].append(None)

    def faqi_put(self, item_id: str) -> bool:
        """背包 → 阵列第一个空格。要求是法器类物品。"""
        item = self.items_table.get(item_id)
        if not item or item.get("type") != "法器" or not self.has_item(item_id):
            return False
        fq = self.faqi_data()
        for i, cell in enumerate(fq["array"]):
            if cell is None:
                fq["array"][i] = item_id
                self.remove_item(item_id)
                return True
        return False  # 阵列已满

    def faqi_take(self, item_id: str) -> bool:
        """阵列 → 背包；已上阵的自动下阵。"""
        fq = self.faqi_data()
        if item_id not in fq["array"]:
            return False
        fq["array"][fq["array"].index(item_id)] = None
        if item_id in fq["deployed"]:
            fq["deployed"][fq["deployed"].index(item_id)] = None
        self.add_item(item_id)
        return True

    def faqi_deploy(self, item_id: str) -> bool:
        """阵列中的法器上阵（占第一个空上阵位）。"""
        fq = self.faqi_data()
        if item_id not in fq["array"] or item_id in fq["deployed"]:
            return False
        for i, cell in enumerate(fq["deployed"]):
            if cell is None:
                fq["deployed"][i] = item_id
                return True
        return False  # 上阵已满

    def faqi_undeploy(self, item_id: str) -> bool:
        fq = self.faqi_data()
        if item_id not in fq["deployed"]:
            return False
        fq["deployed"][fq["deployed"].index(item_id)] = None
        return True

    def faqi_deployed_items(self) -> list:
        """上阵法器的完整条目（战斗触发用）。"""
        out = []
        for iid in self.faqi_data()["deployed"]:
            it = self.items_table.get(iid) if iid else None
            if it:
                out.append({"id": iid, **it})
        return out

    # ================= 功法 =================

    def _gongfa_slots(self, realm_idx: Optional[int] = None) -> dict:
        """当前境界的功法槽位配置 {heart: N, skill: N}。"""
        slots_list = self.config.get("gongfaSlots") or []
        i = self._d["realm"] if (realm_idx is None and self.data) else (realm_idx or 0)
        if 0 <= i < len(slots_list):
            return dict(slots_list[i])
        return {"heart": 0, "skill": 0}

    def _gongfa_sync_slots(self) -> None:
        """按当前境界扩容功法槽位（只增不减）。"""
        slots = self._gongfa_slots()
        gf = self._d["gongfa"]
        for kind in ("equipped_heart", "equipped_skill"):
            target = slots.get("heart" if kind == "equipped_heart" else "skill", 0)
            arr = gf.setdefault(kind, [])
            while len(arr) < target:
                arr.append(None)

    def learn_gongfa(self, gongfa_id: str) -> None:
        if gongfa_id not in self.gongfa_table:
            return
        gf = self._d["gongfa"]
        if gongfa_id in gf["learned"]:
            return
        gf["learned"].append(gongfa_id)
        # 学得后尝试自动装配到第一个空槽
        self._gongfa_sync_slots()
        ginfo = self.gongfa_table[gongfa_id]
        kind = ginfo.get("kind")
        arr_key = "equipped_heart" if kind == "心法" else ("equipped_skill" if kind == "术法" else None)
        if arr_key and arr_key in gf:
            arr = gf[arr_key]
            for idx in range(len(arr)):
                if arr[idx] is None:
                    arr[idx] = gongfa_id
                    break

    def equip_gongfa(self, gongfa_id: str, slot_index: int) -> bool:
        """装备已学功法到指定槽位（自动判断心法/术法）。"""
        gf = self._d["gongfa"]
        if gongfa_id not in gf.get("learned", []):
            return False
        ginfo = self.gongfa_table.get(gongfa_id)
        if not ginfo:
            return False
        kind = ginfo.get("kind")
        arr_key = "equipped_heart" if kind == "心法" else ("equipped_skill" if kind == "术法" else None)
        if not arr_key:
            return False
        self._gongfa_sync_slots()
        arr = gf[arr_key]
        if slot_index < 0 or slot_index >= len(arr):
            return False
        # 先卸下该槽位旧功法
        old = arr[slot_index]
        if old == gongfa_id:
            return True  # 已在槽位上
        # 如果该功法已在其他槽位，先卸下
        for i in range(len(arr)):
            if arr[i] == gongfa_id:
                arr[i] = None
        arr[slot_index] = gongfa_id
        return True

    def unequip_gongfa(self, kind: str, slot_index: int) -> bool:
        """卸下指定槽位的功法。kind: 'heart' 或 'skill'。"""
        gf = self._d["gongfa"]
        arr_key = "equipped_heart" if kind == "heart" else ("equipped_skill" if kind == "skill" else None)
        if not arr_key:
            return False
        arr = gf.get(arr_key, [])
        if slot_index < 0 or slot_index >= len(arr):
            return False
        arr[slot_index] = None
        return True

    def _equipped_hearts(self) -> list:
        """返回所有已装备心法的条目列表（按槽位顺序，空槽跳过）。"""
        gf = self._d["gongfa"]
        arr = gf.get("equipped_heart", [])
        return [self.gongfa_table[gid] for gid in arr if gid and gid in self.gongfa_table]

    def equipped_skills(self) -> list:
        """返回所有已装备术法的 (id, entry) 列表（按槽位顺序，空槽跳过）。"""
        gf = self._d["gongfa"]
        arr = gf.get("equipped_skill", [])
        return [(gid, self.gongfa_table[gid]) for gid in arr if gid and gid in self.gongfa_table]

    def active_gongfa(self) -> Optional[dict]:
        """返回第一个已装备的心法（维持旧接口兼容；修炼倍率取首部心法）。"""
        hearts = self._equipped_hearts()
        return hearts[0] if hearts else None

    def set_active_gongfa(self, gongfa_id: str) -> None:
        """将已学功法设为第一个心法槽的功法（兼容旧接口）。"""
        gf = self._d["gongfa"]
        if gongfa_id in gf.get("learned", []):
            ginfo = self.gongfa_table.get(gongfa_id)
            if ginfo and ginfo.get("kind") == "心法":
                self.equip_gongfa(gongfa_id, 0)
            elif ginfo:
                self.equip_gongfa(gongfa_id, 0)

    # ================= 标记 / 日志 / 插值 =================

    def set_flag(self, name: str) -> None:
        self._d["flags"][name] = True

    def clear_flag(self, name: str) -> None:
        self._d["flags"].pop(name, None)

    def has_flag(self, name: str) -> bool:
        return bool(self._d["flags"].get(name))

    def push_log(self, text: str) -> None:
        log = self._d["log"]
        log.append(text)
        while len(log) > self.LOG_MAX:
            log.pop(0)

    def interpolate(self, text: Optional[str]) -> str:
        """文本插值: {name} {origin} {linggen} {realm} {constitution} 及世界名"""
        origin = self._d["char"].get("origin") or {}
        text = (
            (text or "")
            .replace("{name}", self.char_name())
            .replace("{realm}", self.realm_name())
            .replace("{origin}", origin.get("id") or "农家子弟")
            .replace("{linggen}", self.ling_gen())
            .replace("{constitution}", self.const_data().get("id") or "无")
        )
        # World name interpolation -- sect-aware
        wn = self.config.get("worldNames", {})
        sect_info = {}
        sect_entry = self._d.get("sect") if isinstance(self._d.get("sect"), dict) else None
        if sect_entry and sect_entry.get("name"):
            sname = sect_entry["name"]
            for _sid, _sd in (self.sects_table or {}).items():
                if _sd.get("name") == sname:
                    sect_info = _sd
                    break
        sc = sect_info.get("culture", {}) if isinstance(sect_info, dict) else {}
        text = (text
            .replace("{village}", wn.get("village", ""))
            .replace("{sect}", sect_info.get("name") or wn.get("sect", ""))
            .replace("{sectMountain}", sc.get("mountain") or wn.get("sectMountain", ""))
            .replace("{town}", wn.get("town", ""))
            .replace("{banditLair}", wn.get("banditLair", ""))
            .replace("{banditChief}", wn.get("banditChief", ""))
        )
        return text

    # ================= 宗门 =================

    def join_sect(self, name):
        """加入宗门"""
        sect_data = self.sects_table.get(name)
        if not sect_data:
            for _sid, _sd in (self.sects_table or {}).items():
                if _sd.get("name") == name: sect_data = _sd; break
        starter = (sect_data.get("economy", {}) or {}).get("starterStones", 0) if sect_data else 0
        self._d["sect"] = {"name": name, "joined_at": self._d.get("day", 1), "contribution": starter}
        self.set_flag("宗门弟子")


    def sect_info(self) -> Optional[dict]:
        """返回当前宗门完整数据（含 culture），未加入则 None

        注：sect_table key 是 ID（如 qingyun_zong），
        join_sect 存的是名字（如 青云宗），按 name 值匹配。
        """
        sect_entry = self._d.get("sect")
        if not isinstance(sect_entry, dict) or not sect_entry.get("name"):
            return None
        sname = sect_entry["name"]
        for sid, sdata in self.sects_table.items():
            if sdata.get("name") == sname or sid == sname:
                return sdata
        return None  # 名不匹配，降级为 config worldNames

    def leave_sect(self):
        """退出宗门"""
        self._d["sect"] = None
        self.clear_flag("宗门弟子")

    def mod_contribution(self, delta: int) -> int:
        """增减宗门贡献值，返回新值。未入宗门时无操作返回 0。"""
        st = self._d.get("sect")
        if not isinstance(st, dict): return 0
        st["contribution"] = max(0, st.get("contribution", 0) + delta)
        return st["contribution"]


    def sect_name(self):
        """返回宗门名称，未加入返回 None"""
        st = self._d.get("sect")
        return st["name"] if st else None

    # ================= 序列化 (对应 server.js stateSnapshot) =================

    def to_dict(self) -> dict:
        d = self._d
        eff = self.effective()

        def item_brief(item_id):
            it = self.items_table.get(item_id)
            if not it:
                return {"id": item_id, "name": item_id, "type": "未知"}
            return {"id": item_id, "name": it.get("name"), "type": it.get("type"),
                    "rarity": it.get("rarity") or "凡品", "desc": it.get("desc"),
                    "slot": it.get("slot"), "stats": it.get("stats"),
                    "battle": it.get("battle"),
                    "usable": isinstance(it.get("use"), dict)}

        def equip_brief(item_id):
            it = self.items_table.get(item_id) if item_id else None
            if not it:
                return None
            return {"id": item_id, "name": it.get("name"), "rarity": it.get("rarity"),
                    "stats": it.get("stats")}

        def gongfa_brief(gid):
            g = self.gongfa_table.get(gid)
            if not g:
                return {"id": gid, "name": gid}
            return {"id": gid, "name": g.get("name"), "cultivateRate": g.get("cultivateRate"),
                    "kind": g.get("kind"), "grade": g.get("grade"),
                    "passive": g.get("passive"), "battle": g.get("battle"),
                    "desc": g.get("desc"), "requireRealm": g.get("requireRealm")}

        gf = d.get("gongfa") if isinstance(d.get("gongfa"), dict) else {}
        self._gongfa_sync_slots()
        slots = self._gongfa_slots()
        fq = self.faqi_data()

        def faqi_brief(iid):
            if not iid:
                return None
            it = self.items_table.get(iid)
            if not it:
                return {"id": iid, "name": iid}
            return {"id": iid, "name": it.get("name"), "rarity": it.get("rarity") or "凡品",
                    "desc": it.get("desc"), "stats": it.get("stats"),
                    "battle": it.get("battle"), "deployed": iid in fq["deployed"]}

        return {
            "name": self.char_name(),
            "realm": self.realm_name(),
            "realmIdx": d["realm"],
            "realmStage": d.get("realmStage", 0),
            "linggen": self.ling_gen(),
            "constitution": self.const_data().get("id"),
            "day": d.get("day", 1),
            "stones": d.get("stones", 0),
            "attrs": _en2cn(eff["eff"]),
            "attrsBase": _en2cn(d["attrs"]),
            "items": [item_brief(i) for i in d.get("items", [])],
            "equipment": {slot: equip_brief(d["equipment"].get(slot))
                          for slot in self.config.get("equipSlots", [])},
            "faqi": {"array": [faqi_brief(i) for i in fq["array"]],
                     "deployed": [faqi_brief(i) for i in fq["deployed"]],
                     "capacity": len(fq["array"]),
                     "deployMax": int(self.config.get("faqiDeployMax", 3))},
            "gongfa": {"learned": [gongfa_brief(g) for g in gf.get("learned", [])],
                       "equipped_heart": [gongfa_brief(g) if g else None for g in gf.get("equipped_heart", [])],
                       "equipped_skill": [gongfa_brief(g) if g else None for g in gf.get("equipped_skill", [])],
                       "heartSlots": slots.get("heart", 0),
                       "skillSlots": slots.get("skill", 0)},
            "flags": list(d.get("flags", {}).keys()),
            "log": d.get("log", [])[-20:],
            "realmInfo": self.realm_info(),
            "sect": d.get("sect"),
            "sectInfo": self.sect_info(),
        }

    # ================= 文件存档 (saves/slot_<slot>.json) =================

    def _slot_path(self, slot) -> str:
        return os.path.join(self.saves_dir, f"slot_{slot}.json")

    def export_data(self) -> dict:
        """内部 state → 存档格式 state (属性键 ASCII → 中文, 其余原样)。供 save()/导出接口使用。"""
        st = dict(self._d)
        st["attrs"] = _en2cn(self._d["attrs"])
        return st

    def save(self, slot=1) -> str:
        """存档到 saves/slot_<slot>.json (slot 可为数字或 'auto'), 返回文件路径。"""
        d = self._d
        os.makedirs(self.saves_dir, exist_ok=True)
        scene = self.scenes_table.get(d.get("scene")) or {}
        record = {
            "version": self.SAVE_VERSION,
            "meta": {
                "name": self.char_name(),
                "realm": self.realm_name(),
                "sceneTitle": scene.get("title") or d.get("scene"),
                "time": int(time.time() * 1000),  # 毫秒, 同 JS Date.now()
            },
            "state": self.export_data(),
        }
        path = self._slot_path(slot)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False)
        return path

    def load(self, slot=1) -> bool:
        """从 saves/slot_<slot>.json 读档并升级到当前格式。成功返回 True。"""
        try:
            with open(self._slot_path(slot), "r", encoding="utf-8") as f:
                record = json.load(f)
        except (OSError, ValueError):
            return False
        state = record.get("state") if isinstance(record, dict) else None
        if not isinstance(state, dict) or not state.get("scene"):
            return False
        self.data = self.upgrade(state)
        return True

    def upgrade(self, state: dict) -> dict:
        """旧档升级 (对应 server/save.js Save.upgrade) + 中文属性键 → ASCII。

        导入外部存档时也应经由本方法归一化 (server 的 /api/import 路径)。
        """
        # 属性: 归一化为 AttrDict (中文键 → ASCII); 缺失/非数值 (含 null) 回填初始值
        attrs = AttrDict(state.get("attrs") or {})
        for k, v in self.config.get("initialAttrs", {}).items():
            if not isinstance(attrs.get(k), (int, float)) or isinstance(attrs.get(k), bool):
                attrs[k] = v
        state["attrs"] = attrs

        # 装备槽位补全
        equipment = state.get("equipment") if isinstance(state.get("equipment"), dict) else {}
        for slot in self.config.get("equipSlots", []):
            equipment.setdefault(slot, None)
        state["equipment"] = equipment

        # 功法 / 日志 / 天数 / 物品 / 标记 / 灵石
        gf = state.get("gongfa") if isinstance(state.get("gongfa"), dict) else {}
        gf.setdefault("learned", [])
        # 旧档迁移：{learned, active} → {learned, equipped_heart, equipped_skill}
        old_active = gf.pop("active", None) if "active" in gf else None
        realm = state.get("realm") or 0
        slots_list = self.config.get("gongfaSlots") or []
        slot_cfg = slots_list[realm] if 0 <= realm < len(slots_list) else {"heart": 0, "skill": 0}
        for key, cfg_key in (("equipped_heart", "heart"), ("equipped_skill", "skill")):
            arr = gf.get(key)
            if not isinstance(arr, list):
                arr = []
            target = slot_cfg.get(cfg_key, 0)
            while len(arr) < target:
                arr.append(None)
            gf[key] = arr
        # 将旧 active 功法迁移到合适的装备槽
        if old_active and old_active in self.gongfa_table:
            ginfo = self.gongfa_table[old_active]
            kind = ginfo.get("kind")
            if kind == "心法" and gf.get("equipped_heart"):
                arr = gf["equipped_heart"]
                for i in range(len(arr)):
                    if arr[i] is None:
                        arr[i] = old_active
                        break
            elif kind == "术法" and gf.get("equipped_skill"):
                arr = gf["equipped_skill"]
                for i in range(len(arr)):
                    if arr[i] is None:
                        arr[i] = old_active
                        break
        state["gongfa"] = gf
        state["log"] = state.get("log") or []
        state["day"] = state.get("day") or 1
        state["items"] = state.get("items") or []
        state["flags"] = state.get("flags") or {}
        state["stones"] = state.get("stones") or 0
        if "realmStage" not in state:
            state["realmStage"] = 0

        # 法器阵列: 旧档缺失时按境界初始化; 容量只增不减
        realm = state.get("realm") or 0
        caps = self.config.get("faqiCapacity") or [6]
        cap = caps[realm] if 0 <= realm < len(caps) else caps[-1]
        fq = state.get("faqi") if isinstance(state.get("faqi"), dict) else {}
        arr = fq.get("array") if isinstance(fq.get("array"), list) else []
        while len(arr) < cap:
            arr.append(None)
        dep = fq.get("deployed") if isinstance(fq.get("deployed"), list) else []
        dmax = int(self.config.get("faqiDeployMax", 3))
        dep = (dep + [None] * dmax)[:dmax]
        state["faqi"] = {"array": arr, "deployed": dep}

        # 角色: 按 id 用当前数据表还原条目 (兼容旧客户端缩写字段), 缺失走默认
        char = state.get("char") if isinstance(state.get("char"), dict) else {}
        char["name"] = char.get("name") or self.config.get("playerName") or "无名"
        char["linggen"] = self._resolve_entry("linggen", char.get("linggen"), "伪灵根")
        char["constitution"] = self._resolve_entry("constitution", char.get("constitution"), "无")
        char["origin"] = self._resolve_entry("origin", char.get("origin"), "农家子弟")
        state["char"] = char
        return state


# ================= 自检 =================
if __name__ == "__main__":
    gs = GameState()
    gs.new_game({"name": "测试者", "linggen": "天灵根", "constitution": "武骨", "origin": "修仙世家"})
    print("场景:", gs.data["scene"], "| 灵石:", gs.data["stones"])
    print("有效属性:", gs.effective()["eff"])
    print("插值:", gs.interpolate("{name}({origin}/{linggen}/{constitution}) — {realm}"))
    print("快照键:", sorted(gs.to_dict().keys()))


