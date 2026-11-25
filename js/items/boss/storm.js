/* ============================================================
   雷云巨像 · 风暴之眼（js/items/boss/storm.js）
   ------------------------------------------------------------
   单单位 BOSS，两条血：第一条 5500（积雨，低强度）→ 第二条 9000（风暴之眼）。
   一阶段轮换「落雷 / 雷线」；二阶段再解锁雷环、连锁雷、雷暴领域、雷墙与磁暴牵引。
   战斗节奏刻意放慢：普攻 5.0s / 3.6s，技能之间留 1~1.2s 收招，不追着人跑。

   技能（8 个）：
     1. 落雷          脚下预警 → 雷击（一阶段 2 人 / 二阶段 3 人）
     2. 雷线          向最近敌人方向预警一条贯穿雷道
     3. 雷环          二阶段：内圈安全、外圈安全，只打中间环带
     4. 追踪雷云      召唤缓慢漂移的雷云，云下周期落雷
     5. 雷暴领域      二阶段：以自身为圆心，留 2 个安全缺口
     6. 雷墙          二阶段：横扫全场的雷暴幕墙，留 2 个缺口
     7. 磁暴牵引      二阶段：把挑战者拉向漩涡中心，再引爆雷环
     8. 连锁雷        二阶段：主目标落雷后，向附近 2 人跳跃
   终结技（4 个）：
     1. 风暴降临      第一条血击破时全屏雷击，随后进入二阶段
     2. 雷牢          二阶段 70% 血：四角雷柱围成收缩正方形
     3. 万雷归一      二阶段 40% 血：6 秒预警，环形雷点依次落下
     4. 雷神黄昏      二阶段 10% 血：5 次全屏脉冲，安全区逐次收缩

   特效接入点统一用 [FX] 标注；雷柱 / 电弧 / 全屏白闪复用 stormBolts / stormChains / stormFlash。
   ============================================================ */
'use strict';

var STORM = {
  phaseHp: [5500, 9000],
  speedAdd2: 0.5,          // baseSpeed 140 → 210
  p1: { atkCd: 5.0, marks: 2, warn: 1.10, r: 90, atkMul: 1.70 },
  p2: { atkCd: 3.6, marks: 3, warn: 0.95, r: 95, atkMul: 3.00,
        chain: 2, chainRange: 280, chainAtkMul: 0.56 },
  line: { len: 880, width: 108, warn: 1.15, cdMul: 0.95, mul: 1.08 },
  ring: { inner: 120, outer: 340, warn: 1.25, cdMul: 1.05, mul: 1.00 },
  cloud: {
    cd1: 10.0, cd2: 9.0, life: 7.0, r: 170, speed: 55,
    pulse1: 2.2, pulse2: 1.8, atkMul1: 0.68, atkMul2: 1.02,
    slowMul: 0.82, slowT: 0.4
  },
  domain: {
    cd: 9.0, life: 5.0, r: 300, pulse: 1.8, atkMul: 1.02,
    gap: 0.55, slowMul: 0.72, slowT: 0.5
  },
  wall: {
    cd: 13.0, warn: 1.2, life: 4.4, speed: 285, width: 112,
    gapHalf: 84, atkMul: 0.85, hitCd: 0.65
  },
  pull: { cd: 15.0, time: 1.6, force: 105, atkMul: 0.94 },
  cage: { warn: 5.0, time: 5.0, half0: 250, half1: 110, tick: 0.8, atkMul: 1.40 },
  ult1: { warn: 6.0, count: 8, ringR: 220, markR: 110, atkMul: 32.0, resolve: 0.9, slowT: 1.0 },
  ult2: { warn: 4.0, pulses: 5, interval: 0.5, atkMul: 13.3, safeR0: 220, safeR1: 70, slowT: 0.8 },
  trans: { time: 3.0, pulseAt: 1.2, atkMul: 8.5 },
  ultCycle: { gap: 10.0 }
};

var STORM_SKILLS = [
  { name: '落雷', text: '在 2 名挑战者脚下标雷，1.1 秒后落下；二阶段改为 3 人并附加连锁雷' },
  { name: '雷线', text: '一阶段开始轮换：向最近敌人方向预警一条 880px 雷线，1.15 秒后整条贯穿' },
  { name: '雷环', text: '二阶段轮换：以自身为圆心展开 120–340 的雷环，内圈与外圈之间全部命中' },
  { name: '追踪雷云', text: '召唤一朵缓慢漂移的雷云，云下每 2.2 秒落雷并减速；二阶段提速到 1.8 秒' },
  { name: '雷暴领域', text: '二阶段每 9 秒展开半径 300 的雷暴领域，每 1.8 秒落雷，边缘留 2 个安全缺口' },
  { name: '雷墙', text: '二阶段每 13 秒推出一道横扫全场的雷墙，墙上留 2 个缺口；碰墙持续掉血' },
  { name: '磁暴牵引', text: '二阶段每 15 秒把挑战者缓慢拉向雷暴中心，牵引结束后引爆一圈雷环' },
  { name: '连锁雷', text: '二阶段普攻命中后，闪电跳向附近 2 名挑战者，造成 56% 攻击力' }
];

var STORM_ULTS = [
  { name: '风暴降临', text: '第一条血击破时全屏雷击（850% 攻击力），随后进入第二条血' },
  { name: '雷牢', text: '二阶段 70% 血触发：四角雷柱连成正方形牢笼，安全区从 250 收缩到 110，牢外每 0.8 秒扣 140% 攻击力' },
  { name: '万雷归一', text: '二阶段 40% 血触发：蓄力 6 秒，环形雷点依次落下，每点 3200% 攻击力，留 2 个安全区' },
  { name: '雷神黄昏', text: '二阶段 10% 血触发：蓄力 4 秒，5 次全屏脉冲，每次 1330% 攻击力，安全区逐次收缩；结束后自身虚弱 6 秒，并进入终结技循环（每招结束等待 10 秒）' }
];

/* ============================================================
   华丽演出专用特效层（纯表现，不参与伤害判定）
   ------------------------------------------------------------
   stormBolts  : 落地雷柱（贯穿光柱 + 地面星芒电弧）
   stormChains : 两点之间的折线电弧（连锁雷 / 导雷线）
   stormFlash  : 全屏白闪剩余秒数
   生命周期由 30-sim.js 推进循环递减，重置时随战场一起清空。
   ============================================================ */
var stormBolts = [];
var stormChains = [];
var stormFlash = 0;
var STORM_FX_MAX = 140;

function stormPushBolt(x, y, r, big) {
  stormBolts.push({ x: x, y: y, r: r, life: big ? 0.5 : 0.36, max: big ? 0.5 : 0.36, seed: rand(0, 1000), big: !!big });
  if (stormBolts.length > STORM_FX_MAX) stormBolts.splice(0, stormBolts.length - STORM_FX_MAX);
}
function stormPushChain(x1, y1, x2, y2, color, wide) {
  stormChains.push({ x1: x1, y1: y1, x2: x2, y2: y2, life: 0.28, max: 0.28, seed: rand(0, 1000), wide: !!wide, color: color || '#dbe8ff' });
  if (stormChains.length > STORM_FX_MAX) stormChains.splice(0, stormChains.length - STORM_FX_MAX);
}
function stormFlashSet(sec) { stormFlash = Math.max(stormFlash, sec || 0.3); }

/* 两点之间的折线电弧采样点：偏移由 seed 确定性派生，同一道闪电形状稳定、不逐帧乱跳 */
function stormBoltPoints(x1, y1, x2, y2, seed, segs) {
  var pts = [{ x: x1, y: y1 }];
  var dx = x2 - x1, dy = y2 - y1;
  var len = Math.hypot(dx, dy) || 1;
  var nx = -dy / len, ny = dx / len;
  var offMax = Math.min(22, len * 0.18);
  for (var i = 1; i < segs; i++) {
    var p = i / segs;
    var off = Math.sin(seed * 12.9898 + i * 78.233) * offMax;
    pts.push({ x: x1 + dx * p + nx * off, y: y1 + dy * p + ny * off });
  }
  pts.push({ x: x2, y: y2 });
  return pts;
}

TYPES.stormgolem = {
  key: 'stormgolem', name: '雷云巨像', role: 'BOSS / 双阶段 · 雷暴',
  boss: true, bossImmune: true, calibrated: true,
  r: 46, maxHp: STORM.phaseHp[0], baseSpeed: 140, atk: 110, def: 110,
  impact: false,
  phaseHp: STORM.phaseHp,
  body: '#3c5a8f', light: '#dbe8ff', dark: '#16233d', glow: '#8fb8ff',
  basic: { cd: 5.0, marks: 2, warn: 1.10, r: 90, atkMul: 1.70 },
  skills: STORM_SKILLS,
  skill: {
    name: '追踪雷云', cd: STORM.cloud.cd1, noTurn: true, windup: 0.2,
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '召唤一朵缓慢漂移的雷云，云下每 2.2 秒落雷并减速'
  },
  ultimates: STORM_ULTS,
  ultimate: { name: '万雷归一', text: STORM_ULTS[2].text },
  passive: {
    name: '静电蓄能 / 风眼',
    text: '一阶段落雷攒静电（满 5 层追加一道雷）；二阶段抱团减伤 20%、散开提速 15%，并轮换雷线 / 雷环；雷神黄昏后按雷牢、万雷归一、雷神黄昏循环，每招结束等待 10 秒'
  },
  ultBlocked: function () { return true; },   // 四个终结技都由血量阈值触发

  createState: function () {
    return {
      phase: 1,
      phaseShift: 0,
      actionLock: 0,
      bars: 2,
      atkCd: 3.0,
      recover: 0,
      charge: 0,
      pattern: 0,
      marks: [],
      lines: [],
      rings: [],
      cloud: null,
      domain: null,
      domainCd: 3.0,
      wall: null,
      wallCd: 6.0,
      pull: null,
      pullCd: 9.0,
      cage: null,
      cageDone: false,
      ult1: null,
      ult2: null,
      ult1Done: false,
      ult2Done: false,
      ultCycle: false,
      ultCycleCd: 0,
      ultCycleIx: 0,
      transPulsed: false,
      speedAdd: 0
    };
  },

  /* 第一条血被打空：不走死亡，锁 1 血进入「风暴降临」转阶段演出 */
  onLethal: function (u) {
    var st = u.st;
    if (st.phase !== 1) return false;
    u.hp = 1;
    st.phaseShift = STORM.trans.time;
    st.actionLock = 1;
    st.transPulsed = false;
    st.marks = [];
    st.lines = [];
    st.rings = [];
    st.wall = null;
    st.pull = null;
    st.cloud = null;
    st.domain = null;
    st.ult1 = null;
    st.ult2 = null;
    if (typeof bossCry === 'function') bossCry('风暴降临', '第一条血击破 · 雷云过载');
    if (typeof sfxPlay === 'function') sfxPlay('rage');
    /* [FX] 转阶段起手：BOSS 外圈雷环炸开 + 全屏白闪 + 慢动作 */
    stormFlashSet(0.4);
    ring(u.x, u.y, u.r, u.r + 180, 0.8, '#dbe8ff');
    ring(u.x, u.y, u.r, u.r + 120, 0.55, '#ffffff');
    ring(u.x, u.y, u.r, u.r + 260, 1.0, '#8fb8ff');
    burst(u.x, u.y, 42, '#eaf4ff', 420);
    burst(u.x, u.y, 22, '#8fb8ff', 300);
    shake = Math.max(shake, 20);
    hitStop = Math.max(hitStop, 0.07);
    return true;
  },

  onCast: function (u) {
    stormSpawnCloud(u);
    // 技能 CD 按阶段覆盖：cast() 先把 u.cd 写成 TYPES 的静态值
    u.cd = u.st.phase === 2 ? STORM.cloud.cd2 : STORM.cloud.cd1;
    u.st.recover = Math.max(u.st.recover || 0, 0.8);
  },

  onTick: function (u, dt) {
    var st = u.st;

    /* ---------- 转阶段：无敌、停手、全屏雷击，然后换第二条血 ---------- */
    if (st.phaseShift > 0) {
      st.phaseShift = Math.max(0, st.phaseShift - dt);
      if (!st.transPulsed && st.phaseShift <= STORM.trans.time - STORM.trans.pulseAt) {
        st.transPulsed = true;
        stormArenaPulse(u, STORM.trans.atkMul, '风暴降临');
      }
      if (st.phaseShift <= 0) stormFinishPhase2(u);
      return;
    }

    stormUpdateMarks(u, dt);
    stormUpdateLines(u, dt);
    stormUpdateRings(u, dt);
    stormUpdateWall(u, dt);
    stormUpdatePull(u, dt);

    /* ---------- 终结技期间：只推进演出与落点，不普攻 ---------- */
    if (st.cage) { stormUpdateCage(u, dt); return; }
    if (st.ult1) { stormUpdateUlt1(u, dt); return; }
    if (st.ult2) { stormUpdateUlt2(u, dt); return; }

    /* ---------- 终结技循环：上一招完全结束后归零，再等满 10 秒放下一招 ---------- */
    if (st.phase === 2 && st.ultCycle) {
      if (st.ultCycleCd > 0) st.ultCycleCd = Math.max(0, st.ultCycleCd - dt);
      if (st.ultCycleCd <= 0) {
        var cyc = st.ultCycleIx % 3;
        st.ultCycleIx = (cyc + 1) % 3;
        st.ultCycleCd = STORM.ultCycle.gap;
        if (cyc === 0) { stormStartCage(u); return; }
        if (cyc === 1) { stormStartUlt1(u); return; }
        stormStartUlt2(u);
        return;
      }
    }

    stormUpdateCloud(u, dt);
    stormUpdateDomain(u, dt);

    /* ---------- 血量阈值触发终结技：雷牢 70% → 万雷归一 40% → 雷神黄昏 10% ---------- */
    if (st.phase === 2 && !st.cageDone && u.hp <= u.maxHp * 0.70) {
      stormStartCage(u);
      return;
    }
    if (st.phase === 2 && !st.ult1Done && u.hp <= u.maxHp * 0.40) {
      stormStartUlt1(u);
      return;
    }
    if (st.phase === 2 && !st.ult2Done && u.hp <= u.maxHp * 0.10) {
      stormStartUlt2(u);
      return;
    }

    /* ---------- 收招停顿：让每一次出手之间有可读的呼吸窗口 ---------- */
    if (st.recover > 0) {
      st.recover = Math.max(0, st.recover - dt);
      return;
    }

    /* ---------- 普攻轮换：一阶段 落雷 / 雷线；二阶段 落雷 / 雷线 / 雷环 ---------- */
    st.atkCd -= dt;
    if (st.atkCd <= 0) stormCastBasic(u);

    /* ---------- 二阶段：雷暴领域 / 雷墙 / 磁暴牵引 ---------- */
    if (st.phase === 2) {
      st.domainCd -= dt;
      if (st.domainCd <= 0) {
        st.domainCd = STORM.domain.cd;
        stormCastDomain(u);
      }
      st.wallCd -= dt;
      if (st.wallCd <= 0) {
        st.wallCd = STORM.wall.cd;
        stormStartWall(u);
      }
      st.pullCd -= dt;
      if (st.pullCd <= 0) {
        st.pullCd = STORM.pull.cd;
        stormStartPull(u);
      }
    }

    /* ---------- 风眼：抱团减伤 / 散开提速（只改承伤倍率与 speedAdd） ---------- */
    stormUpdateEye(u);
  },

  draw: function (u) {
    stormDrawBody(u);
    stormDrawTelegraphs(u);
    stormDrawHazards(u);
  }
};

/* ============================================================
   阶段切换
   ============================================================ */
function stormFinishPhase2(u) {
  var st = u.st;
  st.phase = 2;
  st.phaseShift = 0;
  st.actionLock = 0;
  st.speedAdd = STORM.speedAdd2;
  st.atkCd = 2.6;
  st.domainCd = 3.0;
  st.wallCd = 6.0;
  st.pullCd = 9.0;
  st.recover = 1.0;
  st.charge = 0;
  st.pattern = 0;
  st.lines = [];
  st.rings = [];
  st.wall = null;
  st.pull = null;
  st.cage = null;
  st.cageDone = false;
  st.ult1Done = false;
  st.ult2Done = false;
  st.ultCycle = false;
  st.ultCycleCd = 0;
  st.ultCycleIx = 0;

  /* 秘境有独立的二阶段生命（ADV_BOSS.storm.phase2Hp，按敌难 / 试炼倍率放大）；
     普通 BOSS 战没有 advBoss，仍走 TYPES/BALANCE 的 9000。 */
  var nextHp = (u.st.advBoss && u.st.advBoss.phase2Hp)
    ? u.st.advBoss.phase2Hp
    : STORM.phaseHp[1] * (u.st.advScale ? u.st.advScale.hp : 1);
  u.maxHp = Math.max(1, Math.round(nextHp));
  u.hp = u.maxHp;
  bossPhase = 2;

  // 阶段切换清掉所有负面：DoT / 减速 / 定身 / 易伤 / 虚弱
  u.slowT = 0; u.slowMul = BALANCE.slowSpeedMul;
  u.bindT = 0; u.vulnT = 0; u.weakT = 0;
  u.coldStacks = 0; u.drownStacks = 0; u.burnStacks = 0; u.poisonStacks = 0;
  u.dotAmt = 0; u.dotT = 0;

  if (typeof bossCry === 'function') bossCry('风暴之眼 · 睁开', '第二条血 · ' + Math.round(u.maxHp) + ' HP · 雷暴降临');
  if (typeof sfxPlay === 'function') sfxPlay('rage');
  /* [FX] 换血演出：血条从 0 充到 9000；BOSS 上方雷云炸开、地面雷纹扩散 */
  stormFlashSet(0.35);
  ring(u.x, u.y, 10, 340, 0.9, '#dbe8ff');
  ring(u.x, u.y, 8, 210, 0.6, '#ffffff');
  ring(u.x, u.y, 6, 420, 1.1, '#7ff0ff');
  burst(u.x, u.y, 36, '#cfe4ff', 460);
  burst(u.x, u.y, 18, '#7ff0ff', 320);
  shake = Math.max(shake, 16);
}

/* ============================================================
   普攻落雷
   ============================================================ */
function stormCastMarks(u) {
  var st = u.st;
  var P = st.phase === 2 ? STORM.p2 : STORM.p1;
  var targets = stormPickTargets(u, P.marks);
  if (!targets.length) { st.atkCd = 0.6; return; }

  // 一阶段静电满层：本次追加一道雷，然后清零
  var overload = st.phase === 1 && st.charge >= 5;
  if (overload) st.charge = 0;

  for (var i = 0; i < targets.length; i++) {
    stormAddMark(u, targets[i].x, targets[i].y, {
      warn: P.warn, r: P.r, atkMul: P.atkMul, basic: true,
      chain: st.phase === 2, source: 'bolt'
    });
  }
  if (overload) {
    var e = nearestEnemy(u);
    if (e) {
      stormAddMark(u, e.x, e.y, {
        warn: P.warn, r: P.r, atkMul: P.atkMul, basic: true,
        chain: false, source: 'overload'
      });
      floater(e.x, e.y - e.r - 26, '静电过载 · 追加落雷', '#dbe8ff', 14);
    }
  }

  st.atkCd = P.atkCd;
  st.recover = 1.2;
  /* [FX] 施法起手：BOSS 头顶电荷聚合 + 目标脚下预警圈 */
  ring(u.x, u.y, u.r, u.r + 54, 0.4, '#8fb8ff');
  floater(u.x, u.y - u.r - 24, '落雷 · ' + (targets.length + (overload ? 1 : 0)) + ' 道', '#dbe8ff', 13);
}

function stormAddMark(u, x, y, cfg) {
  var r = cfg.r == null ? 90 : cfg.r;
  var warn = cfg.warn == null ? 1.0 : cfg.warn;
  u.st.marks.push({
    x: x, y: y, r: r,
    t: warn, max: warn,
    pct: cfg.pct || 0,
    atkMul: cfg.atkMul || 0,
    basic: !!cfg.basic,
    chain: !!cfg.chain,
    ult: !!cfg.ult,
    slowT: cfg.slowT || 0,
    source: cfg.source || ''
  });
  /* [FX] 预警生成：地面出现蓝白脉冲圈 + 十字准星（见 stormDrawTelegraphs） */
}

function stormUpdateMarks(u, dt) {
  var marks = u.st.marks;
  for (var i = marks.length - 1; i >= 0; i--) {
    var m = marks[i];
    m.t -= dt;
    if (m.t > 0) continue;
    marks.splice(i, 1);
    stormResolveMark(u, m);
  }
}

function stormResolveMark(u, m) {
  var P = STORM.p2;
  var hits = [];
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    var d = Math.hypot(v.x - m.x, v.y - m.y);
    if (d > m.r + v.r * 0.5) continue;
    hits.push({ v: v, d: d });
  }
  hits.sort(function (a, b) { return a.d - b.d; });

  for (var h = 0; h < hits.length; h++) {
    var t = hits[h].v;
    var dmg = m.pct > 0 ? t.maxHp * m.pct : u.atk * m.atkMul;
    var markOpt = m.basic ? { basic: 1 } : (m.ult ? { ult: 1 } : { skill: 1 });
    if (m.pct > 0) markOpt.pct = 1;
    hurt(t, dmg, u, markOpt);
    if (m.slowT > 0 && !t.bossImmune) {
      t.slowT = Math.max(t.slowT || 0, m.slowT);
      t.slowMul = Math.min(t.slowMul || 1, 0.72);
    }
    floater(t.x, t.y - t.r - 18, '-' + Math.round(dmg), '#dbe8ff', m.ult ? 24 : 18);
    /* [FX] 命中瞬间：贯穿雷柱 + 地面星芒 + 电弧粒子 */
    stormPushBolt(t.x, t.y, m.r, m.ult);
    ring(t.x, t.y, t.r, t.r + 46, 0.35, '#eaf4ff');
    burst(t.x, t.y, m.ult ? 18 : 10, '#dbe8ff', 300);
    burst(t.x, t.y, 8, '#7ff0ff', 220);
  }

  /* 连锁雷：主目标命中后跳向附近 2 人（只跳一次，避免指数扩散） */
  if (m.chain && hits.length) {
    var first = hits[0].v;
    var jumped = 0;
    for (var j = 0; j < units.length && jumped < P.chain; j++) {
      var w = units[j];
      if (!w.alive || w.team === u.team || w === first) continue;
      if (Math.hypot(w.x - first.x, w.y - first.y) > P.chainRange) continue;
      var cdmg = u.atk * P.chainAtkMul;
      hurt(w, cdmg, u, { skill: 1 });
      floater(w.x, w.y - w.r - 20, '连锁 -' + Math.round(cdmg), '#b9d4ff', 15);
      /* [FX] 连锁：从主目标拉一条折线电弧到跳跃目标 */
      stormPushChain(first.x, first.y, w.x, w.y, '#b9d4ff', false);
      ring(w.x, w.y, w.r, w.r + 30, 0.28, '#b9d4ff');
      burst(w.x, w.y, 8, '#b9d4ff', 230);
      jumped++;
    }
  }

  /* 落雷命中：静电 +1（一阶段） */
  if (m.basic && u.st.phase === 1) {
    u.st.charge = Math.min(5, (u.st.charge || 0) + 1);
  }

  /* [FX] 落雷整体表现：华丽雷柱由 stormBolts 层绘制（见 drawStormFx） */
  stormPushBolt(m.x, m.y, m.r, m.ult);
  ring(m.x, m.y, 8, m.r, 0.32, '#dbe8ff');
  shake = Math.min(9, shake + (m.ult ? 3.2 : 1.6));
  if (typeof sfxPlay === 'function') sfxPlay('bomb');
}

/* ============================================================
   普攻轮换：落雷 / 雷线 / 雷环
   ============================================================ */
function stormCastBasic(u) {
  var st = u.st;
  if (st.phase === 1) {
    if (st.pattern === 0) stormCastMarks(u);
    else stormCastLine(u);
    st.pattern = (st.pattern + 1) % 2;
  } else {
    if (st.pattern === 0) stormCastMarks(u);
    else if (st.pattern === 1) stormCastLine(u);
    else stormCastRing(u);
    st.pattern = (st.pattern + 1) % 3;
  }
}

/* ---------- 雷线：向最近敌人方向预警一条贯穿雷道 ---------- */
function stormCastLine(u) {
  var st = u.st;
  var P = st.phase === 2 ? STORM.p2 : STORM.p1;
  var e = nearestEnemy(u);
  if (!e) { st.atkCd = 0.6; return; }
  var ang = Math.atan2(e.y - u.y, e.x - u.x);
  var len = STORM.line.len;
  st.lines.push({
    x1: u.x, y1: u.y,
    x2: u.x + Math.cos(ang) * len,
    y2: u.y + Math.sin(ang) * len,
    w: STORM.line.width,
    t: STORM.line.warn, max: STORM.line.warn,
    atkMul: P.atkMul * STORM.line.mul,
    basic: true
  });
  st.atkCd = P.atkCd * STORM.line.cdMul;
  st.recover = 1.0;
  /* [FX] 雷线起手：BOSS 雷核收缩，一条细蓝线锁定目标并逐渐变粗 */
  ring(u.x, u.y, u.r, u.r + 46, 0.35, '#8fb8ff');
  floater(u.x, u.y - u.r - 24, '雷线', '#dbe8ff', 13);
  if (typeof sfxPlay === 'function') sfxPlay('cast');
}

function stormUpdateLines(u, dt) {
  var lines = u.st.lines;
  for (var i = lines.length - 1; i >= 0; i--) {
    var l = lines[i];
    l.t -= dt;
    if (l.t > 0) continue;
    lines.splice(i, 1);
    stormResolveLine(u, l);
  }
}

function stormResolveLine(u, l) {
  var hit = 0;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (segDist(v.x, v.y, l.x1, l.y1, l.x2, l.y2) > l.w * 0.5 + v.r * 0.6) continue;
    var dmg = u.atk * l.atkMul;
    hurt(v, dmg, u, l.basic ? { basic: 1 } : { skill: 1 });
    v.slowT = Math.max(v.slowT || 0, 0.35);
    v.slowMul = Math.min(v.slowMul || 1, 0.85);
    floater(v.x, v.y - v.r - 18, '-' + Math.round(dmg), '#dbe8ff', 18);
    /* [FX] 雷线命中：路径上每名挑战者脚下各落一根小雷柱 */
    stormPushBolt(v.x, v.y, v.r + 16, false);
    ring(v.x, v.y, v.r, v.r + 36, 0.3, '#dbe8ff');
    burst(v.x, v.y, 8, '#b9d4ff', 240);
    hit++;
  }
  /* [FX] 雷线释放：整条雷道从 BOSS 向末端扫过，末端炸出圆形雷环 */
  stormPushChain(l.x1, l.y1, l.x2, l.y2, '#dbe8ff', true);
  stormPushBolt(l.x2, l.y2, l.w * 0.8, false);
  ring(l.x2, l.y2, 8, l.w, 0.4, '#8fb8ff');
  ring(l.x1, l.y1, 8, l.w * 0.6, 0.3, '#7ff0ff');
  shake = Math.max(shake, hit ? 5 : 3);
  if (typeof sfxPlay === 'function') sfxPlay('bomb');
}

/* ---------- 雷环：内圈安全、外圈之外安全的环形打击 ---------- */
function stormCastRing(u) {
  var st = u.st;
  var P = STORM.p2;
  st.rings.push({
    x: u.x, y: u.y,
    inner: STORM.ring.inner,
    outer: STORM.ring.outer,
    t: STORM.ring.warn, max: STORM.ring.warn,
    atkMul: P.atkMul * STORM.ring.mul,
    basic: true
  });
  st.atkCd = P.atkCd * STORM.ring.cdMul;
  st.recover = 1.1;
  /* [FX] 雷环起手：内外两道环同时点亮，中间环带充能 */
  ring(u.x, u.y, STORM.ring.inner, STORM.ring.outer, 0.6, '#8fb8ff');
  ring(u.x, u.y, u.r, STORM.ring.inner, 0.45, '#7ff0ff');
  floater(u.x, u.y - u.r - 24, '雷环', '#dbe8ff', 13);
  if (typeof sfxPlay === 'function') sfxPlay('cast');
}

function stormUpdateRings(u, dt) {
  var rings = u.st.rings;
  for (var i = rings.length - 1; i >= 0; i--) {
    var r = rings[i];
    r.t -= dt;
    if (r.t > 0) continue;
    rings.splice(i, 1);
    stormResolveRing(u, r);
  }
}

function stormResolveRing(u, r) {
  var hit = 0;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    var d = Math.hypot(v.x - r.x, v.y - r.y);
    if (d < r.inner - v.r * 0.5 || d > r.outer + v.r * 0.5) continue;
    var dmg = u.atk * r.atkMul;
    hurt(v, dmg, u, r.basic ? { basic: 1 } : { skill: 1 });
    v.slowT = Math.max(v.slowT || 0, 0.4);
    v.slowMul = Math.min(v.slowMul || 1, 0.82);
    floater(v.x, v.y - v.r - 18, '-' + Math.round(dmg), '#dbe8ff', 18);
    /* [FX] 雷环命中：环带内的单位各自被垂直雷柱打中 */
    stormPushBolt(v.x, v.y, v.r + 18, false);
    ring(v.x, v.y, v.r, v.r + 40, 0.32, '#dbe8ff');
    burst(v.x, v.y, 9, '#b9d4ff', 250);
    hit++;
  }
  /* [FX] 雷环释放：中间环带从内向外翻滚扩散 */
  ring(r.x, r.y, r.inner, r.outer, 0.42, '#dbe8ff');
  ring(r.x, r.y, r.inner * 0.8, r.outer * 0.9, 0.3, '#7ff0ff');
  shake = Math.max(shake, hit ? 4 : 2);
  if (typeof sfxPlay === 'function') sfxPlay('bomb');
}

/* ============================================================
   技能 2：追踪雷云
   ============================================================ */
function stormSpawnCloud(u) {
  var e = nearestEnemy(u);
  if (!e) return;
  var st = u.st;
  st.cloud = {
    x: e.x + srand(-28, 28),
    y: e.y + srand(-28, 28),
    life: STORM.cloud.life,
    pulseT: 0.6,
    r: STORM.cloud.r
  };
  /* [FX] 雷云生成：目标区域上方压下一团暗色云，边缘有电弧 */
  ring(e.x, e.y, 10, STORM.cloud.r, 0.6, '#8fb8ff');
  burst(e.x, e.y, 16, '#b9d4ff', 260);
  floater(u.x, u.y - u.r - 22, '追踪雷云', '#b9d4ff', 14);
  if (typeof sfxPlay === 'function') sfxPlay('cast');
}

function stormUpdateCloud(u, dt) {
  var c = u.st.cloud;
  if (!c) return;
  c.life -= dt;
  if (c.life <= 0) {
    /* [FX] 雷云消散：云团收缩 + 最后一圈电弧 */
    ring(c.x, c.y, c.r, 10, 0.4, '#8fb8ff');
    u.st.cloud = null;
    return;
  }

  // 缓慢飘向挑战者重心：只是地面危险区在移动，不修改 BOSS 的 ang
  var cx = 0, cy = 0, n = 0;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    cx += v.x; cy += v.y; n++;
  }
  if (n > 0) {
    cx /= n; cy /= n;
    var dx = cx - c.x, dy = cy - c.y;
    var d = Math.hypot(dx, dy) || 0.001;
    var step = Math.min(d, STORM.cloud.speed * dt);
    c.x += dx / d * step;
    c.y += dy / d * step;
  }

  c.pulseT -= dt;
  if (c.pulseT > 0) return;
  var phase2 = u.st.phase === 2;
  c.pulseT = phase2 ? STORM.cloud.pulse2 : STORM.cloud.pulse1;
  stormCloudPulse(u, c, phase2);
}

function stormCloudPulse(u, c, phase2) {
  var atkMul = phase2 ? STORM.cloud.atkMul2 : STORM.cloud.atkMul1;
  var dmg = u.atk * atkMul;
  var hit = 0;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (Math.hypot(v.x - c.x, v.y - c.y) > c.r + v.r) continue;
    hurt(v, dmg, u, { skill: 1, dot: 1, periodic: 1 });
    if (!v.bossImmune) {
      v.slowT = Math.max(v.slowT || 0, STORM.cloud.slowT);
      v.slowMul = Math.min(v.slowMul || 1, STORM.cloud.slowMul);
    }
    hit++;
  }
  /* [FX] 云下雷击：云底闪一下 + 落雷柱 + 地面涟漪 */
  stormPushBolt(c.x, c.y, c.r, false);
  ring(c.x, c.y, 8, c.r, 0.4, '#b9d4ff');
  burst(c.x, c.y, hit ? 14 : 6, '#cfe4ff', 260);
  burst(c.x, c.y, 6, '#7ff0ff', 180);
  if (hit) shake = Math.min(7, shake + 1.2);
}

/* ============================================================
   技能 3：雷暴领域（二阶段）
   ============================================================ */
function stormCastDomain(u) {
  u.st.domain = {
    x: u.x, y: u.y,
    r: STORM.domain.r,
    life: STORM.domain.life,
    pulseT: 0.4,
    safeAng: srand(0, TAU)
  };
  /* [FX] 领域展开：以 BOSS 为圆心的雷环扩散，两个安全缺口高亮 */
  ring(u.x, u.y, u.r, STORM.domain.r, 0.7, '#8fb8ff');
  ring(u.x, u.y, u.r, STORM.domain.r * 0.7, 0.5, '#b9d4ff');
  burst(u.x, u.y, 22, '#b9d4ff', 300);
  burst(u.x, u.y, 10, '#7ff0ff', 220);
  floater(u.x, u.y - u.r - 26, '雷暴领域', '#b9d4ff', 15);
  if (typeof sfxPlay === 'function') sfxPlay('cast');
}

function stormUpdateDomain(u, dt) {
  var d = u.st.domain;
  if (!d) return;
  d.life -= dt;
  if (d.life <= 0) { u.st.domain = null; return; }
  d.x = u.x; d.y = u.y;          // 领域跟着 BOSS 缓慢移动
  d.pulseT -= dt;
  if (d.pulseT > 0) return;
  d.pulseT = STORM.domain.pulse;
  stormDomainPulse(u, d);
}

function stormDomainPulse(u, d) {
  var dmg = u.atk * STORM.domain.atkMul;
  var hit = 0;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (Math.hypot(v.x - d.x, v.y - d.y) > d.r + v.r) continue;
    // 两个安全缺口：safeAng 与 safeAng + π
    var a = Math.atan2(v.y - d.y, v.x - d.x);
    if (Math.abs(angDiff(a, d.safeAng)) < STORM.domain.gap) continue;
    if (Math.abs(angDiff(a, d.safeAng + Math.PI)) < STORM.domain.gap) continue;
    hurt(v, dmg, u, { skill: 1, dot: 1, periodic: 1 });
    if (!v.bossImmune) {
      v.slowT = Math.max(v.slowT || 0, STORM.domain.slowT);
      v.slowMul = Math.min(v.slowMul || 1, STORM.domain.slowMul);
    }
    hit++;
  }
  /* [FX] 领域脉冲：整圈雷光扫过，安全缺口处断开 */
  ring(d.x, d.y, d.r * 0.2, d.r, 0.35, '#b9d4ff');
  ring(d.x, d.y, d.r * 0.5, d.r * 0.92, 0.28, '#7ff0ff');
  if (hit) shake = Math.min(8, shake + 1.4);
}

/* ============================================================
   技能 4：雷墙（二阶段）
   ============================================================ */
function stormStartWall(u) {
  var A = ARENA;
  var axis = srand(0, 1) < 0.5 ? 'x' : 'y';     // x = 竖墙横向扫，y = 横墙纵向扫
  var dir = srand(0, 1) < 0.5 ? 1 : -1;
  var start = axis === 'x'
    ? (dir > 0 ? A.x : A.x + A.w)
    : (dir > 0 ? A.y : A.y + A.h);
  var span = axis === 'x' ? A.h : A.w;
  var origin = axis === 'x' ? A.y : A.x;
  u.st.wall = {
    axis: axis, dir: dir, origin: origin, span: span,
    pos: start, speed: STORM.wall.speed, width: STORM.wall.width,
    t: STORM.wall.warn, active: false, life: STORM.wall.life,
    gaps: [srand(0.16, 0.34) * span, srand(0.66, 0.84) * span]
  };
  // 新一面墙：清掉旧墙留下的受击冷却，保证第一下一定生效
  for (var i = 0; i < units.length; i++) units[i].stormWallCd = 0;
  /* [FX] 雷墙预警：场地一侧压下一道雷暴幕墙，两个缺口用青色光柱标出 */
  var cx = axis === 'x' ? (dir > 0 ? A.x : A.x + A.w) : A.x + A.w / 2;
  var cy = axis === 'y' ? (dir > 0 ? A.y : A.y + A.h) : A.y + A.h / 2;
  ring(cx, cy, 10, 180, 0.6, '#8fb8ff');
  floater(cx, cy - 20, '雷墙', '#dbe8ff', 15);
  if (typeof sfxPlay === 'function') sfxPlay('cast');
}

function stormUpdateWall(u, dt) {
  var w = u.st.wall;
  if (!w) return;
  if (!w.active) {
    w.t -= dt;
    if (w.t <= 0) w.active = true;
    return;
  }
  w.life -= dt;
  if (w.life <= 0) {
    /* [FX] 雷墙扫过：墙面淡出，地面留下一条逐渐熄灭的焦痕 */
    u.st.wall = null;
    return;
  }
  w.pos += w.dir * w.speed * dt;

  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    v.stormWallCd = Math.max(0, (v.stormWallCd || 0) - dt);
    var along = w.axis === 'x' ? v.x : v.y;
    if (Math.abs(along - w.pos) > w.width * 0.5 + v.r * 0.6) continue;
    var rel = (w.axis === 'x' ? v.y : v.x) - w.origin;
    if (Math.abs(rel - w.gaps[0]) <= STORM.wall.gapHalf) continue;
    if (Math.abs(rel - w.gaps[1]) <= STORM.wall.gapHalf) continue;
    if (v.stormWallCd > 0) continue;
    v.stormWallCd = STORM.wall.hitCd;
    hurt(v, u.atk * STORM.wall.atkMul, u, { skill: 1, dot: 1, periodic: 1 });
    /* [FX] 雷墙命中：墙面擦过时在该单位身上炸出一束小雷柱 */
    stormPushBolt(v.x, v.y, v.r + 20, false);
    ring(v.x, v.y, v.r, v.r + 30, 0.28, '#dbe8ff');
    shake = Math.min(8, shake + 0.8);
  }
}

/* ============================================================
   技能 5：磁暴牵引（二阶段）
   ============================================================ */
function stormStartPull(u) {
  var A = ARENA;
  var cx = 0, cy = 0, n = 0;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    cx += v.x; cy += v.y; n++;
  }
  if (n > 0) { cx /= n; cy /= n; } else { cx = A.x + A.w / 2; cy = A.y + A.h / 2; }
  cx = clamp(cx, A.x + 120, A.x + A.w - 120);
  cy = clamp(cy, A.y + 120, A.y + A.h - 120);
  u.st.pull = { x: cx, y: cy, t: STORM.pull.time, max: STORM.pull.time, force: STORM.pull.force, team: u.team };
  /* [FX] 磁暴牵引起手：目标点出现旋转雷暴眼，地面浮尘开始向中心螺旋汇聚 */
  ring(cx, cy, 12, 160, 0.55, '#b9d4ff');
  ring(cx, cy, 20, 90, 0.35, '#7ff0ff');
  floater(cx, cy - 26, '磁暴牵引', '#b9d4ff', 15);
  if (typeof sfxPlay === 'function') sfxPlay('cast');
}

function stormUpdatePull(u, dt) {
  var p = u.st.pull;
  if (!p) return;
  // 终结技期间不牵引，避免把玩家拖进雷牢 / 雷点安全区外
  if (u.st.cage || u.st.ult1 || u.st.ult2) { u.st.pull = null; return; }
  var A = ARENA;
  p.t -= dt;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    var dx = p.x - v.x, dy = p.y - v.y;
    var d = Math.hypot(dx, dy) || 0.001;
    var step = Math.min(d, p.force * dt);
    v.x = clamp(v.x + dx / d * step, A.x + v.r, A.x + A.w - v.r);
    v.y = clamp(v.y + dy / d * step, A.y + v.r, A.y + A.h - v.r);
    /* [FX] 牵引过程：从每个挑战者拉一条细导雷线到漩涡中心 */
  }
  if (p.t <= 0) {
    /* [FX] 牵引收束：漩涡闭合，爆出一圈雷环 */
    u.st.rings.push({
      x: p.x, y: p.y,
      inner: STORM.ring.inner * 0.55,
      outer: STORM.ring.outer * 0.85,
      t: 0.35, max: 0.35,
      atkMul: STORM.pull.atkMul,
      basic: false
    });
    ring(p.x, p.y, 8, 200, 0.5, '#ffffff');
    burst(p.x, p.y, 22, '#dbe8ff', 360);
    u.st.pull = null;
  }
}

/* ============================================================
   终结技 · 雷牢（二阶段 70% 血）
   ============================================================ */
function stormStartCage(u) {
  var st = u.st;
  st.cage = {
    t: STORM.cage.warn, max: STORM.cage.warn,
    active: false,
    left: STORM.cage.time,
    tick: 0.15,
    half: STORM.cage.half0
  };
  st.actionLock = 1;
  st.marks = [];
  st.lines = [];
  st.rings = [];
  st.wall = null;
  st.pull = null;
  st.cloud = null;
  st.domain = null;
  if (typeof bossCry === 'function') bossCry('雷牢', '四角雷柱升起 · 安全方形会收缩');
  if (typeof sfxPlay === 'function') sfxPlay('cast');
  /* [FX] 雷牢蓄力：四角雷柱升起，四道光束连成正方形牢笼 */
  stormFlashSet(0.3);
  ring(u.x, u.y, u.r, u.r + 180, 0.8, '#dbe8ff');
  ring(u.x, u.y, u.r, u.r + 110, 0.55, '#b98aff');
  shake = Math.max(shake, 14);
}

function stormUpdateCage(u, dt) {
  var st = u.st;
  var c = st.cage;
  if (!c) return;
  if (!c.active) {
    c.t -= dt;
    if (c.t <= 0) { c.active = true; c.tick = 0.15; }
    return;
  }
  c.left = Math.max(0, c.left - dt);
  c.tick -= dt;
  var prog = 1 - c.left / STORM.cage.time;
  c.half = STORM.cage.half0 + (STORM.cage.half1 - STORM.cage.half0) * prog;
  if (c.tick <= 0 && c.left > 0) {
    c.tick += STORM.cage.tick;
    stormCagePulse(u, c);
  }
  if (c.left <= 0) {
    st.cage = null;
    st.actionLock = 0;
    st.recover = 1.6;
    st.cageDone = true;
    if (typeof bossCry === 'function') bossCry('雷牢 · 崩解', '四根雷柱倒塌 · 反打窗口');
    stormFlashSet(0.3);
    ring(u.x, u.y, 8, 360, 0.7, '#eaf4ff');
    burst(u.x, u.y, 30, '#dbe8ff', 380);
    shake = Math.max(shake, 14);
  }
}

function stormCagePulse(u, c) {
  var A = ARENA, cx = A.x + A.w / 2, cy = A.y + A.h / 2;
  var half = c.half;
  var hit = 0;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (Math.abs(v.x - cx) <= half + v.r * 0.5 &&
        Math.abs(v.y - cy) <= half + v.r * 0.5) continue;
    var dmg = u.atk * STORM.cage.atkMul;
    hurt(v, dmg, u, { ult: 1, dot: 1, periodic: 1 });
    v.slowT = Math.max(v.slowT || 0, 0.4);
    v.slowMul = Math.min(v.slowMul || 1, 0.82);
    floater(v.x, v.y - v.r - 18, '-' + Math.round(dmg), '#eaf4ff', 20);
    /* [FX] 雷牢脉冲：牢外单位被四边光束电击，各自落一根雷柱 */
    stormPushBolt(v.x, v.y, v.r + 22, true);
    ring(v.x, v.y, v.r, v.r + 40, 0.3, '#eaf4ff');
    hit++;
  }
  /* [FX] 雷牢收缩：正方形四边同时放电，白闪 + 紫色外框 */
  stormFlashSet(0.12);
  ring(cx, cy, half * 1.5, half, 0.3, '#eaf4ff');
  ring(cx, cy, half * 1.8, half * 1.2, 0.24, '#b98aff');
  shake = Math.max(shake, hit ? 12 : 6);
  if (hit && typeof sfxPlay === 'function') sfxPlay('bomb');
}

/* ============================================================
   终结技 1：万雷归一
   ============================================================ */
function stormStartUlt1(u) {
  u.st.ult1 = {
    t: STORM.ult1.warn,
    max: STORM.ult1.warn,
    fired: false,
    endT: 0,
    safeAng: srand(0, TAU)
  };
  u.st.actionLock = 1;
  u.st.marks = [];
  u.st.lines = [];
  u.st.rings = [];
  u.st.wall = null;
  u.st.pull = null;
  u.st.cloud = null;
  u.st.domain = null;
  if (typeof bossCry === 'function') bossCry('万雷归一', '6 秒后环形雷点依次落下 · 找安全区');
  if (typeof sfxPlay === 'function') sfxPlay('cast');
  /* [FX] 蓄力：全场天色变暗，BOSS 头顶雷云旋转、蓄能环向内收紧 */
  stormFlashSet(0.25);
  ring(u.x, u.y, u.r, u.r + 160, 0.8, '#dbe8ff');
  ring(u.x, u.y, u.r, u.r + 90, 0.5, '#7ff0ff');
  shake = Math.max(shake, 10);
}

function stormUpdateUlt1(u, dt) {
  var s = u.st.ult1;
  if (!s) return;
  if (!s.fired) {
    s.t -= dt;
    if (s.t <= 0) {
      s.fired = true;
      s.endT = 1.8;
      stormSpawnUlt1Marks(u, s.safeAng);
    }
    return;
  }
  s.endT -= dt;
  if (s.endT <= 0 && u.st.marks.length === 0) {
    u.st.ult1 = null;
    u.st.actionLock = 0;
    u.st.recover = 1.5;
    u.st.ult1Done = true;
  }
}

function stormSpawnUlt1Marks(u, safeAng) {
  var A = ARENA, cx = A.x + A.w / 2, cy = A.y + A.h / 2;
  var n = STORM.ult1.count;
  for (var i = 0; i < n; i++) {
    var a = i / n * TAU;
    if (Math.abs(angDiff(a, safeAng)) < 0.55) continue;
    if (Math.abs(angDiff(a, safeAng + Math.PI)) < 0.55) continue;
    stormAddMark(u, cx + Math.cos(a) * STORM.ult1.ringR,
      cy + Math.sin(a) * STORM.ult1.ringR, {
        warn: STORM.ult1.resolve,
        r: STORM.ult1.markR,
        atkMul: STORM.ult1.atkMul,
        ult: true,
        slowT: STORM.ult1.slowT,
        source: 'ult1'
      });
  }
  /* [FX] 万雷归一：安全区高亮，环形雷点同时出现预警 */
  ring(cx, cy, STORM.ult1.ringR - 40, STORM.ult1.ringR + 40, 0.5, '#dbe8ff');
  ring(cx, cy, STORM.ult1.ringR - 70, STORM.ult1.ringR + 70, 0.35, '#7ff0ff');
  burst(cx, cy, 30, '#eaf4ff', 420);
  burst(cx, cy, 14, '#7ff0ff', 300);
  shake = Math.max(shake, 14);
  if (typeof sfxPlay === 'function') sfxPlay('bomb');
}

/* ============================================================
   终结技 2：雷神黄昏
   ============================================================ */
function stormStartUlt2(u) {
  u.st.ult2 = {
    t: STORM.ult2.warn,
    max: STORM.ult2.warn,
    active: false,
    left: STORM.ult2.pulses,
    total: STORM.ult2.pulses,
    pulseT: 0.3
  };
  u.st.actionLock = 1;
  u.st.marks = [];
  u.st.lines = [];
  u.st.rings = [];
  u.st.wall = null;
  u.st.pull = null;
  u.st.cloud = null;
  u.st.domain = null;
  if (typeof bossCry === 'function') bossCry('雷神黄昏', '4 秒后 5 次全屏雷击 · 安全区会收缩');
  if (typeof sfxPlay === 'function') sfxPlay('cast');
  /* [FX] 蓄力：BOSS 核心变白、地面出现大范围收缩安全圈 */
  stormFlashSet(0.25);
  ring(u.x, u.y, u.r, u.r + 200, 0.9, '#eaf4ff');
  ring(u.x, u.y, u.r, u.r + 120, 0.55, '#b98aff');
  shake = Math.max(shake, 12);
}

function stormUpdateUlt2(u, dt) {
  var s = u.st.ult2;
  if (!s) return;
  if (!s.active) {
    s.t -= dt;
    if (s.t <= 0) { s.active = true; s.pulseT = 0.25; }
    return;
  }

  s.pulseT -= dt;
  if (s.pulseT <= 0 && s.left > 0) {
    s.pulseT += STORM.ult2.interval;
    var prog = (s.total - s.left) / s.total;
    var safeR = STORM.ult2.safeR0 + (STORM.ult2.safeR1 - STORM.ult2.safeR0) * prog;
    stormUlt2Pulse(u, safeR);
    s.left--;
  }

  if (s.left <= 0) {
    u.st.ult2 = null;
    u.st.actionLock = 0;
    u.st.recover = 2.0;
    u.st.ult2Done = true;
    // 首次雷神黄昏结束后进入终结技循环：10 秒后从雷牢开始
    u.st.ultCycle = true;
    u.st.ultCycleCd = STORM.ultCycle.gap;
    u.st.ultCycleIx = 0;
    // 大招结束后的反打窗口：BOSS 虚弱 6 秒（所有伤害 -20%）
    u.weakT = Math.max(u.weakT || 0, 6.0);
    u.weakMul = 0.8;
    if (typeof bossCry === 'function') bossCry('雷神黄昏 · 结束', 'BOSS 虚弱 6 秒 · 10 秒后开始终结技循环');
  }
}

function stormUlt2Pulse(u, safeR) {
  var A = ARENA, cx = A.x + A.w / 2, cy = A.y + A.h / 2;
  var dmg = u.atk * STORM.ult2.atkMul;
  var hit = 0;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (Math.hypot(v.x - cx, v.y - cy) <= safeR + v.r * 0.5) continue;
    hurt(v, dmg, u, { ult: 1 });
    if (!v.bossImmune) {
      v.slowT = Math.max(v.slowT || 0, STORM.ult2.slowT);
      v.slowMul = Math.min(v.slowMul || 1, 0.6);
    }
    floater(v.x, v.y - v.r - 18, '-' + Math.round(dmg), '#eaf4ff', 22);
    stormPushBolt(v.x, v.y, v.r + 20, true);
    ring(v.x, v.y, v.r, v.r + 44, 0.35, '#eaf4ff');
    burst(v.x, v.y, 12, '#eaf4ff', 300);
    hit++;
  }
  /* [FX] 雷神黄昏：全屏白闪 + 从外向内收缩的雷环（safeR 是安全区半径） */
  stormFlashSet(0.18);
  ring(cx, cy, 460, safeR, 0.4, '#eaf4ff');
  ring(cx, cy, 400, safeR + 30, 0.3, '#b98aff');
  shake = Math.max(shake, 16);
  if (hit) {
    hitStop = Math.max(hitStop, 0.03);
    if (typeof sfxPlay === 'function') sfxPlay('bomb');
  }
}

/* ============================================================
   通用：全屏雷击 / 目标选择 / 风眼
   ============================================================ */
function stormArenaPulse(u, atkMul, label) {
  var dmg = u.atk * atkMul;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    hurt(v, dmg, u, { ult: 1 });
    v.slowT = Math.max(v.slowT || 0, 0.8);
    v.slowMul = Math.min(v.slowMul || 1, 0.8);
    floater(v.x, v.y - v.r - 18, '-' + Math.round(dmg), '#eaf4ff', 24);
    ring(v.x, v.y, v.r, v.r + 50, 0.4, '#eaf4ff');
  }
  for (var s = seeds.length - 1; s >= 0; s--) {
    if (seeds[s].team === u.team) continue;
    hurtSeed(seeds[s], dmg, u, { ult: 1 });
  }
  var A = ARENA;
  /* [FX] 全屏雷击：整场白闪 + 多层扩散雷环 + 震屏 + 慢动作 */
  stormFlashSet(0.4);
  ring(A.x + A.w / 2, A.y + A.h / 2, 20, 620, 0.8, '#eaf4ff');
  ring(A.x + A.w / 2, A.y + A.h / 2, 40, 520, 0.55, '#8fb8ff');
  ring(A.x + A.w / 2, A.y + A.h / 2, 60, 380, 0.4, '#7ff0ff');
  burst(u.x, u.y, 34, '#ffffff', 420);
  burst(u.x, u.y, 18, '#7ff0ff', 300);
  shake = Math.max(shake, 22);
  hitStop = Math.max(hitStop, 0.06);
  if (typeof bossCry === 'function') bossCry(label, '全屏雷击 · 每个挑战者扣 ' + Math.round(atkMul * 100) + '% 攻击力');
  if (typeof sfxPlay === 'function') sfxPlay('bomb');
}

function stormPickTargets(u, n) {
  var pool = [];
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (v.alive && v.team !== u.team) pool.push(v);
  }
  // Fisher-Yates，用 srand 保证可复现
  for (var j = pool.length - 1; j > 0; j--) {
    var k = Math.floor(srand(0, j + 1));
    var tmp = pool[j]; pool[j] = pool[k]; pool[k] = tmp;
  }
  return pool.slice(0, Math.min(n, pool.length));
}

function stormUpdateEye(u) {
  // 风眼只属于二阶段：一阶段保持 140 px/s 的慢速，不提前提速
  if (u.st.phase !== 2) { u.st.speedAdd = 0; return; }
  var n = 0;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (Math.hypot(v.x - u.x, v.y - u.y) <= 200) n++;
  }
  if (n >= 3) {
    // 抱团惩罚：承伤 -20%，持续 0.2s（每帧续上，散开即失效）
    u.field.takenT = Math.max(u.field.takenT || 0, 0.2);
    u.field.takenMul = 0.8;
    u.st.speedAdd = STORM.speedAdd2;
  } else {
    u.st.speedAdd = STORM.speedAdd2 + 0.15;   // 散开时移速 +15%
  }
}

/* ============================================================
   绘制（占位特效；全部标 [FX]，可整体替换）
   ============================================================ */
function stormDrawBody(u) {
  var x = u.x, y = u.y, r = u.r;
  var st = u.st || {};
  var p2 = st.phase === 2;
  var pulse = 0.5 + 0.5 * Math.sin(t * 3 + u.seed);
  var charging = !!(st.phaseShift > 0 || st.cage || st.ult1 || st.ult2);

  /* 1. 地面大范围辉光 */
  ctx.save();
  var glowR = r * 2.3;
  var gg = ctx.createRadialGradient(x, y, r * 0.2, x, y, glowR);
  gg.addColorStop(0, rgba(p2 ? '#7ff0ff' : '#8fb8ff', 0.30));
  gg.addColorStop(1, rgba('#8fb8ff', 0));
  ctx.fillStyle = gg;
  ctx.beginPath(); ctx.arc(x, y, glowR, 0, TAU); ctx.fill();
  ctx.restore();

  /* 2. 头顶公转积雨云（5 团）+ 云底间歇闪电 */
  ctx.save();
  for (var i = 0; i < 5; i++) {
    var ca = t * 0.5 + i / 5 * TAU;
    var cx = x + Math.cos(ca) * (r + 12);
    var cy = y - r * 0.55 + Math.sin(ca) * 9;
    var cg = ctx.createRadialGradient(cx, cy, 2, cx, cy, r * 0.62);
    cg.addColorStop(0, 'rgba(38,56,92,0.85)');
    cg.addColorStop(1, 'rgba(22,35,61,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.62, r * 0.4, 0, 0, TAU); ctx.fill();
  }
  if (Math.floor(t * 1.4 + u.seed) % 3 === 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(219,232,255,0.7)';
    ctx.lineWidth = 1.6;
    var bp = stormBoltPoints(x - r * 0.3, y - r * 0.9, x + r * 0.2, y - r * 0.1, u.seed, 4);
    ctx.beginPath();
    ctx.moveTo(bp[0].x, bp[0].y);
    for (var b = 1; b < bp.length; b++) ctx.lineTo(bp[b].x, bp[b].y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();

  /* 3. 岩甲躯干：八边形切面 */
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 0.6 + u.seed) * 0.06);
  var bodyGrad = ctx.createLinearGradient(-r, -r, r, r);
  bodyGrad.addColorStop(0, p2 ? '#5e86c4' : '#4a6aa0');
  bodyGrad.addColorStop(0.45, '#2c4266');
  bodyGrad.addColorStop(1, '#121e33');
  ctx.beginPath();
  for (var k = 0; k < 8; k++) {
    var aa = k / 8 * TAU + Math.PI / 8;
    var px = Math.cos(aa) * r, py = Math.sin(aa) * r;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = bodyGrad; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(10,16,28,.55)'; ctx.stroke();
  // 左上高光切面
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, -r * 0.7); ctx.lineTo(0, -r * 0.85); ctx.lineTo(-r * 0.2, 0); ctx.lineTo(-r * 0.85, 0);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  // 表面雷纹刻线
  ctx.strokeStyle = 'rgba(219,232,255,0.30)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, r * 0.3); ctx.lineTo(-r * 0.15, r * 0.05); ctx.lineTo(-r * 0.35, -r * 0.3);
  ctx.moveTo(r * 0.5, r * 0.25); ctx.lineTo(r * 0.2, 0); ctx.lineTo(r * 0.45, -r * 0.35);
  ctx.stroke();
  ctx.restore();

  /* 4. 中央雷核 */
  ctx.save();
  var coreR = r * (0.42 + 0.05 * pulse);
  var coreG = ctx.createRadialGradient(x, y, 1, x, y, coreR * 2.2);
  coreG.addColorStop(0, 'rgba(255,255,255,0.95)');
  coreG.addColorStop(0.35, rgba(p2 ? '#7ff0ff' : '#8fb8ff', 0.75));
  coreG.addColorStop(1, rgba('#8fb8ff', 0));
  ctx.fillStyle = coreG;
  ctx.beginPath(); ctx.arc(x, y, coreR * 2.2, 0, TAU); ctx.fill();
  ctx.restore();

  /* 5. 环绕折线电弧（3 道，外蓝宽线 + 内白芯） */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (var e = 0; e < 3; e++) {
    var ea = t * (p2 ? 2.0 : 1.3) + e / 3 * TAU + u.seed;
    var ex1 = x + Math.cos(ea) * (r + 4);
    var ey1 = y + Math.sin(ea) * (r + 4);
    var ex2 = x + Math.cos(ea + 0.4) * (r + 22);
    var ey2 = y + Math.sin(ea + 0.4) * (r + 22);
    var ep = stormBoltPoints(ex1, ey1, ex2, ey2, u.seed + e * 31, 3);
    ctx.strokeStyle = 'rgba(143,184,255,0.5)'; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(ep[0].x, ep[0].y);
    for (var q = 1; q < ep.length; q++) ctx.lineTo(ep[q].x, ep[q].y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(ep[0].x, ep[0].y);
    for (var q2 = 1; q2 < ep.length; q2++) ctx.lineTo(ep[q2].x, ep[q2].y); ctx.stroke();
  }
  ctx.restore();

  /* 6. 岩刺王冠 + 双肩刺 */
  ctx.fillStyle = rgba(u.light, 0.92);
  var spikes = [[-0.42, -0.92, -4, 6, 0, -8, 4, 6], [0, -0.98, -4, 6, 0, -11, 4, 6], [0.42, -0.92, -4, 6, 0, -8, 4, 6]];
  for (var sp = 0; sp < spikes.length; sp++) {
    var s = spikes[sp];
    ctx.beginPath();
    ctx.moveTo(x + s[0] * r + s[2], y + s[1] * r + s[3]);
    ctx.lineTo(x + s[0] * r + s[4], y + s[1] * r + s[5]);
    ctx.lineTo(x + s[0] * r + s[6], y + s[1] * r + s[7]);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = rgba('#16233d', 0.9);
  ctx.beginPath(); ctx.moveTo(x - r * 0.9, y - 4); ctx.lineTo(x - r - 10, y - 14); ctx.lineTo(x - r * 0.9, y + 8); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + r * 0.9, y - 4); ctx.lineTo(x + r + 10, y - 14); ctx.lineTo(x + r * 0.9, y + 8); ctx.closePath(); ctx.fill();

  /* 7. 二阶段：双反向旋转外环 + 紫雷纹 */
  if (p2) {
    ctx.save();
    ctx.strokeStyle = 'rgba(127,240,255,' + (0.35 + 0.3 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 2.2;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(t * 0.9);
    ctx.setLineDash([12, 8]);
    ctx.beginPath(); ctx.arc(0, 0, r + 16, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(185,138,255,' + (0.3 + 0.25 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 1.8;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(-t * 0.6);
    ctx.beginPath(); ctx.arc(0, 0, r + 23, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  /* 8. 蓄力 / 转阶段：核心过曝 + 上抽光柱 + 收束环 */
  if (charging) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var chargeGlow = ctx.createRadialGradient(x, y, 2, x, y, r * 1.6);
    chargeGlow.addColorStop(0, 'rgba(255,255,255,0.55)');
    chargeGlow.addColorStop(0.5, rgba('#7ff0ff', 0.25));
    chargeGlow.addColorStop(1, rgba('#7ff0ff', 0));
    ctx.fillStyle = chargeGlow;
    ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, TAU); ctx.fill();
    var lg = ctx.createLinearGradient(0, y - r - 60, 0, y);
    lg.addColorStop(0, 'rgba(219,232,255,0)');
    lg.addColorStop(1, 'rgba(219,232,255,' + (0.35 + 0.25 * pulse).toFixed(3) + ')');
    ctx.fillStyle = lg;
    ctx.fillRect(x - 7, y - r - 60, 14, 60);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.3 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, r + 26 - 10 * pulse, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

function stormDrawTelegraphs(u) {
  var st = u.st;
  var i, m;

  /* 落雷预警圈：渐变填充 + 虚线边界 + 倒计时弧 + 十字准星 + 旋转刻度 */
  for (i = 0; i < st.marks.length; i++) {
    m = st.marks[i];
    var k = clamp(1 - m.t / m.max, 0, 1);
    var tint = m.ult ? '#ffffff' : '#9fc6ff';
    var g = ctx.createRadialGradient(m.x, m.y, m.r * 0.12, m.x, m.y, m.r);
    g.addColorStop(0, rgba(tint, 0.20 + 0.14 * k));
    g.addColorStop(1, rgba(tint, 0.02));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();

    ctx.save();
    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = -t * 46;
    ctx.strokeStyle = rgba(tint, 0.55 + 0.3 * k);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = rgba(tint, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r - 3, -Math.PI / 2, -Math.PI / 2 + TAU * (m.t / m.max));
    ctx.stroke();

    ctx.strokeStyle = rgba(tint, 0.8);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(m.x - 10, m.y); ctx.lineTo(m.x + 10, m.y);
    ctx.moveTo(m.x, m.y - 10); ctx.lineTo(m.x, m.y + 10);
    ctx.stroke();

    ctx.save();
    ctx.translate(m.x, m.y); ctx.rotate(t * 1.5);
    ctx.strokeStyle = rgba(tint, 0.5);
    ctx.beginPath();
    for (var ar = 0; ar < 3; ar++) {
      var ara = ar / 3 * TAU;
      ctx.moveTo(Math.cos(ara) * (m.r - 12), Math.sin(ara) * (m.r - 12));
      ctx.lineTo(Math.cos(ara) * (m.r - 22), Math.sin(ara) * (m.r - 22));
    }
    ctx.stroke();
    ctx.restore();
  }

  /* 追踪雷云：地面危险区 + 上方厚云团 + 云内闪络 + 下垂电弧 */
  var c = st.cloud;
  if (c) {
    var cg = ctx.createRadialGradient(c.x, c.y, c.r * 0.12, c.x, c.y, c.r);
    cg.addColorStop(0, 'rgba(30,44,70,0.5)');
    cg.addColorStop(0.7, 'rgba(60,90,143,0.2)');
    cg.addColorStop(1, 'rgba(60,90,143,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.fill();

    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = 'rgba(185,212,255,' + (0.4 + 0.25 * Math.sin(t * 6)).toFixed(3) + ')';
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.stroke();
    ctx.restore();

    for (var ci = 0; ci < 6; ci++) {
      var ca2 = t * 0.4 + ci / 6 * TAU;
      var bcx = c.x + Math.cos(ca2) * c.r * 0.55;
      var bcy = c.y - 26 + Math.sin(ca2) * 10;
      var bg = ctx.createRadialGradient(bcx, bcy, 2, bcx, bcy, 26);
      bg.addColorStop(0, 'rgba(28,40,66,0.92)');
      bg.addColorStop(1, 'rgba(28,40,66,0)');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.ellipse(bcx, bcy, 26, 16, 0, 0, TAU); ctx.fill();
    }
    if (Math.floor(t * 2 + c.x) % 2 === 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(219,232,255,0.6)';
      ctx.lineWidth = 1.4;
      var cp = stormBoltPoints(c.x - 18, c.y - 30, c.x + 16, c.y - 8, c.x, 4);
      ctx.beginPath(); ctx.moveTo(cp[0].x, cp[0].y);
      for (var cp2 = 1; cp2 < cp.length; cp2++) ctx.lineTo(cp[cp2].x, cp[cp2].y);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(127,240,255,0.4)';
    ctx.lineWidth = 1.2;
    for (var cb = 0; cb < 2; cb++) {
      var bx = c.x + (cb === 0 ? -c.r * 0.4 : c.r * 0.4);
      var bp2 = stormBoltPoints(bx, c.y - 6, bx + 6, c.y + c.r * 0.5, c.y + cb, 3);
      ctx.beginPath(); ctx.moveTo(bp2[0].x, bp2[0].y);
      for (var bp3 = 1; bp3 < bp2.length; bp3++) ctx.lineTo(bp2[bp3].x, bp2[bp3].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* [FX] 雷暴领域：大圈 + 两个安全缺口高亮 */
  var d = st.domain;
  if (d) {
    var dg = ctx.createRadialGradient(d.x, d.y, d.r * 0.2, d.x, d.y, d.r);
    dg.addColorStop(0, 'rgba(90,120,200,0.10)');
    dg.addColorStop(1, 'rgba(90,120,200,0.02)');
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();

    ctx.save();
    ctx.strokeStyle = 'rgba(143,184,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(127,240,255,0.5)';
    ctx.lineWidth = 1.6;
    for (var dl = 0; dl < 3; dl++) {
      var da = t * 1.2 + dl * TAU / 3;
      var dx1 = d.x + Math.cos(da) * d.r;
      var dy1 = d.y + Math.sin(da) * d.r;
      var dx2 = d.x + Math.cos(da + 0.25) * d.r;
      var dy2 = d.y + Math.sin(da + 0.25) * d.r;
      var dp = stormBoltPoints(dx1, dy1, dx2, dy2, dl * 17 + d.safeAng, 3);
      ctx.beginPath(); ctx.moveTo(dp[0].x, dp[0].y);
      for (var dp2 = 1; dp2 < dp.length; dp2++) ctx.lineTo(dp[dp2].x, dp[dp2].y);
      ctx.stroke();
    }
    ctx.restore();

    var gap = STORM.domain.gap;
    ctx.strokeStyle = 'rgba(219,232,255,0.75)';
    ctx.lineWidth = 5;
    for (var s = 0; s < 2; s++) {
      var a0 = d.safeAng + s * Math.PI - gap;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r - 4, a0, a0 + gap * 2);
      ctx.stroke();
    }
  }

  /* [FX] 万雷归一：蓄力环 + 安全区扇形提示 */
  var u1 = st.ult1;
  if (u1) {
    var A = ARENA, cx = A.x + A.w / 2, cy = A.y + A.h / 2;
    if (!u1.fired) {
      var p = 1 - u1.t / u1.max;
      ctx.save();
      ctx.strokeStyle = 'rgba(219,232,255,' + (0.35 + 0.45 * p).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.r + 30 + 50 * (1 - p), 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(127,240,255,' + (0.25 + 0.3 * p).toFixed(3) + ')';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.r + 16 + 30 * (1 - p), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    for (var q = 0; q < 2; q++) {
      var sa = u1.safeAng + q * Math.PI;
      ctx.beginPath();
      ctx.arc(cx, cy, STORM.ult1.ringR, sa - 0.55, sa + 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* [FX] 雷神黄昏：全屏收缩安全圈（越到后面越小） */
  var u2 = st.ult2;
  if (u2 && u2.active) {
    var prog2 = (u2.total - u2.left) / u2.total;
    var safeR = STORM.ult2.safeR0 + (STORM.ult2.safeR1 - STORM.ult2.safeR0) * prog2;
    var A2 = ARENA;
    var ax = A2.x + A2.w / 2, ay = A2.y + A2.h / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(234,244,255,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ax, ay, safeR, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(185,138,255,0.45)';
    ctx.lineWidth = 2;
    for (var wl = 0; wl < 4; wl++) {
      var wa = t * 0.9 + wl * TAU / 4;
      var wx1 = ax + Math.cos(wa) * (safeR + 40);
      var wy1 = ay + Math.sin(wa) * (safeR + 40);
      var wx2 = ax + Math.cos(wa + 0.3) * (safeR + 40);
      var wy2 = ay + Math.sin(wa + 0.3) * (safeR + 40);
      var wp = stormBoltPoints(wx1, wy1, wx2, wy2, wl * 23, 3);
      ctx.beginPath(); ctx.moveTo(wp[0].x, wp[0].y);
      for (var wp2 = 1; wp2 < wp.length; wp2++) ctx.lineTo(wp[wp2].x, wp[wp2].y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ============================================================
   新增招式特效：雷线 / 雷环 / 雷墙 / 磁暴牵引 / 雷牢
   ------------------------------------------------------------
   这些函数只读取 u.st 的临时状态，不参与伤害判定；伤害在对应
   stormResolveLine / stormResolveRing / stormUpdateWall / stormCagePulse 里结算。
   ============================================================ */
function stormDrawHazards(u) {
  var st = u.st;
  if (!st) return;
  stormDrawLines(st);
  stormDrawRings(st);
  stormDrawWall(st);
  stormDrawPull(st);
  stormDrawCage(st);
}

/* [FX] 雷线：预警矩形雷道 + 流动虚线边缘 + 中心充能线 + 滚动电荷刻度 */
function stormDrawLines(st) {
  for (var i = 0; i < st.lines.length; i++) {
    var l = st.lines[i];
    var k = clamp(1 - l.t / l.max, 0, 1);
    var ang = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
    var len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
    var w = l.w;
    var flick = (Math.floor(t * 12 + l.x1 * 0.1) % 2) === 0;
    ctx.save();
    ctx.translate(l.x1, l.y1);
    ctx.rotate(ang);

    /* 槽体底色：沿雷道由淡蓝到青白的横向渐变 */
    var g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, 'rgba(70,100,160,' + (0.16 + 0.12 * k).toFixed(3) + ')');
    g.addColorStop(0.6, 'rgba(90,150,210,' + (0.18 + 0.14 * k).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(190,230,255,' + (0.22 + 0.18 * k).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, -w / 2, len, w);

    /* 中央亮带 */
    var coreG = ctx.createLinearGradient(0, 0, len, 0);
    coreG.addColorStop(0, 'rgba(127,240,255,0)');
    coreG.addColorStop(1, 'rgba(127,240,255,' + (0.18 + 0.16 * k).toFixed(3) + ')');
    ctx.fillStyle = coreG;
    ctx.fillRect(0, -w * 0.18, len, w * 0.36);

    /* 两侧流动虚线边缘 + 内侧白高光 */
    ctx.setLineDash([14, 9]);
    ctx.lineDashOffset = -t * 70;
    ctx.strokeStyle = 'rgba(219,232,255,' + (0.55 + 0.30 * k).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -w / 2); ctx.lineTo(len, -w / 2);
    ctx.moveTo(0, w / 2); ctx.lineTo(len, w / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.20 + 0.25 * k).toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -w / 2 + 2.5); ctx.lineTo(len, -w / 2 + 2.5);
    ctx.moveTo(0, w / 2 - 2.5); ctx.lineTo(len, w / 2 - 2.5);
    ctx.stroke();

    /* 中心充能线：随 k 从起点推进到末端，外青宽 + 内白芯 */
    var chargeX = len * (0.15 + 0.85 * k);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(127,240,255,' + (0.35 + 0.35 * k).toFixed(3) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(chargeX, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.4 * k).toFixed(3) + ')';
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(chargeX, 0); ctx.stroke();

    /* 滚动电荷刻度：沿雷道循环流动的小折线刻度 */
    ctx.strokeStyle = 'rgba(127,240,255,' + (0.4 + 0.3 * k).toFixed(3) + ')';
    ctx.lineWidth = 1.8;
    var ticks = 5;
    for (var c = 0; c < ticks; c++) {
      var px = len * (((c + t * 0.6) % ticks) / ticks);
      ctx.beginPath();
      ctx.moveTo(px, -w * 0.32);
      ctx.lineTo(px + 6, 0);
      ctx.lineTo(px, w * 0.32);
      ctx.stroke();
    }

    /* 末端蓄能准星：脉冲圆环 + 十字 */
    var ep = 8 + 5 * k + 2 * Math.sin(t * 10);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.4 * k).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(len, 0, ep, 0, TAU); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(len - 12, 0); ctx.lineTo(len + 12, 0);
    ctx.moveTo(len, -12); ctx.lineTo(len, 12);
    ctx.stroke();

    /* 临近释放：整条雷道边缘闪白 */
    if (k > 0.7 && flick) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0, -w / 2, len, w);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }
}

/* [FX] 雷环：内外双环 + 中间环带 + 倒计时弧 + 爬行电弧 */
function stormDrawRings(st) {
  for (var i = 0; i < st.rings.length; i++) {
    var r = st.rings[i];
    var k = clamp(1 - r.t / r.max, 0, 1);
    ctx.save();

    /* 内圈安全区辉光 */
    var safeG = ctx.createRadialGradient(r.x, r.y, 1, r.x, r.y, r.inner);
    safeG.addColorStop(0, 'rgba(127,240,255,' + (0.10 + 0.08 * k).toFixed(3) + ')');
    safeG.addColorStop(1, 'rgba(127,240,255,0)');
    ctx.fillStyle = safeG;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.inner, 0, TAU); ctx.fill();

    /* 中间环带填充：径向渐变，两边深、中间亮 */
    var bandG = ctx.createRadialGradient(r.x, r.y, r.inner, r.x, r.y, r.outer);
    bandG.addColorStop(0, 'rgba(143,184,255,' + (0.10 + 0.08 * k).toFixed(3) + ')');
    bandG.addColorStop(0.5, 'rgba(127,240,255,' + (0.14 + 0.10 * k).toFixed(3) + ')');
    bandG.addColorStop(1, 'rgba(143,184,255,' + (0.10 + 0.08 * k).toFixed(3) + ')');
    ctx.fillStyle = bandG;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.outer, 0, TAU);
    ctx.arc(r.x, r.y, r.inner, 0, TAU, true);
    ctx.fill();

    /* 内外双虚线边界（反向滚动） */
    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = -t * 50;
    ctx.strokeStyle = 'rgba(219,232,255,' + (0.50 + 0.30 * k).toFixed(3) + ')';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.inner, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(r.x, r.y, r.outer, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);

    /* 边界白高光 */
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.18 + 0.2 * k).toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.inner - 2, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(r.x, r.y, r.outer + 2, 0, TAU); ctx.stroke();

    /* 倒计时弧：中环顺时针长满 */
    ctx.strokeStyle = 'rgba(127,240,255,' + (0.55 + 0.35 * k).toFixed(3) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(r.x, r.y, (r.inner + r.outer) / 2, -Math.PI / 2, -Math.PI / 2 + TAU * k);
    ctx.stroke();

    /* 环带爬行电弧：多条不同半径的跳动短弧 */
    ctx.globalCompositeOperation = 'lighter';
    for (var a = 0; a < 6; a++) {
      var aa = t * 1.5 + a / 6 * TAU;
      var rr = r.inner + (r.outer - r.inner) * (0.5 + 0.35 * Math.sin(t * 3 + a * 1.7));
      ctx.strokeStyle = 'rgba(127,240,255,' + (0.22 + 0.18 * k).toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rr, aa, aa + 0.22);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* [FX] 雷墙：整面暗色雷暴幕墙 + 两个缺口 + 边缘折线电弧 */
function stormDrawWall(st) {
  var w = st.wall;
  if (!w) return;
  var o = w.origin, span = w.span;
  var half = w.width * 0.5;
  var g0 = w.gaps[0], g1 = w.gaps[1];
  var gap = STORM.wall.gapHalf;
  var segs = [
    [o, g0 - gap],
    [g0 + gap, g1 - gap],
    [g1 + gap, o + span]
  ];
  var active = w.active;
  var alpha = active ? 0.5 : 0.26;

  ctx.save();
  for (var i = 0; i < segs.length; i++) {
    var s0 = segs[i][0], s1 = segs[i][1];
    if (s1 <= s0) continue;
    if (w.axis === 'x') {
      var gx = ctx.createLinearGradient(w.pos - half, 0, w.pos + half, 0);
      gx.addColorStop(0, 'rgba(50,80,135,0)');
      gx.addColorStop(0.5, 'rgba(50,80,135,' + alpha.toFixed(3) + ')');
      gx.addColorStop(1, 'rgba(50,80,135,0)');
      ctx.fillStyle = gx;
      ctx.fillRect(w.pos - half, s0, w.width, s1 - s0);

      // 墙内流动电流横纹
      ctx.strokeStyle = 'rgba(127,240,255,' + (active ? 0.22 : 0.12).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = -t * 40;
      for (var fl = 1; fl <= 3; fl++) {
        var fy = s0 + (s1 - s0) * fl / 4;
        ctx.beginPath(); ctx.moveTo(w.pos - half, fy); ctx.lineTo(w.pos + half, fy); ctx.stroke();
      }
      ctx.setLineDash([]);

      // 前后缘双层光刃
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(219,232,255,' + (active ? 0.75 : 0.4).toFixed(3) + ')';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(w.pos - half, s0); ctx.lineTo(w.pos - half, s1);
      ctx.moveTo(w.pos + half, s0); ctx.lineTo(w.pos + half, s1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (active ? 0.5 : 0.25).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w.pos - half, s0); ctx.lineTo(w.pos - half, s1);
      ctx.moveTo(w.pos + half, s0); ctx.lineTo(w.pos + half, s1);
      ctx.stroke();

      var wp = stormBoltPoints(w.pos, s0, w.pos, s1, i * 17 + w.pos, 6);
      ctx.strokeStyle = 'rgba(219,232,255,0.6)';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(wp[0].x, wp[0].y);
      for (var p = 1; p < wp.length; p++) ctx.lineTo(wp[p].x, wp[p].y);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      var gy = ctx.createLinearGradient(0, w.pos - half, 0, w.pos + half);
      gy.addColorStop(0, 'rgba(50,80,135,0)');
      gy.addColorStop(0.5, 'rgba(50,80,135,' + alpha.toFixed(3) + ')');
      gy.addColorStop(1, 'rgba(50,80,135,0)');
      ctx.fillStyle = gy;
      ctx.fillRect(s0, w.pos - half, s1 - s0, w.width);

      ctx.strokeStyle = 'rgba(127,240,255,' + (active ? 0.22 : 0.12).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = -t * 40;
      for (var fl2 = 1; fl2 <= 3; fl2++) {
        var fx = s0 + (s1 - s0) * fl2 / 4;
        ctx.beginPath(); ctx.moveTo(fx, w.pos - half); ctx.lineTo(fx, w.pos + half); ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(219,232,255,' + (active ? 0.75 : 0.4).toFixed(3) + ')';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(s0, w.pos - half); ctx.lineTo(s1, w.pos - half);
      ctx.moveTo(s0, w.pos + half); ctx.lineTo(s1, w.pos + half);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (active ? 0.5 : 0.25).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s0, w.pos - half); ctx.lineTo(s1, w.pos - half);
      ctx.moveTo(s0, w.pos + half); ctx.lineTo(s1, w.pos + half);
      ctx.stroke();

      var wp2 = stormBoltPoints(s0, w.pos, s1, w.pos, i * 17 + w.pos, 6);
      ctx.strokeStyle = 'rgba(219,232,255,0.6)';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(wp2[0].x, wp2[0].y);
      for (var p2 = 1; p2 < wp2.length; p2++) ctx.lineTo(wp2[p2].x, wp2[p2].y);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // 缺口安全门：青色半透明门 + 两侧光柱高亮
  ctx.globalCompositeOperation = 'lighter';
  for (var g = 0; g < 2; g++) {
    var gc = w.gaps[g];
    if (w.axis === 'x') {
      var doorG = ctx.createLinearGradient(w.pos - half, 0, w.pos + half, 0);
      doorG.addColorStop(0, 'rgba(127,240,255,0)');
      doorG.addColorStop(0.5, 'rgba(127,240,255,' + (active ? 0.28 : 0.16).toFixed(3) + ')');
      doorG.addColorStop(1, 'rgba(127,240,255,0)');
      ctx.fillStyle = doorG;
      ctx.fillRect(w.pos - half, gc - gap, w.width, gap * 2);
      ctx.strokeStyle = 'rgba(127,240,255,' + (active ? 0.8 : 0.5).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(w.pos - half, gc - gap); ctx.lineTo(w.pos + half, gc - gap);
      ctx.moveTo(w.pos - half, gc + gap); ctx.lineTo(w.pos + half, gc + gap);
      ctx.stroke();
    } else {
      var doorG2 = ctx.createLinearGradient(0, w.pos - half, 0, w.pos + half);
      doorG2.addColorStop(0, 'rgba(127,240,255,0)');
      doorG2.addColorStop(0.5, 'rgba(127,240,255,' + (active ? 0.28 : 0.16).toFixed(3) + ')');
      doorG2.addColorStop(1, 'rgba(127,240,255,0)');
      ctx.fillStyle = doorG2;
      ctx.fillRect(gc - gap, w.pos - half, gap * 2, w.width);
      ctx.strokeStyle = 'rgba(127,240,255,' + (active ? 0.8 : 0.5).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(gc - gap, w.pos - half); ctx.lineTo(gc - gap, w.pos + half);
      ctx.moveTo(gc + gap, w.pos - half); ctx.lineTo(gc + gap, w.pos + half);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

/* [FX] 磁暴牵引：旋转漩涡 + 地面螺旋 + 每名挑战者一条导雷线 */
function stormDrawPull(st) {
  var p = st.pull;
  if (!p) return;
  var prog = 1 - p.t / p.max;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  /* 中心漩涡辉光 */
  var vgR = 130 - prog * 40;
  var vg = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, vgR);
  vg.addColorStop(0, 'rgba(255,255,255,' + (0.30 + 0.25 * prog).toFixed(3) + ')');
  vg.addColorStop(0.35, 'rgba(127,240,255,' + (0.22 + 0.18 * prog).toFixed(3) + ')');
  vg.addColorStop(1, 'rgba(127,240,255,0)');
  ctx.fillStyle = vg;
  ctx.beginPath(); ctx.arc(p.x, p.y, vgR, 0, TAU); ctx.fill();

  /* 阿基米德螺旋臂（两条相位错开、向内收拢） */
  for (var arm = 0; arm < 2; arm++) {
    var rot = t * 2.2 + arm * Math.PI;
    ctx.strokeStyle = 'rgba(127,240,255,' + (0.45 - arm * 0.12).toFixed(3) + ')';
    ctx.lineWidth = 2 - arm * 0.5;
    ctx.beginPath();
    var segs = 36;
    for (var s = 0; s <= segs; s++) {
      var f = s / segs;
      var ang = rot + f * 2.4 * TAU;
      var rr = (118 - prog * 60) * (1 - f * 0.82);
      var px = p.x + Math.cos(ang) * rr;
      var py = p.y + Math.sin(ang) * rr;
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  /* 外圈断续弧 */
  for (var i = 0; i < 3; i++) {
    var rr = 26 + i * 26 + prog * 12;
    ctx.strokeStyle = 'rgba(127,240,255,' + (0.5 - i * 0.12).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, t * 1.4 + i, t * 1.4 + i + 1.5);
    ctx.stroke();
  }

  /* 径向旋臂向内收束 */
  ctx.strokeStyle = 'rgba(185,212,255,0.4)';
  ctx.lineWidth = 1.4;
  for (var sa = 0; sa < 6; sa++) {
    var a2 = t * 1.8 + sa / 6 * TAU;
    var rOut = 120 - prog * 70;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(a2) * 18, p.y + Math.sin(a2) * 18);
    ctx.lineTo(p.x + Math.cos(a2) * rOut, p.y + Math.sin(a2) * rOut);
    ctx.stroke();
  }

  /* 导雷线：每名挑战者到漩涡中心，双层折线 + 流向中心的电荷点 */
  for (var u = 0; u < units.length; u++) {
    var v = units[u];
    if (!v.alive || v.team === p.team || v.boss) continue;
    var pts = stormBoltPoints(v.x, v.y, p.x, p.y, v.seed, 4);
    var la = 0.30 + 0.35 * prog;
    ctx.strokeStyle = 'rgba(127,240,255,' + la.toFixed(3) + ')';
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (var q = 1; q < pts.length; q++) ctx.lineTo(pts[q].x, pts[q].y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,' + (la * 0.8).toFixed(3) + ')';
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (var q2 = 1; q2 < pts.length; q2++) ctx.lineTo(pts[q2].x, pts[q2].y);
    ctx.stroke();
    var cf = (t * 1.5 + v.seed) % 1;
    var cxp = v.x + (p.x - v.x) * cf;
    var cyp = v.y + (p.y - v.y) * cf;
    ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + 0.4 * prog).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(cxp, cyp, 2.2, 0, TAU); ctx.fill();
  }

  /* 中心核心脉冲点 */
  var coreR = 5 + 2 * Math.sin(t * 10) + prog * 3;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath(); ctx.arc(p.x, p.y, coreR, 0, TAU); ctx.fill();
  ctx.restore();
}

/* [FX] 雷牢：四根雷柱 + 四边光束 + 收缩的安全方形 */
function stormDrawCage(st) {
  var c = st.cage;
  if (!c) return;
  var A = ARENA, cx = A.x + A.w / 2, cy = A.y + A.h / 2;
  var half = c.active ? c.half : STORM.cage.half0;
  var k = c.active ? clamp(1 - c.left / STORM.cage.time, 0, 1) : 0;
  var corners = [
    { x: cx - half - 18, y: cy - half - 18 },
    { x: cx + half + 18, y: cy - half - 18 },
    { x: cx + half + 18, y: cy + half + 18 },
    { x: cx - half - 18, y: cy + half + 18 }
  ];
  var edges = [[0, 1], [1, 2], [2, 3], [3, 0]];

  ctx.save();

  /* 牢外危险压暗：场地矩形减去安全方形 */
  ctx.fillStyle = 'rgba(40,24,70,' + (0.20 + 0.12 * k).toFixed(3) + ')';
  ctx.beginPath();
  ctx.rect(A.x, A.y, A.w, A.h);
  ctx.rect(cx - half, cy - half, half * 2, half * 2);
  ctx.fill('evenodd');

  /* 安全方形内部微辉光 */
  var safeG = ctx.createRadialGradient(cx, cy, 10, cx, cy, half);
  safeG.addColorStop(0, 'rgba(127,240,255,' + (0.10 + 0.06 * k).toFixed(3) + ')');
  safeG.addColorStop(1, 'rgba(127,240,255,0)');
  ctx.fillStyle = safeG;
  ctx.fillRect(cx - half, cy - half, half * 2, half * 2);

  /* 四根雷柱：升起光柱 + 柱底雷球辉光 + 分叉小电弧 */
  for (var i = 0; i < corners.length; i++) {
    var c0 = corners[i];
    var pg = ctx.createLinearGradient(0, c0.y - 78, 0, c0.y + 8);
    pg.addColorStop(0, 'rgba(185,138,255,0)');
    pg.addColorStop(1, 'rgba(219,232,255,0.7)');
    ctx.fillStyle = pg;
    ctx.fillRect(c0.x - 5, c0.y - 78, 10, 86);

    var ballG = ctx.createRadialGradient(c0.x, c0.y, 1, c0.x, c0.y, 22);
    ballG.addColorStop(0, 'rgba(255,255,255,0.85)');
    ballG.addColorStop(0.5, 'rgba(185,138,255,0.5)');
    ballG.addColorStop(1, 'rgba(185,138,255,0)');
    ctx.fillStyle = ballG;
    ctx.beginPath(); ctx.arc(c0.x, c0.y, 22, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(c0.x, c0.y, 6, 0, TAU); ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    var bp = stormBoltPoints(c0.x, c0.y - 70, c0.x + (i % 2 ? 8 : -8), c0.y, i * 13, 3);
    ctx.strokeStyle = 'rgba(219,232,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(bp[0].x, bp[0].y);
    for (var qb = 1; qb < bp.length; qb++) ctx.lineTo(bp[qb].x, bp[qb].y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 四边折线光束：外紫宽 + 内白芯，电弧沿边流动 */
  ctx.globalCompositeOperation = 'lighter';
  for (var e = 0; e < edges.length; e++) {
    var p1 = corners[edges[e][0]], p2 = corners[edges[e][1]];
    var pts = stormBoltPoints(p1.x, p1.y, p2.x, p2.y, e * 31 + half, 9);
    ctx.strokeStyle = 'rgba(185,138,255,' + (0.5 + 0.25 * k).toFixed(3) + ')';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (var q = 1; q < pts.length; q++) ctx.lineTo(pts[q].x, pts[q].y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + 0.25 * k).toFixed(3) + ')';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (var q2 = 1; q2 < pts.length; q2++) ctx.lineTo(pts[q2].x, pts[q2].y);
    ctx.stroke();
  }

  /* 安全方形边界 + 四角十字标记 */
  ctx.strokeStyle = 'rgba(219,232,255,' + (0.55 + 0.3 * k).toFixed(3) + ')';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
  ctx.strokeStyle = 'rgba(185,138,255,' + (0.5 + 0.3 * k).toFixed(3) + ')';
  ctx.lineWidth = 1.5;
  var mk = 12;
  for (var cm = 0; cm < 4; cm++) {
    var cc = corners[cm];
    ctx.beginPath();
    ctx.moveTo(cc.x - mk, cc.y); ctx.lineTo(cc.x + mk, cc.y);
    ctx.moveTo(cc.x, cc.y - mk); ctx.lineTo(cc.x, cc.y + mk);
    ctx.stroke();
  }
  ctx.restore();
}
