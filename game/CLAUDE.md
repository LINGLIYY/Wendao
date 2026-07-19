# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

修仙・问道 —— 文字冒险修仙 RPG。设计哲学：**骨架由代码（公平数值、可靠存档），叙事由数据（后期接 AI 填空）**。Python 零依赖后端 + 纯静态前端，数据全部 JSON 化。

上级目录 `../规划/` 有开发方案与**踩坑记录.md**（历次事故的根因与解法，动手前值得一读）；`../基本规则.txt` 等是最初的设计文档。

## 常用命令

```bash
# 启动（自动清理 3456 端口 + 开浏览器）
start.bat                                # Windows 双击；命令行需输入 .\start.bat（start 与内置命令歧义）
bash start.sh                            # Git Bash / WSL

# 手动启动
PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe server.py    # → http://localhost:3456

# 语法检查（改完必跑）
.venv/Scripts/python.exe -m py_compile state.py engine.py server.py
node --check client/js/ui.js

# 前端一致性审计（JS DOM 引用 / CSS 死样式 / API 字段对照）
.venv/Scripts/python.exe audit.py

# 快速冒烟：起服务后
curl -s http://localhost:3456/api/ping   # {"pong":true}

# 停服务（不要 taskkill /IM node.exe / python.exe 全杀）
netstat -ano | findstr :3456             # 找 PID 后 taskkill /F /PID <pid>
```

没有正式测试框架。验证方式 = py_compile + `node --check` + `audit.py` + 起服务用 `urllib` 脚本打 API 断言（引擎层可直接 `from state import GameState; from engine import GameEngine` 无服务器单测）。终端打中文必须设 `PYTHONIOENCODING=utf-8`（Windows 控制台默认 GBK 会炸）。

## 架构

```
server.py   HTTP 服务（http.server 标准库，端口 3456，GAME_LOCK 全局锁）
engine.py   游戏引擎：场景跳转/选择分发/修炼/突破/事件抽取/奖励结算/回合制战斗（内嵌 Battle 类）
state.py    状态中心：GameState 唯一持有 data；角色/属性/物品/装备/法器阵列/功法/flag/存档
data/*.json 权威数据源（场景/物品/功法/敌人/事件/奖励/角色创建表/宗门/区域）—— 改剧情、加物品只动这里
client/     纯前端（index.html + ui.js + style.css），零游戏逻辑，只调 API 渲染快照
saves/      存档 slot_<n>.json + slot_auto.json（version 3，与曾经的 Node 版格式兼容）
```

请求流：`client → POST /api/action(choice) → engine.choose() → state 变更 → 响应 {scene, state, battle?}`。前端是无状态渲染器，所有判定都在服务端。

### API 契约（8 端点）

`GET /api/ping|saves|export`；`POST /api/new-game|action|save|load|import|item`。
`/api/item` 的 op：`use|equip|unequip|drop|faqi_put|faqi_take|faqi_deploy|faqi_undeploy|gongfa_equip|gongfa_unequip`。
响应统一 `{ok, ...}`，失败 `{ok:false, error}`（HTTP 400 = 业务拒绝，不是网络故障）。

### 属性键的双命名空间

存档与内部逻辑用 ASCII（hp/mp/atk/def/wisdom/courage/awareness/bone/charm/fortune），**数据文件与 API 快照用中文**（气血/灵力/攻击/防御/悟性/勇气/神识/根骨/魅力/机缘）。`state.py` 的 `AttrDict` 在 get/set 时透明互转，`to_dict()` 出口转回中文。在 JSON 数据里永远写中文键。

### 境界系统（9 大境界 + 每境小阶段）

realms 配置在 `config.json`：凡人 → 练气(9层) → 筑基(4期) → 金丹(4期) → 元婴(4期) → 化神(3期) → 炼虚(3期) → 合体(3期) → 大乘(3期) → 渡劫(2期)。每境有 `stageLabels`（标签名）、`stageToNext`（各阶段升阶所需灵力）、`stageGain`（升阶属性奖励）、`breakGain`（突破大境界属性奖励）。

`state.realm_stage_up()` 修炼满当前阶段灵力后自动升阶；`state.realm_stage_max()` 返回是否到达该境末阶（需手动突破）。存档字段 `realmStage` 记录当前小阶段索引。

### 五行系统（Wuxing）

每个灵根携带 1-5 个五行元素（金木水火土），按 `config.json` 的 `wuxing.sheng`（相生）/ `wuxing.ke`（相克）判定。五行映射到二级属性：金→神识、木→根骨、水→魅力、火→悟性、土→机缘。`state.wuxing_affinity()` 按二级属性值加权计算各元素亲和度(0-100)。

**战斗五行**：玩家五行克敌 → 1.25× 伤害，被克 → 0.8×。`engine.Battle._wuxing_bonus()` 读取双方的 wuxing 元素列表后判定。

### 宗门系统（sects.json，3 个门派）

青云宗（正道）| 赤煞教（魔道）| 丹霞门（中立）。每条门含：`entry_cond`（入宗条件：flags + attrs）、`specialty`（cultBonus/battleBonus/craftBonus）、`economy`（contribRate/贡献转化率）、`gongfaTree`（宗门专属功法列表）、`culture`（山峰名/弟子称谓/主题色）。`state.join_sect(name)` 写入 `sect` 字段并设 `宗门弟子` flag；`state.leave_sect()` 清空。

场景中通过 `cond.flags: ["宗门弟子"]` 区分散修与宗门弟子。宗门 hub 场景铁律同 hub：**不设 onEnter**。

### 区域系统（regions.json）

定义世界地理节点（青云山脉/临江城/散修岭），含 `adjacent`（相邻区域）、`eventTags`（该区域可抽取的事件标签）、`sectId`（关联宗门）、`startScenes`（按出身路由开场）。用于事件池过滤与区域旅行。

### 功法系统（心法/术法 双槽位）

`config.gongfaSlots` 按境界定义可装备槽位数（如练气期 心法1/术法1，元婴 心法4/术法2）。槽位随 `set_realm()` 自动扩容（只增不减）。

- **心法** (kind: "心法")：装备到 `equipped_heart[]`，提供被动属性加成（passive stats），计入 `effective().bonus`
- **术法** (kind: "术法")：装备到 `equipped_skill[]`，战斗中作为可用技能（消耗灵力，含 damage/affix/qiCost）

`state.active_gongfa()` 返回首槽心法（其 `cultivateRate` 影响修炼效率）；`state.equip_gongfa(id, slot_index)` / `state.unequip_gongfa(kind, slot_index)` 管理槽位。功法书通过 `use.learnGongfa` 习得，学习后自动装入第一个空槽。

### 体质被动（Constitution Passives）

格式为逗号分隔的 `key:value` 串：`cult_extra:1,break_bonus:0.10,regen:1,limit_break:1`。`state._parse_passive()` 解析；`state.has_const_passive(key)` / `state.get_const_passive(key)` 查询。

当前支持的 passive key：
- `cult_extra` — 修炼倍率加成（灵体+1 / 道胎+0.5，计入 cult_rate）
- `break_bonus` — 突破率加成（灵体+0.10）
- `hp_bonus` / `atk_bonus` — 先天属性（武骨 hp+10 atk+3，new_game 时并入初始属性）
- `regen` — 战斗每回合回血
- `limit_break` — 突破保底次数

### 数据驱动机制（都在 data/ 里生效，不用碰引擎）

- **文本插值**：场景 text 中 `{name}` `{linggen}` `{origin}` `{realm}` `{constitution}` `{village}` `{sect}` `{sectMountain}` `{town}` 渲染时替换
- **角色路由**：choice 上 `nextByOrigin: {"修仙世家": "scene_a", ...}` / `nextByLinggen: {...}`（支持 `_default`）按角色数据分流——**禁止在共享场景里硬编码具体名字/灵根/出身**，历史教训见踩坑记录
- **时间**：effect/onEnter 支持 `{"day": N}`；eventDraw 自动 +1 日 + 被动修炼；修炼/突破内置 +1
- **条件**：`cond: {attrs:{悟性:{gte:5}}, realm:{gte:1}, flags:[...], items:[...], gongfa:[...]}` 过滤选项显示。`cond.flags` 用于身份判定（`宗门弟子`/`仙师之诺`/`散修之路` 等）
- **战斗**：choice 带 `battle: {enemy, win, lose}`；敌人在 enemies.json（含五行 wuxing 字段、realmIdx 境界索引）
- **境界碾压**：玩家境界高出敌人 ≥2 时跳过回合战斗，直接秒杀（`Battle.start()` 碾压判定）
- **奖励**：choice 带 `rewardTable: id`；rewards.json 结构 = guaranteed 必掉区间 + pool 权重抽取。**池目 id 必须存在于 items.json**（曾有 26 个悬空 id 让玩家抽到空气）
- **hub 场景铁律**：可反复回到的场景（sect_hub / linjiang_fangshi 等）**不设 onEnter**，否则修炼/战斗结算每次回来都重复触发

### 战斗系统（回合制，`Battle` 内嵌类）

状态机：player_turn → resolve → enemy_turn → resolve → check → 下一轮。战斗血量/灵力为临时副本，不写回 GameState（败北除外：气血置 1）。

- **境界压制**：攻方每高 1 大境界伤害 ×2，每低 1 境界 ×0.9（`Battle.suppression()`）
- **五行对策**：克敌 ×1.25 / 被克 ×0.8（`config.wuxing.battleMultiplier`）
- **行动类型**：`basic_attack`（普攻）、`defend`（防御·本回合受伤减半）、`flee`（逃跑·成功率受速度影响）、术法技能（来自 equipped_skill 功法的 battle 数据，消耗灵力）
- **术法词缀**：破甲（敌方防御减半）、连击（追加 60% 伤害）、灼烧（敌方每回合扣血 3 回合）、霜冻（50% 概率僵直）、流血（持续伤害）
- **法器触发**：上阵法器每回合按 `battle.trigger` 概率触发 damage/heal/stun
- **使用物品**：战斗中 `use:<item_id>` 消耗回合使用丹药等
- 战斗结束走 win/lose 场景分支；胜负在 `Battle.start(spec)` 的 spec 中配置

### 物品分类（items.json，82 条）

由字段决定行为：`slot`（武器/防具/饰品/法宝 四槽枚举）= 可穿戴；`use` + `consumable` = 可消耗（丹药/食物/功法书 `use.learnGongfa`）；`type:"法器"` + `battle` = 进法器阵列；都没有 = 材料收集品。`rarity` 四级枚举：凡品/灵品/玄品/仙品（前端配色只认这四个）。

### 法器阵列（三层结构）

`state.data.faqi = {array: [id|null]×capacity, deployed: [id|null]×3}`：
- **array 仓库**：容量随境界 `config.faqiCapacity` [6,6,8,10,12,...]，`set_realm()` 自动扩容；**存放即吃 stats 加成**（无需上阵）
- **deployed 上阵**：≤3 件、同 id 只能一件；战斗每回合按 `battle.trigger` 概率触发 damage/heal/stun（僵直=敌方跳回合）
- 快照含富数据（capacity/deployMax/deployed 标记），前端 `UI.openBag()` 四区窗口消费

## 铁律（每条都对应一次真实事故）

1. **禁止手写/手编辑含中文的 JSON 或在 JS/Python 源码里放大段中文引号文本**。批量改数据 = 写临时 Python 脚本 `json.dump(obj, f, ensure_ascii=False, indent=2)`，跑完删脚本。根因：工具链会把 ASCII 引号偷换成中文弯引号 `""`，曾整文件报废（这正是后端从 Node 迁到 Python + 数据 JSON 化的原因）。
2. **前后端契约不许漂移**：改 `to_dict()`/`item_brief()` 字段、API 响应结构、data 条目字段名时，必须同步检查 `client/js/ui.js` 的消费端，并跑 `audit.py` 验证。曾因字段名不一致导致前端全线误报"无法连接"。
3. **新数据条目严格复制现有条目的字段结构**，枚举值（rarity 四级、slot 四槽、功法 grade 四阶、五行元素五值）不许自创。
4. 玩家可见文本一律走插值占位符或路由分流，不硬编码角色信息。
5. 端口清理只杀占用 3456 的特定 PID，永不 `/IM` 全杀（曾把启动器自己杀死）。
6. **Tab 按钮禁止加 `id` 属性**。所有 Tab 按钮只用 `data-tab` 标识；页面 div 用 `id="tab-X"`。按钮和页面 ID 冲突时 `getElementById` 返回按钮而非页面 → `_renderXxxTab(panel)` 收到按钮 DOM → `innerHTML` 灌进导航栏 → 界面撕裂。条件可见性用 `querySelector('[data-tab="..."]')`。
7. **新 Tab 严格复制已有 Tab 的实现模式**。HTML 结构、JS 渲染方法签名、CSS 类名，一行都不要多。不要发明 sidebar/modal/overlay 等新模式——人物/背包/功法已验证了纯 Tab 内联模式在所有场景下适用。如果觉得"这个 Tab 需要不一样"，先问三遍为什么。
8. **并行子代理必须文件隔离**。两个代理改同一个文件 = 后写者覆盖前者 = 白干。启动前做文件冲突矩阵检查。
9. **批量 JSON 修改用 Python 脚本，不用 Edit 工具**。`json.load()` → 递归遍历替换 → `json.dump(obj, f, ensure_ascii=False, indent=2)`。Edit 工具处理含中文或转义引号的 JS 文件时会损坏引号。

## 调试路径

F12 Console 有启动自动 ping 诊断（`[诊断] 服务端连接成功`）。排障顺序：Console 红错 → Network 看失败请求状态码（0=服务没起，400=数据格式/业务拒绝，500=后端异常）→ curl 直测 API 分离前后端问题。服务端 traceback 直接打在运行 server.py 的终端。

`audit.py` 自动化检查：JS DOM ID 引用是否在 HTML 中存在、CSS 选择器是否有对应 DOM、JS 消费的 API 字段与 `to_dict()` 输出是否一致。

## 工具脚本

| 脚本 | 用途 |
|------|------|
| `audit.py` | 前端一致性审计（DOM ID 匹配 / CSS 死样式 / API 字段对照） |
| `global_replace.py` | 批量 JSON 数据迁移（递归替换 ID/文本字段，支持精确/模糊匹配） |
| `patch_missing.py` | 补全数据文件中缺失的引用（如奖励表悬空物品 id） |
| `patch_tab.py` | 批量修复 JSON 缩进/格式问题（tab→space 等） |

所有工具脚本均为临时用途，跑完应删除，勿提交到 git（遵循铁律 #1）。
