/* ============================================================
   70-tour-odds.js —— 赛事赔率：后台无渲染快速模拟（第 83 条）
   ------------------------------------------------------------
   目标：赔率跟着版本走 —— 分配完成后，用真实引擎无渲染地跑若干局
        2v2，得到每一场的胜率，替代写死的 TOUR_MATCHUP。

   · 无渲染：把 burst / ring / floater 换成空函数，不调用 render()，
     只跑 tick()；粒子数组每局重建，不会累积
   · 分片：每个 requestAnimationFrame 最多算 ODDS_SLICE_MS，
     一局可以跨帧继续（模拟状态本来就放在引擎全局里）
   · 轮转：先每场各跑 1 局，再每场各跑第 2 局 …… 任何时刻每张卡都有近似值
   · 换边：局数为奇数时交换红蓝阵营，抵消出生侧偏差（与 BO2 第 2 局换边同理）
   · 缓存：按「数值指纹」失效（见 oddsFingerprint），同阵容对局下次直接命中
   · 降级：总计算时间超预算 → 没跑完的场次回落到 TOUR_MATCHUP
   ============================================================ */
'use strict';

/* 规则版本：改碰撞 / 技能结算这类「不改数值也会变结果」的机制时手动 +1，
   让旧缓存整体失效（数值改动则由 oddsFingerprint 里的 TYPES / BALANCE 自动覆盖） */
var ODDS_RULES = 1;

var ODDS_ENABLED = true;
var ODDS_DT = 1 / 30;          // 后台模拟步长：实测 1/30 与 1/60 胜率差 ≤ 5 个百分点（40 局样本内）
/* 局数按「待算场次」分摊总预算，而不是固定值：
   12 场小组赛时每场少跑几局，KO 只剩 2~3 场时每场能跑到 40+ 局。
   单场上限 48 局（24 原方向 + 24 换边），下限保证有意义的样本。 */
var ODDS_CAP_DESKTOP = 48, ODDS_CAP_MOBILE = 24;
var ODDS_TOTAL_DESKTOP = 300, ODDS_TOTAL_MOBILE = 96;
var ODDS_MIN_TARGET_DESKTOP = 16, ODDS_MIN_TARGET_MOBILE = 8;
var ODDS_SLICE_MS = 7;         // 单个 rAF 片的计算上限，给渲染留出 60fps
var ODDS_BUDGET_MS = 16000;    // 桌面总预算（纯计算时间，不含等待帧的墙钟时间）
var ODDS_BUDGET_MOBILE_MS = 6000;  // 低端机预算：跑不满就回落静态矩阵
var ODDS_MIN_N = 6;            // 少于 6 局不覆盖静态矩阵，避免抖动
var ODDS_PRIOR = 6;            // 静态矩阵当先验的等价局数：小样本时把赔率往矩阵拉，避免 4 局全胜 → 100%
var ODDS_KEY = 'mcduel.odds.v1';

/* 30-sim 的 finish() 读它：只记录胜负，不动 DOM / 不触发赛事演出 */
var simHeadless = false;
/* 50-ui / 40-render 读它：后台模拟期间主循环不要再 tick / 不要再绘制 */
var oddsRunning = false;

var oddsRun = null;            // { jobs, idx, target, cur, elapsed }
var oddsCache = { fp: '', pairs: {} };
var oddsFp = '';
var oddsSnap = null;
var oddsFxSaved = null;

function oddsNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/* FNV-1a：把一大串数值压成短指纹 */
function oddsHash(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16);
}

/* 数值指纹：TYPES（函数会被 JSON 丢掉，剩数值/文案）+ BALANCE + 角色池 + 对局时长 */
function oddsFingerprint() {
  if (oddsFp) return oddsFp;
  var pool = [];
  for (var i = 0; i < POOL.length; i++) pool.push([POOL[i].key, POOL[i].units]);
  oddsFp = oddsHash([
    'r' + ODDS_RULES,
    JSON.stringify(TYPES),
    JSON.stringify(BALANCE),
    JSON.stringify(pool),
    'd' + roundDuration
  ].join('|'));
  return oddsFp;
}

function oddsLoadCache() {
  if (oddsCache.fp) return;
  var fp = oddsFingerprint(), raw = null;
  try { raw = localStorage.getItem(ODDS_KEY); } catch (e) { raw = null; }
  if (raw) {
    try {
      var obj = JSON.parse(raw);
      if (obj && obj.fp === fp && obj.pairs) {
        oddsCache = { fp: fp, pairs: obj.pairs };
        return;
      }
      oddsCache = { fp: fp, pairs: {} };
    } catch (e2) {
      oddsCache = { fp: fp, pairs: {} };
    }
  } else {
    oddsCache = { fp: fp, pairs: {} };
  }
}

function oddsSaveCache() {
  if (!oddsCache.fp) return;
  try {
    localStorage.setItem(ODDS_KEY, JSON.stringify({ fp: oddsCache.fp, pairs: oddsCache.pairs }));
  } catch (e) { /* 隐私模式 / 配额满：忽略，内存缓存仍有效 */ }
}

/* ---------- 状态快照：模拟会占用引擎全局，结束后必须还原 ---------- */
function oddsSnapshot() {
  oddsSnap = {
    units: units, particles: particles, rings: rings, floaters: floaters,
    bombs: bombs, arrows: arrows, icePatches: icePatches, anvilMarks: anvilMarks,
    seeds: seeds, vines: vines, reviveQueue: reviveQueue,
    pick: pick, teamSize: teamSize, modeKind: modeKind,
    lineupIndex: lineupIndex, relayTimer: relayTimer,
    t: t, roundTime: roundTime, phase: phase, winner: winner,
    suddenDeath: suddenDeath, suddenStart: suddenStart, deathAcc: deathAcc,
    shake: shake, hitStop: hitStop, paused: paused,
    ax: ARENA.x, aw: ARENA.w
  };
}

function oddsRestore() {
  var s = oddsSnap;
  if (!s) return;
  units = s.units; particles = s.particles; rings = s.rings; floaters = s.floaters;
  bombs = s.bombs; arrows = s.arrows; icePatches = s.icePatches; anvilMarks = s.anvilMarks;
  seeds = s.seeds; vines = s.vines; reviveQueue = s.reviveQueue;
  pick = s.pick; teamSize = s.teamSize; modeKind = s.modeKind;
  lineupIndex = s.lineupIndex; relayTimer = s.relayTimer;
  t = s.t; roundTime = s.roundTime; phase = s.phase; winner = s.winner;
  suddenDeath = s.suddenDeath; suddenStart = s.suddenStart; deathAcc = s.deathAcc;
  shake = s.shake; hitStop = s.hitStop; paused = s.paused;
  ARENA.x = s.ax; ARENA.w = s.aw;
  oddsSnap = null;
}

/* 把纯表现原语静音（它们在每帧被 hurt / 死亡 / 技能调用，是最大的开销） */
function oddsFxSilence() {
  oddsFxSaved = { burst: burst, ring: ring, floater: floater };
  var noop = function () {};
  burst = noop; ring = noop; floater = noop;
}
function oddsFxRestore() {
  if (!oddsFxSaved) return;
  burst = oddsFxSaved.burst; ring = oddsFxSaved.ring; floater = oddsFxSaved.floater;
  oddsFxSaved = null;
}

/* ---------- 单局：用引擎真跑，但不碰 DOM ---------- */
function oddsInitMatch(aRoles, bRoles, swap) {
  units = []; particles = []; rings = []; floaters = []; bombs = []; arrows = []; icePatches = [];
  anvilMarks = []; seeds = []; vines = []; reviveQueue = [];
  resetArena();                       // 场地收窄必须复位，否则第二局起点就错了
  t = 0; roundTime = roundDuration; winner = null;
  suddenDeath = false; deathAcc = 0; suddenStart = 0;
  shake = 0; hitStop = 0;
  lineupIndex = { A: 0, B: 0 };
  relayTimer = { A: 0, B: 0 };
  pick = { A: (swap ? bRoles : aRoles).slice(0, 2), B: (swap ? aRoles : bRoles).slice(0, 2) };
  teamSize = 2;
  modeKind = 'vs';
  for (var i = 0; i < 2; i++) { deployRole('A', i); deployRole('B', i); }
  phase = 'fight';
}

function oddsMaxTicks() {
  // 决杀每秒 5% 最多 20 秒分胜负；再留 15 秒余量给草复活 / 种子
  return Math.ceil((roundDuration + 35) / ODDS_DT);
}

/* ---------- 队列 ---------- */
function oddsIsLowEnd() {
  // 触屏 / 窄屏按低端机估：总预算更小、单场上限更低
  var coarse = (typeof matchMedia === 'function') && matchMedia('(pointer: coarse)').matches;
  return !!(coarse || (typeof window !== 'undefined' && window.innerWidth <= 980));
}
function oddsCap() { return oddsIsLowEnd() ? ODDS_CAP_MOBILE : ODDS_CAP_DESKTOP; }
function oddsTotal() { return oddsIsLowEnd() ? ODDS_TOTAL_MOBILE : ODDS_TOTAL_DESKTOP; }
function oddsMinTarget() { return oddsIsLowEnd() ? ODDS_MIN_TARGET_MOBILE : ODDS_MIN_TARGET_DESKTOP; }
function oddsBudget() { return oddsIsLowEnd() ? ODDS_BUDGET_MOBILE_MS : ODDS_BUDGET_MS; }

/* 每场目标局数 = 总预算 / 待算场次，夹在 [下限, 上限] 之间 */
function oddsTargetFor(count) {
  var t = Math.floor(oddsTotal() / Math.max(1, count));
  return Math.max(oddsMinTarget(), Math.min(oddsCap(), t));
}

/* 遍历所有可计算场次：小组赛 + 胜者组 + 败者组 + 总决赛 */
function oddsEachFx(fn) {
  tour.fixtures.forEach(fn);
  if (tour.ko) {
    tour.ko.wb.forEach(function (rd) { rd.matches.forEach(fn); });
    tour.ko.lb.forEach(function (rd) { rd.matches.forEach(fn); });
    if (tour.ko.gf) fn(tour.ko.gf);
  }
}

function oddsCollect() {
  var list = [];
  var add = function (fx) {
    if (!fx || fx.done || !fx.a || !fx.b || !fx.a.roles || !fx.b.roles) return;
    var a = fx.a.roles.slice(0, 2), b = fx.b.roles.slice(0, 2);
    if (a.length < 2 || b.length < 2) return;
    var ka = a.join('+'), kb = b.join('+');
    var key = ka <= kb ? (ka + '~' + kb) : (kb + '~' + ka);
    var flip = !(ka <= kb);          // 规范键的第一个阵容是 fx.b
    var c = oddsCache.pairs[key];
    var n = c ? c.n : 0;
    // 缓存里 w 记的是「规范键第一阵容」的胜场；flip 时要换算成 fx.a 的胜场
    var w = c ? (flip ? (c.n - c.w) : c.w) : 0;
    fx.sim = { n: n, w: w, ok: n >= ODDS_MIN_N, st: 'wait' };
    list.push({ fx: fx, a: a, b: b, key: key, flip: flip, n: n });
  };
  oddsEachFx(add);

  // 目标局数按「这次真的要算的场次」分摊，并固定在当前赛段里：
  // 否则每打完一场、待算场次变少，target 就会变大，导致所有场次都被反复补跑。
  var target = (tour.oddsN && tour.oddsN > 0) ? tour.oddsN : oddsTargetFor(list.length);
  tour.oddsN = target;
  var jobs = [];
  for (var i = 0; i < list.length; i++) {
    var j = list[i];
    j.fx.sim.st = j.n >= target ? 'done' : (j.n > 0 ? 'run' : 'wait');
    if (j.n < target) jobs.push(j);
  }
  return { jobs: jobs, target: target };
}

function oddsNextJob() {
  var st = oddsRun;
  for (var k = 0; k < st.jobs.length; k++) {
    if (st.idx >= st.jobs.length) st.idx = 0;
    var job = st.jobs[st.idx];
    st.idx++;
    if (job.n >= st.target) continue;
    var swap = (job.n % 2 === 1);
    oddsInitMatch(job.a, job.b, swap);
    st.cur = { job: job, swap: swap, ticks: 0 };
    return true;
  }
  return false;
}

function oddsCachePut(job, aw) {
  var c = oddsCache.pairs[job.key];
  if (!c) c = oddsCache.pairs[job.key] = { n: 0, w: 0 };
  c.n++;
  c.w += job.flip ? (1 - aw) : aw;
}

/* 只重写这一场的胜率文字，不动整块棋盘（避免滚动位置跳动） */
function oddsPaint(fx) {
  var key = tourBetKey(fx);
  var txt = tourFxPct(fx) + '%·' + (100 - tourFxPct(fx)) + '%' + tourFxNote(fx);
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  var els = document.querySelectorAll('[data-prob="' + key + '"]');
  for (var i = 0; i < els.length; i++) els[i].textContent = txt;
}

function oddsEndGame() {
  var st = oddsRun, cur = st.cur, job = cur.job;
  var aw = 0;
  if (winner === 'draw') aw = 0.5;
  else if (!cur.swap && winner === 'A') aw = 1;
  else if (cur.swap && winner === 'B') aw = 1;   // 换边后红方是玩家 b
  job.n++;
  job.fx.sim.n = job.n;
  job.fx.sim.w += aw;
  job.fx.sim.ok = job.n >= ODDS_MIN_N;
  job.fx.sim.st = job.n >= st.target ? 'done' : 'run';
  oddsCachePut(job, aw);
  st.cur = null;
  oddsPaint(job.fx);
}

function oddsForceDraw() {
  winner = 'draw';
  phase = 'over';
  oddsEndGame();
}

/* ---------- 主循环（分片） ---------- */
function oddsAlive() {
  return !!(tour && !tour.cur && tour.stage !== 'done' &&
    el.tourBoard && el.tourBoard.classList.contains('show'));
}

function oddsPump() {
  if (!oddsRun) return;
  if (!oddsAlive()) { tourOddsStop(); return; }

  var t0 = oddsNow(), steps = 0;
  while (oddsRun) {
    if (!oddsRun.cur) {
      if (!oddsNextJob()) { oddsComplete(); return; }
    }
    tick(ODDS_DT);
    steps++;
    if (phase === 'over') {
      oddsEndGame();
    } else if (++oddsRun.cur.ticks > oddsRun.maxTicks) {
      oddsForceDraw();
    }
    if ((steps & 63) === 0 && oddsNow() - t0 > ODDS_SLICE_MS) break;
  }
  if (!oddsRun) return;

  oddsRun.elapsed += oddsNow() - t0;
  if (oddsRun.elapsed > oddsRun.budget) { oddsDegrade(); return; }
  requestAnimationFrame(oddsPump);
}

/* ---------- 开始 / 结束 ---------- */
function oddsStart(jobs, target) {
  oddsSnapshot();
  oddsFxSilence();
  paused = true;                 // 双保险：50-ui 的 frame() 也不会驱动这批状态
  oddsRunning = true;
  simHeadless = true;
  oddsRun = {
    jobs: jobs, idx: 0, target: target || oddsTargetFor(jobs.length), cur: null,
    elapsed: 0, budget: oddsBudget(), maxTicks: oddsMaxTicks()
  };
  for (var i = 0; i < jobs.length; i++) oddsPaint(jobs[i].fx);
  requestAnimationFrame(oddsPump);
}

function tourOddsStop() {
  if (!oddsRun) return;
  oddsRun = null;
  oddsRunning = false;
  simHeadless = false;
  oddsFxRestore();
  oddsRestore();
  oddsSaveCache();
}

/* 全部算完：一次性刷新棋盘（赔率按钮也要换成模拟值） */
function oddsComplete() {
  var count = oddsRun ? oddsRun.jobs.length : 0;
  var target = oddsRun ? oddsRun.target : oddsMinTarget();
  tourOddsStop();
  oddsEachFx(function (fx) {
    if (fx && fx.sim && fx.sim.n < ODDS_MIN_N) fx.sim.st = 'off';
  });
  tourLog('后台模拟完成：' + count + ' 场 · 每场 ' + target + ' 局（' + ODDS_DT.toFixed(3) + 's 步长）');
  oddsRepaint();
}

/* 超时降级：没跑满 ODDS_MIN_N 的场次回落到静态矩阵；tour.oddsOff 防止重渲染后又重跑 */
function oddsDegrade() {
  var off = 0, partial = 0;
  var target = oddsRun ? oddsRun.target : oddsMinTarget();
  oddsEachFx(function (fx) {
    var s = fx && fx.sim;
    if (!s) return;
    if (s.n < ODDS_MIN_N) { s.st = 'off'; s.ok = false; off++; }
    else if (s.n < target) { s.st = 'done'; partial++; }
  });
  tour.oddsOff = true;
  var budget = oddsBudget();
  tourOddsStop();
  tourLog('模拟超时（预算 ' + budget + 'ms）：' + off + ' 场回落静态矩阵，' +
    partial + ' 场用部分样本');
  oddsRepaint();
}

/* 重渲染并保持滚动位置：
   tourRender() 内部已对全部 [data-scroll] 容器拍快照 / 还原（第 84 条），
   这里不再单独保存 .tour-board.scrollTop（那只覆盖页面最外层，管不到组内名单 / 赛程图）。 */
function oddsRepaint() {
  tourRender();
}

/* 由 60-tournament 的 tourRender() 调用：幂等，已经在跑就直接返回 */
function tourOddsKick() {
  if (!ODDS_ENABLED || oddsRun) return;
  if (!tour || tour.oddsOff) return;     // 已经降级过，这一届不再重算
  if (!oddsAlive()) return;
  oddsLoadCache();
  var list = oddsCollect();
  if (!list.jobs.length) return;
  oddsStart(list.jobs, list.target);
}

/* 页面卸载前把缓存落盘（localStorage 本来就是同步的，这里只是保险） */
window.addEventListener('pagehide', function () { if (oddsRun) tourOddsStop(); });
