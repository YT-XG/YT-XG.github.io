/* ============================================================
   85-adventure.js —— 秘境试炼（双试炼 · 卡牌自走棋 Roguelite）
   ------------------------------------------------------------
   · 开局三选一「秘境环境」；第一试炼 1-1～1-7，第二试炼 2-1～2-7。
   · 1-1 / 1-2 / 1-6 为奖励关（1 血小怪），1-3 / 1-4 为普攻小怪关，
     1-5 为难度二选一挑战关（左 1–2 星 / 右 3–5 星），1-7 为 BOSS。
   · 第二试炼 2-1 / 2-2 改为普攻小怪（2-2 胜利后仍给固定海克斯）。
   · 非 BOSS 怪物强度按节点平滑递增：1-1 为 1.00，每节点 +0.19；
     2-1 为 2.33，高于 1-5 最高星（1.76 × 1.25 = 2.20）。
   · 牌库 = 10 个角色 × 9 张 = 90 张；商店一次 3 张，可花金币刷新。
     3 张 1 星自动合成 2 星，3 张 2 星自动合成 3 星；2 星卖 12、3 星卖 40。
   · 6 格备战席 + 3 格战斗席；战斗席不能重复角色；战斗前全员满血。
   · 胜利 = 基础 + 胜利 + 连胜 + 利息；失败只拿基础奖励并扣征战生命。
   · 海克斯分白银 / 黄金 / 棱彩；黄金 +2 难度、棱彩 +5 难度。
   · 装备不再进商店：每个节点结束有概率掉基础装备，两件基础可在背包合成进阶。
   · 主界面三栏：左「可合成列表 / 海克斯」、中「当前试炼节点 / 主站席 / 备战席」、
     右「已获得装备 / 角色详情」；金币按钮从屏幕上方拉出角色商店。
   · 与普通 1v1 / 2v2 / 3v3 / 赛事 / BOSS 5v1 完全隔离；BOSS 数值走 ADV_BOSS。
   ============================================================ */
'use strict';

var ADV_SAVE_KEY = 'mcduel.adventure.run.v3';
var ADV_SAVE_KEY_V2 = 'mcduel.adventure.run.v2';

var ADV_CONFIG = {
  maxTrial: 2,
  nodesPerTrial: 7,
  boardSlots: 3,
  benchSlots: 6,
  poolCopies: 9,
  cardCost: 4,
  refreshCost: 2,
  startGold: 24,
  startHp: 80,
  winHeal: 4,
  battleTime: 90,
  maxItems: 3,
  interestStep: 10,
  interestCap: 5,
  streakCap: 5,
  winDrop: 0.55,
  lossDrop: 0.25,
  /* 节点强度：每推进一个非 BOSS 节点，怪物生命 / 攻击 / 防御按此步进平滑增加。 */
  nodePowerStep: 0.19
};

/* 玩家卡牌 1–3 星倍率；挑战关怪物强度另走 ADV_CHALLENGE_STARS。
   3 星是核心通关手段：相对 2 星约 2.2 倍生命、1.9 倍攻击。 */
var ADV_STARS = {
  1: { hp: 1.00, atk: 1.00, def: 1.00, speed: 1.00 },
  2: { hp: 1.90, atk: 1.50, def: 1.35, speed: 1.05 },
  3: { hp: 4.20, atk: 2.90, def: 2.20, speed: 1.16 }
};

/* 挑战关 1–5 星的怪物强度：只做温和提升，奖励档位仍按 1–5 星。
   1-5 最高星（节点强度 1.76 × 1.25 = 2.20）仍低于 2-1（2.33）。 */
var ADV_CHALLENGE_STARS = {
  1: { hp: 1.00, atk: 1.00, def: 1.00, speed: 1.00 },
  2: { hp: 1.06, atk: 1.05, def: 1.03, speed: 1.01 },
  3: { hp: 1.12, atk: 1.10, def: 1.06, speed: 1.02 },
  4: { hp: 1.18, atk: 1.15, def: 1.09, speed: 1.03 },
  5: { hp: 1.25, atk: 1.22, def: 1.12, speed: 1.04 }
};

var ADV_BOSS = {
  duo: {
    units: { bossred: 6500, bosslapis: 6500, bosscore: 7000 },
    atk: 0.80, def: 0.90, speed: 1.00, pctOut: 0.36
  },
  storm: {
    units: { stormgolem: 20000 },
    phase2Hp: 30000,
    atk: 0.72, def: 0.92, speed: 1.00, pctOut: 0.50
  }
};

var ADV_QUALITY = {
  silver: { name: '白银', color: '#c7d3e3', weight: 60 },
  gold: { name: '黄金', color: '#ffc45e', weight: 30 },
  prismatic: { name: '棱彩', color: '#7fe7ff', weight: 10 }
};

/* ---------------- 秘境环境（开局三选一） ---------------- */
var ADV_ENVS = [
  {
    id: 'rainbow', name: '彩虹时代', icon: '✺',
    desc: '本局出现的所有海克斯都是棱彩品质。',
    detail: '棱彩海克斯更强，但每个棱彩会让敌人难度 +5。'
  },
  {
    id: 'peace', name: '和平契约', icon: '☮',
    desc: '敌人难度 -4。',
    detail: '难度每比 10 低 1 点，敌人生命 / 攻击 -4%。'
  },
  {
    id: 'hexmania', name: '海克斯狂热', icon: '✧',
    desc: '1-6 / 2-6 节点额外获得一次海克斯三选一。',
    detail: '正常 1-2 / 2-2 的海克斯仍然保留。'
  },
  {
    id: 'rich', name: '富饶之地', icon: '●',
    desc: '开局额外 +15 金币，利息上限 +2。',
    detail: '更快的经济启动，适合滚雪球。'
  },
  {
    id: 'smith', name: '铁匠的馈赠', icon: '⚒',
    desc: '开局获得 2 件基础装备，装备掉落率 +20%。',
    detail: '装备只能靠掉落与合成获得。'
  },
  {
    id: 'trial', name: '试炼枷锁', icon: '⛓',
    desc: '敌人难度 +2，但金币奖励 +30%。',
    detail: '高风险高回报。'
  }
];
var ADV_ENV_BY_ID = {};
for (var advEi = 0; advEi < ADV_ENVS.length; advEi++) ADV_ENV_BY_ID[ADV_ENVS[advEi].id] = ADV_ENVS[advEi];

/* ---------------- 海克斯 ---------------- */
var ADV_HEXES = [
  { id: 'pocket', q: 'silver', name: '零钱袋', icon: '●', text: '立即获得 12 金币。' },
  { id: 'ledger', q: 'silver', name: '小算盘', icon: '▤', text: '利息上限 +2，立即获得 4 金币。' },
  { id: 'whet', q: 'silver', name: '磨刀石', icon: '▰', text: '所有角色造成的伤害 +6%。' },
  { id: 'feather', q: 'silver', name: '轻羽', icon: '≋', text: '所有角色移速 +8%。' },
  { id: 'medic', q: 'silver', name: '急救包', icon: '✚', text: '立即回复 8 点征战生命。' },
  { id: 'merchant', q: 'gold', name: '商人的直觉', icon: '◈', text: '商店刷新有 30% 概率出现 2 星卡（价格 3 倍）。' },
  { id: 'forge', q: 'gold', name: '铁匠铺', icon: '⚒', text: '立即从 3 件基础装备中选择 1 件。' },
  { id: 'streak', q: 'gold', name: '连胜大师', icon: '▲', text: '连胜奖励 +2。' },
  { id: 'barrier', q: 'gold', name: '团队护盾', icon: '⬟', text: '所有角色开场获得 10% 最大生命护盾。' },
  { id: 'usury', q: 'gold', name: '黄金利息', icon: '¤', text: '利息收益 +50%。' },
  { id: 'midas', q: 'prismatic', name: '点金术', icon: '✦', text: '每个节点开始 +8 金币，并获得 1 件随机基础装备。' },
  { id: 'titan', q: 'prismatic', name: '泰坦之力', icon: '❖', text: '所有角色生命 +25%、伤害 +15%。' },
  { id: 'master', q: 'prismatic', name: '装备大师', icon: '⚙', text: '装备掉落率 +40%，且有 25% 概率掉落进阶装备。' },
  { id: 'double', q: 'prismatic', name: '双倍战利品', icon: '✚', text: '奖励选项 +1，金币奖励 +50%。' },
  { id: 'resonance', q: 'prismatic', name: '海克斯共鸣', icon: '◎', text: '每拥有 1 个海克斯，每个节点开始 +1 金币。' }
];
var ADV_HEX_BY_ID = {};
for (var advHi = 0; advHi < ADV_HEXES.length; advHi++) ADV_HEX_BY_ID[ADV_HEXES[advHi].id] = ADV_HEXES[advHi];

/* ---------------- 基础 / 进阶装备 ---------------- */
var ADV_BASIC_IDS = ['shoes', 'knife', 'shield', 'flower', 'potion'];
var ADV_ITEMS = [
  { id: 'shoes', basic: true, icon: '»', name: '疾风鞋', text: '移速 +12%。', mods: { speed: 0.12 } },
  { id: 'knife', basic: true, icon: '⚔', name: '锋刃小刀', text: '普攻 / 技能 / 终结技伤害 +15%。', mods: { dmg: 0.15 } },
  { id: 'shield', basic: true, icon: '⬟', name: '铁壁盾', text: '防御 +25%。', mods: { def: 0.25 } },
  { id: 'flower', basic: true, icon: '✿', name: '生命花', text: '最大生命 +22%。', mods: { hp: 0.22 } },
  { id: 'potion', basic: true, icon: '⚗', name: '剧毒药', text: '持续伤害 +30%。', mods: { dot: 0.30 } },

  { id: 'gale', basic: false, icon: '⚔', name: '疾影战刃', text: '移速 +12% / 伤害 +15%；每 4 秒 +6% 移速、+5% 伤害，最多 5 层。', mods: { speed: 0.12, dmg: 0.15, ramp: { every: 4, speed: 0.06, dmg: 0.05, max: 5 } } },
  { id: 'aegis', basic: false, icon: '⬣', name: '守护之靴', text: '移速 +12% / 防御 +25%；护盾可叠加，护盾比例越高伤害越高（最多 +50%）。', mods: { speed: 0.12, def: 0.25, shieldDmg: 0.50, shieldStack: true } },
  { id: 'windflower', basic: false, icon: '❀', name: '风花之靴', text: '移速 +12% / 生命 +22%；受伤 -8%，技能冷却流速 +10%。', mods: { speed: 0.12, hp: 0.22, taken: -0.08, cdRate: 1.10 } },
  { id: 'venomstep', basic: false, icon: '☠', name: '毒步之靴', text: '移速 +12% / 持续伤害 +30%；普攻附带轻微减速。', mods: { speed: 0.12, dot: 0.30, slowOnHit: 0.18 } },
  { id: 'breaker', basic: false, icon: '⚒', name: '破军战刃', text: '伤害 +35% / 防御 +25%；受到伤害 -5%。', mods: { dmg: 0.35, def: 0.25, taken: -0.05 } },
  { id: 'bloodblade', basic: false, icon: '✜', name: '汲血之刃', text: '伤害 +15% / 生命 +22%；造成伤害回复 12%。', mods: { dmg: 0.15, hp: 0.22, leech: 0.12 } },
  { id: 'rotblade', basic: false, icon: '☣', name: '腐毒之刃', text: '伤害 +15% / 持续伤害 +45%。', mods: { dmg: 0.15, dot: 0.45 } },
  { id: 'thornmail', basic: false, icon: '❈', name: '荆棘战甲', text: '防御 +25% / 生命 +22%；反弹 18% 受到的伤害。', mods: { def: 0.25, hp: 0.22, thorns: 0.18 } },
  { id: 'plaguewall', basic: false, icon: '▓', name: '疫病壁垒', text: '防御 +25% / 持续伤害 +30%；反弹 10% 伤害。', mods: { def: 0.25, dot: 0.30, thorns: 0.10 } },
  { id: 'everbloom', basic: false, icon: '♨', name: '永生之花', text: '生命 +22% / 持续伤害 +30%；每秒回复 1.5% 最大生命。', mods: { hp: 0.22, dot: 0.30, regen: 0.015 } },
  { id: 'swiftshadow', basic: false, icon: '≫', name: '迅影之靴', text: '移速 +30%；受到伤害 -10%。', mods: { speed: 0.30, taken: -0.10 } },
  { id: 'dualedge', basic: false, icon: '✂', name: '双刃', text: '伤害 +38% / 攻击 +12%。', mods: { dmg: 0.38, atk: 0.12 } },
  { id: 'bastion', basic: false, icon: '⬢', name: '不灭壁垒', text: '防御 +55%；开场获得 12% 最大生命护盾。', mods: { def: 0.55, shieldStart: 0.12 } },
  { id: 'worldtree', basic: false, icon: '♣', name: '世界树', text: '生命 +50%；每秒回复 1.2% 最大生命。', mods: { hp: 0.50, regen: 0.012 } },
  { id: 'plagueheart', basic: false, icon: '☢', name: '万毒之心', text: '持续伤害 +75%。', mods: { dot: 0.75 } }
];
var ADV_ITEM_BY_ID = {};
for (var advIi = 0; advIi < ADV_ITEMS.length; advIi++) ADV_ITEM_BY_ID[ADV_ITEMS[advIi].id] = ADV_ITEMS[advIi];

var ADV_RECIPES = [
  { id: 'gale', a: 'shoes', b: 'knife', out: 'gale' },
  { id: 'aegis', a: 'shoes', b: 'shield', out: 'aegis' },
  { id: 'windflower', a: 'shoes', b: 'flower', out: 'windflower' },
  { id: 'venomstep', a: 'shoes', b: 'potion', out: 'venomstep' },
  { id: 'breaker', a: 'knife', b: 'shield', out: 'breaker' },
  { id: 'bloodblade', a: 'knife', b: 'flower', out: 'bloodblade' },
  { id: 'rotblade', a: 'knife', b: 'potion', out: 'rotblade' },
  { id: 'thornmail', a: 'shield', b: 'flower', out: 'thornmail' },
  { id: 'plaguewall', a: 'shield', b: 'potion', out: 'plaguewall' },
  { id: 'everbloom', a: 'flower', b: 'potion', out: 'everbloom' },
  { id: 'swiftshadow', a: 'shoes', b: 'shoes', out: 'swiftshadow' },
  { id: 'dualedge', a: 'knife', b: 'knife', out: 'dualedge' },
  { id: 'bastion', a: 'shield', b: 'shield', out: 'bastion' },
  { id: 'worldtree', a: 'flower', b: 'flower', out: 'worldtree' },
  { id: 'plagueheart', a: 'potion', b: 'potion', out: 'plagueheart' }
];
var ADV_RECIPE_BY_ID = {};
for (var advRi = 0; advRi < ADV_RECIPES.length; advRi++) ADV_RECIPE_BY_ID[ADV_RECIPES[advRi].id] = ADV_RECIPES[advRi];

/* ---------------- 节点 ---------------- */
var ADV_NODES = [
  { n: 1, type: 'gift', name: '前庭宝库', enemies: 1, hp1: true, reward: true },
  { n: 2, type: 'gift', name: '双生回廊', enemies: 2, hp1: true, reward: true, hex: true },
  { n: 3, type: 'mob', name: '锋芒小径', enemies: 2, noSkill: true },
  { n: 4, type: 'mob', name: '围攻广场', enemies: 3, noSkill: true },
  { n: 5, type: 'challenge', name: '守关者', enemies: 3, challenge: true },
  { n: 6, type: 'gift', name: '秘藏宝库', enemies: 2, hp1: true, reward: true, extraHex: true },
  { n: 7, type: 'boss', name: '王座', boss: true }
];
/* 第二试炼节点差异：2-1 / 2-2 由奖励关改为普攻小怪；2-2 胜利后仍给固定海克斯。 */
var ADV_NODE_TRIAL2 = {
  1: { type: 'mob', name: '雷庭前哨', enemies: 2, noSkill: true, reward: false, hp1: false, hex: false },
  2: { type: 'mob', name: '双生雷廊', enemies: 3, noSkill: true, reward: false, hp1: false, hex: true }
};

var adventure = {
  run: null,
  inBattle: false,
  notice: '',
  snapshot: null,
  selectedCard: null,
  selectedItems: [],
  envOffer: [],
  renderKey: '',
  lastStep: '',
  nodeFocus: '',
  itemFocusId: '',
  itemFocusIx: -1,
  shopOpen: false,
  dragItem: -1,
  dragCardUid: -1,
  touchDrag: null
};

/* ---------------- 小工具 ---------------- */
function advEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
/* 是否按手机端布局：详情面板收进弹窗，不常驻三栏 */
function advIsMobile() {
  if (typeof mobiIsMobile === 'function') { try { return mobiIsMobile(); } catch (e) {} }
  return window.innerWidth <= 1080 ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}
function advClamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function advRand() { return Math.random(); }
function advPick(arr) { return arr[Math.floor(advRand() * arr.length)]; }
function advShuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(advRand() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function advItem(id) { return ADV_ITEM_BY_ID[id] || null; }
function advHex(id) { return ADV_HEX_BY_ID[id] || null; }
function advEnv(id) { return ADV_ENV_BY_ID[id] || ADV_ENVS[0]; }
function advRole(key) { return POOL_BY_KEY[key] || null; }
function advItemName(id) { var d = advItem(id); return d ? d.name : id; }
function advItemIcon(id) { var d = advItem(id); return d ? d.icon : '?'; }
function advQuality(q) { return ADV_QUALITY[q] || ADV_QUALITY.silver; }

function advNode(trial, n) {
  var base = ADV_NODES[n - 1];
  if (!base) return null;
  var o = {
    n: n, trial: trial, type: base.type, enemies: base.enemies,
    hp1: !!base.hp1, reward: !!base.reward, hex: !!base.hex,
    extraHex: !!base.extraHex, challenge: !!base.challenge,
    noSkill: !!base.noSkill, boss: !!base.boss,
    name: base.name,
    bossKey: trial === 2 ? 'storm' : 'duo'
  };
  if (base.boss) {
    o.name = trial === 2 ? '雷云巨像' : '红青双子';
  }
  var ov = trial === 2 ? ADV_NODE_TRIAL2[n] : null;
  if (ov) {
    for (var k in ov) {
      if (Object.prototype.hasOwnProperty.call(ov, k)) o[k] = ov[k];
    }
  }
  return o;
}
function advNodeTag(trial, n) { return trial + '-' + n; }
/* 非 BOSS 节点强度：从 1-1 的 1.00 起，每个节点 +0.19；2-1 为 2.33。 */
function advNodePower(trial, n) {
  var global = (trial - 1) * ADV_CONFIG.nodesPerTrial + (n - 1);
  return 1 + ADV_CONFIG.nodePowerStep * Math.max(0, global);
}

function advCurrentNode(r) {
  if (!r) return null;
  return advNode(r.trial, r.node);
}

function advDifficulty(r) {
  if (!r) return 10;
  var d = 10;
  var env = advEnv(r.env);
  if (env.id === 'peace') d -= 4;
  if (env.id === 'trial') d += 2;
  var goldN = 0, prismN = 0;
  for (var i = 0; i < (r.hexes || []).length; i++) {
    var h = advHex(r.hexes[i]);
    if (!h) continue;
    if (h.q === 'gold') goldN++;
    else if (h.q === 'prismatic') prismN++;
  }
  return d + goldN * 2 + prismN * 5;
}
function advDifficultyMul(r) {
  return Math.max(0.35, 1 + (advDifficulty(r) - 10) * 0.04);
}

/* ---------------- 战绩 / 存档 ---------------- */
function advSave() {
  if (!adventure.run) return;
  try { localStorage.setItem(ADV_SAVE_KEY, JSON.stringify(adventure.run)); } catch (e) {}
  adventureHomeSync();
}
function advClearSave() {
  try {
    localStorage.removeItem(ADV_SAVE_KEY);
    localStorage.removeItem(ADV_SAVE_KEY_V2);
  } catch (e) {}
  adventureHomeSync();
}
function advEnsureRunShape(r) {
  if (!r) return null;
  if (r.version !== 3) return null;
  if (!r.pool || typeof r.pool !== 'object') {
    r.pool = {};
    for (var i = 0; i < POOL.length; i++) r.pool[POOL[i].key] = ADV_CONFIG.poolCopies;
  }
  if (!Array.isArray(r.cards)) r.cards = [];
  if (!Array.isArray(r.board)) r.board = [null, null, null];
  if (!Array.isArray(r.bench)) r.bench = [null, null, null, null, null, null];
  if (!Array.isArray(r.inventory)) r.inventory = [];
  if (!Array.isArray(r.hexes)) r.hexes = [];
  if (!r.hexUsed || typeof r.hexUsed !== 'object') r.hexUsed = {};
  if (!r.extraHexUsed || typeof r.extraHexUsed !== 'object') r.extraHexUsed = {};
  if (!Array.isArray(r.shop)) r.shop = [null, null, null];
  if (!r.global || typeof r.global !== 'object') r.global = { hp: 0, atk: 0 };
  if (!r.uidSeq) r.uidSeq = 1;
  if (typeof r.difficulty !== 'number') r.difficulty = advDifficulty(r);
  var byUid = {};
  for (var c = 0; c < r.cards.length; c++) {
    if (!Array.isArray(r.cards[c].items)) r.cards[c].items = [];
    if (!r.cards[c].star) r.cards[c].star = 1;
    byUid[r.cards[c].uid] = r.cards[c];
  }
  for (var b = 0; b < r.board.length; b++) if (r.board[b] && !byUid[r.board[b]]) r.board[b] = null;
  for (var bc = 0; bc < r.bench.length; bc++) if (r.bench[bc] && !byUid[r.bench[bc]]) r.bench[bc] = null;
  /* 旧存档上限 60 → 新默认 80：补足上限差，保留已损失的生命。 */
  if (typeof r.maxHp !== 'number' || r.maxHp <= 0) r.maxHp = ADV_CONFIG.startHp;
  if (typeof r.hp !== 'number') r.hp = r.maxHp;
  if (r.maxHp < ADV_CONFIG.startHp) {
    var addHp = ADV_CONFIG.startHp - r.maxHp;
    r.maxHp = ADV_CONFIG.startHp;
    r.hp = Math.min(r.maxHp, r.hp + addHp);
  }
  return r;
}
function advLoad() {
  try {
    var raw = localStorage.getItem(ADV_SAVE_KEY);
    if (!raw) return null;
    var r = JSON.parse(raw);
    var ok = advEnsureRunShape(r);
    if (!ok) {
      try { localStorage.removeItem(ADV_SAVE_KEY); } catch (e2) {}
      return null;
    }
    return ok;
  } catch (e) {}
  return null;
}
function adventureHomeLabel(saved) {
  if (!saved) saved = advLoad();
  if (!saved) return '开始试炼';
  if (saved.step === 'complete') return '查看通关战报';
  if (saved.step === 'defeat') return '查看战报';
  return '继续 ' + saved.trial + '-' + saved.node;
}
function adventureHomeSync() {
  var saved = advLoad();
  var label = adventureHomeLabel(saved);
  var b = document.getElementById('homeAdventure');
  if (b) {
    var em = b.querySelector('em');
    if (em) em.innerHTML = label + ' <i>→</i>';
  }
  var mb = document.querySelector('#mobi [data-act="adventure"]');
  if (mb) mb.textContent = '秘境 · ' + label;
}

/* ---------------- 主菜单状态隔离 ---------------- */
function advSnapshotMatch() {
  return {
    teamSize: teamSize,
    modeKind: modeKind,
    roundDuration: roundDuration,
    seriesBest: seriesBest,
    draftMode: draftMode,
    bossMode: bossMode,
    bossRoleKey: bossRoleKey,
    pick: { A: (pick.A || []).slice(), B: (pick.B || []).slice() }
  };
}
function advRestoreMatch() {
  var s = adventure.snapshot;
  if (!s) return;
  teamSize = s.teamSize || 1;
  modeKind = s.modeKind || 'vs';
  roundDuration = s.roundDuration || 180;
  seriesBest = s.seriesBest || 1;
  draftMode = !!s.draftMode;
  bossMode = !!s.bossMode;
  bossRoleKey = s.bossRoleKey || bossRoleKey;
  pick.A = (s.pick.A || []).slice();
  pick.B = (s.pick.B || []).slice();
  adventure.snapshot = null;
  if (typeof resetArena === 'function') resetArena();
}

/* ---------------- 开局 ---------------- */
function advOfferEnvironments() {
  return advShuffle(ADV_ENVS).slice(0, 3);
}

function advNewRun(envId) {
  var env = advEnv(envId);
  var r = {
    version: 3,
    env: env.id,
    trial: 1,
    node: 1,
    cleared: 0,
    gold: ADV_CONFIG.startGold + (env.id === 'rich' ? 15 : 0),
    hp: ADV_CONFIG.startHp,
    maxHp: ADV_CONFIG.startHp,
    streak: 0,
    bestStreak: 0,
    wins: 0,
    losses: 0,
    cards: [],
    board: [null, null, null],
    bench: [null, null, null, null, null, null],
    shop: [null, null, null],
    inventory: [],
    hexes: [],
    hexUsed: {},
    global: { hp: 0, atk: 0 },
    pool: {},
    uidSeq: 1,
    difficulty: 10,
    step: 'hub',
    notice: '',
    result: null,
    pending: null,
    battle: null,
    challengeStar: 0,
    extraHexUsed: {},
    midasNode: '',
    lastShopKey: '',
    totalGold: 0,
    created: Date.now()
  };
  for (var i = 0; i < POOL.length; i++) r.pool[POOL[i].key] = ADV_CONFIG.poolCopies;
  adventure.run = r;
  adventure.inBattle = false;
  adventure.notice = '';
  adventure.selectedCard = null;
  adventure.selectedItems = [];

  /* 初始赠送 1 张 1 星卡，保证第一关不是空场。 */
  var starter = POOL[Math.floor(advRand() * POOL.length)].key;
  var starterUid = advAddCard(starter, 1, true, true);
  if (starterUid) advPlaceOnBoard(starterUid);
  if (env.id === 'smith') {
    for (var s = 0; s < 2; s++) advGrantItem(advPick(ADV_BASIC_IDS));
  }
  advEnterHub(true);
  advSave();
  return r;
}

/* ---------------- 卡牌 ---------------- */
function advNotice(msg) { adventure.notice = msg || ''; }
function advCard(uid) {
  var r = adventure.run;
  if (!r || !uid) return null;
  for (var i = 0; i < r.cards.length; i++) if (r.cards[i].uid === uid) return r.cards[i];
  return null;
}
function advCardZone(uid) {
  var r = adventure.run;
  if (!r) return '';
  if (r.board.indexOf(uid) >= 0) return 'board';
  if (r.bench.indexOf(uid) >= 0) return 'bench';
  return '';
}
function advTotalCards() { return adventure.run ? adventure.run.cards.length : 0; }
function advCountCopies(key, star) {
  var r = adventure.run, n = 0;
  if (!r) return 0;
  for (var i = 0; i < r.cards.length; i++) {
    if (r.cards[i].key === key && r.cards[i].star === star) n++;
  }
  return n;
}
function advFirstEmpty(arr) {
  for (var i = 0; i < arr.length; i++) if (!arr[i]) return i;
  return -1;
}
function advBoardHasKey(key, skipUid) {
  var r = adventure.run;
  if (!r) return false;
  for (var i = 0; i < r.board.length; i++) {
    if (!r.board[i] || r.board[i] === skipUid) continue;
    var c = advCard(r.board[i]);
    if (c && c.key === key) return true;
  }
  return false;
}
function advSellPrice(card) {
  if (!card) return 0;
  if (card.star >= 3) return 30;
  if (card.star === 2) return 10;
  return 3;
}
function advCardSlot(uid) {
  var r = adventure.run;
  if (!r || !uid) return null;
  for (var i = 0; i < r.board.length; i++) if (r.board[i] === uid) return { zone: 'board', ix: i };
  for (var j = 0; j < r.bench.length; j++) if (r.bench[j] === uid) return { zone: 'bench', ix: j };
  return null;
}
/* 拖拽换位：支持主站席 ↔ 备战席、同区换位、拖到空位。
   主站席仍禁止重复角色；换位时装备跟着卡牌走。 */
function advMoveCardTo(uid, zone, ix) {
  var r = adventure.run, card = advCard(uid), from = advCardSlot(uid);
  if (!r || !card || !from) return;
  var toArr = zone === 'board' ? r.board : r.bench;
  if (!toArr || ix < 0 || ix >= toArr.length) return;
  if (from.zone === zone && from.ix === ix) return;
  var targetUid = toArr[ix] || 0;
  if (targetUid === uid) return;
  if (zone === 'board' && from.zone !== 'board') {
    var skip = targetUid || uid;
    if (advBoardHasKey(card.key, skip)) {
      advNotice('战斗席不允许重复角色。');
      adventureRender();
      return;
    }
  }
  var fromArr = from.zone === 'board' ? r.board : r.bench;
  fromArr[from.ix] = targetUid || null;
  toArr[ix] = uid;
  adventure.selectedCard = uid;
  adventure.selectedItems = [];
  advNotice('已移动到' + (zone === 'board' ? '主站席' : '备战席') + '。');
  advSave();
  adventureRender();
}
function advAddCard(key, star, silent, consumePool) {
  var r = adventure.run;
  if (!r || !advRole(key)) return null;
  var need = (star === 2) ? 3 : 1;
  if (consumePool && !advPoolTake(key, need)) return null;
  var total = advTotalCards();
  var overflow = false;
  if (total >= ADV_CONFIG.boardSlots + ADV_CONFIG.benchSlots) {
    /* 买满 9 张时仍允许买下第 3 张同名卡：它会在合成时被消耗掉。 */
    if (advCountCopies(key, star || 1) >= 2) overflow = true;
    else {
      if (consumePool) advPoolReturn(key, need);
      return null;
    }
  }
  var card = { uid: r.uidSeq++, key: key, star: star || 1, items: [] };
  r.cards.push(card);
  var slot = advFirstEmpty(r.bench);
  if (slot >= 0) {
    r.bench[slot] = card.uid;
  } else {
    var b = advFirstEmpty(r.board);
    if (b >= 0 && !advBoardHasKey(key)) {
      r.board[b] = card.uid;
    } else if (!overflow) {
      r.cards.pop();
      if (consumePool) advPoolReturn(key, need);
      return null;
    }
  }
  advCheckCombine();
  if (!silent) advNotice('获得 ' + (advRole(key) ? advRole(key).name : key) + ' · ' + (card.star) + ' 星');
  return card.uid;
}
function advRemoveCard(uid) {
  var r = adventure.run;
  if (!r) return;
  var out = [];
  for (var i = 0; i < r.cards.length; i++) if (r.cards[i].uid !== uid) out.push(r.cards[i]);
  r.cards = out;
  var j;
  for (j = 0; j < r.board.length; j++) if (r.board[j] === uid) r.board[j] = null;
  for (j = 0; j < r.bench.length; j++) if (r.bench[j] === uid) r.bench[j] = null;
  if (adventure.selectedCard === uid) adventure.selectedCard = null;
}
function advMergeItems(target, from) {
  var r = adventure.run;
  if (!r || !target || !from) return;
  for (var i = 0; i < from.items.length; i++) {
    if (target.items.length < ADV_CONFIG.maxItems) target.items.push(from.items[i]);
    else r.inventory.push(from.items[i]);
  }
  from.items = [];
}
/* 自动合成：3 张同名同星 → 高 1 星；优先升级已在战斗席上的那张。 */
function advCheckCombine() {
  var r = adventure.run;
  if (!r) return;
  var guard = 0;
  while (guard++ < 30) {
    var list = null, key = '', star = 0;
    for (var i = 0; i < POOL.length && !list; i++) {
      key = POOL[i].key;
      for (var s = 1; s <= 2; s++) {
        var found = [];
        for (var c = 0; c < r.cards.length; c++) {
          if (r.cards[c].key === key && r.cards[c].star === s) found.push(r.cards[c]);
        }
        if (found.length >= 3) { list = found; star = s; break; }
      }
    }
    if (!list) break;
    var target = null;
    for (var t = 0; t < list.length; t++) {
      if (advCardZone(list[t].uid) === 'board') { target = list[t]; break; }
    }
    if (!target) {
      for (var t2 = 0; t2 < list.length; t2++) {
        if (advCardZone(list[t2].uid)) { target = list[t2]; break; }
      }
    }
    if (!target) target = list[0];
    var consumed = 0;
    for (var k = 0; k < list.length && consumed < 2; k++) {
      if (list[k].uid === target.uid) continue;
      advMergeItems(target, list[k]);
      advRemoveCard(list[k].uid);
      consumed++;
    }
    target.star++;
    if (target.star > 3) target.star = 3;
    /* 升级卡在备战席、而战斗席已有同名「更低星」卡时，才把高星卡换上场。
       同星时保持主站席原卡不动，避免带着装备的卡被换到备战席。
       低星换位前先把装备转到高星卡，装备继续留在主站席。 */
    if (advCardZone(target.uid) === 'bench' && advBoardHasKey(target.key, target.uid)) {
      for (var b = 0; b < r.board.length; b++) {
        var bc = advCard(r.board[b]);
        if (bc && bc.key === target.key && bc.star < target.star) {
          advMergeItems(target, bc);
          var bs = r.bench.indexOf(target.uid);
          if (bs >= 0) {
            r.bench[bs] = r.board[b];
            r.board[b] = target.uid;
          }
          break;
        }
      }
    }
    advNotice('合成成功：' + (advRole(target.key) ? advRole(target.key).name : target.key) + ' 升到 ' + target.star + ' 星');
  }
}
function advPlaceOnBoard(uid) {
  var r = adventure.run, card = advCard(uid);
  if (!r || !card) return;
  if (advCardZone(uid) === 'board') return;
  if (advBoardHasKey(card.key, uid)) { advNotice('战斗席不允许重复角色。'); return; }
  var slot = advFirstEmpty(r.board);
  if (slot < 0) { advNotice('战斗席已满，先下阵一个角色。'); return; }
  for (var i = 0; i < r.bench.length; i++) if (r.bench[i] === uid) r.bench[i] = null;
  r.board[slot] = uid;
  advNotice('');
  advSave();
}
function advMoveToBench(uid) {
  var r = adventure.run, card = advCard(uid);
  if (!r || !card) return;
  if (advCardZone(uid) !== 'board') return;
  var slot = advFirstEmpty(r.bench);
  if (slot < 0) { advNotice('备战席已满。'); return; }
  for (var i = 0; i < r.board.length; i++) if (r.board[i] === uid) r.board[i] = null;
  r.bench[slot] = uid;
  advNotice('');
  advSave();
}
function advSellCard(uid) {
  var r = adventure.run, card = advCard(uid);
  if (!r || !card) return;
  var price = advSellPrice(card);
  var copies = card.star >= 3 ? 9 : (card.star === 2 ? 3 : 1);
  r.gold += price;
  for (var i = 0; i < card.items.length; i++) r.inventory.push(card.items[i]);
  r.pool[card.key] = Math.min(ADV_CONFIG.poolCopies, (r.pool[card.key] || 0) + copies);
  advRemoveCard(uid);
  advNotice('出售 ' + (advRole(card.key) ? advRole(card.key).name : card.key) + ' · +' + price + ' 金币');
  advSave();
}
function advPoolLeft(r) {
  var n = 0;
  if (!r) return 0;
  for (var k in r.pool) if (Object.prototype.hasOwnProperty.call(r.pool, k)) n += r.pool[k];
  return n;
}

/* ---------------- 角色面板聚合 ---------------- */
function advApplyMods(s, m) {
  if (!m) return;
  if (m.hp) s.hp += m.hp;
  if (m.atk) s.atk += m.atk;
  if (m.def) s.def += m.def;
  if (m.speed) s.speed += m.speed;
  if (m.dmg) s.dmg += m.dmg;
  if (m.dot) s.dot += m.dot;
  if (m.leech) s.leech += m.leech;
  if (m.regen) s.regen += m.regen;
  if (m.thorns) s.thorns += m.thorns;
  if (m.shieldStart) s.shieldStart += m.shieldStart;
  if (m.shieldDmg) s.shieldDmg += m.shieldDmg;
  if (m.taken) s.taken += m.taken;
  if (m.cdRate) s.cdRate *= m.cdRate;
  if (m.shieldStack) s.shieldStack = true;
  if (m.slowOnHit) s.slowOnHit += m.slowOnHit;
  if (m.ramp && !s.ramp) s.ramp = m.ramp;
}
function advHexMods(r) {
  var m = {
    dmg: 0, speed: 0, hp: 0, atk: 0, shieldStart: 0,
    drop: 0, advDrop: 0, interestMul: 1, interestCap: 0,
    streakBonus: 0, goldMul: 1, rewardOptions: 0,
    shop2Star: 0, perHexGold: 0, midas: false
  };
  if (!r) return m;
  for (var i = 0; i < r.hexes.length; i++) {
    var id = r.hexes[i];
    if (id === 'whet') m.dmg += 0.06;
    else if (id === 'feather') m.speed += 0.08;
    else if (id === 'barrier') m.shieldStart += 0.10;
    else if (id === 'master') { m.drop += 0.40; m.advDrop += 0.25; }
    else if (id === 'double') { m.rewardOptions += 1; m.goldMul *= 1.50; }
    else if (id === 'merchant') m.shop2Star += 0.30;
    else if (id === 'usury') m.interestMul *= 1.50;
    else if (id === 'ledger') m.interestCap += 2;
    else if (id === 'streak') m.streakBonus += 2;
    else if (id === 'titan') { m.hp += 0.25; m.dmg += 0.15; }
    else if (id === 'midas') m.midas = true;
    else if (id === 'resonance') m.perHexGold += 1;
  }
  var env = advEnv(r.env);
  if (env.id === 'trial') m.goldMul *= 1.30;
  if (env.id === 'smith') m.drop += 0.20;
  return m;
}
function advCardStats(card) {
  var r = adventure.run;
  var s = {
    hp: 1, atk: 1, def: 1, speed: 1, dmg: 1, dot: 1,
    leech: 0, regen: 0, thorns: 0, shieldStart: 0, shieldDmg: 0,
    taken: 1, cdRate: 1, ramp: null, shieldStack: false, slowOnHit: 0
  };
  if (!r || !card) return s;
  var st = ADV_STARS[card.star] || ADV_STARS[1];
  s.hp *= st.hp; s.atk *= st.atk; s.def *= st.def; s.speed *= st.speed;
  for (var i = 0; i < card.items.length; i++) {
    var d = advItem(card.items[i]);
    if (d) advApplyMods(s, d.mods);
  }
  s.hp += r.global.hp || 0;
  s.atk += r.global.atk || 0;
  var hm = advHexMods(r);
  s.hp += hm.hp; s.atk += hm.atk; s.dmg += hm.dmg; s.speed += hm.speed;
  s.shieldStart += hm.shieldStart;
  if (s.taken < 0.35) s.taken = 0.35;
  return s;
}

/* ---------------- 装备 ---------------- */
function advGrantItem(id, silent) {
  var r = adventure.run, d = advItem(id);
  if (!r || !d) return false;
  r.inventory.push(id);
  if (!silent) advNotice('获得装备：' + d.name);
  return true;
}
function advRandomBasic() { return advPick(ADV_BASIC_IDS); }
function advRandomAdvanced() {
  var pool = [];
  for (var i = 0; i < ADV_ITEMS.length; i++) if (!ADV_ITEMS[i].basic) pool.push(ADV_ITEMS[i].id);
  return advPick(pool);
}
function advMaybeDrop(win, node) {
  var r = adventure.run;
  if (!r) return null;
  var hm = advHexMods(r);
  var chance = (win ? ADV_CONFIG.winDrop : ADV_CONFIG.lossDrop) + hm.drop;
  if (win && node && node.type === 'gift') chance = 1;
  if (win && node && node.type === 'boss') chance = 1;
  if (advRand() >= chance) return null;
  var advanced = false;
  if (win && node && node.type === 'boss') advanced = true;
  else if (hm.advDrop > 0 && advRand() < hm.advDrop) advanced = true;
  var id = advanced ? advRandomAdvanced() : advRandomBasic();
  advGrantItem(id, true);
  return id;
}
function advSelectedItemIndices() {
  var out = [];
  for (var i = 0; i < adventure.selectedItems.length; i++) {
    var ix = adventure.selectedItems[i];
    if (ix >= 0 && ix < adventure.run.inventory.length) out.push(ix);
  }
  out.sort(function (a, b) { return a - b; });
  return out;
}
function advToggleItem(ix) {
  var r = adventure.run;
  if (!r || ix < 0 || ix >= r.inventory.length) return;
  if (adventure.itemFocusIx === ix) {
    adventure.itemFocusIx = -1;
    adventure.itemFocusId = '';
    adventure.selectedItems = [];
  } else {
    adventure.itemFocusIx = ix;
    adventure.itemFocusId = r.inventory[ix];
    adventure.selectedItems = [ix];
    adventure.selectedCard = null;   // 弹窗互斥：打开装备详情时关掉角色详情
  }
  adventureRender();
}
function advItemRecipe(id) {
  for (var i = 0; i < ADV_RECIPES.length; i++) if (ADV_RECIPES[i].out === id) return ADV_RECIPES[i];
  return null;
}
function advInvCount(id) {
  var r = adventure.run, n = 0;
  if (!r) return 0;
  for (var i = 0; i < r.inventory.length; i++) if (r.inventory[i] === id) n++;
  return n;
}
/* 「可合成列表」只列出当前背包材料足够的配方。 */
function advCraftableRecipes() {
  var out = [];
  for (var i = 0; i < ADV_RECIPES.length; i++) {
    var rec = ADV_RECIPES[i];
    if (rec.a === rec.b) {
      if (advInvCount(rec.a) >= 2) out.push(rec);
    } else if (advInvCount(rec.a) >= 1 && advInvCount(rec.b) >= 1) {
      out.push(rec);
    }
  }
  return out;
}
function advFindInv(ix, id) {
  var r = adventure.run;
  if (!r) return -1;
  for (var i = 0; i < r.inventory.length; i++) if (i !== ix && r.inventory[i] === id) return i;
  return -1;
}
function advCraftRecipe(rid) {
  var r = adventure.run, rec = ADV_RECIPE_BY_ID[rid];
  if (!r || !rec) return;
  var ia = advFindInv(-1, rec.a);
  var ib = rec.a === rec.b ? advFindInv(ia, rec.a) : advFindInv(-1, rec.b);
  if (ia < 0 || ib < 0) { advNotice('合成材料不足。'); adventureRender(); return; }
  var a = r.inventory[ia], b = r.inventory[ib];
  r.inventory.splice(Math.max(ia, ib), 1);
  r.inventory.splice(Math.min(ia, ib), 1);
  r.inventory.push(rec.out);
  adventure.selectedItems = [];
  adventure.itemFocusId = rec.out;
  adventure.itemFocusIx = r.inventory.length - 1;
  advNotice('合成成功：' + advItemName(rec.out) + '（' + advItemName(a) + ' + ' + advItemName(b) + '）');
  advSave();
  adventureRender();
}
function advEquipItemTo(uid, ix) {
  var r = adventure.run, card = advCard(uid);
  if (!r || !card || ix < 0 || ix >= r.inventory.length) return;
  if (card.items.length >= ADV_CONFIG.maxItems) {
    advNotice('这张卡最多装备 3 件。');
    adventureRender();
    return;
  }
  var id = r.inventory[ix];
  r.inventory.splice(ix, 1);
  card.items.push(id);
  adventure.selectedItems = [];
  adventure.itemFocusId = id;
  adventure.itemFocusIx = -1;
  advNotice('已装备 ' + advItemName(id) + ' → ' + (advRole(card.key) ? advRole(card.key).short : card.key));
  advSave();
  adventureRender();
}
function advEquipSelected(uid) {
  var card = advCard(uid);
  if (!adventure.run || !card) return;
  var sel = advSelectedItemIndices();
  if (sel.length !== 1) { advNotice('先在背包里选中 1 件装备。'); adventureRender(); return; }
  advEquipItemTo(uid, sel[0]);
}
function advUnequipItem(uid, ix) {
  var r = adventure.run, card = advCard(uid);
  if (!r || !card || ix < 0 || ix >= card.items.length) return;
  var id = card.items.splice(ix, 1)[0];
  r.inventory.push(id);
  adventure.selectedItems = [];
  adventure.itemFocusId = id;
  adventure.itemFocusIx = r.inventory.length - 1;
  advNotice('卸下 ' + advItemName(id));
  advSave();
  adventureRender();
}
function advCraftSelected() {
  var r = adventure.run;
  if (!r) return;
  var sel = advSelectedItemIndices();
  if (sel.length !== 2) { advNotice('选中 2 件基础装备才能合成。'); adventureRender(); return; }
  var a = r.inventory[sel[0]], b = r.inventory[sel[1]];
  var da = advItem(a), db = advItem(b);
  if (!da || !db || !da.basic || !db.basic) { advNotice('只有基础装备可以合成。'); adventureRender(); return; }
  var out = null;
  for (var i = 0; i < ADV_RECIPES.length; i++) {
    var rec = ADV_RECIPES[i];
    if ((rec.a === a && rec.b === b) || (rec.a === b && rec.b === a)) { out = rec.out; break; }
  }
  if (!out) { advNotice('这两件装备没有对应配方。'); adventureRender(); return; }
  r.inventory.splice(sel[1], 1);
  r.inventory.splice(sel[0], 1);
  r.inventory.push(out);
  adventure.selectedItems = [];
  advNotice('合成成功：' + advItemName(out));
  advSave();
  adventureRender();
}

/* ---------------- 商店 ---------------- */
function advPoolTake(key, n) {
  var r = adventure.run;
  if (!r || (r.pool[key] || 0) < n) return false;
  r.pool[key] -= n;
  return true;
}
function advPoolReturn(key, n) {
  var r = adventure.run;
  if (!r) return;
  r.pool[key] = Math.min(ADV_CONFIG.poolCopies, (r.pool[key] || 0) + n);
}
function advShopEntryCost(entry) {
  if (!entry) return 0;
  return ADV_CONFIG.cardCost * (entry.star === 2 ? 3 : 1);
}
function advRollShopEntry(twoStarChance) {
  var r = adventure.run;
  if (!r) return null;
  var keys = [];
  for (var i = 0; i < POOL.length; i++) if ((r.pool[POOL[i].key] || 0) > 0) keys.push(POOL[i].key);
  if (!keys.length) return null;
  var key = advPick(keys);
  var star = 1;
  if (twoStarChance > 0 && (r.pool[key] || 0) >= 3 && advRand() < twoStarChance) star = 2;
  if (!advPoolTake(key, star === 2 ? 3 : 1)) {
    if (!advPoolTake(key, 1)) return null;
    star = 1;
  }
  return { key: key, star: star };
}
function advRefreshShop(free) {
  var r = adventure.run;
  if (!r) return false;
  if (!free && r.gold < ADV_CONFIG.refreshCost) { advNotice('刷新需要 ' + ADV_CONFIG.refreshCost + ' 金币。'); return false; }
  if (!free) r.gold -= ADV_CONFIG.refreshCost;
  for (var i = 0; i < r.shop.length; i++) {
    var e = r.shop[i];
    if (e) advPoolReturn(e.key, e.star === 2 ? 3 : 1);
  }
  var hm = advHexMods(r);
  r.shop = [advRollShopEntry(hm.shop2Star), advRollShopEntry(hm.shop2Star), advRollShopEntry(hm.shop2Star)];
  r.shopNode = advNodeTag(r.trial, r.node);
  if (!free) advNotice('商店已刷新。');
  advSave();
  return true;
}
function advEnsureShop() {
  var r = adventure.run;
  if (!r) return;
  var key = advNodeTag(r.trial, r.node);
  if (r.shopNode !== key) advRefreshShop(true);
}
function advBuyShop(ix) {
  var r = adventure.run;
  if (!r || r.step !== 'hub') return;
  var e = r.shop[ix];
  if (!e) return;
  var cost = advShopEntryCost(e);
  if (r.gold < cost) { advNotice('金币不足：需要 ' + cost + '。'); adventureRender(); return; }
  var uid = advAddCard(e.key, e.star, true);
  if (!uid) {
    advPoolReturn(e.key, e.star === 2 ? 3 : 1);
    advNotice('席位已满，先出售或上阵一张卡。');
    adventureRender();
    return;
  }
  r.gold -= cost;
  r.totalGold += cost;
  r.shop[ix] = null;
  var combo = adventure.notice && adventure.notice.indexOf('合成成功') === 0 ? adventure.notice : '';
  advNotice((combo ? combo + ' · ' : '') + '买入 ' + (advRole(e.key) ? advRole(e.key).name : e.key) + ' · ' + e.star + ' 星');
  advSave();
  adventureRender();
}
function advRerollShop() { if (advRefreshShop(false)) adventureRender(); }
function advShopOpen() {
  var r = adventure.run;
  if (!r || r.step !== 'hub' || adventure.shopOpen) return;
  adventure.shopOpen = true;
  var d = document.querySelector('#adventure .adv-shop-drawer');
  if (!d) { adventureRender(); return; }
  d.classList.remove('instant');
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
}
function advShopClose() {
  if (!adventure.shopOpen) return;
  adventure.shopOpen = false;
  var d = document.querySelector('#adventure .adv-shop-drawer');
  if (!d) return;
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
}

/* ---------------- 节点 / 海克斯 / 奖励 ---------------- */
function advEnterHub(isNew) {
  var r = adventure.run;
  if (!r) return;
  r.step = 'hub';
  r.result = null;
  r.pending = null;
  r.difficulty = advDifficulty(r);
  var key = advNodeTag(r.trial, r.node);
  if (isNew) {
    var hm = advHexMods(r);
    if (r.midasNode !== key) {
      if (hm.midas) {
        r.gold += 8;
        advGrantItem(advRandomBasic(), true);
      }
      if (hm.perHexGold > 0) r.gold += hm.perHexGold * r.hexes.length;
      r.midasNode = key;
    }
    r.battle = null;
    r.challengeStar = 0;
    advRefreshShop(true);
  } else {
    advEnsureShop();
  }
  advSave();
}
function advAdvanceNode() {
  var r = adventure.run;
  if (!r) return;
  r.cleared = Math.min(ADV_CONFIG.maxTrial * ADV_CONFIG.nodesPerTrial, (r.trial - 1) * ADV_CONFIG.nodesPerTrial + r.node);
  r.battle = null;
  r.challengeStar = 0;
  r.result = null;
  r.pending = null;
  if (r.node < ADV_CONFIG.nodesPerTrial) {
    r.node++;
  } else if (r.trial < ADV_CONFIG.maxTrial) {
    r.trial++;
    r.node = 1;
    r.gold += 15;
    r.streak = 0;
    advNotice('进入第二试炼：+15 金币。');
  } else {
    r.step = 'complete';
    r.cleared = ADV_CONFIG.maxTrial * ADV_CONFIG.nodesPerTrial;
    advSave();
    return;
  }
  advEnterHub(true);
}

function advRollHexQuality(r) {
  if (!r) return 'silver';
  if (advEnv(r.env).id === 'rainbow') return 'prismatic';
  var roll = advRand();
  if (r.trial >= 2) {
    if (roll < 0.32) return 'silver';
    if (roll < 0.78) return 'gold';
    return 'prismatic';
  }
  if (roll < 0.60) return 'silver';
  if (roll < 0.92) return 'gold';
  return 'prismatic';
}
function advHexOffers(r) {
  if (!r) return [];
  var offers = [];
  for (var i = 0; i < 3; i++) {
    var q = advRollHexQuality(r);
    var pool = [];
    for (var h = 0; h < ADV_HEXES.length; h++) {
      if (ADV_HEXES[h].q !== q) continue;
      if (r.hexes.indexOf(ADV_HEXES[h].id) >= 0) continue;
      if (offers.indexOf(ADV_HEXES[h].id) >= 0) continue;
      pool.push(ADV_HEXES[h].id);
    }
    if (!pool.length) {
      for (var h2 = 0; h2 < ADV_HEXES.length; h2++) {
        if (r.hexes.indexOf(ADV_HEXES[h2].id) >= 0) continue;
        if (offers.indexOf(ADV_HEXES[h2].id) >= 0) continue;
        pool.push(ADV_HEXES[h2].id);
      }
    }
    if (pool.length) offers.push(advPick(pool));
  }
  return offers;
}
function advOpenHex() {
  var r = adventure.run;
  if (!r) return;
  r.pending = { kind: 'hex', offers: advHexOffers(r) };
  r.step = 'hex';
  advSave();
  adventureRender();
}
function advChooseHex(id) {
  var r = adventure.run;
  if (!r || r.step !== 'hex' || !r.pending || r.pending.offers.indexOf(id) < 0) return;
  var h = advHex(id);
  if (!h) return;
  r.hexes.push(id);
  r.pending = null;
  r.difficulty = advDifficulty(r);
  var immediateItemChoice = false;
  if (id === 'pocket') r.gold += 12;
  else if (id === 'ledger') r.gold += 4;
  else if (id === 'medic') r.hp = Math.min(r.maxHp, r.hp + 8);
  else if (id === 'forge') immediateItemChoice = true;
  advNotice('获得海克斯：' + h.name);
  if (immediateItemChoice) {
    advOpenItemChoice('铁匠铺 · 选择 1 件基础装备', 3, 'hex');
  } else {
    advAfterHex();
  }
}
function advAfterHex() {
  var r = adventure.run;
  if (!r) return;
  r.step = 'hub';
  advAdvanceNode();
}
function advOpenItemChoice(title, n, then) {
  var r = adventure.run;
  if (!r) return;
  var pool = advShuffle(ADV_BASIC_IDS).slice(0, n || 3);
  r.pending = { kind: 'item', title: title || '选择装备', options: pool, then: then || 'hub' };
  r.step = 'item';
  advSave();
  adventureRender();
}
function advChooseItem(id) {
  var r = adventure.run;
  if (!r || r.step !== 'item' || !r.pending || r.pending.options.indexOf(id) < 0) return;
  var then = r.pending.then || 'hub';
  advGrantItem(id, true);
  r.pending = null;
  if (then === 'reward') { advAfterReward(); return; }
  if (then === 'hex') { advAfterHex(); return; }
  r.step = 'hub';
  advEnsureShop();
  advSave();
  adventureRender();
}
function advRewardOptions(node, star) {
  var out = [];
  function add(type, value, name, desc, icon) {
    out.push({ type: type, value: value, name: name, desc: desc, icon: icon });
  }
  if (node && node.type === 'boss') {
    add('gold', 30, '金币 30', '立即获得 30 金币。', '●');
    add('advanced', 0, '进阶装备', '随机获得 1 件进阶装备。', '❖');
    add('global', 0.05, '全局强化', '所有角色生命与攻击永久 +5%。', '▲');
  } else if (node && node.type === 'challenge') {
    if (star <= 1) {
      add('gold', 12, '金币 12', '稳扎稳打。', '●');
      add('gold', 16, '金币 16', '多一点积蓄。', '●');
      add('gold', 20, '金币 20', '高风险挑战的保底。', '●');
    } else if (star === 2) {
      add('gold', 16, '金币 16', '立即获得 16 金币。', '●');
      add('basic', 0, '基础装备', '随机获得 1 件基础装备。', '⚒');
      add('gold', 22, '金币 22', '放弃装备换现金。', '●');
    } else if (star === 3) {
      add('gold', 20, '金币 20', '立即获得 20 金币。', '●');
      add('basic', 0, '基础装备', '随机获得 1 件基础装备。', '⚒');
      add('card', 1, '随机 1 星卡', '获得 1 张随机 1 星角色卡。', '✦');
    } else if (star === 4) {
      add('gold', 24, '金币 24', '立即获得 24 金币。', '●');
      add('basic', 0, '基础装备', '随机获得 1 件基础装备。', '⚒');
      add('advanced', 0, '进阶装备', '随机获得 1 件进阶装备。', '❖');
    } else {
      add('gold', 32, '金币 32', '立即获得 32 金币。', '●');
      add('basics2', 0, '基础装备 ×2', '随机获得 2 件基础装备。', '⚒');
      add('advanced', 0, '进阶装备', '随机获得 1 件进阶装备。', '❖');
      add('global', 0.05, '全局强化', '所有角色生命与攻击永久 +5%。', '▲');
    }
  } else {
    add('gold', 10, '金币 10', '立即获得 10 金币。', '●');
    add('basic', 0, '基础装备', '随机获得 1 件基础装备。', '⚒');
    add('card', 1, '随机 1 星卡', '获得 1 张随机 1 星角色卡。', '✦');
  }
  var hm = advHexMods(adventure.run);
  var extra = hm.rewardOptions || 0;
  while (extra-- > 0) {
    add('gold', 8, '额外金币 8', '双倍战利品追加。', '●');
  }
  return out;
}
function advOpenReward(node, star) {
  var r = adventure.run;
  if (!r) return;
  var title = node && node.type === 'boss' ? 'BOSS 战利品'
    : (node && node.type === 'challenge' ? star + ' 星遭遇奖励' : '奖励关三选一');
  r.pending = {
    kind: 'reward',
    title: title,
    sub: node && node.type === 'challenge' ? '难度 ' + star + ' 星 · 选择 1 项' : '选择 1 项',
    options: advRewardOptions(node, star || 1)
  };
  r.step = 'reward';
  advSave();
  adventureRender();
}
function advApplyRewardOption(opt) {
  var r = adventure.run;
  if (!r || !opt) return '';
  adventure.notice = '';
  var hm = advHexMods(r);
  if (opt.type === 'gold') {
    var gold = Math.round(opt.value * hm.goldMul);
    r.gold += gold;
    return '获得 ' + gold + ' 金币。';
  }
  if (opt.type === 'basic') {
    advGrantItem(advRandomBasic(), true);
    return '获得基础装备：' + advItemName(r.inventory[r.inventory.length - 1]) + '。';
  }
  if (opt.type === 'advanced') {
    advGrantItem(advRandomAdvanced(), true);
    return '获得进阶装备：' + advItemName(r.inventory[r.inventory.length - 1]) + '。';
  }
  if (opt.type === 'basics2') {
    advGrantItem(advRandomBasic(), true);
    advGrantItem(advRandomBasic(), true);
    var a = r.inventory[r.inventory.length - 2], b = r.inventory[r.inventory.length - 1];
    return '获得基础装备：' + advItemName(a) + '、' + advItemName(b) + '。';
  }
  if (opt.type === 'card') {
    var key = POOL[Math.floor(advRand() * POOL.length)].key;
    if (advAddCard(key, opt.value || 1, true, true)) {
      var combo = adventure.notice && adventure.notice.indexOf('合成成功') === 0 ? adventure.notice + ' · ' : '';
      return combo + '获得角色卡：' + advRole(key).name + '。';
    }
    r.gold += 8;
    return '席位已满，转化为 8 金币。';
  }
  if (opt.type === 'global') {
    r.global.hp += opt.value;
    r.global.atk += opt.value;
    return '全局强化：生命 / 攻击 +' + Math.round(opt.value * 100) + '%。';
  }
  return '';
}
function advChooseReward(ix) {
  var r = adventure.run;
  if (!r || r.step !== 'reward' || !r.pending) return;
  var opt = r.pending.options[ix];
  if (!opt) return;
  var msg = advApplyRewardOption(opt);
  if (msg) advNotice(msg);
  r.pending = null;
  advAfterReward();
}
/* 奖励关：不再三选一，系统从奖励池随机抽 2 项直接发放。 */
function advOpenAutoReward(node) {
  var r = adventure.run;
  if (!r) return;
  var pool = advShuffle(advRewardOptions(node, 1));
  var picked = pool.slice(0, Math.min(2, pool.length));
  for (var i = 0; i < picked.length; i++) {
    picked[i].gain = advApplyRewardOption(picked[i]);
  }
  r.pending = {
    kind: 'autoReward',
    title: '奖励关 · 系统发放',
    sub: '系统随机挑选 ' + picked.length + ' 项奖励，已直接加入本局。',
    options: picked
  };
  r.step = 'rewardAuto';
  adventure.notice = '';
  advSave();
  adventureRender();
}
function advContinueAutoReward() {
  var r = adventure.run;
  if (!r || r.step !== 'rewardAuto') return;
  r.pending = null;
  advAfterReward();
}
function advAfterReward() {
  var r = adventure.run;
  if (!r) return;
  var node = advCurrentNode(r);
  var key = advNodeTag(r.trial, r.node);
  var needHex = false;
  if (node && node.hex && !r.hexUsed[key]) needHex = true;
  if (node && node.extraHex && advEnv(r.env).id === 'hexmania' && !r.extraHexUsed[key]) needHex = true;
  if (needHex) {
    if (node.hex) r.hexUsed[key] = 1;
    if (node.extraHex) r.extraHexUsed[key] = 1;
    advOpenHex();
    return;
  }
  r.step = 'hub';
  advAdvanceNode();
}

/* ---------------- 战斗 ---------------- */
function advBoardKeys() {
  var r = adventure.run, out = [];
  if (!r) return out;
  for (var i = 0; i < r.board.length; i++) {
    var c = advCard(r.board[i]);
    if (c) out.push(c.key);
  }
  return out;
}
function advBuildBattle() {
  var r = adventure.run;
  if (!r) return null;
  var node = advCurrentNode(r);
  if (!node) return null;
  var keys = advBoardKeys();
  if (!keys.length) return null;
  var b = {
    kind: node.boss ? 'boss' : 'mob',
    node: node.n, trial: r.trial,
    star: node.boss ? 0 : (node.challenge ? (r.challengeStar || 1) : (node.type === 'gift' ? 1 : (r.trial >= 2 ? 2 : 1))),
    enemyKeys: [], hp1: !!node.hp1, noSkill: !!node.noSkill,
    boss: node.boss ? node.bossKey : '',
    seed: ((Date.now() ^ Math.floor(advRand() * 0xffffffff)) >>> 0) || 1
  };
  if (!node.boss) {
    var count = Math.min(3, Math.max(node.enemies || 1, keys.length));
    var all = [];
    for (var i = 0; i < POOL.length; i++) all.push(POOL[i].key);
    b.enemyKeys = advShuffle(all).slice(0, count);
  }
  return b;
}
function advChallengeStar(side) {
  if (side === 'right') return 3 + Math.floor(advRand() * 3);
  return 1 + Math.floor(advRand() * 2);
}
function advUpdateBattleName() {
  var r = adventure.run, b = r && r.battle;
  if (!b) return;
  var node = advNode(b.trial, b.node);
  var keys = advBoardKeys();
  teamNames.A = '试炼者 · ' + keys.length + ' 人';
  teamNames.B = (node ? (b.trial + '-' + b.node + ' · ' + node.name) : '秘境敌人') +
    (b.kind === 'boss' ? '' : ' · ' + b.enemyKeys.length + ' 敌');
  if (el.nameA) el.nameA.textContent = teamNames.A;
  if (el.nameB) el.nameB.textContent = teamNames.B;
}
function advStartBattle(side) {
  var r = adventure.run;
  if (!r || r.step !== 'hub') return;
  var node = advCurrentNode(r);
  if (!node) return;
  var keys = advBoardKeys();
  if (!keys.length) { advNotice('至少上阵 1 张卡才能开始战斗。'); adventureRender(); return; }
  if (!r.battle) {
    if (node.challenge) r.challengeStar = advChallengeStar(side || 'left');
    r.battle = advBuildBattle();
  }
  var b = r.battle;
  if (!b) { advNotice('敌人阵容生成失败。'); adventureRender(); return; }

  bossMode = b.kind === 'boss';
  bossRoleKey = b.boss || 'duo';
  bossMerged = false;
  bossPhase = 1;
  modeKind = 'vs';
  teamSize = keys.length;
  seriesBest = 1;
  if (!bossMode) roundDuration = ADV_CONFIG.battleTime;
  pick.A = keys.slice();
  pick.B = bossMode ? [bossRoleKey] : b.enemyKeys.slice();

  r.step = 'battle';
  adventure.inBattle = true;
  adventure.notice = '';
  adventure.shopOpen = false;
  adventure.nodeFocus = '';
  adventureHide();
  advSave();

  hasPendingSeed = true;
  pendingSeed = b.seed || 1;
  pendingSource = 'adventure';
  startBattle();
  if (phase !== 'fight') {
    adventure.inBattle = false;
    r.step = 'hub';
    advSave();
    adventureShow();
    return;
  }
  advUpdateBattleName();
  if (typeof rebuildRoster === 'function') rebuildRoster();
}
function adventureStartFloor(side) { advStartBattle(side); }

function adventureRetryFloor() {
  var r = adventure.run;
  if (!r || r.step !== 'battle') return;
  /* 终局慢镜头已经把胜负算出来了：让 endFxFinish 走结算，不要再开一局。 */
  if (typeof phase !== 'undefined' && phase === 'over') return;
  adventure.inBattle = false;
  r.step = 'hub';
  advSave();
  adventureStartFloor();
}

function adventureInBattle() {
  return !!(adventure.run && adventure.inBattle && adventure.run.step === 'battle');
}
function adventureOnMenu() {
  var r = adventure.run;
  if (!r || !adventure.inBattle) return;
  adventure.inBattle = false;
  r.step = 'hub';
  r.result = null;
  advEnsureShop();
  advSave();
}

function advStatusLine() {
  var r = adventure.run;
  if (!r) return '秘境试炼';
  var node = advCurrentNode(r);
  return '秘境试炼 · ' + r.trial + '-' + r.node + ' · ' + (node ? node.name : '') +
    ' · 敌难 ' + advDifficulty(r);
}

function adventureCompleteBattle() {
  var r = adventure.run;
  if (!r || !adventure.inBattle || !r.battle) return false;
  var b = r.battle;
  var node = advNode(b.trial, b.node);
  var win = (typeof winner !== 'undefined' && winner === 'A');
  var hm = advHexMods(r);
  var base = 6 + node.n * 2 + (b.trial - 1) * 4;
  var winBonus = win ? 4 + node.n : 0;
  if (win) {
    r.streak++;
    if (r.streak > r.bestStreak) r.bestStreak = r.streak;
  } else {
    r.streak = 0;
  }
  var streakBonus = win ? Math.min(ADV_CONFIG.streakCap, r.streak) + hm.streakBonus : 0;
  var interest = 0;
  if (win) {
    interest = Math.min(ADV_CONFIG.interestCap + hm.interestCap, Math.floor(r.gold / ADV_CONFIG.interestStep));
    interest = Math.floor(interest * hm.interestMul);
  }
  var total = base + winBonus + streakBonus + interest;
  r.gold += total;
  r.totalGold += total;
  if (win) r.wins++; else r.losses++;

  var hpBefore = r.hp;
  var damage = 0;
  var heal = 0;
  if (!win) {
    damage = b.kind === 'boss' ? 18 : (node.type === 'challenge' ? 12 : 10);
    damage += (b.star || 0) * 2;
    if (b.kind === 'boss' && b.trial === 2) damage += 4;
    r.hp -= damage;
  } else {
    var beforeHeal = r.hp;
    r.hp = Math.min(r.maxHp, r.hp + ADV_CONFIG.winHeal);
    heal = r.hp - beforeHeal;
  }
  var drop = advMaybeDrop(win, node);
  var bossLost = b.kind === 'boss' && !win;

  r.result = {
    win: win, draw: (typeof winner !== 'undefined' && winner === 'draw'),
    trial: b.trial, node: b.node, name: node.name, star: b.star || 1,
    boss: b.kind === 'boss', bossLost: bossLost,
    rewards: { base: base, win: winBonus, streak: streakBonus, interest: interest, total: total },
    damage: damage, heal: heal, hpBefore: hpBefore, hpAfter: r.hp,
    drop: drop || '', seconds: (typeof t !== 'undefined' ? Math.round(t * 10) / 10 : 0)
  };
  r.step = (r.hp < 0) ? 'defeat' : 'result';
  adventure.inBattle = false;
  advSave();
  adventureShow();
  if (typeof sfxPlay === 'function') sfxPlay(win ? 'win' : 'lose');
  return true;
}

function advAfterResult() {
  var r = adventure.run;
  if (!r || !r.result) return;
  var res = r.result;
  if (r.step === 'defeat') return;
  if (r.hp < 0) { r.step = 'defeat'; advSave(); adventureRender(); return; }
  if (res.bossLost) {
    r.step = 'hub';
    r.result = null;
    advEnterHub(false);
    adventureRender();
    return;
  }
  var node = advNode(res.trial, res.node);
  if (res.win && node.reward) {
    r.step = 'hub';
    advOpenAutoReward(node);
    return;
  }
  if (res.win && node.type === 'boss') {
    r.step = 'hub';
    advOpenReward(node, res.star);
    return;
  }
  if (res.win && node.hex) {
    r.step = 'hub';
    r.hexUsed[advNodeTag(res.trial, res.node)] = 1;
    advOpenHex();
    return;
  }
  r.step = 'hub';
  advAdvanceNode();
  adventureRender();
}

/* ---------------- 战斗接入：面板 / 装备 / BOSS ---------------- */
function adventureOnUnitAdd(u) {
  var r = adventure.run, b = r && r.battle;
  if (!adventureInBattle() || !u || !u.st || u.st.advApplied || !b) return;
  u.st.advApplied = true;

  if (u.team === 'A') {
    var card = null;
    for (var i = 0; i < r.board.length; i++) {
      var c = advCard(r.board[i]);
      if (!c) continue;
      var role = advRole(c.key);
      if (role && role.units.indexOf(u.key) >= 0) { card = c; break; }
    }
    if (!card) return;
    var s = advCardStats(card);
    u.st.adv = s;
    u.st.advCard = card.uid;
    u.st.advShieldStack = !!s.shieldStack;
    var st = ADV_STARS[card.star] || ADV_STARS[1];
    u.maxHp = Math.max(1, Math.round(u.maxHp * s.hp));
    u.hp = u.maxHp;
    u.atk = Math.max(0, Math.round(u.atk * s.atk * 100) / 100);
    u.def = Math.max(0, Math.round(u.def * s.def * 100) / 100);
    u.baseSpeed = Math.max(1, Math.round(u.baseSpeed * s.speed * 100) / 100);
    if (s.shieldStart > 0) {
      u.st.shield = Math.round(u.maxHp * s.shieldStart);
      u.st.shieldT = 9999;
    }
    u.advRoleKey = card.key;
    u.advStar = st.hp;
    return;
  }

  if (b.kind === 'boss') {
    var bc = ADV_BOSS[b.boss];
    if (!bc || !bc.units[u.key]) return;
    var baseHp = TYPES[u.key] ? TYPES[u.key].maxHp : u.maxHp;
    /* 生命按 ADV_BOSS 配置的绝对值走；第二试炼只额外加强攻击。 */
    var atkTrialMul = b.trial === 2 ? 1.30 : 1.00;
    var diffMul = Math.max(0.60, 1 + (r.difficulty - 10) * 0.015);
    var mul = (bc.units[u.key] / Math.max(1, baseHp)) * diffMul;
    u.maxHp = Math.max(1, Math.round(u.maxHp * mul));
    u.hp = u.maxHp;
    u.atk = Math.max(0, Math.round(u.atk * bc.atk * atkTrialMul * diffMul * 100) / 100);
    u.def = Math.max(0, Math.round(u.def * bc.def * 100) / 100);
    u.baseSpeed = Math.max(1, Math.round(u.baseSpeed * bc.speed * 100) / 100);
    u.st.advBoss = {
      pctOut: Math.min(1.2, (bc.pctOut || 1) * Math.max(0.70, 1 + (r.difficulty - 10) * 0.01)),
      phase2Hp: bc.phase2Hp ? bc.phase2Hp * diffMul : 0
    };
    return;
  }

  var node = advNode(b.trial, b.node);
  var power = advNodePower(b.trial, b.node);
  var cs = (node && node.challenge) ? (ADV_CHALLENGE_STARS[b.star] || ADV_CHALLENGE_STARS[1]) : null;
  var dm = advDifficultyMul(r);
  var hpMul = power * (cs ? cs.hp : 1);
  var atkMul = power * (cs ? cs.atk : 1);
  var defMul = power * (cs ? cs.def : 1);
  var spdMul = cs ? cs.speed : 1;
  u.maxHp = Math.max(1, Math.round(u.maxHp * hpMul * dm));
  u.hp = u.maxHp;
  u.atk = Math.max(0, Math.round(u.atk * atkMul * dm * 100) / 100);
  u.def = Math.max(0, Math.round(u.def * defMul * 100) / 100);
  u.baseSpeed = Math.max(1, Math.round(u.baseSpeed * spdMul * 100) / 100);
  if (b.hp1) { u.maxHp = 1; u.hp = 1; }
  if (b.noSkill) {
    u.st.advNoSkill = true;
    u.cd = 999;
    u.ultCd = 999;
    u.energy = 0;
  }
  u.st.advEnemy = { star: b.star };
}

function advThreat() {
  var r = adventure.run;
  return r ? advDifficultyMul(r) : 1;
}
function adventureCdRate(u) {
  return (u && u.st && u.st.adv && u.st.adv.cdRate) ? u.st.adv.cdRate : 1;
}
function adventureUltCdRate(u) {
  return (u && u.st && u.st.adv && u.st.adv.cdRate) ? u.st.adv.cdRate : 1;
}
function adventureDamageBefore(u, amount, src, opt) {
  if (!adventureInBattle() || amount <= 0) return amount;
  var pct = !!(opt && opt.pct);
  if (u && u.team === 'A' && src !== u && u.st && u.st.adv &&
      u.st.adv.taken !== 1 && !(opt && opt.self)) {
    amount *= u.st.adv.taken;
  }
  if (src && src.team === 'A' && src.st && src.st.adv) {
    var s = src.st.adv;
    if (!pct) {
      if (opt && opt.dot) amount *= s.dot;
      else if (opt && (opt.basic || opt.skill || opt.ult) && !opt.advThorn) amount *= s.dmg;
      if (s.shieldDmg > 0 && src.st.shield > 0) {
        amount *= 1 + Math.min(0.5, (src.st.shield / Math.max(1, src.maxHp)) * 0.8);
      }
    }
  } else if (src && src.team === 'B' && src.st && src.st.advBoss && pct) {
    amount *= src.st.advBoss.pctOut || 1;
  }
  return amount;
}
function adventureDamageAfter(u, src, opt, actualHpLoss) {
  if (!adventureInBattle() || !src || !src.st || actualHpLoss <= 0) return;
  if (src.team === 'A' && src.st.adv) {
    var s = src.st.adv;
    if (src.alive && s.leech > 0 && opt && (opt.basic || opt.skill || opt.ult) && !opt.dot && !opt.advThorn) {
      var heal = Math.min(src.maxHp - src.hp, actualHpLoss * s.leech);
      if (heal > 0.5) src.hp += heal;
    }
  }
  if (u && u.team === 'A' && u.st && u.st.adv && src.team === 'B' &&
      u.st.adv.thorns > 0 && !(opt && opt.advThorn) && u.alive) {
    hurt(src, actualHpLoss * u.st.adv.thorns, u, { skill: 1, advThorn: 1 });
  }
  if (u && u.team === 'B' && !u.boss && src.team === 'A' && src.st && src.st.adv &&
      src.st.adv.slowOnHit > 0 && opt && opt.basic) {
    u.slowT = Math.max(u.slowT || 0, 1.5);
    u.slowMul = Math.min(u.slowMul || 1, 0.80);
  }
}
function adventureOnTick(u, dt) {
  if (!adventureInBattle() || !u || !u.st) return;
  if (u.team === 'A' && u.st.adv) {
    var s = u.st.adv;
    if (s.regen > 0 && u.alive && u.hp < u.maxHp) {
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * s.regen * dt);
    }
    if (s.ramp && u.alive) {
      u.st.advRampT = (u.st.advRampT || 0) + dt;
      while (u.st.advRampT >= s.ramp.every && (u.st.advRampStacks || 0) < s.ramp.max) {
        u.st.advRampT -= s.ramp.every;
        u.st.advRampStacks = (u.st.advRampStacks || 0) + 1;
        u.baseSpeed *= 1 + s.ramp.speed;
        s.dmg += s.ramp.dmg;
        if (typeof floater === 'function') {
          floater(u.x, u.y - u.r - 30, '疾影 +' + u.st.advRampStacks, '#ffe08a', 11);
        }
      }
    }
  } else if (u.team === 'B' && u.st.advNoSkill) {
    u.cd = 999;
    u.ultCd = 999;
    u.energy = 0;
  }
}
function adventureOnLethal(u) { return false; }
function adventureSpawnNextWave() { return false; }

/* ---------------- 界面生命周期 ---------------- */
function adventureOpen() {
  if (typeof mobiIsMobile === 'function' && mobiIsMobile() &&
      typeof mobiIsPortrait === 'function' && mobiIsPortrait()) {
    if (typeof mobiToast === 'function') mobiToast('秘境试炼请横屏游玩');
    return;
  }
  if (!adventure.snapshot) adventure.snapshot = advSnapshotMatch();
  if (typeof tourOddsStop === 'function') tourOddsStop();
  if (typeof previewStop === 'function') previewStop();
  if (!adventure.run) adventure.run = advLoad();
  adventure.inBattle = false;
  adventure.notice = '';
  adventure.selectedCard = null;
  adventure.selectedItems = [];
  adventure.nodeFocus = '';
  adventure.itemFocusId = '';
  adventure.itemFocusIx = -1;
  adventure.shopOpen = false;
  adventure.dragItem = -1;
  adventure.dragCardUid = -1;
  adventure.renderKey = '';
  adventure.lastStep = '';
  if (adventure.run && adventure.run.step === 'battle') {
    adventure.run.step = 'hub';
    advEnsureShop();
    advSave();
  }
  if (!adventure.run) adventure.envOffer = advOfferEnvironments();
  if (typeof mobiIsMobile === 'function' && mobiIsMobile()) {
    mobi.on = false;
    if (mobiRoot()) mobiRoot().classList.remove('on');
    document.body.classList.remove('mobi-mode', 'mobi-battle');
  }
  adventureShow();
}
function adventureShow() {
  var root = document.getElementById('adventure');
  if (!root) return;
  root.classList.add('show');
  document.body.classList.add('adventure-open');
  adventureRender();
}
function adventureHide() {
  var root = document.getElementById('adventure');
  if (root) root.classList.remove('show');
  document.body.classList.remove('adventure-open');
}
function adventureHome() { openMenu(); }

/* openMenu 统一走这里：先保存/回滚秘境战斗，再隐藏遮罩并恢复主菜单状态。 */
function adventurePrepareMenuReturn() {
  if (!adventure) return;
  if (adventure.inBattle) {
    if (typeof phase !== 'undefined' && phase === 'over' && typeof adventureCompleteBattle === 'function' &&
        adventureCompleteBattle()) {
      /* 已结算，继续走隐藏与恢复 */
    } else {
      adventureOnMenu();
    }
  }
  adventureHide();
  advRestoreMatch();
  if (typeof endFx !== 'undefined') endFx = null;
}

/* ---------------- 渲染 ---------------- */
function advRoleIcon(key) {
  var role = advRole(key);
  if (!role) return '';
  if (role.img) return '<img src="' + advEsc(role.img) + '" alt="">';
  if (typeof iconSvg === 'function') {
    /* 优先用角色池 key 的图标：红青组合的图标 key 是 duo，不是首个单位 red。 */
    return iconSvg(role.key) || iconSvg(role.units[0]) || '';
  }
  return '';
}
function advStars(n) {
  var s = '';
  for (var i = 0; i < n; i++) s += '★';
  return s;
}
function advItemChip(id, ix, uid, equipped) {
  var d = advItem(id);
  if (!d) return '';
  var cls = 'adv-item' + (d.basic ? '' : ' advanced') + (equipped ? ' equipped' : '');
  return '<button type="button" class="' + cls + '" data-adv="unequip" data-uid="' + uid + '" data-ix="' + ix + '" title="点击卸下：' + advEsc(d.text) + '">' +
    '<i>' + d.icon + '</i><span>' + advEsc(d.name) + '</span></button>';
}
function advCardHtml(card, zone) {
  if (!card) return '';
  var role = advRole(card.key);
  var name = role ? (role.short || role.name) : card.key;
  var items = '';
  for (var i = 0; i < ADV_CONFIG.maxItems; i++) {
    var id = card.items[i];
    items += id
      ? '<span class="adv-card-item" title="' + advEsc(advItemName(id)) + '">' + advItemIcon(id) + '</span>'
      : '<span class="adv-card-item empty" title="空装备位"></span>';
  }
  var acts = '';
  if (zone === 'board') {
    acts += '<button type="button" data-adv="bench" data-uid="' + card.uid + '">下阵</button>';
  } else {
    acts += '<button type="button" data-adv="place" data-uid="' + card.uid + '">上阵</button>';
  }
  if (adventure.selectedItems.length === 1) {
    acts += '<button type="button" class="equip" data-adv="equip" data-uid="' + card.uid + '">装备</button>';
  }
  acts += '<button type="button" class="sell" data-adv="sell" data-uid="' + card.uid + '">出售 ●' + advSellPrice(card) + '</button>';
  return '<div class="adv-card ' + zone + (adventure.selectedCard === card.uid ? ' selected' : '') + '" draggable="true" data-adv="selectCard" data-uid="' + card.uid + '">' +
    '<div class="adv-card-top"><span class="adv-ico">' + advRoleIcon(card.key) + '</span>' +
      '<span class="adv-stars">' + advStars(card.star) + '</span></div>' +
    '<b>' + advEsc(name) + '</b><small>' + advEsc(role ? role.role : '') + '</small>' +
    '<div class="adv-card-items">' + items + '</div>' +
    '<div class="adv-card-actions">' + acts + '</div></div>';
}
function advEmptySlot(zone, ix) {
  return '<div class="adv-slot empty" data-slot-zone="' + zone + '" data-slot-ix="' + ix + '"><span>+</span></div>';
}
function advTopHtml() {
  var r = adventure.run;
  if (!r) return '';
  var env = advEnv(r.env);
  return '<header class="adv-top">' +
    '<div class="adv-title"><span class="adv-kicker">SECRET REALM · TRIAL ' + r.trial + ' / ' + ADV_CONFIG.maxTrial + '</span>' +
      '<h2>' + (r.trial === 1 ? '第一试炼 · 翠庭' : '第二试炼 · 雷庭') + '</h2>' +
      '<p><b class="adv-env-name">' + advEsc(env.name) + '</b> · ' + advEsc(env.desc) + '</p></div>' +
    '<div class="adv-res">' +
      '<span class="adv-res-pill hp"><i>♥</i><b>' + Math.max(0, r.hp) + '</b><small>征战 / ' + r.maxHp + '</small></span>' +
      '<span class="adv-res-pill diff"><i>⚔</i><b>' + advDifficulty(r) + '</b><small>敌难</small></span>' +
      '<span class="adv-res-pill streak"><i>▲</i><b>' + r.streak + '</b><small>连胜</small></span>' +
      '<button type="button" class="adv-icon-btn" data-adv="home" title="返回主菜单">×</button>' +
    '</div></header>';
}
function advNodeState(r, trial, n) {
  if (!r) return 'future';
  if (r.step === 'complete') return 'done';
  if (trial < r.trial) return 'done';
  if (trial === r.trial && n < r.node) return 'done';
  if (trial === r.trial && n === r.node) return 'current';
  return 'future';
}
function advNodeIcon(node, state) {
  if (state === 'done') return '✓';
  if (node.type === 'boss') return '☠';
  if (node.type === 'challenge') return '♜';
  if (node.type === 'gift') return '✦';
  return '⚔';
}
function advNodeTypeName(type) {
  if (type === 'boss') return 'BOSS';
  if (type === 'challenge') return '守关挑战';
  if (type === 'gift') return '奖励关';
  return '普攻小怪关';
}
function advNodeDesc(node) {
  if (!node) return '';
  if (node.type === 'boss') return 'BOSS 关。失败会扣除大量征战生命，但可以保留当前阵容再次挑战；击破后进入下一试炼。';
  if (node.type === 'challenge') return '难度二选一：左边 1–2 星，右边 3–5 星。实际星级越高，敌人越强，遭遇奖励也越好。';
  if (node.type === 'gift') return '奖励关：小怪只有 1 点生命。胜利后三选一奖励' + (node.hex ? '，随后选择海克斯' : '') + '。';
  return '普攻小怪关：敌人不会释放技能 / 终结技，靠普攻与撞击作战。失败仍会前进，但只拿基础奖励。' +
    (node.hex ? ' 胜利后选择海克斯。' : '');
}
function advNodePopHtml() {
  var r = adventure.run, tag = adventure.nodeFocus;
  if (!r || !tag) return '';
  var parts = String(tag).split('-');
  var trial = parseInt(parts[0], 10), n = parseInt(parts[1], 10);
  var node = advNode(trial, n);
  if (!node) return '';
  var state = advNodeState(r, trial, n);
  var status = state === 'done' ? '已完成' : (state === 'current' ? '当前节点' : '未到达');
  var extra = '';
  if (node.challenge) extra += '<span>左 1–2★ / 右 3–5★</span>';
  if (node.reward) extra += '<span>胜利奖励自动发放 2 项</span>';
  if (node.hex || node.extraHex) extra += '<span>海克斯三选一</span>';
  if (!node.boss) extra += '<span>节点强度 ×' + advNodePower(trial, n).toFixed(2) + '</span>';
  return '<div class="adv-node-pop" role="dialog" aria-label="节点详情">' +
    '<button type="button" class="adv-node-pop-x" data-adv="nodeClose" title="关闭">×</button>' +
    '<div class="adv-node-pop-head"><span class="adv-kicker">' + tag + '</span><b>' + advEsc(node.name) + '</b>' +
      '<span class="adv-node-pop-type ' + node.type + '">' + advNodeTypeName(node.type) + '</span></div>' +
    '<p>' + advNodeDesc(node) + '</p>' +
    '<div class="adv-node-pop-meta"><span class="adv-node-state ' + state + '">' + status + '</span>' +
      '<span>敌人 <b>' + node.enemies + '</b></span>' + extra + '</div></div>';
}
function advPathHtml() {
  var r = adventure.run;
  if (!r) return '';
  var trial = r.trial;
  var nodes = '';
  for (var n = 1; n <= ADV_CONFIG.nodesPerTrial; n++) {
    var node = advNode(trial, n);
    var state = advNodeState(r, trial, n);
    var tag = trial + '-' + n;
    var cls = 'adv-node ' + node.type + ' ' + state + (adventure.nodeFocus === tag ? ' focused' : '');
    nodes += '<button type="button" class="' + cls + '" data-adv="node" data-tag="' + tag + '" title="' + tag + ' · ' + advEsc(node.name) + '" aria-pressed="' + (adventure.nodeFocus === tag) + '">' +
      '<i>' + advNodeIcon(node, state) + '</i><b>' + tag + '</b><small>' + advEsc(node.name) + '</small></button>';
  }
  var trialName = trial === 1 ? '第一试炼' : '第二试炼';
  var note = trial === 1 ? '击破 1-7 后开启第二试炼' : '最终试炼 · 击破 2-7 通关';
  var curNode = advCurrentNode(r);
  var curText = r.step === 'complete' ? '已通关' : (r.trial + '-' + r.node + ' ' + (curNode ? curNode.name : ''));
  return '<section class="adv-path-wrap">' +
    '<div class="adv-path-head">' +
      '<div class="adv-path-title"><span class="adv-kicker">TRIAL ' + (trial === 1 ? 'I' : 'II') + '</span>' +
        '<b>' + trialName + ' · 挑战节点</b><small>点击查看详情</small></div>' +
      '<div class="adv-path-meta"><span>当前 <b>' + advEsc(curText) + '</b></span>' +
        '<span class="adv-path-note">' + note + '</span></div>' +
    '</div>' +
    '<div class="adv-path">' + nodes + '</div>' +
    advNodePopHtml() +
  '</section>';
}
function advCardActualStats(card) {
  var role = advRole(card.key), s = advCardStats(card);
  var out = { units: [], dmg: s.dmg, dot: s.dot };
  if (!role) return out;
  for (var i = 0; i < role.units.length; i++) {
    var t = TYPES[role.units[i]] || {};
    out.units.push({
      name: t.name || role.units[i],
      hp: Math.max(1, Math.round((t.maxHp || 0) * s.hp)),
      atk: Math.max(0, Math.round((t.atk || 0) * s.atk)),
      def: Math.max(0, Math.round((t.def || 0) * s.def)),
      speed: Math.max(1, Math.round((t.baseSpeed || 0) * s.speed))
    });
  }
  return out;
}
function advDetailHtml() {
  var card = advCard(adventure.selectedCard);
  if (!card) {
    return '<section class="adv-panel adv-detail empty"><div class="adv-panel-title">角色详情</div></section>';
  }
  var s = advCardStats(card);
  var act = advCardActualStats(card);
  var role = advRole(card.key);
  var zone = advCardZone(card.uid);
  var items = '';
  if (card.items.length) {
    for (var i = 0; i < card.items.length; i++) {
      items += '<button type="button" class="adv-item equipped" data-adv="unequip" data-uid="' + card.uid + '" data-ix="' + i + '" title="点击卸下">' +
        '<i>' + advItemIcon(card.items[i]) + '</i><span>' + advEsc(advItemName(card.items[i])) + '</span></button>';
    }
  } else {
    items = '<span class="adv-muted">未装备</span>';
  }
  var unitHtml = '';
  for (var u = 0; u < act.units.length; u++) {
    var us = act.units[u];
    unitHtml += '<div class="adv-unit-stat"><span class="adv-unit-name">' + advEsc(us.name) + '</span>' +
      '<span>生命 <b>' + us.hp + '</b></span><span>攻击 <b>' + us.atk + '</b></span>' +
      '<span>防御 <b>' + us.def + '</b></span><span>移速 <b>' + us.speed + '</b></span></div>';
  }
  var acts = '<div class="adv-detail-actions">' +
    (zone === 'board'
      ? '<button type="button" data-adv="bench" data-uid="' + card.uid + '">下阵</button>'
      : '<button type="button" data-adv="place" data-uid="' + card.uid + '">上阵</button>') +
    (adventure.selectedItems.length === 1
      ? '<button type="button" class="equip" data-adv="equip" data-uid="' + card.uid + '">装备</button>' : '') +
    '<button type="button" class="sell" data-adv="sell" data-uid="' + card.uid + '">出售 ●' + advSellPrice(card) + '</button>' +
  '</div>';
  return '<section class="adv-panel adv-detail">' +
    '<div class="adv-panel-title">角色详情 <span>' + (zone === 'board' ? '主站席' : '备战席') + '</span></div>' +
    '<div class="adv-detail-head"><span class="adv-ico">' + advRoleIcon(card.key) + '</span><div><b>' + advEsc(role ? role.name : card.key) + '</b><small>' + advStars(card.star) + ' · ' + advEsc(role ? role.role : '') + '</small></div></div>' +
    '<div class="adv-unit-stats">' + unitHtml + '</div>' +
    '<div class="adv-stat-row adv-stat-bonus">' +
      '<span>伤害 <b>+' + Math.round((s.dmg - 1) * 100) + '%</b></span>' +
      '<span>持续 <b>+' + Math.round((s.dot - 1) * 100) + '%</b></span>' +
      '<span>星级 <b>' + card.star + ' 星</b></span>' +
    '</div>' +
    '<div class="adv-detail-items">' + items + '</div>' + acts + '</section>';
}
function advRecipeHtml(rec) {
  var a = advItem(rec.a), b = advItem(rec.b), out = advItem(rec.out);
  if (!a || !b || !out) return '';
  var mats = rec.a === rec.b ? advEsc(a.name) + ' ×2' : advEsc(a.name) + ' + ' + advEsc(b.name);
  return '<div class="adv-recipe">' +
    '<button type="button" class="adv-recipe-main" data-adv="recipeInfo" data-id="' + rec.out + '" title="查看 ' + advEsc(out.name) + ' 详情">' +
      '<span class="adv-recipe-icons"><i>' + a.icon + '</i><em>+</em><i>' + b.icon + '</i><em>›</em><i class="out">' + out.icon + '</i></span>' +
      '<span class="adv-recipe-txt"><b>' + advEsc(out.name) + '</b><small>' + mats + '</small></span>' +
    '</button>' +
    '<button type="button" class="adv-recipe-go" data-adv="craftRec" data-id="' + rec.out + '">合成</button>' +
  '</div>';
}
function advCraftPanelHtml() {
  var list = advCraftableRecipes();
  var rows = '';
  for (var i = 0; i < list.length; i++) rows += advRecipeHtml(list[i]);
  if (!rows) rows = '<div class="adv-muted box">暂无可合成配方<br>集齐 2 件基础装备后自动出现</div>';
  return '<section class="adv-panel adv-craft-panel">' +
    '<div class="adv-panel-title">可合成列表 <span>' + list.length + ' 项</span></div>' +
    '<div class="adv-craft-list">' + rows + '</div>' +
    '<p class="adv-panel-note">点击进阶装备可查看装备详情</p>' +
  '</section>';
}
function advHexPanelHtml() {
  var r = adventure.run;
  return '<section class="adv-panel adv-hex-panel">' +
    '<div class="adv-panel-title">海克斯 <span>' + r.hexes.length + ' 个</span></div>' +
    '<div class="adv-hexes">' + advHexListHtml() + '</div>' +
  '</section>';
}
function advInvItemHtml(id, ix) {
  var d = advItem(id);
  if (!d) return '';
  var sel = adventure.itemFocusIx === ix;
  return '<button type="button" class="adv-inv-item' + (d.basic ? '' : ' advanced') + (sel ? ' selected' : '') + '" data-adv="invItem" data-ix="' + ix + '" draggable="true" title="' + advEsc(d.name) + ' · ' + advEsc(d.text) + '">' +
    '<i>' + d.icon + '</i></button>';
}
function advInventoryHtml() {
  var r = adventure.run;
  if (!r) return '';
  if (!r.inventory.length) return '<div class="adv-muted box">暂无装备<br>每个节点结束有概率掉落</div>';
  var html = '';
  for (var i = 0; i < r.inventory.length; i++) html += advInvItemHtml(r.inventory[i], i);
  return html;
}
function advItemDetailHtml() {
  var d = advItem(adventure.itemFocusId);
  if (!d) {
    return '<div class="adv-item-detail empty"><b>装备详情</b></div>';
  }
  var rec = advItemRecipe(d.id);
  var mats = rec ? (rec.a === rec.b ? advItemName(rec.a) + ' ×2' : advItemName(rec.a) + ' + ' + advItemName(rec.b)) : '';
  var extra = '';
  if (adventure.itemFocusIx >= 0) {
    extra = adventure.selectedCard
      ? '<button type="button" class="adv-item-equip" data-adv="equipFocused">装备到选中角色</button>'
      : '<span class="adv-item-tip">已选中 · 点击角色卡即可装备</span>';
  } else if (rec) {
    extra = '<span class="adv-item-tip">合成配方：' + advEsc(mats) + '</span>';
  }
  return '<div class="adv-item-detail">' +
    '<div class="adv-item-detail-head"><span class="adv-item-ico' + (d.basic ? '' : ' advanced') + '">' + d.icon + '</span>' +
      '<div><b>' + advEsc(d.name) + '</b><small>' + (d.basic ? '基础装备' : '进阶装备') + (rec ? ' · 可合成' : '') + '</small></div></div>' +
    '<p>' + advEsc(d.text) + '</p>' + extra +
  '</div>';
}
function advInventoryPanelHtml() {
  var r = adventure.run;
  /* 手机端装备详情收进弹窗，面板只留装备格子 */
  var detail = advIsMobile() ? '' : advItemDetailHtml();
  return '<section class="adv-panel adv-inv-panel">' +
    '<div class="adv-panel-title">已获得装备 <span>' + r.inventory.length + ' 件</span></div>' +
    '<div class="adv-inv">' + advInventoryHtml() + '</div>' +
    detail +
  '</section>';
}
function advShopHtml() {
  var r = adventure.run;
  if (!r) return '';
  var html = '';
  for (var i = 0; i < r.shop.length; i++) {
    var e = r.shop[i];
    if (!e) {
      html += '<div class="adv-shop-card sold"><span>已售出</span><small>刷新后补货</small></div>';
      continue;
    }
    var role = advRole(e.key);
    var cost = advShopEntryCost(e);
    html += '<div class="adv-shop-card' + (r.gold < cost ? ' poor' : '') + '">' +
      '<div class="adv-shop-ico"><span class="adv-ico">' + advRoleIcon(e.key) + '</span><span class="adv-stars">' + advStars(e.star) + '</span></div>' +
      '<b>' + advEsc(role ? (role.short || role.name) : e.key) + '</b><small>' + advEsc(role ? role.role : '') + ' · ' + e.star + ' 星</small>' +
      '<button type="button" class="adv-buy" data-adv="buy" data-ix="' + i + '">购买 ●' + cost + '</button></div>';
  }
  return html;
}
function advShopDrawerHtml() {
  var r = adventure.run;
  if (!r) return '';
  var open = !!adventure.shopOpen;
  return '<div class="adv-shop-drawer' + (open ? ' open instant' : '') + '" aria-hidden="' + (open ? 'false' : 'true') + '">' +
    '<div class="adv-shop-dim" data-adv="shopClose"></div>' +
    '<div class="adv-shop-sheet" role="dialog" aria-label="角色商店">' +
      '<div class="adv-shop-head">' +
        '<div class="adv-shop-heading"><span class="adv-kicker">RECRUIT</span><b>角色商店</b></div>' +
        '<div class="adv-shop-meta"><span>持有 <b class="gold">● ' + r.gold + '</b></span><span>牌库 ' + advPoolLeft(r) + '/90</span><span>刷新 ●' + ADV_CONFIG.refreshCost + '</span></div>' +
        '<button type="button" class="adv-icon-btn" data-adv="shopClose" title="关闭商店">×</button>' +
      '</div>' +
      '<div class="adv-shop">' + advShopHtml() + '</div>' +
      '<div class="adv-shop-foot">' +
        '<button type="button" class="adv-secondary" data-adv="reroll">刷新商店 · ●' + ADV_CONFIG.refreshCost + '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}
function advHexListHtml() {
  var r = adventure.run;
  if (!r) return '';
  if (!r.hexes.length) return '<span class="adv-muted">尚未获得海克斯</span>';
  var html = '';
  for (var i = 0; i < r.hexes.length; i++) {
    var h = advHex(r.hexes[i]);
    if (!h) continue;
    html += '<span class="adv-hex q-' + h.q + '" title="' + advEsc(h.text) + '"><i>' + h.icon + '</i>' + advEsc(h.name) + '</span>';
  }
  return html;
}
function advNodeInfoHtml(node) {
  if (!node) return '';
  return '<b>' + node.trial + '-' + node.n + ' · ' + advEsc(node.name) + '</b>' +
    '<p>' + advNodeDesc(node) + '</p>';
}
function advCoinHtml() {
  var r = adventure.run;
  if (!r) return '';
  return '<button type="button" class="adv-coin" data-adv="shopOpen" title="打开角色商店">' +
    '<b>' + r.gold + '</b><span>金币</span><em>商店</em></button>';
}
function advFooterHtml() {
  var r = adventure.run, node = advCurrentNode(r);
  if (!r || !node) return '';
  var boardN = advBoardKeys().length;
  var btn;
  if (node.type === 'challenge' && !r.battle) {
    btn = '<div class="adv-fight-btns">' +
      '<button type="button" class="adv-primary side" data-adv="fight" data-side="left"><span>左 · 1–2 星</span><small>稳妥奖励</small></button>' +
      '<button type="button" class="adv-primary side danger" data-adv="fight" data-side="right"><span>右 · 3–5 星</span><small>高难奖励</small></button>' +
      '</div>';
  } else {
    btn = '<button type="button" class="adv-primary" data-adv="fight">开始战斗 · ' + boardN + ' 人上阵</button>';
  }
  return '<footer class="adv-foot"><div class="adv-node-info">' + advNodeInfoHtml(node) +
    '<div class="adv-foot-meta">敌难 <b>' + advDifficulty(r) + '</b> · 卡池 <b>' + advPoolLeft(r) + '/90</b> · 连胜 <b>' + r.streak + '</b></div></div>' +
    '<div class="adv-foot-actions">' + advCoinHtml() + btn + '</div></footer>';
}
function advHubHtml() {
  var r = adventure.run;
  var board = '', bench = '';
  for (var b = 0; b < r.board.length; b++) {
    var bc = advCard(r.board[b]);
    board += bc ? advCardHtml(bc, 'board') : advEmptySlot('board', b);
  }
  for (var s = 0; s < r.bench.length; s++) {
    var sc = advCard(r.bench[s]);
    bench += sc ? advCardHtml(sc, 'bench') : advEmptySlot('bench', s);
  }
  return '<div class="adv-hub">' +
    advTopHtml() +
    '<div class="adv-layout">' +
      '<aside class="adv-col adv-col-left">' + advCraftPanelHtml() + advHexPanelHtml() + '</aside>' +
      '<main class="adv-col adv-col-mid">' +
        advPathHtml() +
        '<section class="adv-panel adv-board-panel">' +
          '<div class="adv-panel-title">主站席</div>' +
          '<div class="adv-board">' + board + '</div>' +
          '<div class="adv-panel-title">备战席</div>' +
          '<div class="adv-bench">' + bench + '</div>' +
        '</section>' +
      '</main>' +
      '<aside class="adv-col adv-col-right">' + advInventoryPanelHtml() + (advIsMobile() ? '' : advDetailHtml()) + '</aside>' +
    '</div>' +
    advFooterHtml() +
    advShopDrawerHtml() +
  '</div>';
}
function advResultHtml() {
  var r = adventure.run, res = r.result;
  if (!res) return advHubHtml();
  var win = res.win;
  var node = advNode(res.trial, res.node);
  var powerText = advNodePower(res.trial, res.node).toFixed(2);
  var rows = '';
  function row(label, value, cls) {
    return '<div class="adv-result-row ' + (cls || '') + '"><span>' + label + '</span><b>' + value + '</b></div>';
  }
  rows += row('基础奖励', '● ' + res.rewards.base);
  if (win) {
    rows += row('胜利奖励', '● ' + res.rewards.win);
    rows += row('连胜奖励', '● ' + res.rewards.streak);
    rows += row('利息', '● ' + res.rewards.interest);
  }
  rows += row('合计', '● ' + res.rewards.total, 'total');
  return advTopHtml() + advPathHtml() +
    '<section class="adv-result ' + (win ? 'win' : 'loss') + '">' +
      '<div class="adv-result-kicker">' + (win ? 'VICTORY' : 'DEFEAT') + '</div>' +
      '<h2>' + (res.draw ? '同归于尽' : (win ? '战斗胜利' : '战斗失败')) + '</h2>' +
      '<p>' + res.trial + '-' + res.node + ' · ' + advEsc(res.name) + ' · ' +
        (res.boss ? 'BOSS' : (node && node.challenge ? '难度 ' + res.star + ' 星 · 强度 ×' + powerText : '节点强度 ×' + powerText)) + ' · 用时 ' + (res.seconds || 0) + 's</p>' +
      '<div class="adv-result-grid">' + rows + '</div>' +
      (res.damage > 0
        ? '<div class="adv-result-hp"><span>征战生命</span><b>' + res.hpBefore + ' → ' + Math.max(0, res.hpAfter) + '</b><small>失败扣除 ' + res.damage + '</small></div>'
        : (res.heal > 0
          ? '<div class="adv-result-hp heal"><span>征战生命</span><b>' + res.hpBefore + ' → ' + Math.max(0, res.hpAfter) + '</b><small>胜利回复 +' + res.heal + '</small></div>'
          : '')) +
      (res.drop ? '<div class="adv-drop">掉落：' + advItemIcon(res.drop) + ' ' + advEsc(advItemName(res.drop)) + '</div>' : '') +
      '<button type="button" class="adv-primary" data-adv="continue">' +
        (res.bossLost && r.hp >= 0 ? '再战 BOSS' : '继续') + '</button>' +
    '</section>';
}
function advRewardHtml() {
  var r = adventure.run;
  if (!r || !r.pending) return advHubHtml();
  var opts = '';
  for (var i = 0; i < r.pending.options.length; i++) {
    var o = r.pending.options[i];
    opts += '<button type="button" class="adv-choice-card" data-adv="reward" data-ix="' + i + '">' +
      '<i>' + (o.icon || '✦') + '</i><b>' + advEsc(o.name) + '</b><span>' + advEsc(o.desc) + '</span><em>选择</em></button>';
  }
  return advTopHtml() + advPathHtml() +
    '<section class="adv-choice"><span class="adv-kicker">REWARD</span><h2>' + advEsc(r.pending.title) + '</h2>' +
      '<p>' + advEsc(r.pending.sub || '') + '</p><div class="adv-choice-grid">' + opts + '</div></section>';
}
function advAutoRewardHtml() {
  var r = adventure.run;
  if (!r || !r.pending) return advHubHtml();
  var opts = '';
  for (var i = 0; i < r.pending.options.length; i++) {
    var o = r.pending.options[i];
    opts += '<div class="adv-choice-card auto"><i>' + (o.icon || '✦') + '</i><b>' + advEsc(o.name) + '</b>' +
      '<span>' + advEsc(o.gain || o.desc) + '</span><em>已获得</em></div>';
  }
  return advTopHtml() + advPathHtml() +
    '<section class="adv-choice adv-auto-reward"><span class="adv-kicker">REWARD</span>' +
      '<h2>' + advEsc(r.pending.title || '奖励关 · 系统发放') + '</h2>' +
      '<p>' + advEsc(r.pending.sub || '') + '</p>' +
      '<div class="adv-choice-grid two">' + opts + '</div>' +
      '<button type="button" class="adv-primary" data-adv="rewardContinue">继续</button>' +
    '</section>';
}
function advHexChoiceHtml() {
  var r = adventure.run;
  if (!r || !r.pending) return advHubHtml();
  var opts = '';
  for (var i = 0; i < r.pending.offers.length; i++) {
    var h = advHex(r.pending.offers[i]);
    if (!h) continue;
    var q = advQuality(h.q);
    opts += '<button type="button" class="adv-choice-card q-' + h.q + '" data-adv="hex" data-id="' + h.id + '">' +
      '<span class="adv-q adv-q-' + h.q + '">' + q.name + '</span>' +
      '<i>' + h.icon + '</i><b>' + advEsc(h.name) + '</b><span>' + advEsc(h.text) + '</span><em>获取</em></button>';
  }
  return advTopHtml() + advPathHtml() +
    '<section class="adv-choice"><span class="adv-kicker">HEX</span><h2>海克斯三选一</h2>' +
      '<p>黄金品质会让敌人难度 +2，棱彩品质 +5。当前敌难：<b>' + advDifficulty(r) + '</b></p>' +
      '<div class="adv-choice-grid">' + opts + '</div></section>';
}
function advItemChoiceHtml() {
  var r = adventure.run;
  if (!r || !r.pending) return advHubHtml();
  var opts = '';
  for (var i = 0; i < r.pending.options.length; i++) {
    var d = advItem(r.pending.options[i]);
    if (!d) continue;
    opts += '<button type="button" class="adv-choice-card item" data-adv="itemChoice" data-id="' + d.id + '">' +
      '<i>' + d.icon + '</i><b>' + advEsc(d.name) + '</b><span>' + advEsc(d.text) + '</span><em>选择</em></button>';
  }
  return advTopHtml() + advPathHtml() +
    '<section class="adv-choice"><span class="adv-kicker">EQUIPMENT</span><h2>' + advEsc(r.pending.title) + '</h2>' +
      '<p>装备会进入背包，之后可装到任意角色身上。</p><div class="adv-choice-grid">' + opts + '</div></section>';
}
function advEndHtml() {
  var r = adventure.run;
  if (!r) return advEnvHtml();
  var win = r.step === 'complete';
  var title = win ? '试炼通关' : '试炼终止';
  var sub = win ? '你击破了第二试炼的最终 BOSS。' : '征战生命跌破 0，本局结束。';
  return advTopHtml() + advPathHtml() +
    '<section class="adv-end ' + (win ? 'win' : 'loss') + '">' +
      '<span class="adv-kicker">' + (win ? 'COMPLETE' : 'RUN OVER') + '</span>' +
      '<h2>' + title + '</h2><p>' + sub + '</p>' +
      '<div class="adv-end-grid">' +
        '<span>抵达 <b>' + r.trial + '-' + r.node + '</b></span>' +
        '<span>征战生命 <b>' + Math.max(0, r.hp) + '</b></span>' +
        '<span>金币 <b>' + r.gold + '</b></span>' +
        '<span>战绩 <b>' + r.wins + ' 胜 / ' + r.losses + ' 负</b></span>' +
        '<span>最高连胜 <b>' + r.bestStreak + '</b></span>' +
        '<span>海克斯 <b>' + r.hexes.length + '</b></span>' +
      '</div>' +
      '<div class="adv-end-actions"><button type="button" class="adv-primary" data-adv="newRun">再来一局</button>' +
      '<button type="button" class="adv-secondary" data-adv="home">返回主菜单</button></div>' +
    '</section>';
}
function advEnvHtml() {
  var offer = adventure.envOffer && adventure.envOffer.length ? adventure.envOffer : advOfferEnvironments();
  adventure.envOffer = offer;
  var cards = '';
  for (var i = 0; i < offer.length; i++) {
    var e = offer[i];
    cards += '<button type="button" class="adv-env-card" data-adv="env" data-id="' + e.id + '">' +
      '<i>' + e.icon + '</i><b>' + advEsc(e.name) + '</b><span>' + advEsc(e.desc) + '</span><small>' + advEsc(e.detail) + '</small><em>选择此环境</em></button>';
  }
  return '<div class="adv-env-screen">' +
    '<div class="adv-env-head"><span class="adv-kicker">SECRET REALM</span><h2>选择秘境环境</h2>' +
      '<p>三选一，本局全程生效。开局 24 金币、3 张战斗席、6 格备战席；牌库 90 张。</p>' +
      '<button type="button" class="adv-secondary adv-env-back" data-adv="home">返回主菜单</button></div>' +
    '<div class="adv-env-grid">' + cards + '</div>' +
    '<div class="adv-rules-box"><b>试炼规则</b><ul>' +
      '<li>第一 / 第二试炼各 7 个节点：奖励关 → 普攻小怪 → 难度挑战 → 奖励关 → BOSS。</li>' +
      '<li>3 张同名 1 星自动合成 2 星，3 张 2 星合成 3 星；2 星出售 10 金币，3 星出售 30。</li>' +
      '<li>战斗席不能重复角色；每场战斗前全员满血；失败只拿基础奖励并扣征战生命。</li>' +
      '<li>海克斯分白银 / 黄金 / 棱彩；黄金 +2 敌难，棱彩 +5 敌难。</li>' +
      '</ul></div></div>';
}
function adventureRender() {
  var root = document.getElementById('adventure');
  if (!root) return;
  var r = adventure.run;
  if (r && r.step === 'battle') { adventureHide(); return; }
  var isHub = !!r && r.step === 'hub';
  if (!isHub) adventure.shopOpen = false;
  var html;
  if (!r) html = advEnvHtml();
  else if (r.step === 'result') html = advResultHtml();
  else if (r.step === 'reward') html = advRewardHtml();
  else if (r.step === 'rewardAuto') html = advAutoRewardHtml();
  else if (r.step === 'hex') html = advHexChoiceHtml();
  else if (r.step === 'item') html = advItemChoiceHtml();
  else if (r.step === 'defeat' || r.step === 'complete') html = advEndHtml();
  else html = advHubHtml();
  var notice = adventure.notice;
  if (notice) html += '<div class="adv-notice">' + advEsc(notice) + '</div>';
  /* 手机端：角色 / 装备详情以弹窗展示，不常驻三栏 */
  var modal = '';
  if (isHub && advIsMobile()) {
    var detailCard = advCard(adventure.selectedCard);
    if (detailCard) {
      modal = '<div class="adv-modal" data-adv="detailClose"><div class="adv-modal-box">' +
        '<button type="button" class="adv-modal-x" data-adv="detailClose" title="关闭">×</button>' +
        advDetailHtml() + '</div></div>';
    } else if (adventure.itemFocusId) {
      modal = '<div class="adv-modal" data-adv="detailClose"><div class="adv-modal-box">' +
        '<button type="button" class="adv-modal-x" data-adv="detailClose" title="关闭">×</button>' +
        advItemDetailHtml() + '</div></div>';
    }
  }
  var stepKey = r ? r.step : 'env';
  var keepScroll = adventure.lastStep === stepKey ? root.scrollTop : 0;
  adventure.lastStep = stepKey;
  root.classList.toggle('adv-hub-mode', isHub);
  root.innerHTML = '<div class="adv-shell">' + html + modal + '</div>';
  /* 粗指针（手机/触屏）禁用 HTML5 原生拖拽，统一走 Pointer 触摸拖拽，避免拖拽气泡冲突 */
  var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  if (coarse) {
    var draggables = root.querySelectorAll('[draggable]');
    for (var di = 0; di < draggables.length; di++) draggables[di].draggable = false;
  }
  root.scrollTop = keepScroll;
}
function advRestartRun() {
  adventure.run = null;
  adventure.inBattle = false;
  adventure.notice = '';
  adventure.selectedCard = null;
  adventure.selectedItems = [];
  adventure.nodeFocus = '';
  adventure.itemFocusId = '';
  adventure.itemFocusIx = -1;
  adventure.shopOpen = false;
  adventure.dragItem = -1;
  adventure.dragCardUid = -1;
  advClearSave();
  adventure.envOffer = advOfferEnvironments();
  adventure.lastStep = '';
  adventureRender();
}
function adventureClick(e) {
  var t = e.target.closest('[data-adv]');
  if (!t) return;
  var act = t.getAttribute('data-adv');
  var uid = parseInt(t.getAttribute('data-uid'), 10) || 0;
  var ix = parseInt(t.getAttribute('data-ix'), 10);
  if (isNaN(ix)) ix = -1;
  if (act !== 'home') adventure.notice = '';
  if (act === 'home') { adventureHome(); return; }
  if (act === 'detailClose') {
    adventure.selectedCard = null;
    adventure.selectedItems = [];
    adventure.itemFocusId = '';
    adventure.itemFocusIx = -1;
    adventureRender();
    return;
  }
  if (act === 'env') {
    adventure.run = advNewRun(t.getAttribute('data-id'));
    adventure.envOffer = [];
    adventureRender();
    return;
  }
  if (act === 'newRun') { advRestartRun(); return; }
  if (act === 'nodeClose') { adventure.nodeFocus = ''; adventureRender(); return; }
  if (act === 'node') {
    var tag = t.getAttribute('data-tag') || '';
    adventure.nodeFocus = adventure.nodeFocus === tag ? '' : tag;
    adventureRender();
    return;
  }
  if (act === 'rewardContinue') {
    if (adventure.run && adventure.run.step === 'rewardAuto') {
      advContinueAutoReward();
      adventureRender();
    }
    return;
  }
  if (act === 'shopClose') { advShopClose(); return; }
  if (act === 'shopOpen') { advShopOpen(); return; }
  if (act === 'invItem') { advToggleItem(ix); return; }
  if (act === 'recipeInfo') {
    adventure.itemFocusId = t.getAttribute('data-id') || '';
    adventure.itemFocusIx = -1;
    adventure.selectedItems = [];
    adventureRender();
    return;
  }
  if (act === 'craftRec') { advCraftRecipe(t.getAttribute('data-id')); return; }
  if (act === 'equipFocused') {
    if (adventure.selectedCard && adventure.itemFocusIx >= 0) advEquipItemTo(adventure.selectedCard, adventure.itemFocusIx);
    else { advNotice('先选中一张角色卡。'); adventureRender(); }
    return;
  }
  if (act === 'selectCard') {
    var selItem = advSelectedItemIndices();
    if (selItem.length === 1) { advEquipItemTo(uid, selItem[0]); return; }
    adventure.selectedCard = uid;
    adventure.selectedItems = [];
    adventure.itemFocusId = '';
    adventure.itemFocusIx = -1;
    adventureRender();
    return;
  }
  if (act === 'place') advPlaceOnBoard(uid);
  else if (act === 'bench') advMoveToBench(uid);
  else if (act === 'sell') advSellCard(uid);
  else if (act === 'buy') advBuyShop(ix);
  else if (act === 'reroll') advRerollShop();
  else if (act === 'item') advToggleItem(ix);
  else if (act === 'equip') advEquipSelected(uid);
  else if (act === 'unequip') advUnequipItem(uid, ix);
  else if (act === 'craft') advCraftSelected();
  else if (act === 'fight') advStartBattle(t.getAttribute('data-side') || 'left');
  else if (act === 'reward') advChooseReward(ix);
  else if (act === 'hex') advChooseHex(t.getAttribute('data-id'));
  else if (act === 'itemChoice') advChooseItem(t.getAttribute('data-id'));
  else if (act === 'continue') advAfterResult();
  adventureRender();
}
function advDragCard(e) {
  if (!e.target || !e.target.closest) return null;
  return e.target.closest('[data-adv="selectCard"]');
}
function advDragSlot(e) {
  if (!e.target || !e.target.closest) return null;
  var card = e.target.closest('[data-adv="selectCard"]');
  if (card) {
    return { el: card, uid: parseInt(card.getAttribute('data-uid'), 10) || 0, zone: '', ix: -1 };
  }
  var slot = e.target.closest('[data-slot-zone]');
  if (slot) {
    return {
      el: slot, uid: 0,
      zone: slot.getAttribute('data-slot-zone'),
      ix: parseInt(slot.getAttribute('data-slot-ix'), 10)
    };
  }
  return null;
}
function adventureDragStart(e) {
  if (!e.target || !e.target.closest) return;
  var t = e.target.closest('[data-adv="invItem"]');
  if (t) {
    var ix = parseInt(t.getAttribute('data-ix'), 10);
    if (isNaN(ix)) return;
    adventure.dragItem = ix;
    t.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(ix)); } catch (err) {}
    }
    return;
  }
  var c = advDragCard(e);
  if (!c) return;
  var uid = parseInt(c.getAttribute('data-uid'), 10) || 0;
  if (!uid) return;
  adventure.dragCardUid = uid;
  c.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'card:' + uid); } catch (err) {}
  }
}
function adventureDragOver(e) {
  if (adventure.dragItem >= 0) {
    var itemCard = advDragCard(e);
    if (!itemCard) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    itemCard.classList.add('drop-hint');
    return;
  }
  if (adventure.dragCardUid < 0) return;
  var target = advDragSlot(e);
  if (!target || target.uid === adventure.dragCardUid) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  target.el.classList.add('drop-hint');
}
function adventureDragLeave(e) {
  var target = advDragSlot(e);
  if (target) target.el.classList.remove('drop-hint');
}
function adventureDrop(e) {
  if (adventure.dragItem >= 0) {
    var card = advDragCard(e);
    if (!card) return;
    e.preventDefault();
    card.classList.remove('drop-hint');
    var cardUid = parseInt(card.getAttribute('data-uid'), 10) || 0;
    var itemIx = adventure.dragItem;
    adventure.dragItem = -1;
    if (itemIx >= 0) advEquipItemTo(cardUid, itemIx);
    return;
  }
  if (adventure.dragCardUid < 0) return;
  var target = advDragSlot(e);
  if (!target) return;
  e.preventDefault();
  target.el.classList.remove('drop-hint');
  var uid = adventure.dragCardUid;
  adventure.dragCardUid = -1;
  if (target.uid) {
    var from = advCardSlot(target.uid);
    if (from) advMoveCardTo(uid, from.zone, from.ix);
  } else if (target.zone) {
    advMoveCardTo(uid, target.zone, target.ix);
  }
}
function adventureDragEnd() {
  adventure.dragItem = -1;
  adventure.dragCardUid = -1;
  var root = document.getElementById('adventure');
  if (!root) return;
  var nodes = root.querySelectorAll('.dragging,.drop-hint');
  for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('dragging', 'drop-hint');
}

/* ---------- 触摸拖拽（手机端原生 HTML5 拖拽不触发，补一套 Pointer 方案） ----------
   鼠标仍走上面的 dragstart/drop；这里只处理 pointerType=touch。
   按下后移动超过阈值才算拖拽，未超过则原样交给 click 做选中。 */
function advPtrClearHint() {
  var root = document.getElementById('adventure');
  if (!root) return;
  var nodes = root.querySelectorAll('.drop-hint');
  for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('drop-hint');
}
function advPtrDown(e) {
  if (e.pointerType === 'mouse') return;
  if (!e.target || !e.target.closest) return;
  var card = e.target.closest('[data-adv="selectCard"]');
  var item = card ? null : e.target.closest('[data-adv="invItem"]');
  if (!card && !item) return;
  var src;
  if (card) {
    src = { kind: 'card', el: card, uid: parseInt(card.getAttribute('data-uid'), 10) || 0 };
  } else {
    src = { kind: 'item', el: item, ix: parseInt(item.getAttribute('data-ix'), 10) || -1 };
  }
  src.x = e.clientX; src.y = e.clientY; src.active = false;
  adventure.touchDrag = src;
}
function advPtrMove(e) {
  var d = adventure.touchDrag;
  if (!d) return;
  if (!d.active) {
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 8) return;
    d.active = true;
    d.el.classList.add('dragging');
  }
  if (e.cancelable) e.preventDefault();
  advPtrClearHint();
  var target = d.kind === 'item' ? advDragCard(e) : advDragSlot(e);
  if (!target) return;
  if (d.kind === 'card' && target.uid === d.uid) return;
  (target.el || target).classList.add('drop-hint');
}
function advPtrUp(e) {
  var d = adventure.touchDrag;
  if (!d) return;
  adventure.touchDrag = null;
  if (!d.active) return;   // 未拖动，按点击处理
  if (d.kind === 'item') {
    var card = advDragCard(e);
    if (card) {
      var cardUid = parseInt(card.getAttribute('data-uid'), 10) || 0;
      if (cardUid && d.ix >= 0) advEquipItemTo(cardUid, d.ix);
    }
  } else {
    var target = advDragSlot(e);
    if (target) {
      if (target.uid) {
        var from = advCardSlot(target.uid);
        if (from) advMoveCardTo(d.uid, from.zone, from.ix);
      } else if (target.zone) {
        advMoveCardTo(d.uid, target.zone, target.ix);
      }
    }
  }
  adventureDragEnd();
}
/* ============================================================
   秘境图鉴（主菜单只读）
   ============================================================ */
var adventureCodex = { open: false, tab: 'envs' };

function advCodexTabs() {
  return [
    { id: 'envs', name: '环境', count: ADV_ENVS.length },
    { id: 'hexes', name: '海克斯', count: ADV_HEXES.length },
    { id: 'items', name: '装备', count: ADV_ITEMS.length },
    { id: 'nodes', name: '节点', count: ADV_CONFIG.maxTrial * ADV_CONFIG.nodesPerTrial },
    { id: 'roles', name: '角色', count: POOL.length }
  ];
}
function advCodexTabsHtml() {
  var tabs = advCodexTabs(), html = '';
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    html += '<button type="button" class="codex-tab' + (adventureCodex.tab === t.id ? ' on' : '') +
      '" data-codex="tab" data-tab="' + t.id + '"><span>' + t.name + '</span><b>' + t.count + '</b></button>';
  }
  return html;
}
function advCodexSection(title, sub, count) {
  return '<section class="codex-section"><h3>' + title + ' <b>' + count + '</b></h3>' +
    (sub ? '<p>' + sub + '</p>' : '') + '</section>';
}
function advCodexEnvHtml() {
  var html = advCodexSection('秘境环境', '开局三选一，本局全程生效。', ADV_ENVS.length);
  html += '<div class="codex-grid">';
  for (var i = 0; i < ADV_ENVS.length; i++) {
    var e = ADV_ENVS[i];
    html += '<article class="codex-card codex-env">' +
      '<div class="codex-card-head"><span class="codex-ico">' + e.icon + '</span><div><b>' + advEsc(e.name) + '</b><small>环境</small></div></div>' +
      '<p>' + advEsc(e.desc) + '</p><span class="codex-note">' + advEsc(e.detail) + '</span></article>';
  }
  return html + '</div>';
}
function advCodexHexHtml() {
  var groups = [
    { q: 'silver', name: '白银', tip: '基础品质，稳定增益。' },
    { q: 'gold', name: '黄金', tip: '更强，但敌难 +2。' },
    { q: 'prismatic', name: '棱彩', tip: '最强，但敌难 +5；彩虹渐变。' }
  ];
  var html = '';
  for (var g = 0; g < groups.length; g++) {
    var gr = groups[g], list = [];
    for (var i = 0; i < ADV_HEXES.length; i++) if (ADV_HEXES[i].q === gr.q) list.push(ADV_HEXES[i]);
    html += advCodexSection(gr.name + '海克斯', gr.tip, list.length);
    html += '<div class="codex-grid">';
    for (var j = 0; j < list.length; j++) {
      var h = list[j];
      html += '<article class="codex-card codex-hex q-' + h.q + '">' +
        '<div class="codex-hex-head"><span class="adv-q adv-q-' + h.q + '">' + gr.name + '</span><span class="codex-ico">' + h.icon + '</span></div>' +
        '<b>' + advEsc(h.name) + '</b><p>' + advEsc(h.text) + '</p></article>';
    }
    html += '</div>';
  }
  return html;
}
function advCodexItemCard(d) {
  var rec = d.basic ? null : advItemRecipe(d.id);
  var recipe = rec
    ? '配方：' + advItemName(rec.a) + ' + ' + advItemName(rec.b) + ' → ' + d.name
    : '基础材料 · 可参与进阶合成';
  return '<article class="codex-card codex-item' + (d.basic ? '' : ' advanced') + '">' +
    '<div class="codex-card-head"><span class="codex-ico">' + d.icon + '</span><div><b>' + advEsc(d.name) + '</b><small>' +
      (d.basic ? '基础装备' : '进阶装备') + '</small></div></div>' +
    '<p>' + advEsc(d.text) + '</p><span class="codex-recipe">' + advEsc(recipe) + '</span></article>';
}
function advCodexItemsHtml() {
  var basics = [], advanced = [];
  for (var i = 0; i < ADV_ITEMS.length; i++) (ADV_ITEMS[i].basic ? basics : advanced).push(ADV_ITEMS[i]);
  var html = advCodexSection('基础装备', '两件基础装备可在装备栏合成进阶装备。', basics.length);
  html += '<div class="codex-grid">';
  for (var b = 0; b < basics.length; b++) html += advCodexItemCard(basics[b]);
  html += '</div>';
  html += advCodexSection('进阶装备', '配方产物；继承两件基础装备的属性方向，并附带专属效果。', advanced.length);
  html += '<div class="codex-grid">';
  for (var a = 0; a < advanced.length; a++) html += advCodexItemCard(advanced[a]);
  return html + '</div>';
}
function advCodexNodeExtra(node) {
  if (node.boss) return '最终关';
  if (node.reward) return '1 血 · 随机 2 项奖励' + (node.hex ? ' · 海克斯' : '');
  if (node.challenge) return '左 1–2★ / 右 3–5★';
  return '普攻小怪' + (node.hex ? ' · 胜利海克斯' : '');
}
function advCodexNodeRow(trial, n) {
  var node = advNode(trial, n);
  var tag = trial + '-' + n;
  var info = node.boss ? '最终关' : ('敌人 ' + node.enemies + ' · ' + advCodexNodeExtra(node));
  var meta = node.boss ? 'BOSS' : ('强度 ×' + advNodePower(trial, n).toFixed(2));
  return '<div class="codex-node ' + node.type + '">' +
    '<span class="codex-node-tag">' + tag + '</span>' +
    '<div class="codex-node-main"><b>' + advEsc(node.name) + '</b><small><span class="codex-node-type">' +
      advNodeTypeName(node.type) + '</span> · ' + info + '</small></div>' +
    '<span class="codex-node-meta">' + meta + '</span></div>';
}
function advCodexBossCardsHtml() {
  var duo = ADV_BOSS.duo, storm = ADV_BOSS.storm;
  var d = duo.units, s = storm.units;
  var duoTotal = d.bossred + d.bosslapis + d.bosscore;
  var stormTotal = s.stormgolem + storm.phase2Hp;
  return '<article class="codex-card codex-boss">' +
    '<div class="codex-card-head"><span class="codex-ico">☠</span><div><b>' + advEsc(advNode(1, 7).name) + '</b><small>第一试炼 · 1-7 · 总生命 ' + duoTotal.toLocaleString() + '</small></div></div>' +
    '<div class="codex-boss-stats">' +
      '<span>红石块<b>' + d.bossred + '</b></span><span>青金石块<b>' + d.bosslapis + '</b></span><span>紫晶核心<b>' + d.bosscore + '</b></span>' +
      '<span>攻击<b>×' + duo.atk.toFixed(2) + '</b></span><span>防御<b>×' + duo.def.toFixed(2) + '</b></span><span>出手<b>' + Math.round(duo.pctOut * 100) + '%</b></span>' +
    '</div><p>锁血 → 停手 → 靠拢 → 核心 1 血登场并涨血；三段不可跳过。</p></article>' +
    '<article class="codex-card codex-boss">' +
    '<div class="codex-card-head"><span class="codex-ico">☠</span><div><b>' + advEsc(advNode(2, 7).name) + '</b><small>第二试炼 · 2-7 · 总生命 ' + stormTotal.toLocaleString() + '</small></div></div>' +
    '<div class="codex-boss-stats">' +
      '<span>一阶段<b>' + s.stormgolem + '</b></span><span>二阶段<b>' + storm.phase2Hp + '</b></span><span>攻击加成<b>×1.30</b></span>' +
      '<span>攻击<b>×' + storm.atk.toFixed(2) + '</b></span><span>防御<b>×' + storm.def.toFixed(2) + '</b></span><span>出手<b>' + Math.round(storm.pctOut * 100) + '%</b></span>' +
    '</div><p>双血条转阶段；第二试炼攻击额外 ×1.30，生命按配置值 50,000。</p></article>';
}
function advCodexNodesHtml() {
  var html = '<div class="codex-trials">';
  for (var t = 1; t <= ADV_CONFIG.maxTrial; t++) {
    html += '<section class="codex-trial"><div class="codex-trial-head"><span class="adv-kicker">TRIAL ' + (t === 1 ? 'I' : 'II') + '</span>' +
      '<b>' + (t === 1 ? '第一试炼 · 翠庭' : '第二试炼 · 雷庭') + '</b></div><div class="codex-node-list">';
    for (var n = 1; n <= ADV_CONFIG.nodesPerTrial; n++) html += advCodexNodeRow(t, n);
    html += '</div></section>';
  }
  html += '</div>';
  html += advCodexSection('BOSS', 'BOSS 不受节点强度曲线影响，走独立的 ADV_BOSS 数值。', 2);
  html += '<div class="codex-grid">' + advCodexBossCardsHtml() + '</div>';
  return html;
}
function advCodexRoleCard(r) {
  var units = [];
  for (var i = 0; i < r.units.length; i++) {
    var t = TYPES[r.units[i]];
    units.push(t
      ? '<span>' + advEsc(t.name) + ' · HP ' + t.maxHp + ' / 攻 ' + t.atk + ' / 防 ' + t.def + '</span>'
      : '<span>' + advEsc(r.units[i]) + '</span>');
  }
  return '<article class="codex-card codex-role"><span class="codex-role-ico">' + advRoleIcon(r.key) + '</span>' +
    '<div class="codex-role-main"><b>' + advEsc(r.name) + '</b><small>' + advEsc(r.role) + '</small>' +
    '<div class="codex-role-units">' + units.join('') + '</div></div></article>';
}
function advCodexRolesHtml() {
  var html = advCodexSection('角色池', '3 主站席 / 6 备战席；3 张同名同星自动升星；红青组合算 1 个整体。', POOL.length);
  html += '<div class="codex-grid">';
  for (var i = 0; i < POOL.length; i++) html += advCodexRoleCard(POOL[i]);
  return html + '</div>';
}
function advCodexBodyHtml() {
  if (adventureCodex.tab === 'hexes') return advCodexHexHtml();
  if (adventureCodex.tab === 'items') return advCodexItemsHtml();
  if (adventureCodex.tab === 'nodes') return advCodexNodesHtml();
  if (adventureCodex.tab === 'roles') return advCodexRolesHtml();
  return advCodexEnvHtml();
}
function advCodexShellHtml() {
  return '<div class="codex-shell">' +
    '<header class="codex-top"><div><span class="adv-kicker">SECRET REALM · CODEX</span><h2>秘境试炼 · 图鉴</h2>' +
      '<p>环境 / 海克斯 / 装备 / 节点 / 角色 · 数据以当前版本为准</p></div>' +
      '<button type="button" class="adv-icon-btn" data-codex="close" title="关闭图鉴">×</button></header>' +
    '<nav class="codex-tabs">' + advCodexTabsHtml() + '</nav>' +
    '<div class="codex-body">' + advCodexBodyHtml() + '</div>' +
    '<footer class="codex-foot"><span>' + advEsc(APP_VERSION) + '</span><span>点击标签切换 · Esc 关闭</span></footer>' +
  '</div>';
}
function adventureCodexRender() {
  var root = document.getElementById('adventureCodex');
  if (!root) return;
  root.innerHTML = advCodexShellHtml();
}
function adventureCodexOpen(tab) {
  if (tab) adventureCodex.tab = tab;
  if (!document.getElementById('adventureCodex')) adventureCodexInit();
  var root = document.getElementById('adventureCodex');
  if (!root) return;
  adventureCodex.open = true;
  root.classList.add('show');
  document.body.classList.add('codex-open');
  adventureCodexRender();
  root.scrollTop = 0;
}
function adventureCodexClose() {
  adventureCodex.open = false;
  var root = document.getElementById('adventureCodex');
  if (root) {
    root.classList.remove('show');
    root.innerHTML = '';
  }
  document.body.classList.remove('codex-open');
}
function adventureCodexClick(e) {
  var root = document.getElementById('adventureCodex');
  if (e.target === root) { adventureCodexClose(); return; }
  var t = e.target.closest ? e.target.closest('[data-codex]') : null;
  if (!t) return;
  var act = t.getAttribute('data-codex');
  if (act === 'close') { adventureCodexClose(); return; }
  if (act === 'tab') {
    adventureCodex.tab = t.getAttribute('data-tab') || 'envs';
    adventureCodexRender();
    var r = document.getElementById('adventureCodex');
    if (r) r.scrollTop = 0;
  }
}
function adventureCodexInit() {
  if (document.getElementById('adventureCodex')) return;
  var root = document.createElement('div');
  root.id = 'adventureCodex';
  root.className = 'codex-overlay';
  document.body.appendChild(root);
  root.addEventListener('click', adventureCodexClick);
  var btn = document.getElementById('homeAdventureCodex');
  if (btn) btn.addEventListener('click', function () { adventureCodexOpen('envs'); });
  document.addEventListener('keydown', function (e) {
    if (adventureCodex.open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      adventureCodexClose();
    }
  }, true);
}

function adventureInit() {
  if (document.getElementById('adventure')) return;
  var root = document.createElement('div');
  root.id = 'adventure';
  root.className = 'adventure-overlay';
  document.body.appendChild(root);
  root.addEventListener('click', adventureClick);
  root.addEventListener('dragstart', adventureDragStart);
  root.addEventListener('dragover', adventureDragOver);
  root.addEventListener('dragleave', adventureDragLeave);
  root.addEventListener('drop', adventureDrop);
  root.addEventListener('dragend', adventureDragEnd);
  root.addEventListener('pointerdown', advPtrDown, { passive: false });
  root.addEventListener('pointermove', advPtrMove, { passive: false });
  root.addEventListener('pointerup', advPtrUp);
  root.addEventListener('pointercancel', advPtrUp);
  var homeBtn = document.getElementById('homeAdventure');
  if (homeBtn) homeBtn.addEventListener('click', adventureOpen);
  adventureHomeSync();
}

if (typeof window !== 'undefined' && window.document) {
  adventureInit();
  adventureCodexInit();
}



