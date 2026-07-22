/** 卡牌定义与牌堆构建 */

const ROLES = {
  iron_rose: {
    id: 'iron_rose', name: '铁玫瑰', glyph: '薔', hue: 340,
    art: 'assets/roles/iron_rose.jpg',
    tag: '支援', desc: '弃置两张道具牌，你和你的队友各回一点血量。'
  },
  gunpowder: {
    id: 'gunpowder', name: '火药', glyph: '火', hue: 18,
    art: 'assets/roles/gunpowder.jpg',
    tag: '情报', desc: '你的回合内，屏幕底部实时显示弹药牌堆最底部的两张卡牌。'
  },
  outlaw: {
    id: 'outlaw', name: '亡命徒', glyph: '亡命', hue: 30,
    art: 'assets/roles/outlaw.jpg',
    tag: '抽牌', desc: '每次对自己打出空弹，立即抽取一张道具牌。'
  },
  quick_cyl: {
    id: 'quick_cyl', name: '快轮', glyph: '轮', hue: 200,
    art: 'assets/roles/quick_cyl.jpg',
    tag: '翻转', desc: '你射出的子弹，空弹视为实弹，实弹视为空弹。'
  },
  double_barrel: {
    id: 'double_barrel', name: '双管', glyph: '双', hue: 45,
    art: 'assets/roles/double_barrel.jpg',
    tag: '赌博', desc: '每次装弹后，可声明本次装弹第几发子弹为实弹或空弹，若声明成功，则你和你的队友下一轮获得双倍道具。若声明失败，你的对手们下一轮获得双倍道具。'
  },
  silver_spike: {
    id: 'silver_spike', name: '银刺', glyph: '刺', hue: 210,
    art: 'assets/roles/silver_spike.jpg',
    tag: '特殊', desc: '场上有银刺时，每轮装弹会自动将特殊子弹随机塞入子弹堆（银刺无法选择是否塞入）。'
  },
  night_owl: {
    id: 'night_owl', name: '夜枭', glyph: '枭', hue: 265,
    art: 'assets/roles/night_owl.jpg',
    tag: '反打', desc: '当你的血量少于等于4点时，你对自己开枪打出实弹选择一个对手一起扣除血量。'
  },
  rattlesnake: {
    id: 'rattlesnake', name: '响尾蛇', glyph: '蛇', hue: 145,
    art: 'assets/roles/rattlesnake.jpg',
    tag: '复制', desc: '当有一位玩家使用道具时，你可以消耗一点血量将该道具卡复制到自己手中。（一轮限一次）'
  },
  zhui_xiang: {
    id: 'zhui_xiang', name: '追香', glyph: '香', hue: 310,
    art: null,
    tag: '讨债', desc: '此轮内对手开枪打伤你时记为债务人（一轮限一次）。同轮内你对其打出的实弹伤害 +1 后清除；过轮作废。不可与霰弹枪追加。'
  }
};

const ITEMS = {
  lucky_coin: {
    id: 'lucky_coin', name: '幸运硬币', glyph: '币', hue: 42,
    art: 'assets/tools/lucky_coin.jpg',
    desc: '抽两张道具卡。'
  },
  painkiller: {
    id: 'painkiller', name: '止痛药', glyph: '药', hue: 280,
    art: 'assets/tools/painkiller.jpg',
    desc: '投掷一次六面骰子，奇数失去1点血量，偶数回复2点血量。'
  },
  bandage: {
    id: 'bandage', name: '绷带', glyph: '绷', hue: 8,
    art: 'assets/tools/bandage.jpg',
    desc: '回复一点血量。'
  },
  eject: {
    id: 'eject', name: '退弹', glyph: '退', hue: 25,
    art: 'assets/tools/eject.jpg',
    desc: '弃置子弹牌堆顶上一张子弹牌。'
  },
  inspect: {
    id: 'inspect', name: '检视弹巢', glyph: '视', hue: 190,
    art: 'assets/tools/inspect.jpg',
    desc: '查看子弹牌堆中任意位置的子弹牌。'
  },
  shotgun: {
    id: 'shotgun', name: '霰弹枪', glyph: '霰', hue: 0,
    art: 'assets/tools/shotgun.jpg',
    desc: '若下一发为实弹，则开枪时造成的伤害改为造成2点伤害。'
  },
  swap: {
    id: 'swap', name: '换弹', glyph: '换', hue: 160,
    art: 'assets/tools/swap.jpg',
    desc: '交换子弹牌堆中任意两张子弹牌的位置。'
  },
  peek_top: {
    id: 'peek_top', name: '检视弹簧', glyph: '簧', hue: 175,
    art: 'assets/tools/peek_top.jpg',
    desc: '查看子弹牌堆顶上的子弹牌。'
  },
  reverse: {
    id: 'reverse', name: '反转', glyph: '反', hue: 220,
    art: 'assets/tools/reverse.jpg',
    desc: '将下一发子弹反转：实弹变为空弹，空弹变为实弹；特殊弹类型不变，但仍消耗本效果。'
  },
  bind: {
    id: 'bind', name: '捆绑', glyph: '捆', hue: 55,
    art: 'assets/tools/bind.jpg',
    desc: '选择一个玩家，他的下一回合无法行动。'
  },
  double_arrow: {
    id: 'double_arrow', name: '一箭双雕', glyph: '雕', hue: 320,
    art: 'assets/tools/double_arrow.jpg',
    desc: '连锁或解锁一到两名玩家；每人同时仅可与一人连锁，冲突时旧连锁自动解除。被连锁的玩家同时受到下一次伤害；无论伤害如何触发，只要再受到一次伤害，该连锁即解除。'
  }
};

const BULLET = { LIVE: 'live', BLANK: 'blank', SPECIAL: 'special' };

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildItemDeck() {
  const deck = [];
  Object.keys(ITEMS).forEach((id) => {
    for (let i = 0; i < 7; i++) deck.push(id);
  });
  return shuffle(deck);
}

function buildRoleDeck() {
  return shuffle(Object.keys(ROLES));
}

function buildAmmoCountDeck() {
  return shuffle([1, 2, 3, 4, 5, 6]);
}

function bulletLabel(b) {
  if (b === BULLET.LIVE) return '实弹';
  if (b === BULLET.BLANK) return '空弹';
  if (b === BULLET.SPECIAL) return '特殊弹';
  return b;
}

function roleMeta(roleId) {
  return ROLES[roleId] || { name: '?', glyph: '?', hue: 0, tag: '', desc: '' };
}

function itemMeta(itemId) {
  return ITEMS[itemId] || { name: '?', glyph: '?', hue: 0, desc: '' };
}
