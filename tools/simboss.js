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
const ALL = argv.includes('--all');
// 调参用的一次性覆盖：--dmg 0.5 / --take 0.6 / --pct 0.2
const DMG_ARG = argNum('dmg', NaN);
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

function load(rel) {
  const file = path.join(JS_DIR, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

load('00-base.js');
fs.readdirSync(path.join(JS_DIR, 'items'))
  .filter(function (f) { return /\.js$/.test(f) && f !== 'pool.js'; })
  .sort()
  .forEach(function (f) { load(path.join('items', f)); });
load(path.join('items', 'pool.js'));
load('10-core.js');
load('30-sim.js');

vm.runInContext(`
  var __nukes = 0;
  (function () {
    var orig = coreNuke;
    coreNuke = function (u) { __nukes++; return orig(u); };
  })();
`, sandbox);

if (Number.isFinite(DMG_ARG)) vm.runInContext('BALANCE.boss.dmgMul = ' + DMG_ARG + ';', sandbox);
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
  seeds = []; vines = []; reviveQueue = [];

  bossMode = true;
  bossRoleKey = 'duo';
  bossMerged = false;
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

  for (var i = 0; i < keys.length; i++) deployRole('A', i);
  deployBoss('B');
  phase = 'fight';

  var guard = 0, maxTicks = Math.ceil((dur + 40) * 60);
  var mergedAt = -1, coreHp = null, aHpMerge = null, aMax = 0;
  for (var m0 = 0; m0 < units.length; m0++) if (units[m0].team === 'A') aMax += units[m0].maxHp;
  while (phase === 'fight' && guard < maxTicks) {
    tick(SIM_DT); guard++;
    if (bossMerged && mergedAt < 0) { mergedAt = t; aHpMerge = teamHp('A').cur; }
    if (bossMerged) {
      for (var k = 0; k < units.length; k++) {
        if (units[k].team === 'B' && units[k].alive) coreHp = units[k].hp;
      }
    }
  }
  if (phase === 'fight') finish('time');

  var dealtA = 0;
  for (var q = 0; q < units.length; q++) if (units[q].team === 'A') dealtA += units[q].dealt;
  return {
    winner: winner, seconds: t, merged: bossMerged,
    mergedAt: mergedAt, coreHp: coreHp, dealtA: dealtA, aHpMerge: aHpMerge, aMax: aMax,
    aHp: teamHp('A').cur, bHp: teamHp('B').cur,
    by: suddenDeath ? 'death' : 'kill', bossMergedEnd: bossMerged
  };
}
`, sandbox, { filename: 'tools/simboss.js#harness' });

const POOL_KEYS = sandbox.POOL.map(function (p) { return p.key; });

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
console.log('BOSS 战 5v1 无头模拟 · 每套 ' + N + ' 局 · 时长 ' + DUR + 's');
console.log('挑战者：常规数值（无额外加成）｜ BOSS 承伤 ×' + sandbox.BALANCE.boss.dmgTakeMul +
  ' · 百分比 ×' + sandbox.BALANCE.boss.pctTakeMul +
  ' ｜ BOSS 出手 ×' + sandbox.BALANCE.boss.dmgMul);
console.log('红青各 ' + sandbox.TYPES.bossred.maxHp + ' HP ｜ 紫晶核心 ' +
  sandbox.TYPES.bosscore.maxHp + ' HP');
console.log('');

let global = { games: 0, wins: 0, sec: 0, deal: 0, merged: 0, timeouts: 0, deaths: 0 };

TEAMS.forEach(function (team) {
  const bad = team.filter(function (k) { return !POOL_KEYS.includes(k); });
  if (bad.length) {
    console.error('未知角色：' + bad.join(',') + '（可用：' + POOL_KEYS.join(',') + '）');
    process.exit(1);
  }

  let wins = 0, sec = 0, deal = 0, merged = 0, mergedAt = 0, coreLeft = 0, coreN = 0;
  let aHpMergeSum = 0, aHpMergeN = 0, aMaxSum = 0;
  let timeouts = 0, deaths = 0, minSec = 1e9, maxSec = 0;

  for (let i = 0; i < N; i++) {
    const seed = SEED_BASE + i * 7919;
    const r = sandbox.__bossMatch(team, seed, DUR);
    if (r.winner === 'A') wins++;
    sec += r.seconds; deal += r.dealtA;
    if (r.merged) merged++;
    if (r.aHpMerge != null) { aHpMergeSum += r.aHpMerge; aHpMergeN++; }
    aMaxSum += r.aMax;
    if (r.mergedAt >= 0) mergedAt += r.mergedAt;
    if (r.merged && r.coreHp != null) { coreLeft += r.coreHp; coreN++; }
    if (r.by === 'death') deaths++;
    if (r.winner === 'B' && r.by === 'time') timeouts++;
    minSec = Math.min(minSec, r.seconds);
    maxSec = Math.max(maxSec, r.seconds);
  }

  global.games += N; global.wins += wins; global.sec += sec; global.deal += deal;
  global.merged += merged; global.timeouts += timeouts; global.deaths += deaths;

  console.log('玩家：' + team.join(' + '));
  console.log('  玩家胜率 ' + pct(wins, N) +
    ' ｜ 时长 平均 ' + avg(sec, N) + 's（' + Math.round(minSec) + '–' + Math.round(maxSec) + 's）' +
    ' ｜ 合体率 ' + pct(merged, N));
  console.log('  总伤害 平均 ' + avg(deal, N) +
    (merged ? (' ｜ 合体时刻 平均 ' + Math.round(mergedAt / merged) + 's') : '') +
    (coreN ? (' ｜ 核心剩余 ' + avg(coreLeft, coreN) + ' HP') : '') +
    (aHpMergeN ? (' ｜ 合体时玩家余血 ' + avg(aHpMergeSum, aHpMergeN) + '/' + avg(aMaxSum, N) + '（' + pct(aHpMergeSum, aMaxSum) + '）') : '') +
    ' ｜ 决杀结束 ' + deaths + ' 局 ｜ 超时 BOSS 胜 ' + timeouts + ' 局');
  console.log('');
});

console.log('汇总：' + global.games + ' 局 ｜ 玩家胜率 ' + pct(global.wins, global.games) +
  ' ｜ 平均时长 ' + avg(global.sec, global.games) + 's' +
  ' ｜ 合体率 ' + pct(global.merged, global.games) +
  ' ｜ 平均总伤害 ' + avg(global.deal, global.games) +
  ' ｜ 终末震荡 ' + sandbox.__nukes + ' 次');
console.log('');
