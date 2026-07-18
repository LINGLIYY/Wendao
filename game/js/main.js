// ============================================
// 启动器 —— 初始化、工具栏按钮、进入游戏
// ============================================
window.addEventListener("DOMContentLoaded", () => {
  UI.init();
  document.title = CONFIG.title;
  document.getElementById("game-title").textContent = CONFIG.title;

  // 旧版单存档 → 多槽位迁移
  Save.migrateLegacy();

  // 工具栏
  document.getElementById("btn-save").onclick = () => UI.openSavePanel("save");
  document.getElementById("btn-load").onclick = () => UI.openSavePanel("load");
  document.getElementById("btn-restart").onclick = () => {
    if (confirm("确定要重新开始吗？（不会删除已保存的存档）")) {
      State.newGame();
      Engine.goto(CONFIG.startScene);
    }
  };
  document.getElementById("btn-char").onclick = () => UI.toggleChar();
  document.getElementById("btn-side").onclick = () => UI.toggleSide();

  // 存档导入：文件选择回调
  document.getElementById("import-file").addEventListener("change", (e) => {
    UI.handleImportFile(e.target.files[0]);
    e.target.value = ""; // 允许重复选择同一文件
  });

  // 点击遮罩关闭存档面板
  UI.el.savePanel.addEventListener("click", (e) => {
    if (e.target === UI.el.savePanel) UI.closeSavePanel();
  });

  // Esc 关闭所有浮层（键盘可访问性；移动端浮层模式）
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    UI.closeSavePanel();
    UI.el.char.classList.add("hidden");
    UI.el.side.classList.add("hidden");
  });

  // 启动：有存档则询问是否从最近的存档继续
  const latest = Save.latest();
  if (latest) {
    const m = latest.data.meta;
    const label = latest.slot === Save.AUTO_SLOT ? "自动存档" : "存档 " + latest.slot;
    if (
      confirm(
        "检测到最近的" + label + "：\n" +
        m.name + "・" + m.realm + "　" + m.sceneTitle + "\n" +
        new Date(m.time).toLocaleString() + "\n\n是否继续上次的旅程？"
      ) &&
      Save.load(latest.slot)
    ) {
      Engine.goto(State.data.scene, true);
      return;
    }
  }
  State.newGame();
  Engine.goto(CONFIG.startScene);
});
