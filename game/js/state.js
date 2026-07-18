// ============================================
// 状态中心 —— 全游戏唯一的状态对象
// 所有状态修改必须经过这里的接口，禁止直接改 State.data
// ============================================
const State = {
  data: null,

  // 开新档
  newGame() {
    const equipment = {};
    CONFIG.equipSlots.forEach((s) => (equipment[s] = null));
    this.data = {
      scene: CONFIG.startScene,
      attrs: Object.assign({}, CONFIG.initialAttrs), // 基础属性
      realm: 0, // 境界下标，对应 CONFIG.realms
      day: 1, // 时日计数（修炼/突破/战斗各消耗一日，为寿元系统铺路）
      items: [], // 背包物品 id 数组
      equipment, // 装备槽：{ 武器: itemId|null, ... }
      gongfa: { learned: [], active: null }, // 已习得功法 / 主修功法
      log: [], // 事件日志（右栏展示，随存档保存）
      flags: {}, // 剧情标记
    };
  },

  // ---- 事件日志 ----
  pushLog(text) {
    this.data.log.push(text);
    if (this.data.log.length > 60) this.data.log.shift(); // 只保留最近 60 条
  },

  // ---- 属性 ----
  modAttr(key, delta) {
    if (!(key in this.data.attrs)) this.data.attrs[key] = 0;
    this.data.attrs[key] += delta;
    if (this.data.attrs[key] < 0) this.data.attrs[key] = 0;
  },

  // 有效属性 = 基础属性 + 装备加成 + 主修功法被动
  // 返回 { base: 基础, bonus: 加成合计, eff: 有效值 }
  effective() {
    const base = this.data.attrs;
    const bonus = {};
    const add = (stats) => {
      for (const k in stats) bonus[k] = (bonus[k] || 0) + stats[k];
    };
    for (const slot in this.data.equipment) {
      const id = this.data.equipment[slot];
      if (id && ITEMS[id] && ITEMS[id].stats) add(ITEMS[id].stats);
    }
    const gf = this.activeGongfa();
    if (gf && gf.passive) add(gf.passive);

    const eff = {};
    for (const k in base) eff[k] = base[k] + (bonus[k] || 0);
    for (const k in bonus) if (!(k in eff)) eff[k] = bonus[k];
    return { base, bonus, eff };
  },

  // ---- 境界 ----
  setRealm(index) {
    this.data.realm = index;
  },
  realmName() {
    return (CONFIG.realms[this.data.realm] || {}).name || "未知";
  },
  realmInfo() {
    return CONFIG.realms[this.data.realm];
  },

  // ---- 灵根（由剧情 flag 决定） ----
  lingGen() {
    if (this.hasFlag("天灵根")) return "天灵根";
    if (this.hasFlag("伪灵根")) return "伪灵根";
    return "未测";
  },

  // ---- 物品 ----
  addItem(id) {
    this.data.items.push(id);
  },
  removeItem(id) {
    const i = this.data.items.indexOf(id);
    if (i >= 0) this.data.items.splice(i, 1);
  },
  hasItem(id) {
    return this.data.items.indexOf(id) >= 0;
  },

  // ---- 装备 ----
  equip(id) {
    const it = ITEMS[id];
    if (!it || !it.slot || !this.hasItem(id)) return false;
    this.unequip(it.slot); // 槽位已有装备则先卸回背包
    this.removeItem(id);
    this.data.equipment[it.slot] = id;
    return true;
  },
  unequip(slot) {
    const cur = this.data.equipment[slot];
    if (cur) {
      this.data.equipment[slot] = null;
      this.addItem(cur);
    }
  },

  // ---- 功法 ----
  learnGongfa(id) {
    if (!GONGFA[id]) return;
    if (this.data.gongfa.learned.indexOf(id) >= 0) return;
    this.data.gongfa.learned.push(id);
    if (!this.data.gongfa.active) this.data.gongfa.active = id; // 第一部功法自动设为主修
  },
  setActiveGongfa(id) {
    if (this.data.gongfa.learned.indexOf(id) >= 0) this.data.gongfa.active = id;
  },
  activeGongfa() {
    return this.data.gongfa.active ? GONGFA[this.data.gongfa.active] : null;
  },

  // ---- 标记 ----
  setFlag(name) {
    this.data.flags[name] = true;
  },
  clearFlag(name) {
    delete this.data.flags[name];
  },
  hasFlag(name) {
    return !!this.data.flags[name];
  },
};
