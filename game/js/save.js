// ============================================
// 存档 —— 多槽位存档系统（市面常见架构）
//
// 结构：手动槽位 1..CONFIG.maxSaveSlots + 自动存档槽 "auto"
// 每个槽位一条 localStorage 记录：
//   {
//     version: 存档格式版本（未来格式变更时做迁移用）
//     meta:    { name, realm, sceneTitle, time }  —— 列表页展示用
//     state:   State.data 的完整快照
//   }
// ============================================
const Save = {
  PREFIX: "xiuxian_save_slot_",
  LEGACY_KEY: "xiuxian_save_v1", // 旧版单存档，启动时迁移
  AUTO_SLOT: "auto",
  VERSION: 3,

  slotKey(slot) {
    return this.PREFIX + slot;
  },

  // 读取一个槽位，无效/不存在返回 null
  read(slot) {
    const raw = localStorage.getItem(this.slotKey(slot));
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!data.state || !data.state.scene) return null;
      if (!SCENES[data.state.scene] && !EVENTS[data.state.scene]) return null;
      return data;
    } catch (e) {
      return null;
    }
  },

  // 把当前 State 写入槽位
  save(slot) {
    const scene = SCENES[State.data.scene] || {};
    const record = {
      version: this.VERSION,
      meta: {
        name: CONFIG.playerName,
        realm: State.realmName(),
        sceneTitle: scene.title || State.data.scene,
        time: Date.now(),
      },
      state: State.data,
    };
    localStorage.setItem(this.slotKey(slot), JSON.stringify(record));
  },

  // 从槽位恢复 State，成功返回 true
  load(slot) {
    const data = this.read(slot);
    if (!data) return false;
    State.data = this.upgrade(data.state);
    return true;
  },

  // 旧版本存档补全新增字段（v2 → v3：属性扩充/装备/功法）
  upgrade(state) {
    for (const k in CONFIG.initialAttrs) {
      if (!(k in state.attrs)) state.attrs[k] = CONFIG.initialAttrs[k];
    }
    if (!state.equipment) state.equipment = {};
    CONFIG.equipSlots.forEach((s) => {
      if (!(s in state.equipment)) state.equipment[s] = null;
    });
    if (!state.gongfa) state.gongfa = { learned: [], active: null };
    if (!state.log) state.log = [];
    if (!state.day) state.day = 1;
    if (!state.items) state.items = [];
    if (!state.flags) state.flags = {};
    return state;
  },

  delete(slot) {
    localStorage.removeItem(this.slotKey(slot));
  },

  // 自动存档（每次场景推进时由引擎调用）
  autoSave() {
    this.save(this.AUTO_SLOT);
  },

  // 列出所有手动槽位：[{ slot: 1, data: 记录|null }, ...]
  list() {
    const out = [];
    for (let i = 1; i <= CONFIG.maxSaveSlots; i++) {
      out.push({ slot: i, data: this.read(i) });
    }
    return out;
  },

  // 找到时间最新的一个存档（含自动档），没有返回 null
  latest() {
    let best = null;
    const slots = this.list().concat([{ slot: this.AUTO_SLOT, data: this.read(this.AUTO_SLOT) }]);
    for (const s of slots) {
      if (s.data && (!best || s.data.meta.time > best.data.meta.time)) best = s;
    }
    return best;
  },

  // 旧版单存档 → 迁移到槽位 1（只在槽位 1 为空时执行）
  migrateLegacy() {
    const raw = localStorage.getItem(this.LEGACY_KEY);
    if (!raw) return;
    try {
      if (!this.read(1)) {
        const state = JSON.parse(raw);
        if (state.scene && SCENES[state.scene]) {
          const scene = SCENES[state.scene];
          localStorage.setItem(
            this.slotKey(1),
            JSON.stringify({
              version: this.VERSION,
              meta: {
                name: CONFIG.playerName,
                realm: (CONFIG.realms[state.realm] || CONFIG.realms[0]).name,
                sceneTitle: scene.title || state.scene,
                time: Date.now(),
              },
              state: state,
            })
          );
        }
      }
    } catch (e) {
      /* 旧档损坏则直接丢弃 */
    }
    localStorage.removeItem(this.LEGACY_KEY);
  },
};
