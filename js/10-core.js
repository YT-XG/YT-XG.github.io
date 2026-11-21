/* ============================================================
   10-core.js —— 感知函数、全局状态、单位工厂、出生点、reset()
   ============================================================ */
'use strict';

/* ============================================================
   实时状态：单位可读取的"感知"数据
   ------------------------------------------------------------
   · speedOf(u)  —— 单位此刻的真实速度（含冲刺、减速）
   · sense(u)    —— 最近敌人的距离 / 速度 / 冲刺状态 / 血量比
   只读，不产生任何位移；决策层唯一能做的动作仍是 cast()
   ============================================================ */
function speedOf(u) {
  if (!u || !u.alive) return 0;
  if (u.st.milkT > 0) return 0;   // 野生狗奶引导中：原地站桩（不改朝向）
  if (u.bindT > 0) return 0;      // 被藤蔓捆绑：定身（只停速度，不改朝向）
  var sp;
  if (u.st.rage) {
    if (u.st.rage.phase === 'shake') return 0;   // 原地无敌抖动
    var rage = TYPES[u.key].rage;
    var mul = rage ? rage.speedMul : 1;
    if (rage && rage.speedRampPerSec) {
      // 狂暴开始后速度倍率继续随时间线性增加，封顶避免无限加速
      mul = Math.min(rage.speedMulCap || 99, mul + (t - u.st.rage.since) * rage.speedRampPerSec);
    }
    sp = u.baseSpeed * mul;
  } else {
    sp = u.dashT > 0 ? u.dashSpeed : u.baseSpeed;
  }
  // slowMul 允许不同来源使用不同减速系数（青金石 0.6 / 冰块 0.4），默认取全局值
  return u.slowT > 0 ? sp * (u.slowMul || BALANCE.slowSpeedMul) : sp;
}

function sense(u) {
  var e = nearestEnemy(u);
  if (!e) return { enemy: null, dist: 0, angleDiff: 0, enemySpeed: 0, enemyDashing: false, enemyHpRatio: 0 };
  var dx = e.x - u.x, dy = e.y - u.y;
  var dist = Math.hypot(dx, dy) || 0.001;
  return {
    enemy: e,
    dist: dist,
    angleDiff: Math.abs(angDiff(Math.atan2(dy, dx), u.ang)),
    enemySpeed: speedOf(e),
    enemyDashing: e.dashT > 0,
    enemyHpRatio: e.hp / e.maxHp
  };
}

// 派生伤害：由撞击速度 + 攻击方数值实时算出，公式常量全部来自 BALANCE
function dmgOf(attacker, impact, victim) {
  var base = BALANCE.dmgBase + Math.min(impact, BALANCE.impactCap) * BALANCE.dmgPerImpact;
  var dmg = base * attacker.atk * (attacker.dmgMult || 1);
  var AT = TYPES[attacker.key];
  if (AT.onAttack) dmg = AT.onAttack(attacker, dmg);
  var T = victim && TYPES[victim.key];
  if (T && T.onDamaged) dmg = T.onDamaged(victim, dmg);
  return dmg;
}

/* ============================================================
   状态
   ============================================================ */
var units = [], particles = [], rings = [], floaters = [], bombs = [], arrows = [], icePatches = [];
// 终结技的一次性光束（大狗等）：只做短寿命视觉，伤害在 spawnUltBeam 里立即结算
var ultBeams = [];
// 水桶的水面：{x,y,r:220,age,team,owner,phase}，有独立的引力与浸水计时（见 30-sim 的 updateWaters）
var waters = [];
// 铁砧的落点预警圆：生成时锁定坐标，delay 秒后砸落结算
var anvilMarks = [];
// 草的种子 / 藤蔓 / 待复活队列（草阵亡后在种子上复活）
var seeds = [], vines = [], reviveQueue = [];
// 冰面数量上限：防止长时间对局铺满场地掉帧（存活期 6s × 落点频率，正常远低于此值）
var ICE_PATCH_MAX = 120;
var WATER_MAX = 6;             // 水面上限：CD 8s、水面寿命 8s，单角色最多 1 滩，多角色也不会铺满
var ANVIL_MARK_MAX = 12;       // 落点圆上限：CD 3s、延迟 3s，单角色同时最多 1 个
var SEED_MAX = 6;              // 全场合计种子上限，超出删最早的
var REVIVE_DELAY = 1.0;        // 草在种子上复活的吟唱时间（秒）
var t = 0, roundTime = 180, phase = 'menu', winner = null;
/* 固定步长累加器：由 50-ui 的 frame() 消费；reset() 时清零 */
var simAcc = 0;
/* 竖屏战场镜头：按存活单位重心横向平移，单位是 CSS 像素 */
var portraitCam = 0;
/* 可复现对局：pendingSeed 由每日挑战 / 幽灵码写入；source 只用于赛后文案 */
var pendingSeed = 0, hasPendingSeed = false;
var matchSource = '';       // '' | 'daily' | 'ghost'
var pendingSource = '';

function setNextSeed(seed, source) {
  pendingSeed = (seed >>> 0) || 1;
  hasPendingSeed = true;
  pendingSource = source || '';
}
// 对局时长档位（秒）；默认 3 分钟。切换后由下一次 reset() 生效
var ROUND_OPTIONS = [60, 120, 180, 300];
var roundDuration = 180;
// 决杀阶段：倒计时归零后每秒扣除全体单位 5% 最大生命，直到分出胜负
var suddenDeath = false, suddenStart = 0, deathAcc = 0;
var DEATH_DRAIN = 0.05;
var shake = 0, hitStop = 0;
var paused = false, speedMul = 1;

// 内部阵营仍用 A/B，避免动到物理与判定逻辑
var SIDE_LABEL = { A: '红方', B: '蓝方' };
/* 赛事模式：把「红方 / 蓝方」替换成参赛玩家名（按本局实际进场颜色填）。
   空字符串 = 普通对局，继续用 SIDE_LABEL。 */
var teamNames = { A: '', B: '' };
function teamLabel(team) { return teamNames[team] || SIDE_LABEL[team]; }

/* 阵容与对战模式
   · pick[team] —— 该方的角色 key 数组，长度 = teamSize
   · modeKind  —— 'vs' 同时上场 / 'relay' 轮流上场（上一个倒下，下一个才进场）
   · 接力时 lineupIndex 记录当前上场的角色序号；胜者保持血量，败者换人 */
var pick = { A: ['duo'], B: ['spear'] };
var teamSize = 1;                        // 1 / 2 / 3
var modeKind = 'vs';                     // 'vs' | 'relay'
var lineupIndex = { A: 0, B: 0 };
var relayTimer = { A: 0, B: 0 };
var RELAY_DELAY = 1.0;                   // 接力换人间隔（秒）
var activeTeam = 'A';   // 当前正在选择的一方
var activeSlot = 0;     // 当前正在选择的格子（0..teamSize-1）

/* 征召模式：双方轮流选人，角色全局不可重复。
   draftOrder 记录每一步的 {team, slot}，draftStep 指向当前轮到的位置。
   最多支持 4v4（9 个角色池刚好够 8 个不重复角色）。 */
var draftMode = false;
var draftOrder = [];
var draftStep = 0;

/* 单机赛制：1 = 单局，3 = 三局两胜。
   赛事模式不读这个字段，仍按赛程自己的 BO2/BO3/BO5 走。 */
var seriesBest = 1;
var seriesWins = { A: 0, B: 0 };
var seriesGame = 1;

function sideName(team) {
  // 赛事模式只显示「红方 · 玩家名」，具体角色交给伤害条 / 比分条
  if (teamNames[team]) return SIDE_LABEL[team] + ' · ' + teamNames[team];
  var keys = pick[team] || [];
  var names = [];
  for (var i = 0; i < keys.length; i++) {
    var c = POOL_BY_KEY[keys[i]];
    names.push(c ? c.name : '待选');
  }
  return SIDE_LABEL[team] + ' · ' + names.join(' + ');
}

// 侧边信息条上的短标签：接力显示「当前角色 1/3」，多角色显示「N 个角色」
function teamShort(team) {
  var keys = pick[team] || [];
  if (modeKind === 'relay') {
    var c = POOL_BY_KEY[keys[lineupIndex[team]]];
    return c ? c.short + ' ' + (lineupIndex[team] + 1) + '/' + keys.length : '—';
  }
  if (keys.length === 1) {
    var c1 = POOL_BY_KEY[keys[0]];
    return c1 ? c1.short : '—';
  }
  return keys.length + ' 个角色';
}

// 该方还活着（在场）的单位数
function countAlive(team) {  var n = 0;
  for (var i = 0; i < units.length; i++) if (units[i].alive && units[i].team === team) n++;
  return n;
}

// 接力模式下还有没有下一个角色可以上场
function hasBackup(team) {
  return modeKind === 'relay' && lineupIndex[team] + 1 < (pick[team] || []).length;
}

var el = {
  stage: document.getElementById('stage'),
  hpA: document.getElementById('hpA'),
  hpB: document.getElementById('hpB'),
  nameA: document.getElementById('nameA'),
  nameB: document.getElementById('nameB'),
  timer: document.getElementById('timer'),
  timerLabel: document.getElementById('timerLabel'),
  roundPick: document.getElementById('roundPick'),
  modePick: document.getElementById('modePick'),
  diceA: document.getElementById('diceA'),
  diceB: document.getElementById('diceB'),
  btnRandom: document.getElementById('btnRandom'),
  banner: document.getElementById('banner'),
  home: document.getElementById('home'),
  menu: document.getElementById('menu'),
  menuMode: document.getElementById('menuMode'),
  btnBackHome: document.getElementById('btnBackHome'),
  pool: document.getElementById('pool'),
  pickSummary: document.getElementById('pickSummary'),
  cardA: document.getElementById('cardA'),
  cardB: document.getElementById('cardB'),
  detailA: document.getElementById('detailA'),
  detailB: document.getElementById('detailB'),
  detailBodyA: document.getElementById('detailBodyA'),
  detailBodyB: document.getElementById('detailBodyB'),
  status: document.getElementById('status'),
  btns: document.getElementById('btns'),
  foot: document.querySelector('.foot'),
  btnStart: document.getElementById('btnStart'),
  btnRestart: document.getElementById('btnRestart'),
  btnPause: document.getElementById('btnPause'),
  btnSpeed: document.getElementById('btnSpeed'),
  btnTour: document.getElementById('btnTour'),
  tourPanel: document.getElementById('tourPanel'),
  tourBoard: document.getElementById('tourBoard'),
  tourFxEl: document.getElementById('tourFx'),
  tourSize: document.getElementById('tourSize'),
  btnMenu: document.getElementById('btnMenu'),
  homeCoins: document.getElementById('homeCoins'),
  homeSeason: document.getElementById('homeSeason'),
  homeSeasonBtn: document.getElementById('homeSeasonBtn'),
  homeVer: document.getElementById('homeVer'),
  sizePick: document.getElementById('sizePick'),
  oddsA: document.getElementById('oddsA'),
  oddsB: document.getElementById('oddsB'),
  oddsBarA: document.getElementById('oddsBarA'),
  oddsBarB: document.getElementById('oddsBarB'),
  comboPick: document.getElementById('comboPick'),
  seriesPick: document.getElementById('seriesPick'),
  draftPick: document.getElementById('draftPick'),
  rosterA: document.getElementById('rosterA'),
  rosterB: document.getElementById('rosterB'),
  result: document.getElementById('result'),
  resKicker: document.getElementById('resKicker'),
  resTitle: document.getElementById('resTitle'),
  resSub: document.getElementById('resSub'),
  resStats: document.getElementById('resStats'),
  resAgain: document.getElementById('resAgain'),
  resNext: document.getElementById('resNext'),
  resChange: document.getElementById('resChange'),
  resGhost: document.getElementById('resGhost'),
  resHome: document.getElementById('resHome'),
  ghost: document.getElementById('ghost'),
  ghostTitle: document.getElementById('ghostTitle'),
  ghostSub: document.getElementById('ghostSub'),
  ghostStats: document.getElementById('ghostStats'),
  ghostStart: document.getElementById('ghostStart'),
  ghostClose: document.getElementById('ghostClose'),
  dailyHint: document.getElementById('dailyHint'),
  pause: document.getElementById('pause'),
  pauseResume: document.getElementById('pauseResume'),
  pauseRestart: document.getElementById('pauseRestart'),
  pauseSound: document.getElementById('pauseSound'),
  pauseHome: document.getElementById('pauseHome'),
  btnSound: document.getElementById('btnSound'),
  deskToast: document.getElementById('deskToast'),
  deskNames: document.getElementById('deskNames')
};


/* ============================================================
   生成
   ============================================================ */
function addUnit(key, x, y, team) {
  var d = TYPES[key];
  var u = {
    key: key, name: d.name, team: team,
    r: d.r, maxHp: d.maxHp, hp: d.maxHp,
    baseSpeed: d.baseSpeed, atk: d.atk, dmgMult: 1,
    body: d.body, light: d.light, dark: d.dark, glow: d.glow,
    skillName: d.skill.name,
    ultName: d.ultimate ? d.ultimate.name : '',
    ultCd: d.ultimate ? srand(5.0, 9.0) : 0,   // 终结技初始充能：错开各单位的大招节奏
    ultT: 0, ultCastMax: 0, ultAim: null,
    x: x, y: y, ang: 0, vx: 0, vy: 0,
    alive: true, flash: 0,
    cd: d.skill.passiveOnly ? 0 : srand(0.8, 1.8), hitCd: 0, wallCd: 0,
    dashT: 0, dashSpeed: 0,
    castT: 0, castMax: 0, castAim: null,
    slowT: 0, slowMul: BALANCE.slowSpeedMul, iceTick: 1.0, dealt: 0, taken: 0,
    waterT: 0, waterAcc: 1.0,   // 浸水累计时长 / 满 1 秒结算一次的累加器（水桶的水面）
    bindT: 0, poisonT: 0, poisonAcc: 1.0, poisonSrc: null,
    revives: 0,   // 已经靠种子复活过几次（草最多 2 次）
    st: d.createState ? d.createState() : {},
    trail: [], seed: Math.random() * 1000
  };
  units.push(u);
  return u;
}

// 出生点随机：双方各自半场取点；距任何同队单位至少 r1+r2+gap；朝向指向场地中心 ±faceSpread
var SPAWN = { margin: 70, gap: 46, faceSpread: 1.0, tries: 80 };

function spawnSide(team, r) {
  var A = ARENA, m = SPAWN.margin;
  // 半场范围：A 在左 42% 内，B 在右 42% 内，中间留 16% 缓冲，保证双方不会重叠
  var x0 = team === 'A' ? A.x + m : A.x + A.w * 0.58;
  var x1 = team === 'A' ? A.x + A.w * 0.42 : A.x + A.w - m;
  var y0 = A.y + m, y1 = A.y + A.h - m;
  for (var k = 0; k < SPAWN.tries; k++) {
    var x = srand(x0, x1), y = srand(y0, y1), ok = true;
    for (var i = 0; i < units.length; i++) {
      var o = units[i];
      if (o.team !== team) continue;   // 对手在另一半场，天然不重叠
      if (Math.hypot(o.x - x, o.y - y) < o.r + r + SPAWN.gap) { ok = false; break; }
    }
    if (ok) return { x: x, y: y };
  }
  // 挤不下时（3v3 每方可能有 4~6 个单位）：按已有同队数量在半个场地里排成环，保证不重叠
  var mates = 0;
  for (var m2 = 0; m2 < units.length; m2++) if (units[m2].team === team) mates++;
  var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  var ang = mates * 2.399 + srand(-0.25, 0.25);
  var rad = Math.min(130, 30 * (mates + 1));
  return {
    x: clamp(cx + Math.cos(ang) * rad, x0, x1),
    y: clamp(cy + Math.sin(ang) * rad, y0, y1)
  };
}

/* 让某一方的第 idx 个角色进场（同时上场的角色各自 spawn 一次；接力每次只进一个） */
function deployRole(team, idx) {
  var keys = pick[team] || [];
  if (idx < 0 || idx >= keys.length) return;
  var role = POOL_BY_KEY[keys[idx]];
  if (!role) return;
  for (var i = 0; i < role.units.length; i++) {
    var key = role.units[i];
    var pt = spawnSide(team, TYPES[key].r);
    var u = addUnit(key, pt.x, pt.y, team);
    u.roleIdx = idx;
    faceInward(u);
  }
}

function faceInward(u) {
  var A = ARENA;
  var toCenter = Math.atan2(A.y + A.h / 2 - u.y, A.x + A.w / 2 - u.x);
  u.ang = toCenter + srand(-SPAWN.faceSpread, SPAWN.faceSpread);
}

function reset() {
  // 先决定本局种子，再生成任何单位：出生点 / 初始 CD / 撞墙噪声都吃这串随机数
  if (hasPendingSeed) {
    seedSim(pendingSeed);
    matchSource = pendingSource;
    hasPendingSeed = false;
    pendingSource = '';
    pendingSeed = 0;
  } else {
    seedSim(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0));
    matchSource = '';
  }
  simAcc = 0;
  portraitCam = 0;
  if (typeof hudLast !== 'undefined') hudLast.status = '';   // 新一局强制重写底部状态栏
  if (typeof portraitSize !== 'undefined') portraitSize.cssW = 0;

  units = []; particles = []; rings = []; floaters = []; bombs = []; arrows = []; icePatches = [];
  ultBeams = [];
  waters = [];
  anvilMarks = [];
  seeds = []; vines = []; reviveQueue = [];
  resetArena();   // 场地恢复到初始宽度
  t = 0; roundTime = roundDuration; winner = null;
  suddenDeath = false; deathAcc = 0; suddenStart = 0;
  shake = 0; hitStop = 0;
  lineupIndex = { A: 0, B: 0 };
  relayTimer = { A: 0, B: 0 };

  ['A', 'B'].forEach(function (team) {
    // 同时上场：全部角色一次进场；接力：只进第一个
    var n = modeKind === 'relay' ? 1 : (pick[team] || []).length;
    for (var i = 0; i < n; i++) deployRole(team, i);
  });

  el.stage.classList.remove('sudden');
  el.timerLabel.textContent = 'SEC';
  syncPick();
  el.banner.classList.remove('show');
  if (typeof hideResult === 'function') hideResult();
  if (typeof rebuildRoster === 'function') rebuildRoster();
}


