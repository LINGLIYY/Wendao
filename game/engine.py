# -*- coding: utf-8 -*-
"""
修仙・问道 —— 游戏引擎（Python 版）

移植自 server/engine.js + server/battle.js。
AI 安全原则：调度权在本地、数值权在本地、AI 只填空。

数据来源
--------
data/ 下的 JSON 文件（权威数据源，直接编辑 JSON 即可）：
  scenes / events / events_fixed / rewards / enemies / skills / battle_actions
  以及支撑表 config / items / gongfa

状态归属
--------
引擎不持有游戏状态：GameState 实例由外部传入（构造函数注入），引擎只通过其
公开方法读写。GameState 需要提供的接口（对应 server/state.js 的 snake_case 移植）：

  属性  data                  存档字典 {scene, attrs, realm, day, stones, items,
                              equipment, gongfa:{learned,active}, log, flags, char}
  必需  effective()           -> {'base':…, 'bonus':…, 'eff':…} 实时属性
        mod_attr(k, d)        属性增减（下限 0）
        add_item(id) / remove_item(id) / has_item(id)
        set_flag(f) / clear_flag(f) / has_flag(f)
        learn_gongfa(id)      习得功法
        set_realm(i)          设置境界
        active_gongfa()       -> 主修功法 dict 或 None
        cult_rate()           灵根×体质综合修炼倍率
        break_bonus()         灵根+体质合计突破加成
        has_const_passive(k)  体质被动判断（如 "cult_extra"）
        push_log(text)        写入事件日志
        new_game(char=None)   重开新档
  可选  save(slot)            存档（goto/结果页后自动调用 save('auto')）
        interpolate(text)     文本占位符替换（缺省时引擎自带兜底实现）
        snapshot()/to_dict()  状态快照（缺省时引擎按 server.js 同构自建）
        mod_stones(d)         灵石增减（缺省时直接写 data['stones']）
        char_name() / realm_name() / realm_info()（缺省时经 data + config 兜底）

属性键兼容：数据表（场景/敌人/奖励等）一律中文属性键；GameState 内部可用中文键
或 ASCII 键（state.py：气血→hp 灵力→mp 攻击→atk 防御→def 悟性→wisdom 勇气→courage）。
引擎读取 effective()['eff'] 与 data['attrs'] 时两种键都兼容，写入统一走 mod_attr。

渲染约定
--------
所有公开方法返回渲染数据::

    {'scene': {'title', 'text', 'choices', 'sceneId'},
     'state': {...状态快照...},
     'battle': None | {round, enemy, player, log, actions}}

choices 已序列化（剔除函数引用与内部结构，附 idx 供客户端回传）；
choose() 接受 idx 下标 / 序列化字典 / 原始字典三种形式，并会把客户端回传的
序列化选项还原为最近一次渲染的原始选项（修复 JS 版 effect 被 '[效果]' 标记
覆盖后效果丢失的问题）。

另提供 server.py 适配层使用的访问器：
  current_scene()    最近一次渲染的场景快照 {title, text, choices, sceneId}
  battle_snapshot()  当前战斗态快照（无战斗时 None）
"""

import json
import math
import os
import random

_ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA_DIR = os.path.join(_ENGINE_DIR, "data")

# 属性键映射：场景/物品/敌人等数据表一律中文键；GameState 内部可能使用 ASCII 键
# （state.py：气血→hp 灵力→mp 攻击→atk 防御→def 悟性→wisdom 勇气→courage）。
# 引擎读取属性时两种键都兼容，写入统一走 state.mod_attr（其自带归一化）。
ATTR_CN2EN = {"气血": "hp", "灵力": "mp", "攻击": "atk",
              "防御": "def", "悟性": "wisdom", "勇气": "courage"}


def attr_get(attrs, key, default=0):
    """从属性字典取值：优先原键（中文），其次 ASCII 映射键。"""
    if not attrs:
        return default
    if key in attrs:
        return attrs[key]
    alt = ATTR_CN2EN.get(key)
    if alt is not None and alt in attrs:
        return attrs[alt]
    return default


def attr_set_abs(attrs, key, value):
    """向属性字典写绝对值：写到已存在的键（中文或 ASCII 映射），都不存在时写映射键。"""
    if key in attrs:
        attrs[key] = value
        return
    alt = ATTR_CN2EN.get(key)
    if alt is not None and alt in attrs:
        attrs[alt] = value
        return
    attrs[alt or key] = value


def js_round(x):
    """等价 JS Math.round：.5 一律向正无穷取整（Python round 是银行家舍入）。"""
    return int(math.floor(x + 0.5))


def _bar(label, cur, max_v, pct):
    """文本血条（对应 battle.js 的 bar()）。"""
    w = 20
    f = min(w, max(1, js_round(pct / 100.0 * w)))
    return "%s  %d/%d\n[%s%s] %d%%" % (label, cur, max_v, "█" * f, "░" * (w - f), pct)


class GameEngine:
    """游戏引擎 —— 场景调度 / 修炼 / 突破 / 事件抽取 / 奖励结算 / 回合制战斗。"""

    # 序列化选项时透传的字段（对应 server.js currentScene()；effect 单独处理）
    _CHOICE_FIELDS = ("text", "next", "roll", "eventDraw", "rewardTable",
                      "action", "battleAction", "nextByOrigin", "nextByLinggen",
                      "restart", "cond")

    def __init__(self, state, data_dir=None):
        self.state = state
        self.data_dir = data_dir or DEFAULT_DATA_DIR
        # —— 核心七表 ——
        self.scenes = self._load_json("scenes")
        self.events = self._load_json("events")
        self.events_fixed = self._load_json("events_fixed")
        self.rewards = self._load_json("rewards")
        self.enemies = self._load_json("enemies")
        self.skills = self._load_json("skills")
        self.battle_actions = self._load_json("battle_actions")
        # —— 支撑表（战斗物品 / 奖励归类 / 境界配置）——
        self.config = self._load_json("config")
        self.items = self._load_json("items")
        self.gongfa = self._load_json("gongfa", required=False) or {}

        self.battle = GameEngine.Battle(self)
        self._last_choices = []  # 最近一次渲染的原始选项（用于回传解析）
        self._last_scene = None  # 最近一次渲染的场景快照（server.py 适配层读取）

    # ================= 数据加载 =================

    def _load_json(self, name, required=True):
        path = os.path.join(self.data_dir, name + ".json")
        if not os.path.exists(path):
            if required:
                raise FileNotFoundError("缺少数据文件 %s" % path)
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    # ================= 场景调度 =================

    def get_scene(self, scene_id):
        """统一场景查找：固定场景 > 固定事件 > 动态事件。"""
        if scene_id is None:
            return None
        return (self.scenes.get(scene_id)
                or self.events_fixed.get(scene_id)
                or self.events.get(scene_id))

    def goto(self, scene_id, skip_enter=False):
        """场景跳转：触发 onEnter 效果、写日志、自动存档、过滤可见选项。"""
        scene = self.get_scene(scene_id)
        if scene is None:
            return self._missing_scene(scene_id)
        self.state.data["scene"] = scene_id
        if not skip_enter:
            if scene.get("onEnter"):
                self.apply_effect(scene["onEnter"])
            self.state.push_log("【" + str(scene.get("title", scene_id)) + "】")
        self._auto_save()
        choices = [c for c in (scene.get("choices") or []) if self.check_cond(c.get("cond"))]
        return self._render(scene, choices)

    def choose(self, choice):
        """处理玩家选择。

        choice 可为：渲染 choices 的下标（int）/ 客户端回传的序列化字典 /
        原始选项字典。支持 nextByOrigin、nextByLinggen、roll、内置行动、
        battle、eventDraw、rewardTable、restart。
        """
        c = self._resolve_choice(choice)

        if c.get("restart"):
            self.battle.reset()
            self.state.new_game()
            start = self.state.data.get("scene") or self.config.get("startScene")
            return self.goto(start)

        self.state.push_log("》 " + str(c.get("text", "")))
        if isinstance(c.get("effect"), dict):
            self.apply_effect(c["effect"])

        # 战斗中的回合行动（attack / defend / flee / use:<item_id>）
        if c.get("action") == "battle":
            if not self.battle.active:  # 过期点击兜底：回到当前场景
                return self.goto(self.state.data.get("scene"), skip_enter=True)
            return self.battle.player_act(c.get("battleAction"))

        # 内置行动
        if c.get("action") == "cultivate":
            return self.cultivate()
        if c.get("action") == "breakthrough":
            return self.breakthrough()
        # 进入交互式战斗
        if c.get("battle"):
            return self.battle.start(c["battle"])
        # 奖励表结算
        if c.get("rewardTable"):
            return self.settle_reward(c["rewardTable"], c.get("next"))
        # 事件池抽取（外出历练消耗一日，含被动修炼）
        if c.get("eventDraw"):
            self._passive_cultivate(1)
            self.state.data["day"] = self.state.data.get("day", 1) + 1
            return self.draw_event(c["eventDraw"])

        nxt = c.get("next")
        # 出身路由：按角色出身自动分流
        if c.get("nextByOrigin"):
            oid = ((self.state.data.get("char") or {}).get("origin") or {}).get("id") or "农家子弟"
            m = c["nextByOrigin"]
            nxt = m.get(oid) or m.get("_default") or nxt
        # 灵根路由：按角色灵根自动分流
        if c.get("nextByLinggen"):
            lid = ((self.state.data.get("char") or {}).get("linggen") or {}).get("id") or "伪灵根"
            m = c["nextByLinggen"]
            nxt = m.get(lid) or m.get("_default") or nxt
        # 随机判定
        if c.get("roll"):
            r = c["roll"]
            nxt = r.get("success") if random.random() < r.get("chance", 0) else r.get("fail")
        if nxt is None:
            # next 为空（固定事件占位 next: null）：停留当前场景
            return self.goto(self.state.data.get("scene"), skip_enter=True)
        return self.goto(nxt)

    def show_result(self, title, text, next_id):
        """结果展示页：单个"继 续"选项跳回 next_id。"""
        self.state.push_log("【" + str(title) + "】")
        self._auto_save()
        return self._render({"title": title, "text": text},
                            [{"text": "继 续", "next": next_id}])

    # ================= 通用判定 / 效果结算 =================

    def check_cond(self, cond):
        """条件判定：attrs（gte/lte，按实时属性）/ realm / flags / items / gongfa。"""
        if not cond:
            return True
        if cond.get("attrs"):
            eff = self.state.effective()["eff"]
            for k, r in cond["attrs"].items():
                v = attr_get(eff, k, 0)
                if "gte" in r and v < r["gte"]:
                    return False
                if "lte" in r and v > r["lte"]:
                    return False
        if cond.get("realm"):
            realm = self.state.data.get("realm", 0)
            r = cond["realm"]
            if "gte" in r and realm < r["gte"]:
                return False
            if "lte" in r and realm > r["lte"]:
                return False
        for f in cond.get("flags") or []:
            if not self.state.has_flag(f):
                return False
        for it in cond.get("items") or []:
            if not self.state.has_item(it):
                return False
        learned = (self.state.data.get("gongfa") or {}).get("learned") or []
        for g in cond.get("gongfa") or []:
            if g not in learned:
                return False
        return True

    def apply_effect(self, eff):
        """效果结算：attrs / addItems / removeItems / setFlags / clearFlags /
        realm / learnGongfa / day（推进时日）。"""
        if not isinstance(eff, dict):
            return
        for k, v in (eff.get("attrs") or {}).items():
            self.state.mod_attr(k, v)
        for iid in eff.get("addItems") or []:
            self.state.add_item(iid)
        for iid in eff.get("removeItems") or []:
            self.state.remove_item(iid)
        for f in eff.get("setFlags") or []:
            self.state.set_flag(f)
        for f in eff.get("clearFlags") or []:
            self.state.clear_flag(f)
        if "realm" in eff and eff["realm"] is not None:
            self.state.set_realm(eff["realm"])
        for g in eff.get("learnGongfa") or []:
            self.state.learn_gongfa(g)
        if "sect" in eff and isinstance(eff["sect"], dict):
            self.state.join_sect(eff["sect"]["name"])
        if eff.get("clearSect"):
            self.state.leave_sect()
        if eff.get("day"):
            days = int(eff["day"])
            self._passive_cultivate(days)
            self.state.data["day"] = self.state.data.get("day", 1) + days

    # ================= 修炼 / 突破 =================

    def use_item(self, item_id):
        """场景外使用物品（背包面板调用）。

        返回 (ok, message)。消耗品应用 use 效果后移除；
        功法书学习后消耗；非可用物品返回失败。"""
        it = self.items.get(item_id)
        if not it or not self.state.has_item(item_id):
            return False, "物品不存在"
        use = it.get("use")
        if not isinstance(use, dict):
            return False, "%s 无法直接使用" % it.get("name", item_id)
        self.apply_effect(use)
        if it.get("consumable"):
            self.state.remove_item(item_id)
        # 概括反馈文本
        parts = []
        for k, v in (use.get("attrs") or {}).items():
            parts.append("%s %+d" % (k, v))
        for g in use.get("learnGongfa") or []:
            gf = self.gongfa.get(g) or {}
            parts.append("习得功法「%s」" % gf.get("name", g))
        msg = "使用了 %s" % it.get("name", item_id)
        if parts:
            msg += "：" + "，".join(parts)
        self.state.push_log("》 " + msg)
        return True, msg

    def _passive_cultivate(self, days):
        """被动修炼：按天数自动获得灵力（灵根决定效率，即使不主动打坐也在积累）。"""
        if not self.state.data:
            return
        gain = 0
        for _ in range(int(days)):
            gain += self.state.daily_passive_mp()
        if gain > 0:
            self.state.mod_attr("灵力", gain)
            realm = self.state.data.get("realm", 0)
            self.state.push_log("》 被动修炼 +%d 灵力（%d 日，灵根·%s）" % (
                gain, days, self.state.ling_gen()))

    def cultivate(self):
        """主动打坐修炼一日。

        公式：(2 + random×2) × 功法倍率 × 灵根倍率 × (1 + 悟性×0.08)，
        向下不低于 1；体质带 cult_extra 被动额外 +1；推进 day（含被动修炼）。
        """
        back = self.state.data.get("scene")
        gf = self.state.active_gongfa()
        gf_rate = gf.get("cultivateRate", 0.5) if gf else 0.5
        ling_rate = self.state.cult_rate()  # 灵根×体质综合修炼倍率
        wu = attr_get(self.state.effective()["eff"], "悟性", 0)
        base_gain = (2 + random.random() * 2) * gf_rate * ling_rate * (1 + wu * 0.08)
        gain = max(1, js_round(base_gain))
        # 灵体：额外 +1
        if self.state.has_const_passive("cult_extra"):
            gain += 1
        # 被动修炼（主动打坐的一日，被动加成也算入）
        self._passive_cultivate(1)
        lg_passive = self.state.daily_passive_mp()
        total_gain = gain + lg_passive
        self.state.mod_attr("灵力", gain)  # 主动部分（被动已由 _passive_cultivate 加过）
        self.state.data["day"] = self.state.data.get("day", 1) + 1
        cur_mp = self.state.data["attrs"].get("mp", 0)
        info = self.state.realm_info()
        to_next = info.get("toNext") if info else None

        # 修炼满当前小阶段 → 自动晋升（最后一阶除外，需手动突破）
        if to_next and cur_mp >= to_next and not self.state.realm_stage_max():
            if self.state.realm_stage_up():
                new_name = self.state.realm_name()
                text = ("丹田饱满，灵气充盈——体内经脉自发贯通！\n\n"
                        "【" + new_name + "】")
                return self.show_result("突破・" + new_name, text, back)

        flavors = [
            "你盘膝而坐，周身天地灵气如涓涓细流沁入四肢百骸。",
            "夜色如水。你闭目凝神，识海中那一缕灵力又壮大了几分。",
            "一呼一吸之间，日升月落。丹田中又添一丝暖意。",
        ]
        text = random.choice(flavors) + "\n\n【主动 +%d" % gain
        if lg_passive:
            text += "　被动 +%d（灵根·%s）" % (lg_passive, self.state.ling_gen())
        text += "】"
        if gf:
            text += "\n功法·%s ×%.1f" % (gf.get("name", ""), gf_rate)
        text += "　灵根·%s ×%.1f" % (self.state.ling_gen(), ling_rate)
        if to_next:
            remain = max(0, int(to_next) - int(cur_mp))
            text += "\n距%s尚需 %d 灵力" % ((info.get("stageLabels") or [""])[self.state.data.get("realmStage", 0)] or "下一阶", remain)
        return self.show_result("修炼・第 %d 日" % self.state.data["day"], text, back)

    def breakthrough(self):
        """冲击突破。

        成功率 = 45% + 悟性×3% + 灵根/体质突破加成。
        成功：境界 +1，灵力扣除所需的 60%，属性奖励按 realms[新境界].breakGain
        表驱动（缺省回退 气血+10/攻击+2/防御+2）；
        失败：灵力损失当前的 30%，气血 -5。无论成败推进 day。
        """
        back = self.state.data.get("scene")
        realms = self.config.get("realms") or []
        idx = self.state.data.get("realm", 0)
        info = self._realm_info()
        next_info = realms[idx + 1] if 0 <= idx + 1 < len(realms) else None
        if not info or not info.get("toNext") or not next_info:
            return self.show_result("突破", "你已至当前巅峰，前路渺渺。", back)
        cur = attr_get(self.state.data.get("attrs") or {}, "灵力", 0)
        if cur < info["toNext"]:
            return self.show_result(
                "突破・机缘未至",
                "丹田灵力空虚，难以为继。\n\n【需 %s，现有 %s】" % (info["toNext"], cur), back)
        self._passive_cultivate(1)
        self.state.data["day"] = self.state.data.get("day", 1) + 1
        wu = attr_get(self.state.effective()["eff"], "悟性", 0)
        chance = 0.45 + wu * 0.03 + self.state.break_bonus()  # 灵根+体质合计突破加成
        if random.random() < chance:
            self.state.set_realm(idx + 1)
            self.state.mod_attr("灵力", -js_round(info["toNext"] * 0.6))
            gain = next_info.get("breakGain") or {"气血": 10, "攻击": 2, "防御": 2}
            for k, v in gain.items():
                self.state.mod_attr(k, v)
            gain_text = "　".join("%s +%s" % (k, v) for k, v in gain.items())
            return self.show_result(
                "突破・%s！" % next_info["name"],
                "轰——！\n\n体内壁垒应声而碎，磅礴灵力自天灵倾泻而下！\n\n"
                "【%s】【%s】" % (next_info["name"], gain_text), back)
        self.state.mod_attr("灵力", -js_round(cur * 0.3))
        self.state.mod_attr("气血", -5)
        return self.show_result(
            "突破・失败",
            "灵力奔涌至瓶颈处却如浪碎礁石，轰然溃散！\n\n"
            "【灵力损三成，气血 -5。稳固根基，来日再战。】", back)

    # ================= 事件抽取 =================

    def draw_event(self, draw):
        """按 tags 匹配 + rarity 权重抽取事件；固定事件池优先于动态事件池。"""
        tags = (draw or {}).get("tags") or []
        weights = self.config.get("rarityWeights") or {}

        def build_pool(table):
            pool = []
            for eid, e in table.items():
                etags = e.get("tags")
                if not etags or not any(t in tags for t in etags):
                    continue
                if not self.check_cond(e.get("cond")):
                    continue
                pool.append((eid, weights.get(e.get("rarity"), 10)))
            return pool

        # 固定事件池为空时才查动态池
        pool = build_pool(self.events_fixed)
        if not pool:
            pool = build_pool(self.events)
        if not pool:
            return self.goto(self.state.data.get("scene"), skip_enter=True)
        r = random.random() * sum(w for _, w in pool)
        for eid, w in pool:
            r -= w
            if r <= 0:
                return self.goto(eid)
        return self.goto(pool[-1][0])

    # ================= 奖励结算 =================

    def settle_reward(self, table_id, fallback_next=None):
        """奖励表结算：必掉保底 + 随机 Roll（次数 + 概率两层）。

        产出全为原材料（非成品）：未登记 items 表的材料同样入包，
        名称在快照中回退为 id，供后续炼丹/炼器系统消耗。
        （JS 版对 灵石/灵力/悟性 只展示不入账、Roll 出的未登记材料不入包，
        此处修正为实际发放。）
        """
        table = self.rewards.get(table_id)
        back = fallback_next or self.state.data.get("scene")
        if not table:
            return self.goto(back)
        attr_keys = set((self.config.get("initialAttrs") or {}).keys())
        attr_keys |= {ATTR_CN2EN[k] for k in attr_keys if k in ATTR_CN2EN}
        guaranteed, gained = [], []
        # 必掉
        for k, rng in (table.get("guaranteed") or {}).items():
            lo, hi = rng[0], rng[1]
            v = random.randint(lo, hi)
            guaranteed.append({"key": k, "val": v})
            if k == "灵石":
                self._mod_stones(v)
            elif k in attr_keys:
                self.state.mod_attr(k, v)
            else:
                for _ in range(v):
                    self.state.add_item(k)
        # 随机 Roll
        rolls = table.get("rolls") or {}
        cnt_rng = rolls.get("count") or [0, 0]
        pool = table.get("pool") or []
        if cnt_rng[1] > 0 and pool:
            total = sum(p.get("weight", 0) for p in pool)
            cnt = random.randint(cnt_rng[0], cnt_rng[1])
            for _ in range(cnt):
                if random.random() > rolls.get("rate", 0):
                    continue
                r = random.random() * total
                acc = 0
                for p in pool:
                    acc += p.get("weight", 0)
                    if r <= acc:
                        gained.append(p)
                        break
        for p in gained:
            self.state.add_item(p["id"])  # 原材料直接入包
        # 结果文本
        text = str(table.get("label", "")) + "\n\n"
        if guaranteed:
            text += "▎必得：" + "、".join("%s ×%d" % (g["key"], g["val"]) for g in guaranteed) + "\n"
        if gained:
            text += "▎额外收获：" + "、".join(p.get("name", p["id"]) for p in gained) + "\n"
        if not guaranteed and not gained:
            text += "本次空手而归。\n"
        return self.show_result("收获", text, back)

    # ================= 战斗（内嵌类） =================

    class Battle:
        """交互式回合制战斗（对应 server/battle.js）。

        状态机：player_turn → resolve → enemy_turn → resolve → check → 下一轮。
        战斗血量/灵力为临时副本，不写回 GameState（败北除外：气血置 1）；
        每回合实时读取 state.effective() 计算攻防。
        """

        def __init__(self, engine):
            self.engine = engine
            self.st = None  # {spec, enemy, pHp, pMaxHp, eHp, eMaxHp, pQi, round, log, defending, back, enemyBurning}

        @property
        def active(self):
            return self.st is not None

        def reset(self):
            self.st = None

        # —— 境界压制 ——
        def _realm_delta(self):
            """玩家境界 - 敌人境界（敌人 realmIdx 缺省视为 0）。"""
            p = self.engine.state.data.get("realm", 0)
            e = (self.st["enemy"] or {}).get("realmIdx", 0)
            return p - e

        @staticmethod
        def suppression(delta):
            """境界压制系数：攻方每高 1 大境界伤害 ×2，每低 1 境界 ×0.9。"""
            if delta > 0:
                return 2.0 ** delta
            if delta < 0:
                return 0.9 ** (-delta)
            return 1.0

        # —— 五行对策 ——
        def _wuxing_bonus(self):
            """玩家五行克敌 → 1.25x 伤害；被克 → 0.8x。无五行数据跳过。"""
            wu = (self.engine.config.get("wuxing") or {})
            ke = wu.get("ke") or {}
            p_els = self.engine.state.wuxing_elements()
            e_els = (self.st["enemy"] or {}).get("wuxing") or []
            if not p_els or not e_els:
                return 1.0, None
            for pe in p_els:
                for ee in e_els:
                    if ke.get(pe) == ee:  # 玩家克敌
                        return wu.get("battleMultiplier", 1.25), "%s克%s·伤害增幅" % (pe, ee)
                    if ke.get(ee) == pe:  # 敌克玩家
                        return 0.8, "%s克%s·伤害衰减" % (ee, pe)
            return 1.0, None

        # —— 进入战斗 ——
        def start(self, spec):
            """初始化战斗状态。spec: {'enemy': id, 'win': scene_id, 'lose': scene_id}

            玩家境界高出敌人 ≥2 时直接碾压（无伤秒杀，奖励照发）。"""
            eng = self.engine
            enemy_id = (spec or {}).get("enemy")
            enemy = eng.enemies.get(enemy_id)
            if not enemy:
                return eng.show_result("战斗", "（敌人数据缺失：%s）" % enemy_id,
                                       eng.state.data.get("scene"))
            # 碾压判定：境界差 ≥2 不进回合战斗
            p_realm = eng.state.data.get("realm", 0)
            e_realm = enemy.get("realmIdx", 0)
            if p_realm - e_realm >= 2:
                back = spec.get("win") or eng.state.data.get("scene")
                if enemy.get("reward"):
                    eng.apply_effect(enemy["reward"])
                text = ("%s【%s】刚一现身，便被你的气机死死压住，伏地颤抖不敢妄动。\n\n"
                        "你随手一挥，胜负已分。\n\n—— 碾 压 ——") % (enemy.get("name"), enemy.get("realm"))
                if enemy.get("rewardText"):
                    text += "\n" + enemy["rewardText"]
                return eng.show_result("战斗・碾压", text, back)
            eff = eng.state.effective()["eff"]
            hp = attr_get(eff, "气血", 1) or 1
            self.st = {
                "spec": spec,
                "enemy": enemy,
                "pHp": hp, "pMaxHp": hp,
                "eHp": enemy.get("气血", 1), "eMaxHp": enemy.get("气血", 1),
                "pQi": attr_get(eff, "灵力", 0),
                "round": 0,
                "log": [],
                "defending": False,
                "enemyBurning": 0,
                "back": eng.state.data.get("scene"),  # 战斗结束后回到的场景
            }
            # 时间由 eventDraw/effect 统一推进，战斗本身不额外消耗时日
            self.add_log("遭遇 %s【%s】！" % (enemy.get("name"), enemy.get("realm")))
            delta = p_realm - e_realm
            if delta >= 1:
                self.add_log("你的境界隐隐压过对方，出手更见威势。")
            elif delta <= -1:
                self.add_log("对方境界在你之上，一股无形威压当头罩下！")
            return self._emit()

        # —— 玩家行动 ——
        def player_act(self, action_id):
            """玩家行动：attack（含技能）/ defend / flee / use:<item_id> / 术法功法。"""
            eng = self.engine
            if not self.active:
                return eng.goto(eng.state.data.get("scene"), skip_enter=True)
            st = self.st
            st["round"] += 1
            st["defending"] = False
            eff = eng.state.effective()["eff"]

            if isinstance(action_id, str) and action_id.startswith("use:"):
                # 使用物品（占用本回合，随后敌方行动）
                self._use_item(action_id[4:])
            elif isinstance(action_id, str) and (action_id.startswith("gf_") or action_id.startswith("sk_")):
                # 术法功法技能：从 gongfa 表读取 battle 数据
                gf_skill = eng.gongfa.get(action_id) or {}
                gb = gf_skill.get("battle") if isinstance(gf_skill.get("battle"), dict) else {}
                if not gb:
                    self.add_log("功法数据缺失，无法施展")
                else:
                    dmg_spec = gb.get("damage") or {"attackRatio": 1.0}
                    cost = gb.get("qiCost") or 0
                    if cost and (st["pQi"] or 0) < cost:
                        self.add_log("灵力不足，%s 施展失败！" % gf_skill.get("name", action_id))
                    else:
                        st["pQi"] = max(0, (st["pQi"] or 0) - cost)
                        affix = gb.get("affix")
                        # 破甲：敌方防御减半
                        dfn = st["enemy"].get("防御", 0)
                        if affix == "破甲":
                            dfn = dfn * 0.5
                        atk = attr_get(eff, "攻击", 0) * dmg_spec.get("attackRatio", 1.0)
                        base = max(1, atk - dfn * 0.5 + (random.random() * 4 - 2))
                        wxm, wxtext = self._wuxing_bonus()
                        dmg = max(1, js_round(base * self.suppression(self._realm_delta()) * wxm))
                        st["eHp"] = max(0, st["eHp"] - dmg)
                        if wxtext:
                            self.add_log("五行 " + wxtext)
                        self.add_log("你施展「%s」，造成 %d 点伤害" % (gf_skill.get("name", action_id), dmg))

                        # 词缀结算
                        if affix == "连击":
                            follow = max(1, js_round(dmg * 0.6))
                            st["eHp"] = max(0, st["eHp"] - follow)
                            self.add_log("（连击）追加 %d 点伤害" % follow)
                        elif affix == "灼烧":
                            st["enemyBurning"] = (st.get("enemyBurning") or 0) + 3
                            self.add_log("（灼烧）敌人陷入灼烧状态，持续3回合")
                        elif affix == "霜冻":
                            if random.random() < 0.5:
                                st["enemyStunned"] = True
                                self.add_log("（霜冻）敌人被冰霜凝固，陷入僵直！")
                        elif affix == "吸血":
                            heal = max(1, js_round(dmg * 0.3))
                            st["pHp"] = min(st["pMaxHp"], st["pHp"] + heal)
                            self.add_log("（吸血）恢复气血 +%d" % heal)
                        elif affix == "破甲":
                            self.add_log("（破甲）无视敌方半数防御")
            else:
                sk = eng.skills.get(action_id) or {}
                cat = sk.get("category")
                if cat == "defense":
                    st["defending"] = True
                    self.add_log("你摆出防御姿态")
                elif cat == "escape":
                    spd = attr_get(eff, "勇气", 5)
                    if random.random() < 0.3 + spd * 0.03:
                        self.add_log("你成功脱离了战斗！")
                        return self.end(False, fled=True)
                    self.add_log("逃跑失败！")
                elif sk.get("damage") or action_id == "basic_attack":
                    # 攻击类：basic_attack 统一按 damage 规格结算
                    dmg_spec = sk.get("damage") or {"attackRatio": 1.0}
                    cost = sk.get("qiCost") or 0
                    if cost and (st["pQi"] or 0) < cost:
                        self.add_log("灵力不足，%s 施展失败！" % sk.get("name", "技能"))
                    elif sk.get("hitRate") is not None and random.random() > sk["hitRate"]:
                        st["pQi"] = max(0, (st["pQi"] or 0) - cost)
                        self.add_log("%s 被敌人躲开了！" % sk.get("name", "攻击"))
                    else:
                        st["pQi"] = max(0, (st["pQi"] or 0) - cost)
                        atk = attr_get(eff, "攻击", 0) * dmg_spec.get("attackRatio", 1.0)
                        dfn = st["enemy"].get("防御", 0)
                        base = max(1, atk - dfn * 0.5 + (random.random() * 4 - 2))
                        wxm, wxtext = self._wuxing_bonus()
                        dmg = max(1, js_round(base * self.suppression(self._realm_delta()) * wxm))
                        st["eHp"] = max(0, st["eHp"] - dmg)
                        if wxtext:
                            self.add_log("五行 " + wxtext)
                        if action_id == "basic_attack" or not sk.get("name"):
                            self.add_log("你发起攻击，造成 %d 点伤害" % dmg)
                        else:
                            self.add_log("你施展「%s」，造成 %d 点伤害" % (sk["name"], dmg))
                else:
                    self.add_log("你犹豫了片刻，错失良机")

            # 上阵法器触发（每回合按概率自动释放）
            self._faqi_trigger()

            # 检查敌方是否死亡
            if st["eHp"] <= 0:
                return self.end(True)
            # 敌方回合
            return self.enemy_turn()

        def _faqi_trigger(self):
            """上阵法器逐件 roll 触发：damage 附伤 / heal 治疗 / stun 僵直。"""
            eng = self.engine
            st = self.st
            for it in eng.state.faqi_deployed_items():
                spec = it.get("battle")
                if not isinstance(spec, dict):
                    continue
                if random.random() >= spec.get("trigger", 0):
                    continue
                text = spec.get("text") or ("%s 自行激发" % it.get("name"))
                parts = []
                dmg_range = spec.get("damage")
                if isinstance(dmg_range, list) and len(dmg_range) == 2 and st["eHp"] > 0:
                    dmg = random.randint(int(dmg_range[0]), int(dmg_range[1]))
                    st["eHp"] = max(0, st["eHp"] - dmg)
                    parts.append("造成 %d 点伤害" % dmg)
                heal_range = spec.get("heal")
                if isinstance(heal_range, list) and len(heal_range) == 2:
                    heal = random.randint(int(heal_range[0]), int(heal_range[1]))
                    st["pHp"] = min(st["pMaxHp"], st["pHp"] + heal)
                    parts.append("恢复 %d 点气血" % heal)
                stun = spec.get("stun") or (spec.get("stunChance") and random.random() < spec["stunChance"])
                if stun:
                    st["enemyStunned"] = True
                    parts.append("敌人陷入僵直")
                self.add_log("〔法器〕%s，%s" % (text, "、".join(parts) if parts else "灵光一闪"))

        def _use_item(self, item_id):
            """战斗中使用物品：结算 use 效果并同步临时战斗血量/灵力。"""
            eng = self.engine
            it = eng.items.get(item_id)
            if not it or not it.get("use") or not eng.state.has_item(item_id):
                self.add_log("物品无法使用")
                return
            eng.apply_effect(it["use"])
            attrs = it["use"].get("attrs") or {}
            heal = attrs.get("气血", 0)
            if heal:
                self.st["pHp"] = min(self.st["pMaxHp"], max(0, self.st["pHp"] + heal))
            qi = attrs.get("灵力", 0)
            if qi:
                self.st["pQi"] = max(0, self.st["pQi"] + qi)
            if it.get("consumable"):
                eng.state.remove_item(item_id)
            self.add_log("你使用了 %s" % it.get("name", item_id))

        # —— 敌方 AI ——
        def enemy_turn(self):
            eng = self.engine
            if not self.active:
                return eng.goto(eng.state.data.get("scene"), skip_enter=True)
            st = self.st
            e = st["enemy"]
            # 灼烧结算：每回合扣 3% maxHp
            if st.get("enemyBurning", 0) > 0:
                burn_dmg = max(1, js_round(st["eMaxHp"] * 0.03))
                st["eHp"] = max(0, st["eHp"] - burn_dmg)
                st["enemyBurning"] -= 1
                self.add_log("%s 被灼烧持续灼痛，损失 %d 点气血" % (e.get("name"), burn_dmg))
                if st["eHp"] <= 0:
                    return self.end(True)
            if st.get("enemyStunned"):
                st["enemyStunned"] = False
                self.add_log("%s 身形僵滞，无法行动！" % e.get("name"))
                return self._emit()
            dfn = attr_get(eng.state.effective()["eff"], "防御", 0)
            base = max(1, e.get("攻击", 0) - dfn * 0.5 + (random.random() * 4 - 2))
            dmg = max(1, js_round(base * self.suppression(-self._realm_delta())))
            if st["defending"]:
                dmg = max(1, js_round(dmg * 0.5))
            st["pHp"] = max(0, st["pHp"] - dmg)
            self.add_log("%s 发动攻击，造成 %d 点伤害%s"
                         % (e.get("name"), dmg, "（防御减半）" if st["defending"] else ""))
            if st["pHp"] <= 0:
                return self.end(False)
            # 下一轮
            return self._emit()

        # —— 战斗结束 ——
        def end(self, win, fled=False):
            """结算：胜利发放 reward；败北气血置 1；成功脱离不奖不罚。"""
            eng = self.engine
            st = self.st
            spec = st["spec"] or {}
            enemy = st["enemy"]
            text = "\n".join(st["log"])
            if win:
                target = spec.get("win") or st["back"]
                if enemy.get("reward"):
                    eng.apply_effect(enemy["reward"])
                text += "\n\n—— 胜 利 ——"
                if enemy.get("rewardText"):
                    text += "\n" + enemy["rewardText"]
                title = "战斗・胜"
            elif fled:
                # 成功脱离：无奖励也无重伤惩罚（JS 版误按败北结算，此处修正）
                target = spec.get("lose") or st["back"]
                text += "\n\n—— 脱 离 ——\n你且战且退，全身而返。"
                title = "战斗・遁"
            else:
                target = spec.get("lose") or st["back"]
                attr_set_abs(eng.state.data["attrs"], "气血", 1)
                text += "\n\n—— 败 北 ——\n重伤！气血仅存 1 点。"
                title = "战斗・败"
            self.st = None
            return eng.show_result(title, text, target)

        # —— 渲染 ——
        def render(self):
            """渲染战斗界面 -> {'title', 'text', 'choices', 'battle_state'}。"""
            eng = self.engine
            st = self.st
            e = st["enemy"]
            p_pct = max(0, js_round(st["pHp"] * 100.0 / st["pMaxHp"])) if st["pMaxHp"] else 0
            e_pct = max(0, js_round(st["eHp"] * 100.0 / st["eMaxHp"])) if st["eMaxHp"] else 0
            title = "⚔ 第 %d 回合" % st["round"]
            lines = [
                _bar("我方 %s" % eng._char_name(), st["pHp"], st["pMaxHp"], p_pct),
                _bar("%s【%s】" % (e.get("name"), e.get("realm")), st["eHp"], st["eMaxHp"], e_pct),
                "",
            ]
            lines += st["log"][-4:]
            # 行动选项：基础行动 + 已装备术法
            choices = []
            for aid in eng.battle_actions:
                sk = eng.skills.get(aid) or {}
                label = sk.get("name", aid)
                if sk.get("qiCost"):
                    label += "（灵力%s）" % sk["qiCost"]
                choices.append({"text": label, "action": "battle", "battleAction": aid})
            # 已装备术法（从 state 读取）
            for skill_id, skill_entry in eng.state.equipped_skills():
                gb = (skill_entry.get("battle") or {}) if isinstance(skill_entry.get("battle"), dict) else {}
                qi_cost = gb.get("qiCost") or 0
                qi_ok = qi_cost == 0 or (st["pQi"] or 0) >= qi_cost
                label = skill_entry.get("name", skill_id)
                if qi_cost:
                    label += "（灵力%s）" % qi_cost
                if not qi_ok:
                    label += "【灵力不足】"
                choices.append({"text": label, "action": "battle", "battleAction": skill_id,
                               "qiCost": qi_cost, "qiOk": qi_ok})
            # 使用物品快捷选项（可用消耗品，去重，至多 3 个）
            usable = []
            for iid in eng.state.data.get("items") or []:
                it = eng.items.get(iid)
                if it and it.get("use") and it.get("consumable") and iid not in usable:
                    usable.append(iid)
            for iid in usable[:3]:
                choices.append({"text": "使用 %s" % eng.items[iid]["name"],
                                "action": "battle", "battleAction": "use:" + iid})
            return {"title": title, "text": "\n".join(lines),
                    "choices": choices, "battle_state": self.battle_state()}

        def battle_state(self):
            """战斗态快照（对应 server.js battleSnapshot()）。"""
            if not self.active:
                return None
            eng = self.engine
            st = self.st
            e = st["enemy"]
            actions = []
            for aid in eng.battle_actions:
                sk = eng.skills.get(aid) or {}
                actions.append({"id": aid,
                               "name": sk.get("name", aid),
                               "qiCost": sk.get("qiCost") or 0})
            # 已装备术法
            for skill_id, skill_entry in eng.state.equipped_skills():
                gb = (skill_entry.get("battle") or {}) if isinstance(skill_entry.get("battle"), dict) else {}
                actions.append({"id": skill_id,
                               "name": skill_entry.get("name", skill_id),
                               "qiCost": gb.get("qiCost") or 0,
                               "affix": gb.get("affix")})
            return {
                "round": st["round"],
                "enemy": {"name": e.get("name"), "realm": e.get("realm"),
                          "hp": st["eHp"], "maxHp": st["eMaxHp"],
                          "burning": st.get("enemyBurning", 0)},
                "player": {"hp": st["pHp"], "maxHp": st["pMaxHp"], "qi": st["pQi"]},
                "log": st["log"][-6:],
                "actions": actions,
            }

        def _emit(self):
            """把战斗渲染包装为统一渲染数据。"""
            r = self.render()
            return self.engine._render({"title": r["title"], "text": r["text"]},
                                       r["choices"], battle=r["battle_state"])

        def add_log(self, msg):
            self.st["log"].append("【第 %d 回合】%s" % (self.st["round"], msg))
            if len(self.st["log"]) > 20:
                self.st["log"].pop(0)

    # ================= 渲染 / 序列化 =================

    def _render(self, scene, choices, battle=None):
        """构建统一渲染数据；记录原始选项供 choose() 回传解析。"""
        self._last_choices = list(choices or [])
        ser = [self._serialize_choice(c, i) for i, c in enumerate(self._last_choices)]
        if battle is None and self.battle.active:
            battle = self.battle.battle_state()
        scene_snap = {
            "title": scene.get("title", ""),
            "text": self._interpolate(scene.get("text", "")),
            "choices": ser,
            "sceneId": self.state.data.get("scene"),
        }
        self._last_scene = scene_snap
        return {"scene": scene_snap, "state": self._snapshot(), "battle": battle}

    def current_scene(self):
        """最近一次渲染的场景快照（server.py 适配层读取）。"""
        if self._last_scene is not None:
            return self._last_scene
        return {"title": "未知", "text": "场景数据丢失", "choices": [],
                "sceneId": (self.state.data or {}).get("scene")}

    def battle_snapshot(self):
        """当前战斗态快照；无战斗时为 None（server.py 适配层读取）。"""
        return self.battle.battle_state() if self.battle.active else None

    def _serialize_choice(self, c, idx):
        """选项序列化：剔除函数引用，effect 仅以标记透出，附 idx 供回传。"""
        out = {"idx": idx, "text": str(c.get("text", "")),
               "restart": bool(c.get("restart", False))}
        for k in self._CHOICE_FIELDS:
            v = c.get(k)
            if v is None or callable(v) or k in out:
                continue
            out[k] = self._json_safe(v)
        # 战斗选项补充敌人名（便于前端展示）
        b = c.get("battle")
        if isinstance(b, dict):
            out["battle"] = {"enemy": b.get("enemy"),
                             "enemyName": (self.enemies.get(b.get("enemy")) or {}).get("name")}
        # 效果本体只在服务端结算；回传时按 idx/text 还原原始选项
        if c.get("effect") is not None:
            out["effect"] = "[效果]"
        return out

    def _json_safe(self, v):
        """递归剔除不可序列化的函数引用。"""
        if callable(v):
            return None
        if isinstance(v, dict):
            return {k: self._json_safe(x) for k, x in v.items() if not callable(x)}
        if isinstance(v, (list, tuple)):
            return [self._json_safe(x) for x in v if not callable(x)]
        return v

    def _resolve_choice(self, choice):
        """把客户端回传的选择还原为最近一次渲染的原始选项。

        支持：int 下标 / 带 idx 的序列化字典 / 仅有 text 的字典；
        均无法匹配时按传入字典原样使用（剔除序列化标记）。
        """
        if isinstance(choice, int):
            if 0 <= choice < len(self._last_choices):
                return self._last_choices[choice]
            return {}
        if not isinstance(choice, dict):
            return {}
        idx = choice.get("idx")
        if isinstance(idx, int) and 0 <= idx < len(self._last_choices):
            orig = self._last_choices[idx]
            if not choice.get("text") or choice.get("text") == orig.get("text"):
                return orig
        txt = choice.get("text")
        if txt:
            for c in self._last_choices:
                if c.get("text") == txt:
                    return c
        clean = dict(choice)
        if not isinstance(clean.get("effect"), dict):
            clean.pop("effect", None)
        clean.pop("idx", None)
        return clean

    def _missing_scene(self, scene_id):
        """场景缺失兜底：给出返回/重开选项，避免卡死。"""
        cur = self.state.data.get("scene")
        choices = []
        if cur and self.get_scene(cur) is not None:
            choices.append({"text": "返 回", "next": cur})
        choices.append({"text": "重新开始", "restart": True})
        return self._render(
            {"title": "（迷途）",
             "text": "场景不存在：%s\n\n（数据缺失，请返回或重新开始）" % scene_id},
            choices)

    # ================= GameState 适配（可选接口兜底） =================

    def _auto_save(self):
        save = getattr(self.state, "save", None)
        if callable(save):
            save("auto")

    def _mod_stones(self, d):
        fn = getattr(self.state, "mod_stones", None)
        if callable(fn):
            fn(d)
        else:
            self.state.data["stones"] = max(0, self.state.data.get("stones", 0) + d)

    def _char_name(self):
        fn = getattr(self.state, "char_name", None)
        if callable(fn):
            return fn()
        return ((self.state.data.get("char") or {}).get("name")) or "你"

    def _realm_info(self):
        fn = getattr(self.state, "realm_info", None)
        if callable(fn):
            return fn()
        realms = self.config.get("realms") or []
        idx = self.state.data.get("realm", 0)
        return realms[idx] if 0 <= idx < len(realms) else None

    def _realm_name(self):
        fn = getattr(self.state, "realm_name", None)
        if callable(fn):
            return fn()
        info = self._realm_info()
        return info["name"] if info else "未知"

    def _interpolate(self, text):
        """文本占位符替换：{name} {realm} {origin} {linggen} {constitution}。"""
        fn = getattr(self.state, "interpolate", None)
        if callable(fn):
            return fn(text)
        char = (self.state.data or {}).get("char") or {}
        rep = {
            "{name}": str(char.get("name", "")),
            "{realm}": self._realm_name(),
            "{origin}": (char.get("origin") or {}).get("id", "农家子弟"),
            "{linggen}": (char.get("linggen") or {}).get("id", "未测"),
            "{constitution}": (char.get("constitution") or {}).get("id", "无"),
        }
        out = text or ""
        for k, v in rep.items():
            out = out.replace(k, v)
        return out

    def _snapshot(self):
        """状态快照（对应 server.js stateSnapshot()）。

        优先使用 GameState 自带的 snapshot()/to_dict()（state.py 为 to_dict()），
        两者皆无时按 server.js 同构自建。"""
        for name in ("snapshot", "to_dict"):
            fn = getattr(self.state, name, None)
            if callable(fn):
                return fn()
        d = self.state.data or {}
        char = d.get("char") or {}
        eff = self.state.effective()
        realm_info = self._realm_info()

        items = []
        for iid in d.get("items") or []:
            it = self.items.get(iid)
            if it:
                items.append({"id": iid, "name": it.get("name"), "type": it.get("type"),
                              "rarity": it.get("rarity", "凡品"), "desc": it.get("desc")})
            else:
                items.append({"id": iid, "name": iid, "type": "未知"})

        equipment = {}
        for slot in self.config.get("equipSlots") or []:
            iid = (d.get("equipment") or {}).get(slot)
            it = self.items.get(iid) if iid else None
            equipment[slot] = ({"id": iid, "name": it.get("name"),
                                "rarity": it.get("rarity"), "stats": it.get("stats")}
                               if it else None)

        def gf_brief(gid):
            g = self.gongfa.get(gid)
            return ({"id": gid, "name": g.get("name"), "cultivateRate": g.get("cultivateRate"),
                     "kind": g.get("kind"), "grade": g.get("grade"),
                     "passive": g.get("passive"), "battle": g.get("battle"),
                     "desc": g.get("desc"), "requireRealm": g.get("requireRealm")}
                    if g else {"id": gid, "name": gid})

        gf = d.get("gongfa") or {}
        slots_list = self.config.get("gongfaSlots") or []
        realm = d.get("realm", 0)
        slot_cfg = slots_list[realm] if 0 <= realm < len(slots_list) else {"heart": 0, "skill": 0}
        return {
            "name": char.get("name", ""),
            "realm": realm_info["name"] if realm_info else "未知",
            "realmIdx": d.get("realm", 0),
            "linggen": (char.get("linggen") or {}).get("id", "未测"),
            "constitution": (char.get("constitution") or {}).get("id", "无"),
            "day": d.get("day", 1),
            "stones": d.get("stones", 0),
            "attrs": eff["eff"],
            "attrsBase": d.get("attrs") or {},
            "items": items,
            "equipment": equipment,
            "gongfa": {"learned": [gf_brief(g) for g in gf.get("learned") or []],
                       "equipped_heart": [gf_brief(g) if g else None for g in gf.get("equipped_heart", [])],
                       "equipped_skill": [gf_brief(g) if g else None for g in gf.get("equipped_skill", [])],
                       "heartSlots": slot_cfg.get("heart", 0),
                       "skillSlots": slot_cfg.get("skill", 0)},
            "flags": list((d.get("flags") or {}).keys()),
            "log": (d.get("log") or [])[-20:],
            "realmInfo": realm_info,
        }

