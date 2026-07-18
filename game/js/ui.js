// ============================================
// UI 渲染 —— 全项目唯一操作 DOM 的文件
// 三栏 CRPG 布局：左=人物面板 / 中=剧情 / 右=背包+事件日志
// 桌面端两侧常显；移动端收起为浮层，由工具栏按钮开关
// ============================================
const UI = {
  el: {}, // 缓存 DOM 引用，main.js 启动时填充
  saveMode: "load", // 存档面板当前模式："save" | "load"

  init() {
    this.el.title = document.getElementById("scene-title");
    this.el.text = document.getElementById("scene-text");
    this.el.choices = document.getElementById("choices");
    this.el.char = document.getElementById("char-panel");
    this.el.side = document.getElementById("side-right");
    this.el.inventory = document.getElementById("inventory-panel");
    this.el.log = document.getElementById("log-panel");
    this.el.savePanel = document.getElementById("save-panel");
    this.el.toast = document.getElementById("toast");
  },

  // 渲染一个场景（正文 + 选项），并刷新整个 HUD
  render(scene, choices) {
    this.el.title.textContent = scene.title || "";
    this.el.text.textContent = scene.text || "";
    // 重新触发淡入动画
    this.el.text.classList.remove("fade-in");
    void this.el.text.offsetWidth;
    this.el.text.classList.add("fade-in");

    this.el.choices.innerHTML = "";
    choices.forEach((choice) => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.textContent = choice.text;
      btn.onclick = () => Engine.choose(choice);
      this.el.choices.appendChild(btn);
    });

    this.renderHUD();
  },

  // 三个常显区域统一刷新入口
  renderHUD() {
    this.renderChar();
    this.renderInventory();
    this.renderLog();
  },

  // ============================================
  // 左栏：人物面板
  // ============================================
  renderChar() {
    const { base, bonus, eff } = State.effective();
    let html = "<h3>" + CONFIG.playerName + '</h3>';
    html += '<div class="realm-badge">' + State.realmName() + "</div>";
    html += '<div class="attr-row"><span>灵根</span><span>' + State.lingGen() + "</span></div>";
    html += '<div class="attr-row"><span>时日</span><span>第 ' + State.data.day + " 日</span></div>";
    const info = State.realmInfo();
    if (info && info.toNext) {
      html +=
        '<div class="attr-row"><span>突破所需</span><span>灵力 ' +
        (State.data.attrs["灵力"] || 0) + " / " + info.toNext + "</span></div>";
    }

    html += "<h4>属性</h4>";
    for (const key in eff) {
      html +=
        '<div class="attr-row"><span>' + key + "</span><span>" +
        (base[key] || 0) +
        (bonus[key] ? ' <i class="attr-bonus">+' + bonus[key] + "</i>" : "") +
        "</span></div>";
    }

    html += "<h4>装备</h4>";
    CONFIG.equipSlots.forEach((slot) => {
      const id = State.data.equipment[slot];
      html +=
        '<div class="attr-row"><span>' + slot + "</span><span>" +
        (id
          ? ITEMS[id].name +
            ' <button class="mini-btn" onclick="UI.unequip(\'' + slot + '\')">卸下</button>'
          : '<i class="empty">空</i>') +
        "</span></div>";
    });

    html += "<h4>功法</h4>";
    const learned = State.data.gongfa.learned;
    if (!learned.length) {
      html += '<p class="empty">尚未修习任何功法</p>';
    }
    learned.forEach((gid) => {
      const gf = GONGFA[gid];
      if (!gf) return;
      const isActive = State.data.gongfa.active === gid;
      html +=
        '<div class="attr-row"><span>' + gf.name +
        '<span class="item-type">' + gf.grade + "</span></span><span>" +
        (isActive
          ? '<i class="attr-bonus">主修</i>'
          : '<button class="mini-btn" onclick="UI.setActiveGongfa(\'' + gid + '\')">主修</button>') +
        "</span></div>";
    });

    html +=
      '<button class="choice-btn mobile-close" onclick="UI.toggleChar()">关 闭</button>';
    this.el.char.innerHTML = html;
  },

  unequip(slot) {
    State.unequip(slot);
    this.renderHUD();
  },

  setActiveGongfa(id) {
    State.setActiveGongfa(id);
    this.toast("主修功法：" + GONGFA[id].name);
    this.renderHUD();
  },

  // ============================================
  // 右栏上：背包
  // ============================================
  renderInventory() {
    const items = State.data.items;
    let html = "<h3>背包</h3>";
    if (items.length === 0) {
      html += '<p class="empty">空空如也</p>';
    } else {
      html += "<ul>";
      items.forEach((id) => {
        const it = ITEMS[id] || { name: id, type: "?", desc: "" };
        let btns = "";
        if (it.use) {
          btns +=
            '<button class="mini-btn" onclick="UI.useItem(\'' + id + '\')">' +
            (it.use.learnGongfa ? "研读" : "使用") + "</button>";
        }
        if (it.slot) {
          btns += '<button class="mini-btn" onclick="UI.equipItem(\'' + id + '\')">装备</button>';
        }
        html +=
          "<li><b>" + it.name + "</b>" +
          '<span class="item-type">' + it.type + "</span>" +
          (it.rarity ? '<span class="item-type">' + it.rarity + "</span>" : "") +
          "<p>" + it.desc + "</p>" +
          (btns ? '<div class="item-actions">' + btns + "</div>" : "") +
          "</li>";
      });
      html += "</ul>";
    }
    this.el.inventory.innerHTML = html;
  },

  useItem(id) {
    const it = ITEMS[id];
    if (!it || !it.use || !State.hasItem(id)) return;
    Engine.applyEffect(it.use);
    if (it.consumable) State.removeItem(id);
    this.toast((it.use.learnGongfa ? "研读了 " : "使用了 ") + it.name);
    this.renderHUD();
  },

  equipItem(id) {
    if (State.equip(id)) {
      this.toast("已装备 " + ITEMS[id].name);
      this.renderHUD();
    }
  },

  // ============================================
  // 右栏下：事件日志
  // ============================================
  renderLog() {
    const log = State.data.log || [];
    let html = '<h3>事件日志</h3><div class="log-list">';
    log.slice(-40).forEach((line) => {
      const cls = line.charAt(0) === "》" ? "log-choice" : "log-scene";
      html += '<div class="' + cls + '">' + line + "</div>";
    });
    html += "</div>";
    html +=
      '<button class="choice-btn mobile-close" onclick="UI.toggleSide()">关 闭</button>';
    this.el.log.innerHTML = html;
    const list = this.el.log.querySelector(".log-list");
    list.scrollTop = list.scrollHeight; // 自动滚到最新
  },

  // ============================================
  // 移动端浮层开关（桌面端两侧常显，按钮隐藏）
  // ============================================
  toggleChar() {
    this.el.side.classList.add("hidden");
    this.el.char.classList.toggle("hidden");
  },

  toggleSide() {
    this.el.char.classList.add("hidden");
    this.el.side.classList.toggle("hidden");
  },

  // ============================================
  // 存档面板（多槽位，存/读共用一个面板，按模式切换）
  // ============================================
  openSavePanel(mode) {
    this.saveMode = mode;
    this.renderSavePanel();
    this.el.savePanel.classList.remove("hidden");
  },

  closeSavePanel() {
    this.el.savePanel.classList.add("hidden");
  },

  renderSavePanel() {
    const mode = this.saveMode;
    let html =
      '<div class="panel-box">' +
      "<h3>" + (mode === "save" ? "存档" : "读档") + "</h3>" +
      '<div class="slot-list">';

    // 自动存档槽只在读档模式下展示（不可手动覆盖，市面通行做法）
    if (mode === "load") {
      html += this._slotHtml("自动存档", Save.AUTO_SLOT, Save.read(Save.AUTO_SLOT), true);
    }
    Save.list().forEach((s) => {
      html += this._slotHtml("存档 " + s.slot, s.slot, s.data, false);
    });

    html +=
      "</div>" +
      '<div class="panel-io">' +
      '<button onclick="UI.exportSave()">导出进度</button>' +
      '<button onclick="UI.importSave()">导入进度</button>' +
      "</div>" +
      '<button class="choice-btn panel-close" onclick="UI.closeSavePanel()">关 闭</button>' +
      "</div>";
    this.el.savePanel.innerHTML = html;
  },

  // ---- 存档导出/导入（JSON 文件） ----
  exportSave() {
    const record = { version: Save.VERSION, exportedAt: Date.now(), state: State.data };
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "修仙问道-进度-第" + State.data.day + "日.json";
    a.click();
    URL.revokeObjectURL(a.href);
    this.toast("已导出当前进度");
  },

  importSave() {
    document.getElementById("import-file").click();
  },

  handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const st = data.state || data; // 兼容裸 state 格式
        if (!st.scene || !(SCENES[st.scene] || EVENTS[st.scene])) throw new Error("bad");
        State.data = Save.upgrade(st);
        Engine.goto(State.data.scene, true);
        this.closeSavePanel();
        this.toast("进度导入成功");
      } catch (e) {
        this.toast("导入失败：文件无效");
      }
    };
    reader.readAsText(file);
  },

  // 单个槽位的 HTML
  _slotHtml(label, slot, data, isAuto) {
    const mode = this.saveMode;
    let meta;
    if (data) {
      const m = data.meta;
      meta =
        '<div class="slot-line1">' + m.name + "・" + m.realm +
        '　<span class="slot-scene">' + m.sceneTitle + "</span></div>" +
        '<div class="slot-line2">' + new Date(m.time).toLocaleString() + "</div>";
    } else {
      meta = '<div class="slot-empty">—— 空 ——</div>';
    }

    let actions = "";
    if (mode === "save") {
      actions += '<button onclick="UI.onSlotAction(\'save\', \'' + slot + '\')">' +
        (data ? "覆盖" : "存入") + "</button>";
    } else if (data) {
      actions += '<button onclick="UI.onSlotAction(\'load\', \'' + slot + '\')">读取</button>';
    }
    if (data && !isAuto) {
      actions += '<button class="danger" onclick="UI.onSlotAction(\'delete\', \'' + slot + '\')">删除</button>';
    }

    return (
      '<div class="slot">' +
      '<div class="slot-info"><div class="slot-name">' + label + "</div>" + meta + "</div>" +
      '<div class="slot-actions">' + actions + "</div>" +
      "</div>"
    );
  },

  // 槽位按钮统一入口
  onSlotAction(action, slot) {
    if (action === "save") {
      if (Save.read(slot) && !confirm("该槽位已有存档，确定覆盖吗？")) return;
      Save.save(slot);
      this.toast("已存入 " + (slot === Save.AUTO_SLOT ? "自动存档" : "存档 " + slot));
      this.renderSavePanel();
    } else if (action === "load") {
      if (Save.load(slot)) {
        Engine.goto(State.data.scene, true); // 读档恢复，不重复结算 onEnter
        this.closeSavePanel();
        this.toast("读档成功");
      } else {
        this.toast("存档已损坏或不存在");
        this.renderSavePanel();
      }
    } else if (action === "delete") {
      if (!confirm("确定删除该存档吗？此操作不可恢复。")) return;
      Save.delete(slot);
      this.renderSavePanel();
    }
  },

  // 右下角提示气泡
  toast(msg) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.el.toast.classList.remove("show");
    }, 1800);
  },
};
