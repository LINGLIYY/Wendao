<handoff>
<role>你接手一个修仙文字 RPG 的 Python 后端开发任务。</role>

<workspace>C:\知识库\AI\Ai修仙小游戏\game</workspace>

<state_summary>
## 项目当前状态 (v0.2, git commit e2d0569)

### 数据文件 (data/)
| 文件 | 条目 | 状态 |
|------|------|------|
| enemies.json | 37 只 (凡人~渡劫全覆盖) | ✅ |
| gongfa.json | 21 本 (凡/灵/玄/仙四阶) | ✅ |
| rewards.json | 15 张表 (combat/herb/mining/vision/trade 各三档) | ✅ |
| items.json | 100 种 | ✅ |
| recipes.json | 6 条配方 | ✅ 新文件,数据就位 |
| scenes.json | 94 个场景 | ✅ |
| events.json | 166 个事件 | ✅ |
| sects.json | 3 个宗门 | ✅ |
| config.json | 完整境界/五行/槽位配置 | ✅ |

### 代码文件
| 文件 | 行数 | 状态 |
|------|------|------|
| state.py | 968 行, 78 方法 | ✅ py_compile 通过 |
| server.py | HTTP API, 端口 3456 | ✅ |
| engine.py | 游戏引擎 | ⚠️ 缺少 craft() 方法 |
| ui.js | 前端, sect 三态 UI 已重构 | ✅ |
| style.css | 含 ~90 行宗门 CSS | ✅ |

### state.py 关键方法 (已实现, engine.py 的依赖)
- sect_info() → 返回当前宗门完整数据(含 culture/specialty)
- mod_contribution(delta) → 增减贡献值
- join_sect() → 入宗自动初始化 contribution=starterStones
- interpolate() → 宗门动态 worldNames (查 sects_table 而非写死青云宗)
- to_dict() → 输出 "sectInfo" 字段供前端
</state_summary>

<pending_task>
## 待完成: 炼丹/炼器系统 (P1-2)

### 已完成
- data/recipes.json — 6条配方 (3炼丹+3炼器)
  - recipe_huiqi: lingcao*1 → dan_huiqi (rate 0.8)
  - recipe_bigu: lingcao*2+ningqicao*1 → dan_bigu (rate 0.65)
  - recipe_tianxiang: juhuacao*2+yilinghua*1+tianlingzhi*1 → dan_tianxiang (rate 0.45)
  - recipe_tiexuanjing: fan_tie*2+xiayin_kuang*1 → tie_xuanjing (rate 0.7)
  - recipe_qingfeng: tie_xuanjing*2+shougu*3 → jian_qingfeng (rate 0.5)
  - recipe_huichun: shougu*2+lingshi_kuang*1 → pai_huichun (rate 0.65)

### 待实现 (只需要改 engine.py)
1. engine.py __init__ 加载 recipes:
   self.recipes = self._load_json("recipes")  ← 加在 self.sects = ... 之后

2. engine.py 新增 craft() 方法 (插入到 draw_event() 之前):
   - 查配方表
   - 检查边界: 配方存在/材料足够/境界达标
   - 消耗材料 (remove_item)
   - 计算成功率: baseRate + sect craftBonus (查 sect_info().specialty.craftBonus)
   - 随机判定, 成功→add_item(output), 失败→无产出
   - 渲染结果场景

3. engine.py choose() 添加 craft 分发:
   在 "# 奖励表结算" 之前加:
   if c.get("craft"):
       return self.craft(c["craft"])

### engine.py 中已有的依赖 (不需要重复实现)
- self.state.sect_info() → dict with "specialty"."craftBonus" keys
- self.state.data.get("items") → 物品ID列表
- self.state.data.get("realm") → 玩家境界
- self.state.add_item(id) / remove_item(id) / has_item(id)
- self.state.push_log(text) / mod_contribution(delta)
- self.items → 物品详情表 (name/type/rarity)
- self._load_json("filename") → 自动加 data/ 前缀和 .json 后缀
- self.goto(scene, skip_enter) / self._render / self._auto_save
</pending_task>

<rules>
## ⚠️ 编辑规则 (前任踩坑总结)

1. **永远不要用 PowerShell (Set-Content/Replace) 编辑 Python/JS 文件**
   → 会加 BOM 或破坏缩进, 导致 py_compile 失败或方法不可见

2. **用 Python 脚本编辑文件, 跑完即删**
   ```python
   # _patch.py
   with open("engine.py", "r", encoding="utf-8") as f:
       content = f.read()
   # ... 字符串替换 ...
   with open("engine.py", "w", encoding="utf-8") as f:
       f.write(content)
   ```

3. **改完立刻验证:**
   python -m py_compile state.py engine.py server.py

4. **改完立刻 git commit:**
   git add -A && git commit -m "描述"

5. **wuxing 枚举只有五个:** 金/木/水/火/土
6. **rarity 枚举只有四个:** 普通/稀有/传说/史诗
7. **JSON 必须用 json.dump(ensure_ascii=False)** — 不要手写含中文的 JSON
8. **属性键双命名空间:** JSON 数据用中文键, state.py 内部用 ASCII (hp/mp/atk/def/wisdom/courage)
</rules>

<verification>
完成后跑:
```bash
python -m py_compile state.py engine.py server.py
python -c "from state import GameState; from engine import GameEngine; gs=GameState(); ge=GameEngine(gs); gs.new_game({'name':'t','linggen':'天灵根','constitution':'武骨','origin':'修仙世家'}); gs.add_item('lingcao'); r=ge.craft('recipe_huiqi'); print('Craft:', ge.current_scene()['title'])"
```
预期输出: "Craft: 炼制·成" 或 "Craft: 炼制·败"
</verification>
</handoff>
