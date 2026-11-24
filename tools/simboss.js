#!/usr/bin/env node
/* ============================================================
   tools/simboss.js —— BOSS 战（5v1）无头模拟
   ------------------------------------------------------------
   和第 98 条一起加：BOSS 模式的血量 / 投弹 / 冲击全部是"面伤 + 高血量"，
   只靠肉眼试玩没法判断会不会 20 秒结束，所以固化成脚本。

   用法（在仓库根目录）：
     node tools/simboss.js                          # 默认阵容 × 12 局
     node tools/simboss.js --n 20                   # 每套阵容 20 局
     node tools/simboss.js --team spear,bow,dog,anvil,ice
     node tools/simboss.js --all                    # 每套 5 人阵容都跑一遍
     node tools/simboss.js --seed 20261121 --dur 300
     node tools/simboss.js --boss storm               # 指定 BOSS（duo / storm）

   口径：
     · 玩家方 5 个角色（走真实 reset 里的 deployRole / deployBoss 路径）
     · BOSS 方固定 红青双子（bossred / bosslapis）→ 合体紫晶核心
     · 统计：胜率、平均时长、平均总伤害、合体率、合体后剩余核心血量
     · 每局最长 dur + 40 秒（决杀会自己结束战斗）
     · 只读 js/ 下的代码，不写任何文件
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

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
const N = Math.max(1, argNum('n', 12));
const SEED_BASE = argNum('seed', 20261121);
const DUR = argNum('dur', 300);
const TEAM_ARG = argStr('team', 'spear,bow,dog,anvil,ice');
const BOSS_ARG = argStr('boss', 'duo');
const ALL = argv.includes('--all');
// 调参用的一次性覆盖：--take 0.6 / --pct 0.2
const TAKE_ARG = argNum('take', NaN);
const PCT_ARG = argNum('pct', NaN);
const NUKE_ARG = argNum('nuke', NaN);

/* ---------------- 最小 DOM / Canvas 桩（与 tools/sim.js 同口径）---------------- */
function makeCtx2d() {
  const target = { canvas: { width: 0, height: 0 } };
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return function () {}; },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function makeEl(tag) {
  const el = {
    tagName: tag || 'div', style: {}, dataset: {}, textContent: '', innerHTML: '', title: '',
    className: '', width: 0, height: 0, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    appendChild(c) { el.children.push(c); return c; },
    removeChild() {},
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { width: 1290, height: 600, left: 0, top: 0 }; },
    getContext() { return makeCtx2d(); }
  };
  return el;
}
const sandbox = { console, Math, Date, JSON, setTimeout, clearTimeout };
sandbox.window = {
  devicePixelRatio: 1, innerWidth: 1290, innerHeight: 600,
  addEventListener() {}, removeEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {} }; },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  requestAnimationFrame() { return 0; }
};
const doc = {
  body: makeEl('body'), documentElement: makeEl('html'),
  getElementById() { return makeEl(); },
  querySelector() { return makeEl(); },
  querySelectorAll() { return []; },
  createElement(tag) { return makeEl(tag); },
  addEventListener() {}, removeEventListener() {}
};
sandbox.document = doc;
sandbox.navigator = { clipboard: null, userAgent: 'node-simboss' };
sandbox.localStorage = sandbox.window.localStorage;
sandbox.requestAnimationFrame = sandbox.window.requestAnimationFrame;
vm.createContext(sandbox);
sandbox.__bossKey = BOSS_ARG;

function load(rel) {
  const file = path.join(JS_DIR, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

load('00-base.js');
fs.readdirSync(path.join(JS_DIR, 'items'))
  .filter(function (f) { return /\.js$/.test(f) && f !== 'pool.js'; })
  .sort()
  .forEach(function (f) { load(path.join('items', f)); });
// BOSS 已按「一个 BOSS 一个文件」拆到 items/boss/：先加载共用的 shared.js，再按文件名加载
var bossDir = path.join(JS_DIR, 'items', 'boss');
if (fs.existsSync(bossDir)) {
  var bossFiles = fs.readdirSync(bossDir).filter(function (f) { return /\.js$/.test(f); });
  bossFiles.sort(function (a, b) {
    if (a === 'shared.js') return -1;
    if (b === 'shared.js') return 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  bossFiles.forEach(function (f) { load(path.join('items', 'boss', f)); });
}
load(path.join('items', 'pool.js'));
load('10-core.js');
load('25-field.js');
load('30-sim.js');

vm.runInContext(`
  var __nukes = 0;
  (function () {
    var orig = coreNuke;
    coreNuke = function (u) { __nukes++; return orig(u); };
  })();
`, sandbox);

if (Number.isFinite(TAKE_ARG)) vm.runInContext('BALANCE.boss.dmgTakeMul = ' + TAKE_ARG + ';', sandbox);
if (Number.isFinite(PCT_ARG)) vm.runInContext('BALANCE.boss.pctTakeMul = ' + PCT_ARG + ';', sandbox);
if (Number.isFinite(NUKE_ARG)) vm.runInContext('BALANCE.boss.core.nukeDelay = ' + NUKE_ARG + ';', sandbox);

/* ---------------- 对局驱动 ---------------- */
vm.runInContext(`
burst = function () {};
ring = function () {};
floater = function () {};
simHeadless = true;
paused = false;

function __bossMatch(keys, seed, dur) {
  units = []; particles = []; rings = []; floaters = []; bombs = []; arrows = [];
  icePatches = []; ultBeams = []; waters = []; anvilMarks = [];
  seeds = []; vines = []; reviveQueue = []; gagaDrops = [];

  bossMode = true;
  bossRoleKey = __bossKey;
  bossMerged = false;
  bossPhase = 1;
  bossMergeFx = null;
  bossMergeAct = null;
  pick = { A: keys.slice(), B: [bossRoleKey] };
  teamSize = 5;
  modeKind = 'vs';
  roundDuration = dur;

  resetArena();
  t = 0; roundTime = dur; winner = null;
  suddenDeath = false; deathAcc = 0; suddenStart = 0;
  shake = 0; hitStop = 0;
  lineupIndex = { A: 0, B: 0 };
  relayTimer = { A: 0, B: 0 };
  seedSim(seed);
  resetField();

  for (var i = 0; i < keys.length; i++) deployRole('A', i);
  deployBoss('B');
  phase = 'fight';

  var guard = 0, maxTicks = Math.ceil((dur + 40) * 60);
  var mergedAt = -1, coreHp = null, aHpMerge = null, aMaxStart = 0;
  var phaseAt = -1, secondHp = null, aMaxPhase = null;
  function aMaxNow() {
    var total = 0;
    for (var mi = 0; mi < units.length; mi++) if (units[mi].team === 'A') total += Math.max(0, units[mi].maxHp);
    return total;
  }
  for (var m0 = 0; m0 < units.length; m0++) if (units[m0].team === 'A') aMaxStart += units[m0].maxHp;
  while (phase === 'fight' && guard < maxTicks) {
    tick(SIM_DT); guard++;
    if (bossMerged && mergedAt < 0) { mergedAt = t; aHpMerge = teamHp('A').cur; aMaxPhase = aMaxNow(); }
    if (bossPhase === 2 && phaseAt < 0) { phaseAt = t; aHpMerge = teamHp('A').cur; aMaxPhase = aMaxNow(); }
    if (bossMerged) {
      for (var k = 0; k < units.length; k++) {
        if (units[k].team === 'B' && units[k].alive) coreHp = units[k].hp;
      }
    }
    if (bossPhase === 2) {
      for (var k2 = 0; k2 < units.length; k2++) {
        if (units[k2].team === 'B' && units[k2].alive) secondHp = units[k2].hp;
      }
    }
  }
  if (phase === 'fight') finish('time');

  var dealtA = 0;
  for (var q = 0; q < units.length; q++) if (units[q].team === 'A') dealtA += units[q].dealt;
  return {
    winner: winner, seconds: t, merged: bossMerged,
    mergedAt: mergedAt, coreHp: coreHp, dealtA: dealtA, aHpMerge: aHpMerge, aMax: aMaxPhase == null ? aMaxStart : aMaxPhase,
    phase2: bossPhase === 2, phaseAt: phaseAt, secondHp: secondHp,
    aHp: teamHp('A').cur, bHp: teamHp('B').cur,
    by: suddenDeath ? 'death' : 'kill', bossMergedEnd: bossMerged
  };
}
`, sandbox, { filename: 'tools/simboss.js#harness' });

const POOL_KEYS = sandbox.POOL.map(function (p) { return p.key; });

// 当前 BOSS 配置（--boss 指定；duo / storm）
if (!sandbox.BOSS_ROLES[BOSS_ARG]) {
  console.error('未知 BOSS：' + BOSS_ARG + '（可用：' + Object.keys(sandbox.BOSS_ROLES).join(',') + '）');
  process.exit(1);
}
vm.runInContext('bossRoleKey = ' + JSON.stringify(BOSS_ARG) + '; bossPhase = 1;', sandbox);
const BOSS_CFG = sandbox.bossConfig();
const TWO_BAR = sandbox.bossTwoBar();

const TEAMS = ALL
  ? [
      ['spear', 'bow', 'dog', 'anvil', 'ice'],
      ['duo', 'ice', 'grass', 'bucket', 'bow'],
      ['spear', 'spear', 'spear', 'spear', 'spear'],
      ['bow', 'bow', 'bow', 'bow', 'bow'],
      ['dog', 'dog', 'dog', 'dog', 'dog'],
      ['anvil', 'anvil', 'anvil', 'anvil', 'anvil'],
      ['grass', 'bucket', 'ice', 'milk', 'bow'],
      ['milk', 'milk', 'milk', 'milk', 'milk'],
      ['bucket', 'bucket', 'bucket', 'bucket', 'bucket'],
      ['ice', 'ice', 'ice', 'ice', 'ice'],
      ['grass', 'grass', 'grass', 'grass', 'grass'],
      ['duo', 'duo', 'duo', 'duo', 'duo'],
      ['bow', 'ice', 'grass', 'anvil', 'milk']
    ]
  : [TEAM_ARG.split(',').map(function (s) { return s.trim(); }).filter(Boolean)];

function pct(n, d) { return d ? (n / d * 100).toFixed(1) + '%' : '—'; }
function avg(sum, n) { return n ? Math.round(sum / n) : 0; }

console.log('');
console.log('BOSS 战 5v1 无头模拟 · ' + BOSS_CFG.name + ' · 每套 ' + N + ' 局 · 时长 ' + DUR + 's');
console.log('挑战者：常规数值（无额外加成）｜ BOSS 承伤 ×' + sandbox.BALANCE.boss.dmgTakeMul +
  ' · 百分比 ×' + sandbox.BALANCE.boss.pctTakeMul +
  ' ｜ BOSS 出手不做整体缩放');
if (TWO_BAR) {
  var sd = sandbox.TYPES[BOSS_CFG.units[0]];
  console.log('两条血：' + sd.phaseHp.join(' / ') + ' HP');
} else {
  console.log('红青各 ' + sandbox.TYPES.bossred.maxHp + ' HP ｜ 紫晶核心 ' +
    sandbox.TYPES.bosscore.maxHp + ' HP');
}
console.log('');

let global = { games: 0, wins: 0, sec: 0, deal: 0, merged: 0, phase2: 0, timeouts: 0, deaths: 0 };

TEAMS.forEach(function (team) {
  const bad = team.filter(function (k) { return !POOL_KEYS.includes(k); });
  if (bad.length) {
    console.error('未知角色：' + bad.join(',') + '（可用：' + POOL_KEYS.join(',') + '）');
    process.exit(1);
  }

  let wins = 0, sec = 0, deal = 0, merged = 0, mergedAt = 0, coreLeft = 0, coreN = 0;
  let phase2 = 0, phaseAt = 0, secondLeft = 0, secondN = 0;
  let aHpMergeSum = 0, aHpMergeN = 0, aMaxSum = 0;
  let timeouts = 0, deaths = 0, minSec = 1e9, maxSec = 0;

  for (let i = 0; i < N; i++) {
    const seed = SEED_BASE + i * 7919;
    const r = sandbox.__bossMatch(team, seed, DUR);
    if (r.winner === 'A') wins++;
    sec += r.seconds; deal += r.dealtA;
    if (r.merged) merged++;
    if (r.phase2) phase2++;
    if (r.phaseAt >= 0) phaseAt += r.phaseAt;
    if (r.phase2 && r.secondHp != null) { secondLeft += r.secondHp; secondN++; }
    if (r.aHpMerge != null) { aHpMergeSum += r.aHpMerge; aHpMergeN++; aMaxSum += r.aMax; }
    if (r.mergedAt >= 0) mergedAt += r.mergedAt;
    if (r.merged && r.coreHp != null) { coreLeft += r.coreHp; coreN++; }
    if (r.by === 'death') deaths++;
    if (r.winner === 'B' && r.by === 'time') timeouts++;
    minSec = Math.min(minSec, r.seconds);
    maxSec = Math.max(maxSec, r.seconds);
  }

  global.games += N; global.wins += wins; global.sec += sec; global.deal += deal;
  global.merged += merged; global.phase2 += phase2;
  global.timeouts += timeouts; global.deaths += deaths;

  console.log('玩家：' + team.join(' + '));
  console.log('  玩家胜率 ' + pct(wins, N) +
    ' ｜ 时长 平均 ' + avg(sec, N) + 's（' + Math.round(minSec) + '–' + Math.round(maxSec) + 's）' +
    ' ｜ ' + (TWO_BAR ? ('二阶段率 ' + pct(phase2, N)) : ('合体率 ' + pct(merged, N))));
  console.log('  总伤害 平均 ' + avg(deal, N) +
    (TWO_BAR
      ? (phase2 ? (' ｜ 二阶段时刻 平均 ' + Math.round(phaseAt / phase2) + 's') : '') +
        (secondN ? (' ｜ 第二条血剩余 ' + avg(secondLeft, secondN) + ' HP') : '')
      : (merged ? (' ｜ 合体时刻 平均 ' + Math.round(mergedAt / merged) + 's') : '') +
        (coreN ? (' ｜ 核心剩余 ' + avg(coreLeft, coreN) + ' HP') : '')) +
    (aHpMergeN ? (' ｜ 阶段时玩家余血 ' + avg(aHpMergeSum, aHpMergeN) + '/' + avg(aMaxSum, aHpMergeN) + '（' + pct(aHpMergeSum, aMaxSum) + '）') : '') +
    ' ｜ 决杀结束 ' + deaths + ' 局 ｜ 超时 BOSS 胜 ' + timeouts + ' 局');
  console.log('');
});

console.log('汇总：' + global.games + ' 局 ｜ 玩家胜率 ' + pct(global.wins, global.games) +
  ' ｜ 平均时长 ' + avg(global.sec, global.games) + 's' +
  ' ｜ ' + (TWO_BAR ? '二阶段率 ' + pct(global.phase2, global.games) : '合体率 ' + pct(global.merged, global.games)) +
  ' ｜ 平均总伤害 ' + avg(global.deal, global.games) +
  ' ｜ 终末震荡 ' + sandbox.__nukes + ' 次');
console.log('');
