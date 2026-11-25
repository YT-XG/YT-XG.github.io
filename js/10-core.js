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
/* 大狗终结技引导：原地释放 5 秒激光，期间不被推动 */
function isDogChannel(u) {
  return !!(u && u.st && u.st.ultLaserT > 0);
}

function speedOf(u) {
  if (!u || !u.alive) return 0;
  if (u.st.phaseShift > 0) return 0;       // BOSS 转阶段：无敌停顿
  if (u.st.actionLock > 0) return 0;       // BOSS 终结技引导：原地施法
  if (isDogChannel(u)) return 0;            // 终极咆哮：原地引导，不移动
  if (u.st.mergeFill > 0) return 0;        // 紫晶核心血条充能中：原地涨血
  if (u.st.nukeCast > 0) return 0;         // 终末震荡演出：BOSS 原地停止
  if (bossMergeAct && (bossMergeAct.a === u || bossMergeAct.b === u)) return 0;  // 合体前停顿
  /* 一阶段锁血：某一只被打到 1 HP 后立刻「停手」——原地不动、不攻击（仍在场等另一只）。
     合体条件不变：两只都到 1 HP 才会进入合体流程。 */
  var BT = TYPES[u.key];
  if (BT && BT.bossLock && u.hp <= (BALANCE.boss.lockHp == null ? 1 : BALANCE.boss.lockHp) + 0.05) return 0;
  if (u.st.milkT > 0) return 0;   // 野生狗奶引导中：原地站桩（不改朝向）
  if (isGagaPinned(u)) return 0;  // 咕咕嘎嘎：反震蓄力期间原地站桩（旋转已改为沿原方向移动）
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
  /* 咕咕嘎嘎的技能「咕咕」：旋转期间移速倍率（物品私有状态，其他角色没有这个字段）。
     只放大速度大小，不改 u.ang，方向仍只由撞墙 / 技能改变。 */
  if (u.st && u.st.spinSpeedMul > 0) sp *= u.st.spinSpeedMul;
  // 附魔移速（青金石 4 号附魔）：叠加式乘区，只放大常速与冲刺，不改变直线运动规则
  if (u.st && u.st.speedAdd) sp *= 1 + u.st.speedAdd;
  // 场地食物 / 恶劣环境：只改速度大小，不改 u.ang（与冰面 / 水面同一口径）
  if (u.field) {
    if (u.field.spdT > 0) sp *= u.field.spdMul;
    if (u.field.envSlowT > 0) sp *= u.field.envSlowMul;
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
// ⚠️ 撞击在这里是「技能」而不是通用出伤：只有声明了 impact 的物品才会因碰撞掉血
function dmgOf(attacker, impact, victim) {
  var AT = TYPES[attacker.key];
  if (!AT.impact) return 0;
  var base = BALANCE.dmgBase + Math.min(impact, BALANCE.impactCap) * BALANCE.dmgPerImpact;
  var dmg = base * attacker.atk * (attacker.dmgMult || 1);
  if (AT.onAttack) dmg = AT.onAttack(attacker, dmg);
  var T = victim && TYPES[victim.key];
  if (T && T.onDamaged) dmg = T.onDamaged(victim, dmg);
  return dmg;
}

/* 撞击伤害是否来自「普攻」：普攻冲刺开始时由物品写 st.basicAtk，
   技能 / 终结技会在 cast() / castUltimate() 里清掉该标记。 */
function isBasicHit(u) {
  return !!(u && u.st && u.st.basicAtk && u.dashT > 0);
}

/* 撞击伤害分类：普攻冲刺 → basic；主动技能冲刺 → skill；终结技连撞 → ult。
   没有显式标记的普通撞击按普攻处理，保证所有正伤害都带分类。 */
function attackDamageOpt(u, dmg) {
  if (!(dmg > 0)) return null;
  if (isBasicHit(u)) return { basic: 1 };
  if (u && u.st && u.st.attackKind === 'skill') return { skill: 1 };
  if (u && u.st && u.st.attackKind === 'ult') return { ult: 1 };
  return { basic: 1 };
}

/* ============================================================
   状态
   ============================================================ */
var units = [], particles = [], rings = [], floaters = [], bombs = [], arrows = [], icePatches = [];
// 终结技的一次性光束（大狗等）：只做短寿命视觉，伤害在 spawnUltBeam 里立即结算
var ultBeams = [];
// 水桶的狂浪：{x,y,r:230,age,boom,team,owner,phase}，有独立的引力与溺水叠层计时（见 30-sim 的 updateWaves）
var waters = [];
// 铁砧的落点预警圆：生成时锁定坐标，delay 秒后砸落结算
var anvilMarks = [];
// 草的种子 / 藤蔓 / 待复活队列（草阵亡后在种子上复活）
var seeds = [], vines = [], reviveQueue = [];
// 冰面数量上限：防止长时间对局铺满场地掉帧（存活期 6s × 落点频率，正常远低于此值）
var ICE_PATCH_MAX = 120;
var WATER_MAX = 6;             // 狂浪上限：CD 10s、浪面寿命 7s，单角色最多 1 滩，多角色也不会铺满
var ANVIL_MARK_MAX = 48;       // 落点圆上限：多个铁砧同时放砧雨 / 陨核天裁时也不会挤掉落点
var SEED_MAX = 6;              // 全场合计种子上限，超出删最早的
var REVIVE_DELAY = 1.0;        // 草在种子上复活的吟唱时间（秒）
var t = 0, roundTime = 180, phase = 'menu', winner = null;
/* 固定步长累加器：由 50-ui 的 frame() 消费；reset() 时清零 */
var simAcc = 0;
/* 竖屏战场镜头：按存活单位重心横向平移，单位是 CSS 像素 */
var portraitCam = 0;
/* 终末震荡镜头：{t, per, outro, origin, targets:[{x,y}], dur}
   渲染层只读，不参与模拟；t 由 tick 推进。 */
var bossCine = null;
/* 终末震荡大招演出：{t, dur, x, y, shards:[...]}，纯表现层，fx() 推进寿命 */
var bossNukeFx = null;
/* 终局特写：一方倒下后先慢镜头聚焦，演出结束再弹结算；{t,dur,focus,winner,sub,by} */
var endFx = null;
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
/* 是否为 1v1 单挑局：双方阵容长度都是 1（1v1 之外的任何人数都返回 false） */
function soloMode() {
  /* 秘境闯关不是 1v1：它借用 pick 数组来放「第一波小怪」，不能让
     1v1 的 solo 数值 / 场地收缩规则误作用到秘境，否则 1 只小怪的首波
     会被当成单挑局。普通 1v1 没有 adventureInBattle()，行为不变。 */
  if (typeof adventureInBattle === 'function' && adventureInBattle()) return false;
  var A = pick && pick.A, B = pick && pick.B;
  return !!(A && B && A.length === 1 && B.length === 1);
}
var teamSize = 1;                        // 1 / 2 / 3
var modeKind = 'vs';                     // 'vs' | 'relay'
var lineupIndex = { A: 0, B: 0 };
var relayTimer = { A: 0, B: 0 };
var RELAY_DELAY = 1.0;                   // 接力换人间隔（秒）
var activeTeam = 'A';   // 当前正在选择的一方
var activeSlot = 0;     // 当前正在选择的格子（0..teamSize-1）

/* ============================================================
   BOSS 模式（5v1，2026-11-21 第 98 条）
   ------------------------------------------------------------
   · bossMode 为真时：A 方固定 5 个角色（普通选人页选），B 方只有 1 个 BOSS
   · bossRoleKey 指向 BOSS_ROLES 里的条目；后续"每个物品都能当 BOSS"时，
     只要在这里加一条（units 换成 boss 版 key + merged 合体形态）即可
   · pick.B 仍然写角色 key（['duo']），这样 sideName / 结算文案都能复用
   ============================================================ */
var bossMode = false;
var bossRoleKey = 'duo';
var bossMerged = false;      // 红青是否已经合体（每局 reset 时清空）
var bossPhase = 1;           // 单单位 BOSS 的阶段（雷云巨像：1 = 第一条血 / 2 = 第二条血）
var bossMergeFx = null;      // 合体演出状态 {x,y,ax,ay,bx,by,t,dur}，由 40-render 绘制
var bossMergeAct = null;     // 合体前的「停顿 + 靠拢」阶段 {a,b,ax,ay,bx,by,mx,my,t,dur}
var BOSS_ROLES = {
  duo: {
    key: 'duo',
    name: '红青双子',
    short: '红青双子',
    role: '双生 BOSS · 锁血 → 合体',
    units: ['bossred', 'bosslapis'],
    merged: 'bosscore',
    unitsLabel: '红石 / 青金',
    icon: 'duo',
    cardNote: '2 单位 · 锁 1 血',
    enabled: true,
    detail: {
      meta: '红青各 4550 HP · 锁 1 血 · 免疫控制 → 合体 5000 HP',
      tags: ['锁血', '免疫控制', '合体', '终焉一击'],
      briefs: [
        { title: '阶段 1 · 双生', text: '红石 / 青金各 4550 HP，血量锁 1，谁都打不死' },
        { title: '阶段 2 · 合体', text: '两只同时 1 血 → 紫晶核心 5000 HP，出生即狂暴' }
      ],
      winShort: '击碎紫晶核心即胜利',
      win: '击碎紫晶核心即玩家胜利；玩家 5 个单位全灭则 BOSS 胜利。'
    }
  },
  storm: {
    key: 'storm',
    name: '雷云巨像',
    short: '雷云巨像',
    role: '双阶段 BOSS · 两条血',
    units: ['stormgolem'],
    merged: null,
    unitsLabel: '雷云巨像',
    icon: 'storm',
    cardNote: '两条血 · 免疫控制',
    enabled: true,
    detail: {
      meta: '两条血 5500 / 9000 · 免疫控制 · 阶段切换清负面',
      tags: ['两条血', '阶段变身', '雷暴', '多终结技'],
      briefs: [
        { title: '阶段 1 · 积雨', text: '5500 HP，轮换落雷 / 雷线，强度低、节奏慢' },
        { title: '阶段 2 · 风暴之眼', text: '9000 HP，解锁雷环 / 雷墙 / 磁暴牵引 / 雷牢 / 万雷归一 / 雷神黄昏' }
      ],
      winShort: '击破第二条血即胜利',
      win: '击破第二条血即玩家胜利；玩家 5 个单位全灭则 BOSS 胜利。'
    }
  }
};
function bossConfig() { return BOSS_ROLES[bossRoleKey] || BOSS_ROLES.duo; }

/* 可选 BOSS 列表 + 选择（桌面角色池 / 手机抽屉共用） */
function bossRoleKeys() {
  var out = [];
  for (var k in BOSS_ROLES) if (BOSS_ROLES[k] && BOSS_ROLES[k].enabled) out.push(k);
  return out;
}
function selectBossRole(key) {
  if (!BOSS_ROLES[key] || !BOSS_ROLES[key].enabled) return bossConfig();
  bossRoleKey = key;
  bossMerged = false;
  bossPhase = 1;
  pick.B = [key];
  return bossConfig();
}
// 当前 BOSS 是否是「单单位 + 两条血」形态（雷云巨像），UI / 结算据此切换文案
function bossTwoBar() {
  var B = bossConfig();
  var T = B && B.units && B.units.length === 1 ? TYPES[B.units[0]] : null;
  return !!(T && T.phaseHp);
}

// 该单位是不是 BOSS（免疫控制 / 锁血 / 特殊绘制的统一判定）
function isBossUnit(u) { return !!(u && u.boss); }


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
  if (bossMode && team === 'B') return SIDE_LABEL.B + ' · BOSS ' + bossConfig().name;
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
  if (bossMode && team === 'B') return bossConfig().short;
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
  poolTitle: document.querySelector('.pool-title'),
  poolHint: document.querySelector('.pool-hint'),
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
  btnSound: document.getElementById('btnSound'),
  deskToast: document.getElementById('deskToast'),
  deskNames: document.getElementById('deskNames')
};


/* ============================================================
   生成
   ============================================================ */
function addUnit(key, x, y, team) {
  var d = TYPES[key];
  // 1v1 单挑修正：只放大「缺队友」角色的生命上限（见 BALANCE.solo），2v2 / 3v3 恒为 1
  var hpMul = soloMode() ? (BALANCE.solo.hpMul[key] || 1) : 1;
  var maxHp = d.maxHp * hpMul;
  var u = {
    key: key, name: d.name, team: team,
    r: d.r, maxHp: maxHp, hp: maxHp,
    baseSpeed: d.baseSpeed, atk: d.atk, dmgMult: 1,
    // 新数值体系：防御参与减伤；energyMax>0 的单位用能量条驱动终结技
    def: d.def || 0, energyMax: d.energyMax || 0, energy: 0,
    // 虚弱：受到终末震荡后，普攻 / 技能 / 终结技伤害按 weakMul 结算
    weakT: 0, weakMul: 0.8,
    body: d.body, light: d.light, dark: d.dark, glow: d.glow,
    boss: !!d.boss, bossImmune: !!d.bossImmune,
    skillName: d.skill.name,

    ultName: d.ultimate ? d.ultimate.name : '',
    ultCd: d.ultimate ? (d.energyMax ? 0 : srand(5.0, 9.0)) : 0,   // 能量型终结技从 0 能量开始
    ultT: 0, ultCastMax: 0, ultAim: null,
    x: x, y: y, ang: 0, vx: 0, vy: 0,
    alive: true, flash: 0,
    cd: d.skill.passiveOnly ? 0 : srand(0.8, 1.8), hitCd: 0, wallCd: 0,
    dashT: 0, dashSpeed: 0,
    castT: 0, castMax: 0, castAim: null,
    slowT: 0, slowMul: BALANCE.slowSpeedMul, dealt: 0, taken: 0,
    // 寒冷：层数 / 每秒结算累加器 / 是否站在陷阱上 / 施放者与攻击力快照
    coldStacks: 0, coldAcc: 1.0, coldOn: false, coldSrc: null, coldAtk: 0,
    // 脆弱：受到所有类型伤害的倍率与剩余时间（冰块终结技）
    vulnT: 0, vulnMul: 1.2,
    // 大狗技能加攻：已加到 atk 上的数值 / 剩余时间（到期由 tick 还原）
    atkBuffAdd: 0, atkBuffT: 0,
    // 溺水（水桶狂浪）：层数 / 每秒结算累加器 / 施放者与攻击力快照 / 在浪中的叠层计时 / 离浪衰减计时
    drownStacks: 0, drownAcc: 1.0, drownSrc: null, drownAtk: 0, drownInAcc: 0, drownOutAcc: 0,
    bindT: 0,
    // 中毒：层数 / 每秒结算累加器 / 施放者与生命上限快照（草）
    poisonStacks: 0, poisonAcc: 1.0, poisonSrc: null, poisonMhp: 0,
    dotAmt: 0, dotT: 0,         // DoT 汇总：这一秒累计的持续伤害 / 距离下次飘字的剩余时间
    revives: 0,   // 已经靠种子复活过几次（草最多 2 次）
    /* 场地环境状态（25-field.js）：
       · atk / spd / taken / cd / regen —— 食物增益（倍率或每秒回复比例）
       · envDps / envAcc / envSlow —— 恶劣环境写入的每秒伤害、结算累加器、减速
       · envTakenMul —— 血月等天气的承伤倍率
       · label / labelT —— 最近拾取的食物名，供状态栏短暂显示 */
    field: {
      atkMul: 1, atkT: 0, spdMul: 1, spdT: 0, takenMul: 1, takenT: 0,
      cdMul: 1, cdT: 0, regen: 0, regenT: 0,
      envDps: 0, envAcc: 1.0, envSlowT: 0, envSlowMul: 1, envTakenMul: 1,
      label: '', labelT: 0
    },
    st: d.createState ? d.createState() : {},
    trail: [], seed: Math.random() * 1000
  };
  units.push(u);
  if (typeof adventureOnUnitAdd === 'function') adventureOnUnitAdd(u);
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

/* BOSS 进场：B 方只有 1 个角色，但会展开成 2 个 BOSS 单位。
   固定在右半场中线上、竖直错开，保证两只不重叠且一进场就面向玩家。 */
function deployBoss(team) {
  var B = bossConfig();
  var A = ARENA;
  var cx = A.x + A.w * 0.80;
  var cy = A.y + A.h / 2;
  var off = 62;
  for (var i = 0; i < B.units.length; i++) {
    var key = B.units[i];
    var d = TYPES[key];
    var y = cy + (B.units.length > 1 ? (i === 0 ? -off : off) : 0);
    y = clamp(y, A.y + d.r + 10, A.y + A.h - d.r - 10);
    var x = clamp(cx + srand(-14, 14), A.x + A.w * 0.62, A.x + A.w - d.r - 10);
    var u = addUnit(key, x, y, team);
    u.roleIdx = 0;
    faceInward(u);
  }
}

function reset() {
  // 菜单期的实时预测还在跑的话先收摊：它会占用引擎全局状态
  if (typeof previewStop === 'function') previewStop();
  // reset 期间把 phase 标成 'reset'：syncPick() 里的预测钩子不会在这里抢引擎
  phase = 'reset';
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
  if (typeof gagaDrops !== 'undefined') gagaDrops = [];   // 咕咕嘎嘎的口水（items/gaga.js）
  if (typeof stormBolts !== 'undefined') { stormBolts = []; stormChains = []; stormFlash = 0; }
  resetArena();   // 场地恢复到初始宽度
  if (typeof resetField === 'function') resetField();   // 随机食物 / 危险区域 / 天气计时
  // BOSS 战用自己的时长常量（主菜单的分钟档位不作用于该模式）
  t = 0; roundTime = bossMode ? BALANCE.boss.duration : roundDuration; winner = null;
  bossMerged = false;
  bossPhase = 1;
  bossMergeFx = null;
  bossMergeAct = null;
  bossCine = null;
  bossNukeFx = null;
  endFx = null;
  suddenDeath = false; deathAcc = 0; suddenStart = 0;
  shake = 0; hitStop = 0;
  lineupIndex = { A: 0, B: 0 };
  relayTimer = { A: 0, B: 0 };

  ['A', 'B'].forEach(function (team) {
    // BOSS 模式：B 方整队就是一个 BOSS 角色，走专用进场
    if (bossMode && team === 'B') { deployBoss(team); return; }
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
  // 新一局必须重画一帧（菜单期 render 不再逐帧执行）
  if (typeof markRenderDirty === 'function') markRenderDirty();
}


