// ============================================
// 物品表 —— 纯数据层，禁止写逻辑
//
// 通用字段：name / type / rarity（品质）/ desc
// 消耗品：use（使用时结算的效果，格式同场景 effect）+ consumable
// 功法书：use.learnGongfa: [功法id]（见 data/gongfa.js）
// 装备：  slot（装备槽位）+ stats（装备时的属性加成）
// ============================================
const ITEMS = {
  // ---- 功法书 ----
  yinqijue: {
    name: "《引气诀》",
    type: "功法书",
    rarity: "凡品",
    desc: "青云宗入门吐纳法门，凡人修习百日可引气入体，踏入练气。",
    use: { learnGongfa: ["gf_yinqi"] },
    consumable: true,
  },

  // ---- 丹药 / 消耗品 ----
  juqidan: {
    name: "聚气丹",
    type: "丹药",
    rarity: "凡品",
    desc: "以数种低阶灵草炼成，可助无灵根者短暂感应天地灵气。",
    use: { attrs: { 灵力: 3 } },
    consumable: true,
  },
  ganliang: {
    name: "干粮",
    type: "食物",
    rarity: "凡品",
    desc: "母亲连夜烙的面饼，还带着一点余温。",
    use: { attrs: { 气血: 5 } },
    consumable: true,
  },
  lingcao: {
    name: "疗伤草",
    type: "丹药",
    rarity: "凡品",
    desc: "山野间自生的灵草，捣碎敷服可活血生肌。",
    use: { attrs: { 气血: 10 } },
    consumable: true,
  },

  // ---- 装备 ----
  tiejian: {
    name: "铁剑",
    type: "装备",
    rarity: "凡品",
    slot: "武器",
    stats: { 攻击: 3 },
    desc: "爹年轻时打猎用的铁剑，剑刃上还留着几处豁口。",
  },
  buyi: {
    name: "粗布衣",
    type: "装备",
    rarity: "凡品",
    slot: "防具",
    stats: { 防御: 1 },
    desc: "娘亲缝的粗布衣，针脚细密。",
  },
  hushenfu: {
    name: "护身符",
    type: "装备",
    rarity: "灵品",
    slot: "饰品",
    stats: { 气血: 5 },
    desc: "不知名老者所刻的木符，隐有暖意流转。",
  },
};
