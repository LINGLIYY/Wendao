// ============================================
// 游戏引擎 —— 游戏循环核心
// 只认识"场景/选项/条件/效果"这套通用格式，不认识具体剧情
// ============================================
const Engine = {
  // 场景查找：主线场景表 + 随机事件表（事件就是可被抽取的场景）
  getScene(id) {
    return SCENES[id] || EVENTS[id];
  },

  // 进入一个场景
  // skipEnter=true 时不结算 onEnter（用于读档恢复，避免重复结算）
  goto(sceneId, skipEnter) {
    const scene = this.getScene(sceneId);
    if (!scene) {
      console.error("场景不存在：" + sceneId);
      return;
    }
    State.data.scene = sceneId;
    if (!skipEnter) {
      if (scene.onEnter) this.applyEffect(scene.onEnter);
      State.pushLog("【" + (scene.title || sceneId) + "】");
    }
    Save.autoSave(); // 每次场景推进自动存档

    // 按条件过滤可显示的选项
    const choices = (scene.choices || []).filter((c) => this.checkCond(c.cond));
    UI.render(scene, choices);
  },

  // 玩家点了一个选项
  choose(choice) {
    if (choice.restart) {
      State.newGame();
      this.goto(CONFIG.startScene);
      return;
    }
    State.pushLog("》 " + choice.text);
    if (choice.effect) this.applyEffect(choice.effect);

    // 内置行动：修炼 / 突破 / 战斗
    if (choice.action === "cultivate") {
      this.cultivate();
      return;
    }
    if (choice.action === "breakthrough") {
      this.breakthrough();
      return;
    }
    if (choice.battle) {
      this.battle(choice.battle);
      return;
    }

    // 从事件池抽取（有 eventDraw 时忽略 next/roll）
    if (choice.eventDraw) {
      this.drawEvent(choice.eventDraw);
      return;
    }

    let next = choice.next;
    if (choice.roll) {
      next = Math.random() < choice.roll.chance ? choice.roll.success : choice.roll.fail;
    }
    this.goto(next);
  },

  // 从事件池按标签筛选 + 稀有度加权随机抽取
  // draw: { tags: ["临江坊市"] }
  drawEvent(draw) {
    const pool = [];
    for (const id in EVENTS) {
      const e = EVENTS[id];
      if (!e.tags || !e.tags.some((t) => draw.tags.includes(t))) continue;
      if (!this.checkCond(e.cond)) continue;
      pool.push({ id, weight: CONFIG.rarityWeights[e.rarity] || 10 });
    }
    if (!pool.length) {
      // 池子为空：留在原地
      this.goto(State.data.scene, true);
      return;
    }
    let r = Math.random() * pool.reduce((sum, p) => sum + p.weight, 0);
    for (const p of pool) {
      r -= p.weight;
      if (r <= 0) {
        this.goto(p.id);
        return;
      }
    }
    this.goto(pool[pool.length - 1].id);
  },

  // 展示一次性结果页（修炼/突破/战斗的结算文本），"继续"回到指定场景
  // 不改变 State.data.scene，读档恢复时不会停在结果页
  showResult(title, text, nextId) {
    State.pushLog("【" + title + "】");
    Save.autoSave();
    UI.render({ title: title, text: text }, [{ text: "继 续", next: nextId }]);
  },

  // ---- 修炼（公式见开发方案 §6.5） ----
  cultivate() {
    const back = State.data.scene;
    const gf = State.activeGongfa();
    const rate = gf ? gf.cultivateRate : 0.5; // 无功法事倍功半
    const wu = State.effective().eff["悟性"] || 0;
    const gain = Math.max(1, Math.round((2 + Math.random() * 2) * rate * (1 + wu * 0.08)));
    State.modAttr("灵力", gain);
    State.data.day += 1;

    const flavors = [
      "你盘膝而坐，呼吸渐缓，周身天地灵气如涓涓细流，缓缓沁入四肢百骸。",
      "夜色如水。你闭目凝神，识海中那一缕灵力又壮大了几分。",
      "一呼一吸之间，日升月落。今日的苦功，又化作丹田中一丝暖意。",
    ];
    let text = flavors[Math.floor(Math.random() * flavors.length)] + "\n\n【灵力 +" + gain + "】";
    text += gf ? "（主修：" + gf.name + "）" : "（尚无功法引导，事倍功半）";
    this.showResult("修炼・第 " + State.data.day + " 日", text, back);
  },

  // ---- 突破（公式见开发方案 §6.5） ----
  breakthrough() {
    const back = State.data.scene;
    const info = State.realmInfo();
    const nextInfo = CONFIG.realms[State.data.realm + 1];
    if (!info || !info.toNext || !nextInfo) {
      this.showResult("突破", "你已至当前修行之路的巅峰，前路渺渺，暂无可循之法。", back);
      return;
    }
    const cur = State.data.attrs["灵力"] || 0;
    if (cur < info.toNext) {
      this.showResult(
        "突破・机缘未至",
        "你尝试冲击" + nextInfo.name + "境的壁垒，却觉丹田灵力空虚，难以为继。\n\n【突破需灵力 " +
          info.toNext + "，现有 " + cur + "。回去再积攒些修为吧。】",
        back
      );
      return;
    }

    State.data.day += 1;
    const wu = State.effective().eff["悟性"] || 0;
    const chance = Math.min(0.9, 0.45 + wu * 0.03);
    if (Math.random() < chance) {
      State.setRealm(State.data.realm + 1);
      State.modAttr("灵力", -Math.round(info.toNext * 0.6));
      State.modAttr("气血", 10);
      State.modAttr("攻击", 2);
      State.modAttr("防御", 2);
      this.showResult(
        "突破・" + nextInfo.name + "！",
        "轰——！\n\n体内壁垒应声而碎，磅礴灵力自天灵倾泻而下，冲刷经脉，淬炼筋骨！\n\n你睁开双眼，眸中似有星光一闪而逝。\n\n【境界提升：" +
          nextInfo.name + "】【气血 +10　攻击 +2　防御 +2】",
        back
      );
    } else {
      State.modAttr("灵力", -Math.round(cur * 0.3));
      State.modAttr("气血", -5);
      this.showResult(
        "突破・失败",
        "灵力奔涌至瓶颈处，却如浪碎礁石，轰然溃散！\n\n你闷哼一声，喉头一甜，强行压下翻腾的气血。\n\n【灵力损失三成，气血 -5。稳固根基，来日再战。】",
        back
      );
    }
  },

  // ---- 战斗 v1：自动回合结算（规则见开发方案 §6.6） ----
  // spec: { enemy: 敌人id, win: 胜利场景, lose: 战败场景 }
  battle(spec) {
    const e = ENEMIES[spec.enemy];
    if (!e) {
      console.error("敌人不存在：" + spec.enemy);
      return;
    }
    const p = State.effective().eff;
    let php = p["气血"] || 1;
    let ehp = e.气血;
    let rounds = 0;
    const rnd = () => Math.floor(Math.random() * 5) - 2; // -2 ~ +2
    while (php > 0 && ehp > 0 && rounds < 30) {
      rounds++;
      ehp -= Math.max(1, (p["攻击"] || 0) - e.防御 + rnd()); // 玩家先手
      if (ehp <= 0) break;
      php -= Math.max(1, e.攻击 - (p["防御"] || 0) + rnd());
    }
    State.data.day += 1;

    const win = ehp <= 0;
    let text = "你与" + e.name + "【" + e.realm + "】战作一团！\n\n激斗 " + rounds + " 个回合，";
    if (win) {
      const taken = (p["气血"] || 1) - Math.max(php, 0);
      if (taken > 0) State.modAttr("气血", -taken);
      text += "你觑得破绽，一击制胜！\n\n【损失气血 " + taken + "】";
      if (e.reward) {
        this.applyEffect(e.reward);
        if (e.rewardText) text += "\n" + e.rewardText;
      }
      this.showResult("战斗・胜", text, spec.win);
    } else {
      State.data.attrs["气血"] = 1;
      text += "你渐落下风，身上添了数道伤口，只得拼死突围而走……\n\n【重伤！气血仅存 1 点，速寻疗伤之物。】";
      this.showResult("战斗・败", text, spec.lose);
    }
  },

  // 条件判定：cond 未定义视为通过；属性判定基于有效属性（含装备/功法加成）
  // { attrs: {属性: {gte/lte}}, realm: {gte/lte}, flags: [...], items: [...], gongfa: [...] }
  checkCond(cond) {
    if (!cond) return true;
    if (cond.attrs) {
      const eff = State.effective().eff;
      for (const key in cond.attrs) {
        const rule = cond.attrs[key];
        const val = eff[key] || 0;
        if (rule.gte !== undefined && val < rule.gte) return false;
        if (rule.lte !== undefined && val > rule.lte) return false;
      }
    }
    if (cond.realm) {
      if (cond.realm.gte !== undefined && State.data.realm < cond.realm.gte) return false;
      if (cond.realm.lte !== undefined && State.data.realm > cond.realm.lte) return false;
    }
    if (cond.flags) {
      for (const f of cond.flags) if (!State.hasFlag(f)) return false;
    }
    if (cond.items) {
      for (const it of cond.items) if (!State.hasItem(it)) return false;
    }
    if (cond.gongfa) {
      for (const g of cond.gongfa) {
        if (State.data.gongfa.learned.indexOf(g) < 0) return false;
      }
    }
    return true;
  },

  // 效果结算：
  // { attrs: {属性: 增减量}, addItems, removeItems, setFlags, clearFlags,
  //   realm, learnGongfa: [功法id] }
  applyEffect(eff) {
    if (eff.attrs) {
      for (const key in eff.attrs) State.modAttr(key, eff.attrs[key]);
    }
    if (eff.addItems) eff.addItems.forEach((id) => State.addItem(id));
    if (eff.removeItems) eff.removeItems.forEach((id) => State.removeItem(id));
    if (eff.setFlags) eff.setFlags.forEach((f) => State.setFlag(f));
    if (eff.clearFlags) eff.clearFlags.forEach((f) => State.clearFlag(f));
    if (eff.realm !== undefined) State.setRealm(eff.realm);
    if (eff.learnGongfa) eff.learnGongfa.forEach((id) => State.learnGongfa(id));
  },
};
