#!/usr/bin/env node
/* ============================================================
   tools/sim2v2.js —— 2v2 角色综合强度测算
   ------------------------------------------------------------
   与 tools/sim.js 同源：Node + 最小 DOM/Canvas 桩，加载真实引擎
   （00-base → items/* → 10-core → 30-sim），逐 tick 跑完一局。

   口径：
     · 2v2 同时上场（teamSize=2 / modeKind='vs'），双方各自 2 个不重复角色
     · 角色池 9 个 → 36 个双人组合，组合间全循环（630 组对位）
     · 每组对位跑「正向 + 反向」两局，抵消出生侧偏差；平局按 0.5 胜
     · 每局种子由基种子 + 组合下标 + 局号决定，可复现

   除「出场胜率」，额外给两项去搭档噪声的指标：
     · 拟合强度：pair 强度 = 两个角色的加性 logit，用全部对局做逻辑回归，
       拆掉「和谁搭档」的影响；强度分 0 = 全角色均值
     · 协同残差：实测胜率 − 加性模型的预测胜率，用来找 1+1>2 的组合

   用法（在仓库根目录）：
     node tools/sim2v2.js                # 每组对位双向各 2 局（默认）
     node tools/sim2v2.js --n 4          # 样本翻倍
     node tools/sim2v2.js --dur 120      # 对局时长（默认 180）
     node tools/sim2v2.js --dt 0.0333    # 模拟步长（默认 1/60，赛事赔率用 1/30）
     node tools/sim2v2.js --json out.json
     node tools/sim2v2.js --sample 10    # 只计时，不出结果
   本脚本只读 js/ 下的代码，不写任何文件（--json 除外）。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
function argNum(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : def;
}
function argStr(name, def) {
  const i = argv.indexOf('--' + name);
  return i < 0 ? def : argv[i + 1];
}
const PER_DIR = Math.max(1, argNum('n', 2));
const DURATION = argNum('dur', 180);
const DT = argNum('dt', 1 / 60);
const SEED_BASE = argNum('seed', 20261121);
const JSON_OUT = argStr('json', '');
const SAMPLE = argNum('sample', 0);

/* ---------------- 最小 DOM / Canvas 桩（同 sim.js） ---------------- */
function makeCtx2d() {
  const target = { canvas: { width: 0, height: 0 } };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function makeEl(tag) {
  const el = {
    tagName: tag || 'div',
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    title: '',
    className: '',
    width: 0,
    height: 0,
    children: [],
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; }
    },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    appendChild(c) { el.children.push(c); return c; },
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { width: 1290, height: 600, left: 0, top: 0 }; },
    getContext() { return makeCtx2d(); }
  };
  return el;
}

const sandbox = {
  console,
  Math, Date, JSON,
  setTimeout, clearTimeout,
};

sandbox.window = {
  devicePixelRatio: 1,
  innerWidth: 1290,
  innerHeight: 600,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {} }; },
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
  requestAnimationFrame() { return 0; }
};
const doc = {
  body: makeEl('body'),
  documentElement: makeEl('html'),
  getElementById() { return makeEl(); },
  querySelector() { return makeEl(); },
  querySelectorAll() { return []; },
  createElement(tag) { return makeEl(tag); },
  addEventListener() {},
  removeEventListener() {}
};
sandbox.document = doc;
sandbox.navigator = { clipboard: null, userAgent: 'node-sim' };
sandbox.localStorage = sandbox.window.localStorage;
sandbox.requestAnimationFrame = sandbox.window.requestAnimationFrame;

vm.createContext(sandbox);

/* ---------------- 加载引擎（只读） ---------------- */
function load(rel) {
  const file = path.join(JS_DIR, rel);
  const code = fs.readFileSync(file, 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

load('00-base.js');
fs.readdirSync(path.join(JS_DIR, 'items'))
  .filter(function (f) { return /\.js$/.test(f) && f !== 'pool.js'; })
  .sort()
  .forEach(function (f) { load(path.join('items', f)); });
load(path.join('items', 'pool.js'));
load('10-core.js');
load('25-field.js');
load('30-sim.js');

/* ---------------- 2v2 对局驱动 ---------------- */
vm.runInContext(`
burst = function () {}; ring = function () {}; floater = function () {};
simHeadless = true;
paused = false;

function __sim2v2Init(a, b, seed, dur, dt) {
  units = []; particles = []; rings = []; floaters = []; bombs = []; arrows = [];
  icePatches = []; ultBeams = []; waters = []; anvilMarks = [];
  seeds = []; vines = []; reviveQueue = [];
  // 先写阵容再复位场地：arenaStartBox() 按 pickUnitCount() 决定开局尺寸
  pick = { A: a.slice(0, 2), B: b.slice(0, 2) };
  teamSize = 2;
  modeKind = 'vs';
  resetArena();
  t = 0; roundTime = dur; winner = null;
  suddenDeath = false; deathAcc = 0; suddenStart = 0;
  shake = 0; hitStop = 0;
  lineupIndex = { A: 0, B: 0 };
  relayTimer = { A: 0, B: 0 };
  seedSim(seed >>> 0);
  resetField();
  deployRole('A', 0); deployRole('A', 1);
  deployRole('B', 0); deployRole('B', 1);
  phase = 'fight';
}

function __sim2v2(a, b, seed, dur, dt) {
  __sim2v2Init(a, b, seed, dur, dt);

  var guard = 0, maxTicks = Math.ceil((dur + 45) / dt);
  while (phase === 'fight' && guard < maxTicks) { tick(dt); guard++; }
  if (phase === 'fight') finish('time');

  return {
    winner: winner,
    seconds: t,
    ticks: guard,
    death: suddenDeath,
    aHp: teamHp('A').cur,
    bHp: teamHp('B').cur,
    dealt: __roleDealt()
  };
}

/* 每个角色（按 pick 里的位置）本局造成的总伤害，用于平衡诊断 */
function __roleDealt() {
  var out = {};
  for (var ti = 0; ti < 2; ti++) {
    var team = ti ? 'B' : 'A';
    var keys = pick[team] || [];
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.team !== team) continue;
      var k = keys[u.roleIdx];
      if (!k) continue;
      out[k] = (out[k] || 0) + (u.dealt || 0);
    }
  }
  return out;
}

/* 诊断：每 every 秒打一行「双方剩余血量 / 已造成伤害 / 存活数 / 单位血量」 */
function __sim2v2Probe(a, b, seed, dur, dt, every) {
  __sim2v2Init(a, b, seed, dur, dt);

  function snap(team) {
    var hp = 0, max = 0, dealt = 0, alive = 0, list = [];
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.team !== team) continue;
      hp += Math.max(0, u.hp); max += u.maxHp; dealt += u.dealt;
      if (u.alive) alive++;
      list.push(u.name + ':' + Math.round(u.hp) + '/' + Math.round(u.maxHp));
    }
    return { hp: Math.round(hp), max: Math.round(max), dealt: Math.round(dealt), alive: alive, list: list };
  }

  var log = [], guard = 0, maxTicks = Math.ceil((dur + 45) / dt);
  var step = Math.max(1, Math.round(every / dt));
  while (phase === 'fight' && guard < maxTicks) {
    tick(dt); guard++;
    if (guard % step === 0) log.push({ t: Math.round(t), a: snap('A'), b: snap('B') });
  }
  if (phase === 'fight') finish('time');
  return { log: log, winner: winner, seconds: t, final: { a: snap('A'), b: snap('B') } };
}
`, sandbox, { filename: 'tools/sim2v2.js#harness' });

const KEYS = sandbox.POOL.map(function (p) { return p.key; });
const LABEL = {}, UNITS = {}, ROLE = {};
sandbox.POOL.forEach(function (p) {
  LABEL[p.key] = p.short;
  UNITS[p.key] = p.units.length;
  ROLE[p.key] = p.role;
});

/* ---------------- 36 个双人组合 ---------------- */
const PAIRS = [];
for (let i = 0; i < KEYS.length; i++) {
  for (let j = i + 1; j < KEYS.length; j++) {
    PAIRS.push({ key: KEYS[i] + '+' + KEYS[j], roles: [KEYS[i], KEYS[j]] });
  }
}
const PAIR_BY_KEY = {};
PAIRS.forEach(function (p) { PAIR_BY_KEY[p.key] = p; });

/* ---------------- 诊断模式：--probe "grass+anvil,spear+bow" ---------------- */
const PROBE = argStr('probe', '');
if (PROBE) {
  const sides = PROBE.split(',');
  const a = (sides[0] || '').split('+'), b = (sides[1] || '').split('+');
  const bad = a.concat(b).filter(function (k) { return KEYS.indexOf(k) < 0; });
  if (a.length !== 2 || b.length !== 2 || bad.length) {
    console.error('用法：--probe "角色A+角色B,角色C+角色D"（可用：' + KEYS.join(',') + '）');
    process.exit(1);
  }
  const r = sandbox.__sim2v2Probe(a, b, SEED_BASE, DURATION, DT, argNum('every', 5));
  const line = function (s) { return pad(s.hp + '/' + s.max, 11) + pad(s.dealt, 8) + pad(s.alive, 4); };
  console.log('');
  console.log('诊断：' + a.map(function (k) { return LABEL[k]; }).join('+') + '（A） vs ' +
    b.map(function (k) { return LABEL[k]; }).join('+') + '（B） · ' + DURATION + 's · seed ' + SEED_BASE);
  console.log(pad(' t', 6) + pad('A 血量/上限', 12) + pad('伤害', 8) + pad('存活', 5) +
    pad('B 血量/上限', 12) + pad('伤害', 8) + '存活');
  r.log.forEach(function (row) {
    console.log(pad(row.t + 's', 6) + line(row.a) + line(row.b));
  });
  console.log('');
  console.log('结果：' + r.winner + ' 胜 · ' + r.seconds.toFixed(1) + 's');
  console.log('  A 终局：' + r.final.a.list.join(' | '));
  console.log('  B 终局：' + r.final.b.list.join(' | '));
  process.exit(0);
}

/* ---------------- 计时模式 ---------------- */
if (SAMPLE > 0) {
  const t0 = Date.now();
  let deaths = 0;
  for (let i = 0; i < SAMPLE; i++) {
    const pa = PAIRS[i % PAIRS.length], pb = PAIRS[(i * 7 + 3) % PAIRS.length];
    const r = sandbox.__sim2v2(pa.roles, pb.roles, (SEED_BASE + i * 131) >>> 0, DURATION, DT);
    if (r.death) deaths++;
  }
  const ms = (Date.now() - t0) / SAMPLE;
  console.log('样本 ' + SAMPLE + ' 局 · 平均 ' + ms.toFixed(1) + 'ms/局 · 决杀 ' + deaths + ' 局');
  process.exit(0);
}

/* ---------------- 跑全循环（支持分片 / 合并） ---------------- */
const SHARD = argStr('shard', '');      // "k/m"：只跑第 k 片（630 组对位按序号取模）
const RAW_OUT = argStr('raw', '');      // 分片原始结果路径
const MERGE = argStr('merge', '');      // 逗号分隔的分片原始结果

const pairStat = {};   // pairKey -> { n, w }
PAIRS.forEach(function (p) { pairStat[p.key] = { n: 0, w: 0 }; });
const roleStat = {};
KEYS.forEach(function (k) { roleStat[k] = { n: 0, w: 0 }; });
const roleDealt = {};
KEYS.forEach(function (k) { roleDealt[k] = 0; });

const games = [];      // 逻辑回归样本 { a:[k1,k2], b:[k1,k2], y, w }
let durations = [];
let deathGames = 0, draws = 0, matches = 0;

let SHARD_K = 0, SHARD_M = 1;
if (SHARD) {
  const spec = SHARD.split('/');
  SHARD_K = Number(spec[0]) || 0;
  SHARD_M = Math.max(1, Number(spec[1]) || 1);
}

const t0 = Date.now();

if (MERGE) {
  /* ---- 合并模式：只读分片结果，不跑模拟 ---- */
  MERGE.split(',').forEach(function (f) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));
    Object.keys(raw.pairStat).forEach(function (k) {
      if (!pairStat[k]) return;
      pairStat[k].n += raw.pairStat[k].n;
      pairStat[k].w += raw.pairStat[k].w;
    });
    Object.keys(raw.roleStat).forEach(function (k) {
      if (!roleStat[k]) return;
      roleStat[k].n += raw.roleStat[k].n;
      roleStat[k].w += raw.roleStat[k].w;
    });
    if (raw.roleDealt) {
      Object.keys(raw.roleDealt).forEach(function (k) {
        if (roleDealt[k] !== undefined) roleDealt[k] += raw.roleDealt[k];
      });
    }
    raw.games.forEach(function (g) { games.push(g); });
    raw.durations.forEach(function (d) { durations.push(d); });
    deathGames += raw.deathGames;
    draws += raw.draws;
    matches += raw.matches;
  });
} else {
  /* ---- 模拟模式：跑自己负责的对位 ---- */
  function run(a, b, seed) {
    return sandbox.__sim2v2(a, b, seed >>> 0, DURATION, DT);
  }

  for (let i = 0; i < PAIRS.length; i++) {
    for (let j = i + 1; j < PAIRS.length; j++) {
      if ((i * PAIRS.length + j) % SHARD_M !== SHARD_K) continue;
      const pa = PAIRS[i], pb = PAIRS[j];
      for (let k = 0; k < PER_DIR; k++) {
        const r1 = run(pa.roles, pb.roles, SEED_BASE + k * 7919 + i * 131 + j);
        const r2 = run(pb.roles, pa.roles, SEED_BASE + 104729 + k * 7919 + i * 131 + j);
        matches += 2;

        // 正向局：A 侧是 pa
        const aw = r1.winner === 'A' ? 1 : (r1.winner === 'B' ? 0 : 0.5);
        // 反向局：A 侧是 pb，换算成 pa 视角
        const aw2 = r2.winner === 'B' ? 1 : (r2.winner === 'A' ? 0 : 0.5);

        pairStat[pa.key].n += 2; pairStat[pa.key].w += aw + aw2;
        pairStat[pb.key].n += 2; pairStat[pb.key].w += (1 - aw) + (1 - aw2);

        // 角色出场胜率：pa 的两个角色都记 aw，pb 的都记 1-aw
        pa.roles.forEach(function (key) { roleStat[key].n += 2; roleStat[key].w += aw + aw2; });
        pb.roles.forEach(function (key) { roleStat[key].n += 2; roleStat[key].w += (1 - aw) + (1 - aw2); });

        // 场均伤害：两个方向各记一次
        [r1, r2].forEach(function (res) {
          Object.keys(res.dealt).forEach(function (key) {
            if (roleDealt[key] !== undefined) roleDealt[key] += res.dealt[key];
          });
        });

        // 一组对位只记一条样本：两个方向合并，权重 = 局数
        games.push({ a: pa.roles, b: pb.roles, y: (aw + aw2) / 2, w: 2 });

        if (r1.winner === 'draw') draws++;
        if (r2.winner === 'draw') draws++;
        if (r1.death) deathGames++;
        if (r2.death) deathGames++;
        durations.push(r1.seconds, r2.seconds);
      }
    }
  }

  if (RAW_OUT) {
    fs.writeFileSync(path.resolve(ROOT, RAW_OUT), JSON.stringify({
      shard: SHARD, dur: DURATION, dt: DT, perDir: PER_DIR, seed: SEED_BASE,
      pairStat: pairStat, roleStat: roleStat, roleDealt: roleDealt, games: games,
      durations: durations, deathGames: deathGames, draws: draws, matches: matches
    }) + '\n', 'utf8');
    console.log('分片完成：' + matches + ' 局 · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's → ' + RAW_OUT);
    process.exit(0);
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

/* ---------------- 加性强度拟合（pair 强度 = s1 + s2，逻辑回归 / 牛顿法） ---------------- */
function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

const s = {};
KEYS.forEach(function (k) { s[k] = 0; });
const RIDGE = 0.02;            // 极弱正则，只为防止某角色样本全胜时发散

function solve(A, b) {         // 9×9 高斯-约当消元（带部分主元）
  const n = b.length;
  const M = A.map(function (row, i) { return row.concat([b[i]]); });
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) continue;
    const tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
    const d = M[c][c];
    for (let k = c; k <= n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map(function (row) { return row[n]; });
}

let fitIter = 0, fitDelta = 1;
while (fitIter < 40 && fitDelta > 1e-9) {
  fitIter++;
  const g = KEYS.map(function () { return 0; });
  const H = KEYS.map(function () { return KEYS.map(function () { return 0; }); });
  games.forEach(function (rec) {
    const ia = KEYS.indexOf(rec.a[0]), ib = KEYS.indexOf(rec.a[1]);
    const ic = KEYS.indexOf(rec.b[0]), id = KEYS.indexOf(rec.b[1]);
    const z = s[rec.a[0]] + s[rec.a[1]] - s[rec.b[0]] - s[rec.b[1]];
    const p = sigmoid(z);
    const d = rec.w * (rec.y - p);
    const v = rec.w * p * (1 - p);
    g[ia] += d; g[ib] += d; g[ic] -= d; g[id] -= d;
    // x = [+1, +1, -1, -1]，H += v · xxᵀ
    const idx = [ia, ib, ic, id], sgn = [1, 1, -1, -1];
    for (let m = 0; m < 4; m++) {
      for (let n2 = 0; n2 < 4; n2++) {
        H[idx[m]][idx[n2]] += v * sgn[m] * sgn[n2];
      }
    }
  });
  const n = KEYS.length;
  for (let i = 0; i < n; i++) {
    g[i] -= RIDGE * s[KEYS[i]];
    H[i][i] += RIDGE;
  }
  const step = solve(H, g);
  fitDelta = 0;
  KEYS.forEach(function (k, i) {
    s[k] += step[i];
    fitDelta = Math.max(fitDelta, Math.abs(step[i]));
  });
}
// 中心化：均值 = 0
const meanS = KEYS.reduce(function (a, k) { return a + s[k]; }, 0) / KEYS.length;
KEYS.forEach(function (k) { s[k] -= meanS; });

/* 加性模型的拟合优度：组合实测胜率 vs 模型预测 */
const fitRows = PAIRS.map(function (p) {
  const obs = pairStat[p.key].w / pairStat[p.key].n;
  // 对手按 36 个组合等权（全部组合各打一遍），平均对手强度 = 2 * E[s]
  const pred = sigmoid(s[p.roles[0]] + s[p.roles[1]] - 2 * meanS);
  return { key: p.key, roles: p.roles, n: pairStat[p.key].n, obs: obs, pred: pred, resid: obs - pred };
});

/* ---------------- 输出 ---------------- */
function pct(w, n) { return n ? Math.round((w / n) * 1000) / 10 : 0; }
function pad(str, n) {
  str = String(str);
  let out = str, width = 0;
  for (const ch of str) width += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  while (width < n) { out += ' '; width++; }
  return out;
}
function signed(v, d) { return (v >= 0 ? '+' : '') + v.toFixed(d === undefined ? 1 : d); }

console.log('');
console.log('MC 方块对决 · 2v2 角色综合强度');
console.log('36 个双人组合全循环 · 每组对位双向各 ' + PER_DIR + ' 局 · 时长 ' + DURATION +
  's · 步长 1/' + Math.round(1 / DT) + ' · 共 ' + matches + ' 局 · 用时 ' + elapsed + 's');
console.log('');

/* 1) 综合强度排行 */
console.log('【综合强度排行】（出场胜率 = 在全部搭档 / 全部对手下的平均胜率）');
console.log(pad('#', 4) + pad('角色', 9) + pad('出场胜率', 10) + pad('拟合强度', 10) +
  pad('平均阵容下胜率', 15) + pad('场均伤害', 10) + '样本');
const rank = KEYS.slice().sort(function (a, b) {
  return (roleStat[b].w / roleStat[b].n) - (roleStat[a].w / roleStat[a].n);
});
rank.forEach(function (k, idx) {
  const t = roleStat[k];
  const v = pct(t.w, t.n);
  const avgWin = sigmoid(s[k]) * 100;   // 搭档为「平均水平」时对平均阵容的胜率
  const avgDealt = t.n ? roleDealt[k] / t.n : 0;
  console.log(pad(idx + 1, 4) + pad(LABEL[k], 9) + pad(v.toFixed(1) + '%', 10) +
    pad(signed(s[k] * 100, 0), 10) + pad(avgWin.toFixed(1) + '%', 15) +
    pad(Math.round(avgDealt), 10) + t.n);
});

/* 2) 搭档矩阵：行角色 + 列搭档的胜率 */
console.log('');
console.log('【搭档胜率矩阵】行 + 列 的双人组合胜率 %（同一组合两个方向对称，样本 ' +
  (pairStat[PAIRS[0].key].n) + ' 局）');
let head = pad('', 9);
KEYS.forEach(function (k) { head += pad(LABEL[k], 9); });
console.log(head);
KEYS.forEach(function (k, i) {
  let row = pad(LABEL[k], 9);
  KEYS.forEach(function (m, j) {
    if (i === j) { row += pad('—', 9); return; }
    const key = i < j ? k + '+' + m : m + '+' + k;
    const st = pairStat[key];
    row += pad(pct(st.w, st.n).toFixed(0), 9);
  });
  console.log(row);
});

/* 3) 组合强弱 */
function pairLine(p, withResid) {
  const obs = pct(pairStat[p.key].w, pairStat[p.key].n);
  const row = fitRows.find(function (r) { return r.key === p.key; });
  let line = pad(p.roles.map(function (k) { return LABEL[k]; }).join(' + '), 18) +
    pad(obs.toFixed(1) + '%', 8);
  if (withResid) line += pad(signed(row.resid * 100, 1), 10) + pad((row.pred * 100).toFixed(1) + '%', 10);
  return line;
}
const byObs = PAIRS.slice().sort(function (a, b) {
  return (pairStat[b.key].w / pairStat[b.key].n) - (pairStat[a.key].w / pairStat[a.key].n);
});
console.log('');
console.log('【最强 6 个组合】');
byObs.slice(0, 6).forEach(function (p) { console.log('  ' + pairLine(p, false)); });
console.log('');
console.log('【最弱 6 个组合】');
byObs.slice(-6).reverse().forEach(function (p) { console.log('  ' + pairLine(p, false)); });

/* 4) 协同残差：实测 − 加性预测 */
console.log('');
console.log('【协同残差】实测胜率 − 加性模型预测（>0 = 1+1>2，<0 = 互相拖累）');
const byResid = fitRows.slice().sort(function (a, b) { return b.resid - a.resid; });
console.log('  最强协同');
byResid.slice(0, 5).forEach(function (r) {
  console.log('    ' + pad(r.roles.map(function (k) { return LABEL[k]; }).join(' + '), 18) +
    pad(signed(r.resid * 100, 1), 9) + '  实测 ' + (r.obs * 100).toFixed(1) +
    '% / 预测 ' + (r.pred * 100).toFixed(1) + '%');
});
console.log('  最弱协同');
byResid.slice(-5).reverse().forEach(function (r) {
  console.log('    ' + pad(r.roles.map(function (k) { return LABEL[k]; }).join(' + '), 18) +
    pad(signed(r.resid * 100, 1), 9) + '  实测 ' + (r.obs * 100).toFixed(1) +
    '% / 预测 ' + (r.pred * 100).toFixed(1) + '%');
});

/* 5) 每角色搭档表现 */
console.log('');
console.log('【各角色搭档表现】只列每个角色最好的 2 个 / 最差的 2 个搭档');
rank.forEach(function (k) {
  const list = PAIRS.filter(function (p) { return p.roles.indexOf(k) >= 0; })
    .map(function (p) {
      return { partner: p.roles[0] === k ? p.roles[1] : p.roles[0], v: pairStat[p.key].w / pairStat[p.key].n };
    })
    .sort(function (a, b) { return b.v - a.v; });
  const top = list.slice(0, 2).map(function (x) { return LABEL[x.partner] + ' ' + (x.v * 100).toFixed(1) + '%'; });
  const bot = list.slice(-2).reverse().map(function (x) { return LABEL[x.partner] + ' ' + (x.v * 100).toFixed(1) + '%'; });
  console.log('  ' + pad(LABEL[k], 8) + ' 最佳：' + pad(top.join(' / '), 26) + ' 最差：' + bot.join(' / '));
});

/* 6) 对局统计 */
const avgDur = durations.reduce(function (a, b) { return a + b; }, 0) / durations.length;
console.log('');
console.log('平均单局 ' + avgDur.toFixed(1) + 's · 进入决杀 ' + deathGames + ' 局（' +
  (deathGames / matches * 100).toFixed(1) + '%）· 平局 ' + draws + ' 局');
console.log('拟合迭代 ' + fitIter + ' 次');

if (JSON_OUT) {
  const out = {
    version: sandbox.APP_VERSION,
    dmgScale: sandbox.BALANCE.dmgScale,
    mode: '2v2-vs', duration: DURATION, dt: DT, perDir: PER_DIR, seed: SEED_BASE,
    matches: matches, avgSeconds: Math.round(avgDur * 10) / 10,
    suddenDeathRate: Math.round(deathGames / matches * 1000) / 10,
    roles: rank.map(function (k) {
      return {
        key: k, name: LABEL[k], role: ROLE[k], units: UNITS[k],
        win: pct(roleStat[k].w, roleStat[k].n), n: roleStat[k].n,
        rating: Math.round(s[k] * 1000) / 1000,
        avgPartnerWin: Math.round(sigmoid(s[k]) * 1000) / 10,
        avgDealt: roleStat[k].n ? Math.round(roleDealt[k] / roleStat[k].n) : 0
      };
    }),
    pairs: byObs.map(function (p) {
      const r = fitRows.find(function (x) { return x.key === p.key; });
      return {
        key: p.key, win: pct(pairStat[p.key].w, pairStat[p.key].n), n: pairStat[p.key].n,
        pred: Math.round(r.pred * 1000) / 10, resid: Math.round(r.resid * 1000) / 10
      };
    })
  };
  fs.writeFileSync(path.resolve(ROOT, JSON_OUT), JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('\n已写出 ' + JSON_OUT);
}
