// ============================================
// 场景表 —— 纯数据层，禁止写逻辑
//
// 写剧情 = 往这里加条目，不需要碰 js/ 目录。
//
// 场景格式：
//   id: {
//     title:   场景标题（显示在正文上方）
//     text:    正文，支持 \n 换行
//     onEnter: 进入场景时结算的效果（可选）
//     choices: 选项数组
//   }
//
// 选项格式：
//   text:   按钮文字
//   next:   下一个场景 id
//   roll:   随机判定 { chance: 成功率, success: 场景id, fail: 场景id }（有 roll 时忽略 next）
//   cond:   显示条件（可选）{ attrs: {属性: {gte/lte: 数值}}, flags: [...], items: [...] }
//   effect: 选中后结算的效果（可选）
//
// 效果格式（onEnter / effect 通用）：
//   { attrs: {属性: 增减量}, addItems: [...], removeItems: [...],
//     setFlags: [...], clearFlags: [...], realm: 境界下标 }
// ============================================
const SCENES = {

  start: {
    title: "青云村・村口",
    text:
      "你叫林尘，是青云村一个再普通不过的少年。\n\n" +
      "今日天还未亮，村口的老槐树下便围满了人——传闻中的青云宗仙师，竟真的驾云而来，要在这偏僻山村中收徒。\n\n" +
      "仙师一袭青衫，负手立于树下，身前悬浮着一块莹白的测灵石。村中与你年纪相仿的少年少女，都眼巴巴地排起了队。\n\n" +
      "【仙师：修为不明·深不可测】",
    onEnter: { addItems: ["ganliang"] },
    choices: [
      { text: "挤上前去，排队拜见仙师", next: "celing", effect: { attrs: { 勇气: 1 } } },
      { text: "先躲在人群后观望", next: "guanwang" },
    ],
  },

  guanwang: {
    title: "青云村・人群后",
    text:
      "你悄悄躲在人群后，看着一个个少年将手按上测灵石。\n\n" +
      "大多数人手落石上，石头毫无反应，只能黯然退下；偶有一人引得石中亮起一丝微光，仙师也只是略一颔首，说一句“伪灵根，可为杂役”。\n\n" +
      "队伍越来越短，仙师的目光忽然越过人群，落在了你的身上：“那位小友，为何不上前一试？”",
    choices: [
      { text: "硬着头皮走上前去", next: "celing" },
      { text: "摇摇头，转身回家", next: "huijia_pingfan" },
    ],
  },

  celing: {
    title: "青云村・测灵石前",
    text:
      "终于轮到你了。\n\n" +
      "近看之下，那测灵石内里仿佛有云雾流转，触手微凉。仙师淡淡道：“凝神静气，将手按实。”\n\n" +
      "你深吸一口气，把手掌按了上去——",
    choices: [
      {
        text: "闭上眼，感受石中的动静",
        roll: { chance: 0.3, success: "tianlinggen", fail: "fanlinggen" },
      },
    ],
  },

  tianlinggen: {
    title: "青云村・惊变",
    text:
      "嗡——！\n\n" +
      "测灵石骤然爆发出刺目白光，光柱直冲天际，整个青云村都被照得亮如白昼！人群一片哗然。\n\n" +
      "一向古井无波的仙师霍然睁大了眼睛，一把抓住你的手腕，声音都有些发颤：“天灵根……竟是万中无一的天灵根！”\n\n" +
      "“小友，可愿随我上山，入我青云宗内门？”",
    onEnter: { attrs: { 悟性: 3 }, setFlags: ["天灵根"] },
    choices: [
      {
        text: "拜入青云宗",
        next: "shangshan",
        effect: { addItems: ["yinqijue"] },
      },
      { text: "我要回去和娘亲商量……", next: "huijia_qiyu" },
    ],
  },

  fanlinggen: {
    title: "青云村・测灵石前",
    text:
      "石中云雾微微一荡，只泛起一点萤火般的微光，旋即熄灭。\n\n" +
      "仙师摇了摇头：“伪灵根，杂而不纯，引气入体便是极限，此生怕是与大道无缘。”\n\n" +
      "周围传来几声低低的哄笑。你的脸涨得通红，手还僵在测灵石上。",
    onEnter: { setFlags: ["伪灵根"] },
    choices: [
      {
        text: "跪地恳求：“弟子不怕吃苦，杂役也愿做！”",
        roll: { chance: 0.5, success: "kenqiu_cheng", fail: "kenqiu_bai" },
        effect: { attrs: { 勇气: 1 } },
      },
      { text: "默默收回手，转身离开", next: "huijia_pingfan" },
    ],
  },

  kenqiu_cheng: {
    title: "青云村・一线机缘",
    text:
      "仙师注视你良久，忽而轻叹：“有此心志，倒也难得。灵根定上限，心志定下限——罢了。”\n\n" +
      "他袖袍一拂，一枚温润的丹药落入你掌心。\n\n" +
      "“此乃聚气丹。三个月后我再路过此地，你若能借它引气入体，杂役之位，便留给你。”",
    onEnter: { addItems: ["juqidan"], setFlags: ["仙师之诺"] },
    choices: [
      { text: "郑重收下丹药，叩首谢恩", next: "shangshan_yuandian" },
    ],
  },

  kenqiu_bai: {
    title: "青云村・测灵石前",
    text:
      "仙师面色不变，只是淡淡道：“仙途维艰，非心诚可渡。回去吧。”\n\n" +
      "说罢便不再看你，目光转向了队伍中的下一人。\n\n" +
      "膝盖上的尘土还没拍净，你听见自己的心跳声，又重又闷。",
    choices: [
      { text: "起身，攥紧拳头离开", next: "huijia_buganxin" },
    ],
  },

  shangshan: {
    title: "第二章・青云直上",
    text:
      "三日后，你辞别父母，随仙师踏上飞舟。\n\n" +
      "云海在脚下翻涌，青云村缩成一个小点。你摩挲着怀中的《引气诀》，只觉得胸口有什么东西在发烫。\n\n" +
      "天灵根，内门弟子——你的仙途，从这里开始。",
    onEnter: { realm: 1, attrs: { 灵力: 10 } },
    choices: [
      { text: "随仙师入宗，开始修行", next: "qingyun_hub" },
      { text: "重新开始", restart: true },
    ],
  },

  shangshan_yuandian: {
    title: "第二章・微茫之火",
    text:
      "此后三月，你白日帮家里务农，夜里便盘膝坐在屋后山坡上，一遍遍尝试感应天地灵气。\n\n" +
      "第八十九天深夜，你咬牙服下聚气丹——一缕微凉的气流，终于顺着呼吸沉入了小腹。\n\n" +
      "引气入体，练气一层。虽只是杂役的门槛，但你知道，路已经在脚下了。\n\n" +
      "三个月期满，仙师如约而至，将你带上了青云宗。",
    onEnter: { realm: 1, attrs: { 灵力: 3 }, removeItems: ["juqidan"] },
    choices: [
      { text: "以杂役弟子之身入宗", next: "qingyun_hub" },
      { text: "重新开始", restart: true },
    ],
  },

  huijia_pingfan: {
    title: "结局・凡尘",
    text:
      "你回到了家中。娘亲正在灶前添柴，见你回来，只问了句“饿不饿”。\n\n" +
      "多年以后，你成了青云村最好的猎户，娶妻生子，一生平顺。\n\n" +
      "只是偶尔夜里抬头望见流星掠过山脊，你总会想起那个清晨，老槐树下悬着的那块莹白石头。\n\n" +
      "【第一章・完】",
    choices: [{ text: "重新开始", restart: true }],
  },

  huijia_buganxin: {
    title: "第二章・心火不熄",
    text:
      "你回到家中，一夜未眠。\n\n" +
      "第二日天不亮，你收拾了行囊——听镇上的货郎说过，千里之外的临江城，每年都有散修坊市，或许……那里有不需要灵根的机缘。\n\n" +
      "临走前，爹一言不发地把他年轻时打猎用的铁剑塞进了你的行囊，娘亲往里添了件新缝的粗布衣。\n\n" +
      "仙路断了一条，你偏要自己再蹚一条出来。",
    onEnter: { attrs: { 勇气: 2 }, setFlags: ["散修之路"], addItems: ["tiejian", "buyi"] },
    choices: [
      { text: "启程，前往临江城", next: "linjiang_fangshi" },
      { text: "重新开始", restart: true },
    ],
  },

  huijia_qiyu: {
    title: "第二章・缘起",
    text:
      "仙师非但没有不悦，反而抚掌而笑：“身负天灵根而不忘亲恩，心性可贵。”\n\n" +
      "“三日后，我在村口等你。”\n\n" +
      "当晚，娘亲摸着你的头发红了眼眶，爹一言不发地去镇上打了一壶酒。三日后村口，仙师的飞舟准时落下。",
    onEnter: { addItems: ["yinqijue"], realm: 1, attrs: { 灵力: 10 } },
    choices: [
      { text: "登上飞舟，前往青云宗", next: "qingyun_hub" },
      { text: "重新开始", restart: true },
    ],
  },

  // ================================================================
  // 第二章 —— 双线可玩循环
  // 铁律：hub 场景不设 onEnter（修炼/战斗结算会反复回到这里）
  // ================================================================

  // ---- 青云宗线 ----
  qingyun_hub: {
    title: "青云宗・居所",
    text:
      "青云宗立于九霄峰上，终年云海翻腾。晨钟暮鼓之间，随处可见御剑来去的身影。\n\n" +
      "你的居所虽然简朴，一草一木却都浸着远胜山下的灵气。\n\n" +
      "修行之路，贵在日积月累。今日，你打算做些什么？",
    choices: [
      { text: "打坐修炼（一日）", action: "cultivate" },
      { text: "尝试冲击突破", action: "breakthrough" },
      { text: "去后山历练（随机遭遇）", eventDraw: { tags: ["青云后山"] } },
      { text: "下山远行，前往临江城", next: "linjiang_fangshi" },
    ],
  },

  // ---- 临江城散修线 ----
  linjiang_fangshi: {
    title: "临江城・坊市",
    text:
      "临江城灰青色的城墙下，城南坊市鱼龙混杂：吆喝的小贩、蒙面的散修、挂着幌子的丹铺……\n\n" +
      "据说每隔数年，就有凡人在这里撞见改变命运的机缘。\n\n" +
      "你握了握腰间的铁剑，混入了人流。",
    choices: [
      { text: "在坊市里四处逛逛（随机遭遇）", eventDraw: { tags: ["临江坊市"] } },
      { text: "出城去荒林历练（随机遭遇）", eventDraw: { tags: ["临江荒林"] } },
      { text: "回客栈打坐修炼（一日）", action: "cultivate" },
      { text: "尝试冲击突破", action: "breakthrough" },
      { text: "找个茶棚歇脚，恢复精神", next: "linjiang_fangshi", effect: { attrs: { 气血: 2 } } },
    ],
  },
};
