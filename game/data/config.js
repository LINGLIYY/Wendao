// ============================================
// 全局配置 —— 纯数据层，禁止写逻辑
// ============================================
const CONFIG = {
  // 游戏标题
  title: "修仙・问道",

  // 新游戏的入口场景
  startScene: "start",

  // 初始属性（状态栏字段在这里定义）
  initialAttrs: {
    气血: 20,
    灵力: 0,
    攻击: 5,
    防御: 5,
    悟性: 5,
    勇气: 5,
  },

  // 装备槽位
  equipSlots: ["武器", "防具", "饰品", "法宝"],

  // 事件稀有度 → 抽取权重
  rarityWeights: { 普通: 70, 稀有: 25, 传说: 5 },

  // 玩家默认名
  playerName: "林尘",

  // 手动存档槽位上限（不含自动存档槽）
  maxSaveSlots: 6,

  // 境界表：state.realm 存的是下标
  // toNext = 突破到下一境界所需灵力（null 表示当前版本巅峰）
  // lifespan = 寿元（占位，寿元系统实装后启用）
  realms: [
    { name: "凡人", toNext: 10, lifespan: 80 },
    { name: "练气", toNext: 60, lifespan: 120 },
    { name: "筑基", toNext: 200, lifespan: 200 },
    { name: "金丹", toNext: 500, lifespan: 500 },
    { name: "元婴", toNext: 1200, lifespan: 800 },
    { name: "化神", toNext: 3000, lifespan: 1500 },
    { name: "炼虚", toNext: 8000, lifespan: 3000 },
    { name: "合体", toNext: 20000, lifespan: 6000 },
    { name: "大乘", toNext: 50000, lifespan: 10000 },
    { name: "渡劫", toNext: null, lifespan: 10000 },
  ],
};
