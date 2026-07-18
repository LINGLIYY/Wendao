// ============================================
// 敌人表 —— 纯数据层，禁止写逻辑
//
// realm:      境界标注（战斗文本中展示，呼应基本规则 #6）
// 气血/攻击/防御: 战斗数值（与玩家有效属性同一体系）
// reward:     胜利时结算的效果（格式同场景 effect）
// rewardText: 胜利文本附加的战利品说明
// ============================================
const ENEMIES = {
  wild_dog: {
    name: "野犬",
    realm: "凡兽",
    气血: 12,
    攻击: 6,
    防御: 2,
    reward: { attrs: { 勇气: 1 } },
    rewardText: "【历经搏杀：勇气 +1】",
  },
  gray_wolf: {
    name: "灰毛妖狼",
    realm: "练气一层・妖兽",
    气血: 22,
    攻击: 9,
    防御: 4,
    reward: { addItems: ["lingcao"] },
    rewardText: "【在狼窝旁发现一株疗伤草】",
  },
  black_snake: {
    name: "黑纹妖蛇",
    realm: "练气三层・妖兽",
    气血: 30,
    攻击: 12,
    防御: 5,
    reward: { attrs: { 灵力: 3 }, addItems: ["lingcao"] },
    rewardText: "【吸纳蛇丹残余灵气：灵力 +3，获得疗伤草】",
  },
};
