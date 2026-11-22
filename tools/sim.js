#!/usr/bin/env node
/* ============================================================
   tools/sim.js —— 常驻无头对位矩阵（1v1）
   ------------------------------------------------------------
   为什么要有这个文件：以前每次改数值都临时写一个 Node 桩脚本，
   跑完就删，文档里的对位表因此永远停在旧版本（420/360 血时代）。
   这里把桩固化下来：只用 Node 内置模块 + 最小 DOM/Canvas 桩，
   加载 00-base → items/* → 10-core → 30-sim，用真实引擎逐 tick 跑完一局。

   用法（在仓库根目录）：
     node tools/sim.js                 # 9×9，每个对位双向各 12 局
     node tools/sim.js --n 30          # 每个对位双向各 30 局
     node tools/sim.js --dur 120       # 对局时长 120s（默认 180）
     node tools/sim.js --seed 20261121 # 固定种子基（默认按日期算）
     node tools/sim.js --json out.json # 额外输出机器可读结果

   口径：
     · 每个对位都跑「A 先手」与「B 先手」两个方向，抵消出生侧偏差；
     · 平局按 0.5 胜计；胜率 = 该角色在对位中拿到的分数 / 局数；
     · 决杀（每秒 -5% 最大生命）与草复活都照常参与，最长 dur+45 秒。
   注意：本脚本只读 js/ 下的代码，不写任何文件（--json 除外）。
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
const PER_DIR = Math.max(1, argNum('n', 12));
const DURATION = argNum('dur', 180);
const SEED_BASE = argNum('seed', 20261121);
const JSON_OUT = argStr('json', '');

/* ---------------- 最小 DOM / Canvas 桩 ---------------- */
function makeCtx2d() {
  // 绘图 API 在本脚本里完全不会被调用（40-render 不加载），
  // 但 00-base 的 fitCanvas() 在加载时就会 setTransform，所以必须可调用。
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

/* ---------------- 加载引擎（只读，按 00 → items → 10 → 30 的顺序）--------------- */
function load(rel) {
  const file = path.join(JS_DIR, rel);
  const code = fs.readFileSync(file, 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

load('00-base.js');
const itemFiles = fs.readdirSync(path.join(JS_DIR, 'items'))
  .filter(function (f) { return /\.js$/.test(f) && f !== 'pool.js'; })
  .sort();
itemFiles.forEach(function (f) { load(path.join('items', f)); });
load(path.join('items', 'pool.js'));
load('10-core.js');
load('25-field.js');
load('30-sim.js');

/* ---------------- 对局驱动（注入到 vm 里，才能操作引擎的顶层变量）--------------- */
vm.runInContext(`
/* 表现原语静音：对位矩阵只关心胜负，粒子 / 震屏 / 音效全部跳过 */
burst = function () {};
ring = function () {};
floater = function () {};
simHeadless = true;
paused = false;

function __simMatch(ka, kb, seed, dur) {
  units = []; particles = []; rings = []; floaters = []; bombs = []; arrows = [];
  icePatches = []; ultBeams = []; waters = []; anvilMarks = [];
  seeds = []; vines = []; reviveQueue = [];
  resetArena();
  t = 0; roundTime = dur; winner = null;
  suddenDeath = false; deathAcc = 0; suddenStart = 0;
  shake = 0; hitStop = 0;
  lineupIndex = { A: 0, B: 0 };
  relayTimer = { A: 0, B: 0 };
  pick = { A: [ka], B: [kb] };
  teamSize = 1;
  modeKind = 'vs';
  seedSim(seed);
  resetField();
  deployRole('A', 0);
  deployRole('B', 0);
  phase = 'fight';

  var guard = 0, maxTicks = Math.ceil((dur + 45) * 60);
  while (phase === 'fight' && guard < maxTicks) { tick(SIM_DT); guard++; }
  if (phase === 'fight') finish('time');

  return {
    winner: winner,
    seconds: t,
    ticks: guard,
    aHp: teamHp('A').cur,
    bHp: teamHp('B').cur,
    by: suddenDeath ? 'death' : 'kill'
  };
}

/* 诊断通道：逐段打印双方血量 / 已造成伤害 / 场上实体数量，
   用来确认「技能到底有没有在打伤害」，避免把引擎问题当成平衡问题 */
function __simProbe(ka, kb, seed, dur, every) {
  units = []; particles = []; rings = []; floaters = []; bombs = []; arrows = [];
  icePatches = []; ultBeams = []; waters = []; anvilMarks = [];
  seeds = []; vines = []; reviveQueue = [];
  resetArena();
  t = 0; roundTime = dur; winner = null;
  suddenDeath = false; deathAcc = 0; suddenStart = 0;
  shake = 0; hitStop = 0;
  lineupIndex = { A: 0, B: 0 };
  relayTimer = { A: 0, B: 0 };
  pick = { A: [ka], B: [kb] };
  teamSize = 1; modeKind = 'vs';
  seedSim(seed);
  resetField();
  deployRole('A', 0); deployRole('B', 0);
  phase = 'fight';

  function snap(team) {
    var hp = 0, dealt = 0, alive = 0, hops = 0, ults = 0;
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.team !== team) continue;
      hp += Math.max(0, u.hp);
      dealt += u.dealt;
      if (u.alive) alive++;
      if (u.dashT > 0) hops++;
      if (u.ultT > 0) ults++;
    }
    return { hp: Math.round(hp), dealt: Math.round(dealt), alive: alive, dashing: hops, ulting: ults };
  }

  var log = [], guard = 0, maxTicks = Math.ceil((dur + 45) * 60);
  var step = Math.max(1, Math.round(every * 60));
  while (phase === 'fight' && guard < maxTicks) {
    tick(SIM_DT); guard++;
    if (guard % step === 0) {
      log.push({
        t: Math.round(t), a: snap('A'), b: snap('B'),
        ice: icePatches.length, water: waters.length, seed: seeds.length, arrow: arrows.length
      });
    }
  }
  if (phase === 'fight') finish('time');
  return {
    log: log,
    winner: winner,
    seconds: Math.round(t * 10) / 10,
    final: { a: snap('A'), b: snap('B') }
  };
}
`, sandbox, { filename: 'tools/sim.js#harness' });

const KEYS = sandbox.POOL.map(function (p) { return p.key; });
const LABEL = {};
sandbox.POOL.forEach(function (p) { LABEL[p.key] = p.short; });

/* ---------------- 诊断模式：node tools/sim.js --probe ice,spear ---------------- */
const PROBE = argStr('probe', '');
if (PROBE) {
  const spec = PROBE.split(',');
  const ka = spec[0], kb = spec[1];
  if (!KEYS.includes(ka) || !KEYS.includes(kb)) {
    console.error('未知角色：' + PROBE + '（可用：' + KEYS.join(',') + '）');
    process.exit(1);
  }
  const r = sandbox.__simProbe(ka, kb, SEED_BASE, DURATION, argNum('every', 5));
  console.log('');
  console.log('诊断：' + LABEL[ka] + '（A） vs ' + LABEL[kb] + '（B） · ' + DURATION + 's · seed ' + SEED_BASE);
  console.log('   t     ' + pad(LABEL[ka] + ' HP/伤害', 18) + pad(LABEL[kb] + ' HP/伤害', 18) + '冰 水 种 箭');
  r.log.forEach(function (row) {
    const a = row.a, b = row.b;
    console.log('  ' + pad(row.t + 's', 6) +
      pad(a.hp + ' / ' + a.dealt + (a.alive ? '' : '(亡)'), 18) +
      pad(b.hp + ' / ' + b.dealt + (b.alive ? '' : '(亡)'), 18) +
      row.ice + '  ' + row.water + '  ' + row.seed + '  ' + row.arrow);
  });
  console.log('');
  console.log('结果：' + r.winner + ' 胜 · ' + r.seconds + 's · ' +
    'A 余 ' + r.final.a.hp + ' HP / 造成 ' + r.final.a.dealt +
    ' · B 余 ' + r.final.b.hp + ' HP / 造成 ' + r.final.b.dealt);
  process.exit(0);
}

/* ---------------- 跑矩阵 ---------------- */
function runOne(a, b, seed) {
  return sandbox.__simMatch(a, b, seed >>> 0, DURATION);
}

const t0 = Date.now();
const score = {};      // score[a][b] = { n, w }（a 视角）
const roleTotal = {};  // 每个角色的总胜分 / 总局数
const durations = [];
KEYS.forEach(function (k) {
  score[k] = {};
  roleTotal[k] = { n: 0, w: 0 };
  KEYS.forEach(function (m) { score[k][m] = { n: 0, w: 0 }; });
});

let matches = 0;
for (let i = 0; i < KEYS.length; i++) {
  for (let j = i + 1; j < KEYS.length; j++) {
    const a = KEYS[i], b = KEYS[j];
    for (let s = 0; s < PER_DIR; s++) {
      // 正向：a 在 A 侧
      const r1 = runOne(a, b, SEED_BASE + s * 7919 + i * 131 + j);
      // 反向：b 在 A 侧（用不同种子，避免同一出生序列）
      const r2 = runOne(b, a, SEED_BASE + 104729 + s * 7919 + i * 131 + j);
      matches += 2;

      let aw = 0, bw = 0;
      if (r1.winner === 'A') aw += 1;
      else if (r1.winner === 'B') bw += 1;
      else { aw += 0.5; bw += 0.5; }
      if (r2.winner === 'A') bw += 1;        // 反向局里 A 侧是 b
      else if (r2.winner === 'B') aw += 1;
      else { aw += 0.5; bw += 0.5; }

      score[a][b].n += 2; score[a][b].w += aw;
      score[b][a].n += 2; score[b][a].w += bw;
      roleTotal[a].n += 2; roleTotal[a].w += aw;
      roleTotal[b].n += 2; roleTotal[b].w += bw;
      durations.push(r1.seconds, r2.seconds);
    }
  }
}

/* ---------------- 输出 ---------------- */
function pct(w, n) { return n ? Math.round((w / n) * 1000) / 10 : 0; }
function pad(s, n) {
  s = String(s);
  let out = s;
  // 中文按双宽算，保证列对齐
  let width = 0;
  for (const ch of s) width += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  while (width < n) { out += ' '; width++; }
  return out;
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log('');
console.log('MC 方块对决 · 1v1 对位矩阵（行 = 该角色胜率 %）');
console.log('每对双向各 ' + PER_DIR + ' 局 · 对局时长 ' + DURATION + 's · 共 ' + matches +
  ' 局 · 用时 ' + elapsed + 's');
console.log('');

// 表头：短名 4 字
let header = pad('', 10);
KEYS.forEach(function (k) { header += pad(LABEL[k], 6); });
console.log(header);
for (let i = 0; i < KEYS.length; i++) {
  let row = pad(LABEL[KEYS[i]], 10);
  for (let j = 0; j < KEYS.length; j++) {
    if (i === j) { row += pad('—', 6); continue; }
    const s = score[KEYS[i]][KEYS[j]];
    row += pad(pct(s.w, s.n).toFixed(1), 6);
  }
  console.log(row);
}

console.log('');
console.log('角色总胜率（对全部 8 个对手平均）');
KEYS.slice().sort(function (a, b) {
  return (roleTotal[b].w / roleTotal[b].n) - (roleTotal[a].w / roleTotal[a].n);
}).forEach(function (k) {
  const t = roleTotal[k];
  const v = pct(t.w, t.n);
  const bar = '█'.repeat(Math.round(v / 4));
  console.log('  ' + pad(LABEL[k], 8) + pad(v.toFixed(1) + '%', 8) + bar);
});

const avgDur = durations.reduce(function (a, b) { return a + b; }, 0) / durations.length;
console.log('');
console.log('平均单局时长 ' + avgDur.toFixed(1) + 's（含决杀）');

/* 极端对位：样本足够但偏离 50% 超过 15 个点 */
console.log('');
console.log('偏离 50% 超过 15 个点的对位：');
let flagged = 0;
for (let i = 0; i < KEYS.length; i++) {
  for (let j = i + 1; j < KEYS.length; j++) {
    const s = score[KEYS[i]][KEYS[j]];
    const v = pct(s.w, s.n);
    if (Math.abs(v - 50) >= 15 && s.n >= 2) {
      flagged++;
      console.log('  ' + pad(LABEL[KEYS[i]], 8) + ' vs ' + pad(LABEL[KEYS[j]], 8) +
        '  ' + v.toFixed(1) + '% / ' + (100 - v).toFixed(1) + '%  (n=' + s.n + ')');
    }
  }
}
if (!flagged) console.log('  无');

if (JSON_OUT) {
  const out = {
    version: sandbox.APP_VERSION,
    dmgScale: sandbox.BALANCE.dmgScale,
    duration: DURATION, perDir: PER_DIR, seed: SEED_BASE,
    avgSeconds: Math.round(avgDur * 10) / 10,
    roles: KEYS.map(function (k) {
      return { key: k, name: LABEL[k], win: pct(roleTotal[k].w, roleTotal[k].n), n: roleTotal[k].n };
    }),
    matrix: KEYS.map(function (a) {
      const row = {};
      KEYS.forEach(function (b) { row[b] = a === b ? null : pct(score[a][b].w, score[a][b].n); });
      return { key: a, vs: row };
    })
  };
  fs.writeFileSync(path.resolve(ROOT, JSON_OUT), JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('\n已写出 ' + JSON_OUT);
}
