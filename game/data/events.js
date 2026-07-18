// ============================================
// 随机事件池 —— 纯数据层（当前为占位，格式已定，见开发方案 §6.2）
//
// 事件格式与场景（data/scenes.js）完全一致，额外多三个字段：
//   tags:   地点/来源标签数组，剧情选项用 eventDraw:{tags:[...]} 触发抽取
//   rarity: 稀有度（普通/稀有/传说），权重见 config.rarityWeights
//   cond:   出现条件（可选，同选项 cond 格式）
//
// 阶段三接入 AI 后，AI 生成的事件也写入这张表的格式，引擎无需改动。
// ============================================
const EVENTS = {

  // ================ 临江坊市 ================

  ev_fs_wushi: {
    rarity: "普通",
    tags: ["临江坊市"],
    title: "坊市・寻常半日",
    text:
      "你在坊市里转了半日，除了被人潮挤掉一只鞋，一无所获。\n\n" +
      "不过听摊贩们闲聊，最近似乎有位炼丹师在坊市高价收购灵草——这消息，说不定什么时候用得上。",
    choices: [{ text: "回到坊市街口", next: "linjiang_fangshi" }],
  },

  ev_fs_xiaofan: {
    rarity: "普通",
    tags: ["临江坊市"],
    title: "坊市・胡饼摊",
    text:
      "“小哥！看你风尘仆仆，定是远道而来！”一个热情过头的小贩拦住了你，油乎乎的手里举着刚出炉的胡饼。\n\n" +
      "“三文钱两块，走过路过不要错过！”",
    choices: [
      {
        text: "买两块胡饼（获得干粮）",
        next: "linjiang_fangshi",
        effect: { addItems: ["ganliang"] },
      },
      { text: "摆手走开", next: "linjiang_fangshi" },
    ],
  },

  ev_fs_laozhe: {
    rarity: "稀有",
    tags: ["临江坊市"],
    title: "坊市・古旧地摊",
    text:
      "坊市最偏僻的角落里，一位老者守着一方褪色的旧布，布上只摆着一枚木符。\n\n" +
      "你的目光刚落上去，老者便抬起头，浑浊的眼睛忽然亮了一下：“有缘人。此符随老朽三十年，今日看来，是要易主了。”\n\n" +
      "【老者：境界不明】",
    choices: [
      {
        text: "收下护身符，郑重道谢",
        next: "linjiang_fangshi",
        effect: { addItems: ["hushenfu"] },
      },
      { text: "心生警惕，只是看看便离开", next: "linjiang_fangshi" },
    ],
  },

  ev_fs_doufa: {
    rarity: "传说",
    tags: ["临江坊市"],
    title: "坊市・惊雷",
    text:
      "轰——！\n\n" +
      "半空中骤然炸响一声惊雷，两道遁光在城外江面上轰然相撞，激起十丈高的水墙！坊市中修士纷纷驻足仰望，有人低呼：“是筑基期的斗法！”\n\n" +
      "你屏住呼吸看完了全程。电光石火间灵力奔涌的轨迹，竟让你隐约摸到了一丝门道。\n\n" +
      "【悟性 +1】",
    onEnter: { attrs: { 悟性: 1 } },
    choices: [{ text: "心潮澎湃地回到坊市", next: "linjiang_fangshi" }],
  },

  // ================ 临江荒林 ================

  ev_hl_dog: {
    rarity: "普通",
    tags: ["临江荒林"],
    title: "荒林・恶犬拦路",
    text:
      "枯枝在脚下咔嚓作响。一条瘦骨嶙峋的野犬从灌木后蹿出，呲着黄牙，喉咙里滚出低沉的呜声。\n\n" +
      "【野犬：凡兽】",
    choices: [
      { text: "拔剑迎战！", battle: { enemy: "wild_dog", win: "linjiang_fangshi", lose: "linjiang_fangshi" } },
      { text: "缓缓后退，绕道而行", next: "linjiang_fangshi" },
    ],
  },

  ev_hl_snake: {
    rarity: "稀有",
    tags: ["临江荒林"],
    title: "荒林・蛇影",
    text:
      "林间忽然一片死寂。一条碗口粗的黑纹妖蛇自树冠垂下，竖瞳锁定了你，信子嘶嘶作响——它盘踞之处，隐有灵气波动，似在护着什么。\n\n" +
      "【黑纹妖蛇：练气三层・妖兽】",
    choices: [
      { text: "富贵险中求，战！", battle: { enemy: "black_snake", win: "linjiang_fangshi", lose: "linjiang_fangshi" } },
      { text: "境界悬殊，速速退走", next: "linjiang_fangshi" },
    ],
  },

  ev_hl_quiet: {
    rarity: "普通",
    tags: ["临江荒林"],
    title: "荒林・无事",
    text:
      "你在荒林中转了半日，除了几只受惊的野兔，一无所获。\n\n" +
      "不过临溪打了一套拳脚，倒也活络了筋骨。",
    onEnter: { attrs: { 气血: 1 } },
    choices: [{ text: "返回临江城", next: "linjiang_fangshi" }],
  },

  // ================ 青云后山 ================

  ev_qs_wolf: {
    rarity: "普通",
    tags: ["青云后山"],
    title: "后山・狼嚎",
    text:
      "云雾深处传来一声狼嚎。转过山岩，一头灰毛妖狼正伏在兽径旁，绿油油的眼睛盯住了你。\n\n" +
      "后山妖兽是宗门特意放养的磨刀石——要试试你的剑吗？\n\n" +
      "【灰毛妖狼：练气一层・妖兽】",
    choices: [
      { text: "正是练手的好机会，战！", battle: { enemy: "gray_wolf", win: "qingyun_hub", lose: "qingyun_hub" } },
      { text: "今日状态不佳，退走", next: "qingyun_hub" },
    ],
  },

  ev_qs_herb: {
    rarity: "普通",
    tags: ["青云后山"],
    title: "后山・崖畔灵草",
    text:
      "你在一处背阴的崖畔发现几株疗伤草，叶脉间灵气流转，正是入药的好年份。\n\n" +
      "【获得 疗伤草】",
    onEnter: { addItems: ["lingcao"] },
    choices: [{ text: "小心采下，收入行囊", next: "qingyun_hub" }],
  },

  ev_qs_jianzhong: {
    rarity: "稀有",
    tags: ["青云后山"],
    title: "后山・剑冢残意",
    text:
      "你误入一片布满断剑的山谷。锈迹斑斑的剑身插满坡地，像一片沉默的墓碑。\n\n" +
      "指尖抚过其中一柄断剑时，一缕苍凉剑意突然涌入识海——那是某位前辈陨落前的最后一剑。\n\n" +
      "【悟性 +1】",
    onEnter: { attrs: { 悟性: 1 } },
    choices: [{ text: "对断剑长揖一礼，退出山谷", next: "qingyun_hub" }],
  },
};
