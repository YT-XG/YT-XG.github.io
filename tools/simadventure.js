#!/usr/bin/env node
/* 秘境试炼真实引擎回归：
   node tools/simadventure.js --n 2
   node tools/simadventure.js --selftest
   · 走真实 advNewRun → advStartBattle → startBattle → tick → endFxFinish 路径
   · 牌库 90 张 / 3 张自动升星 / 商店刷新 / 海克斯 / 装备 / 双试炼推进
   · --seed 固定商店、掉落、敌阵与战斗种子（沙箱内 Math.random 已替换） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'js');
const argv = process.argv.slice(2);
function argStr(k, d) { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; }
function argNum(k, d) { const v = Number(argStr(k, d)); return Number.isFinite(v) ? v : d; }
const N = Math.max(1, argNum('n', 2));
const SEED = argNum('seed', 20261126);

function ctx2d() {
  return new Proxy({ canvas: { width: 0, height: 0 } }, {
    get(t, k) { return k in t ? t[k] : function () {}; },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function element() {
  return {
    style: {}, textContent: '', innerHTML: '', children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return element(); }, querySelectorAll() { return []; },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    closest() { return null; },
    getContext() { return ctx2d(); },
    getBoundingClientRect() { return { width: 1290, height: 600 }; }
  };
}

let rngState = 1;
function seedRng(s) { rngState = (s >>> 0) || 1; }
const seededMath = Object.create(Math);
seededMath.random = function () {
  let x = rngState >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  rngState = x >>> 0;
  return (rngState >>> 0) / 4294967296;
};

const store = {};
const localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }
};
const sandbox = {
  console, Math: seededMath, Date, JSON, localStorage, setTimeout, clearTimeout,
  document: {
    body: element(), documentElement: element(), getElementById() { return element(); },
    querySelector() { return element(); }, querySelectorAll() { return []; },
    createElement() { return element(); }, addEventListener() {}
  },
  navigator: { userAgent: 'node-adventure-sim' },
  requestAnimationFrame() { return 0; },
  __seedRng: seedRng
};
sandbox.window = {
  innerWidth: 1290, innerHeight: 600, devicePixelRatio: 1, localStorage,
  addEventListener() {}, matchMedia() { return { matches: false }; },
  requestAnimationFrame() { return 0; }
};
vm.createContext(sandbox);
function load(rel) { vm.runInContext(fs.readFileSync(path.join(JS, rel), 'utf8'), sandbox, { filename: rel }); }

load('00-base.js');
fs.readdirSync(path.join(JS, 'items'))
  .filter(f => /\.js$/.test(f) && f !== 'pool.js')
  .sort()
  .forEach(f => load(path.join('items', f)));
load('items/boss/shared.js');
load('items/boss/duo.js');
load('items/boss/storm.js');
load('items/pool.js');
load('10-core.js');
load('25-field.js');
load('20-menu.js');
load('30-sim.js');
load('85-adventure.js');

vm.runInContext(`
simHeadless = false;
burst = function(){}; ring = function(){}; floater = function(){};
syncPick = function(){}; hideResult = function(){}; rebuildRoster = function(){};
markRenderDirty = function(){}; iconSvg = function(){ return ''; };
adventureShow = function(){}; adventureRender = function(){}; adventureHide = function(){};
sfxPlay = function(){};

function __seed(s) { __seedRng(s >>> 0); }
function __autoShop() {
  var r = adventure.run;
  if (!r || r.step !== 'hub') return;
  var guard = 0;
  while (guard++ < 20) {
    var bought = false;
    for (var i = 0; i < r.shop.length; i++) {
      var e = r.shop[i];
      if (!e) continue;
      var cost = advShopEntryCost(e);
      if (r.gold >= cost && r.cards.length < 9) {
        var before = r.cards.length;
        advBuyShop(i);
        if (r.cards.length !== before || r.gold >= cost) { bought = true; break; }
      }
    }
    if (!bought) break;
  }
  /* 把星级最高且不重复的角色放上战斗席。 */
  var boardCards = [];
  for (var b = 0; b < r.board.length; b++) { var bc = advCard(r.board[b]); if (bc) boardCards.push(bc); }
  var all = r.cards.slice().sort(function(a, b2) {
    if (b2.star !== a.star) return b2.star - a.star;
    return a.uid - b2.uid;
  });
  for (var k = 0; k < all.length && advBoardKeys().length < 3; k++) {
    var c = all[k];
    if (advCardZone(c.uid) === 'board') continue;
    if (advBoardHasKey(c.key, c.uid)) continue;
    advPlaceOnBoard(c.uid);
  }
  /* 多余金币刷新一次找同名卡。 */
  if (r.gold >= 6 && r.cards.length < 9) {
    for (var pass = 0; pass < 1; pass++) {
      advRerollShop();
      for (var q = 0; q < r.shop.length; q++) {
        var e2 = r.shop[q];
        if (e2 && r.gold >= advShopEntryCost(e2) && r.cards.length < 9) advBuyShop(q);
      }
    }
  }
}
function __equipAll() {
  var r = adventure.run;
  if (!r) return;
  var guard = 0;
  while (r.inventory.length && guard++ < 30) {
    var board = [];
    for (var i = 0; i < r.board.length; i++) { var c = advCard(r.board[i]); if (c) board.push(c); }
    if (!board.length) break;
    var target = board[0];
    for (var b = 0; b < board.length; b++) if (board[b].items.length < 3) { target = board[b]; break; }
    if (target.items.length >= 3) break;
    adventure.selectedItems = [0];
    advEquipSelected(target.uid);
  }
}
function __fight() {
  var r = adventure.run;
  var trial = r.trial, node = r.node;
  var side = 'left';
  advStartBattle(side);
  if (phase !== 'fight') {
    return { trial: trial, node: node, error: 'not-started', step: r.step, winner: null, hp: r.hp };
  }
  var guard = 0, maxTicks = Math.ceil((roundTime + 50) * 60);
  while (phase === 'fight' && guard++ < maxTicks) tick(1 / 60);
  if (phase === 'fight') finish('time');
  if (endFx) endFxFinish();
  return {
    trial: trial, node: node, winner: winner,
    win: winner === 'A', hp: r.hp, step: r.step,
    seconds: Math.round(t * 10) / 10,
    board: r.board.map(function(uid){ var c = advCard(uid); return c ? c.key + ':' + c.star : '-'; }).join(','),
    enemies: units.filter(function(u){ return u.team === 'B'; }).map(function(u){ return u.key; })
  };
}
function __choices() {
  var r = adventure.run;
  var guard = 0;
  while (guard++ < 12) {
    if (r.step === 'result') { advAfterResult(); continue; }
    if (r.step === 'rewardAuto') { advContinueAutoReward(); continue; }
    if (r.step === 'reward' && r.pending) { advChooseReward(0); continue; }
    if (r.step === 'hex' && r.pending && r.pending.offers.length) { advChooseHex(r.pending.offers[0]); continue; }
    if (r.step === 'item' && r.pending && r.pending.options.length) { advChooseItem(r.pending.options[0]); continue; }
    break;
  }
}
function __run(env, seed) {
  __seed(seed);
  adventure.run = advNewRun(env);
  adventure.inBattle = false;
  __autoShop();
  __equipAll();
  var fights = [], guard = 0;
  while (guard++ < 60) {
    var r = adventure.run;
    if (!r) break;
    if (r.step === 'complete' || r.step === 'defeat') break;
    if (r.step === 'hub') {
      __autoShop();
      __equipAll();
      fights.push(__fight());
      continue;
    }
    if (r.step === 'result' || r.step === 'rewardAuto' || r.step === 'reward' || r.step === 'hex' || r.step === 'item') {
      __choices();
      continue;
    }
    break;
  }
  return {
    env: env, step: adventure.run.step, trial: adventure.run.trial, node: adventure.run.node,
    hp: adventure.run.hp, gold: adventure.run.gold, wins: adventure.run.wins,
    losses: adventure.run.losses, hexes: adventure.run.hexes.slice(),
    cards: adventure.run.cards.length, fights: fights
  };
}
`, sandbox);

if (argv.includes('--selftest')) {
  vm.runInContext(`
    function assert(cond, msg) { if (!cond) throw new Error(msg); }
    assert(POOL.length === 10, '角色池必须是 10 个');
    assert(ADV_CONFIG.poolCopies === 9, '每个角色 9 张');
    assert(POOL.length * ADV_CONFIG.poolCopies === 90, '牌库必须是 90 张');
    assert(ADV_ITEMS.filter(function(i){return i.basic;}).length === 5, '基础装备必须是 5 件');
    assert(ADV_ITEMS.filter(function(i){return !i.basic;}).length === 15, '进阶装备必须是 15 件');
    assert(ADV_RECIPES.length === 15, '合成配方必须是 15 条');
    assert(ADV_ENVS.length === 6, '环境必须是 6 个');
    assert(ADV_HEXES.length === 15, '海克斯必须是 15 个');
    assert(ADV_HEXES.filter(function(h){return h.q==='silver';}).length === 5, '白银海克斯 5 个');
    assert(ADV_HEXES.filter(function(h){return h.q==='gold';}).length === 5, '黄金海克斯 5 个');
    assert(ADV_HEXES.filter(function(h){return h.q==='prismatic';}).length === 5, '棱彩海克斯 5 个');

    __seed(1);
    var r = advNewRun('rich');
    assert(r.gold === 39, '富饶之地开局金币应为 39');
    assert(advPoolLeft(r) === 86, '开局牌库剩余应为 86（1 张赠送 + 3 张商店）');
    assert(r.shop.length === 3 && r.shop[0] && r.shop[1] && r.shop[2], '商店应展示 3 张');
    assert(r.cards.length === 1, '开局应赠送 1 张卡');
    assert(r.board.filter(Boolean).length === 1, '开局赠送卡应自动上阵');
    assert(r.hp === 80 && r.maxHp === 80, '默认征战生命应为 80');
    assert(ADV_CONFIG.winHeal === 4, '胜利应回复 4 点征战生命');
    var oldSave = {
      version: 3, pool: {}, cards: [], board: [null,null,null], bench: [null,null,null,null,null,null],
      inventory: [], hexes: [], shop: [null,null,null], uidSeq: 1, hp: 30, maxHp: 60
    };
    advEnsureRunShape(oldSave);
    assert(oldSave.maxHp === 80 && oldSave.hp === 50, '旧存档生命上限应迁移到 80');

    /* 3 张 1 星 → 2 星；3 张 2 星 → 3 星。 */
    r.cards = []; r.board = [null,null,null]; r.bench = [null,null,null,null,null,null];
    for (var k in r.pool) r.pool[k] = 9;
    advAddCard('spear', 1, true); advAddCard('spear', 1, true); advAddCard('spear', 1, true);
    var spear = r.cards.filter(function(c){return c.key==='spear';});
    assert(spear.length === 1 && spear[0].star === 2, '3 张 1 星应合成 2 星');
    for (var i = 0; i < 6; i++) advAddCard('spear', 1, true);
    spear = r.cards.filter(function(c){return c.key==='spear';});
    assert(spear.length === 1 && spear[0].star === 3, '9 张 1 星应合成 3 星');
    var goldBefore = r.gold;
    advSellCard(spear[0].uid);
    assert(r.gold === goldBefore + 30, '3 星出售应为 30 金币');
    assert(r.pool.spear === 9, '出售 3 星应归还 9 张');

    assert(advSellPrice({star:2}) === 10, '2 星出售应为 10');
    assert(ADV_STARS[3].hp >= 4 && ADV_STARS[3].atk >= 2.8, '3 星角色应有高倍率');

    /* 装备聚合与出售返还。 */
    r.cards = [{uid:1,key:'spear',star:2,items:['knife','flower']}];
    r.board = [1,null,null]; r.bench = [null,null,null,null,null,null];
    r.global = {hp:0,atk:0}; r.hexes = [];
    var st2 = advCardStats(r.cards[0]);
    assert(st2.hp > 2.1 && st2.dmg > 1.14, '星级 + 装备面板聚合异常');
    advSellCard(1);
    assert(r.inventory.indexOf('knife') >= 0 && r.inventory.indexOf('flower') >= 0, '出售角色应返还装备');

    /* 装备合成 / 装备 / 卸下。 */
    r.cards = [{uid:9,key:'ice',star:1,items:[]}]; r.board=[9,null,null]; r.bench=[null,null,null,null,null,null];
    r.inventory = ['shoes','knife']; adventure.selectedItems = [0,1];
    advCraftSelected();
    assert(r.inventory.length === 1 && r.inventory[0] === 'gale', '鞋 + 刀应合成疾影战刃');
    adventure.selectedItems = [0];
    advEquipSelected(9);
    assert(r.cards[0].items.length === 1 && r.cards[0].items[0] === 'gale', '装备未装入角色');
    advUnequipItem(9, 0);
    assert(r.inventory.indexOf('gale') >= 0 && r.cards[0].items.length === 0, '卸下装备未回背包');

    /* 2 星合成：主站席已有 2 星带装备时，3 张 1 星合出的 2 星应留在备战席。 */
    r.cards = [
      {uid:30,key:'dog',star:2,items:['knife']},
      {uid:31,key:'dog',star:1,items:[]},
      {uid:32,key:'dog',star:1,items:[]},
      {uid:33,key:'dog',star:1,items:[]}
    ];
    r.board = [30,null,null]; r.bench = [31,32,33,null,null,null];
    r.global = {hp:0,atk:0}; r.hexes = [];
    advCheckCombine();
    assert(r.board[0] === 30 && advCard(30).star === 2 && advCard(30).items[0] === 'knife', '2星合成不应把主站席装备卡换到备战席');
    assert(advCard(31) && advCard(31).star === 2 && advCardZone(31) === 'bench', '合出的2星应留在备战席');

    /* 拖拽换位：备战席 → 主站席，占用交换 / 空位移动。 */
    r.cards = [{uid:40,key:'dog',star:1,items:[]},{uid:41,key:'spear',star:1,items:[]}];
    r.board = [40,null,null]; r.bench = [41,null,null,null,null,null];
    advMoveCardTo(41, 'board', 0);
    assert(r.board[0] === 41 && r.bench[0] === 40, '备战席拖到主站席应交换位置');
    advMoveCardTo(40, 'board', 1);
    assert(r.board[1] === 40 && r.bench[0] === null, '备战席拖到主站席空位应移动');

    /* 角色详情：实际数值。 */
    var dataCard = {uid:50,key:'dog',star:2,items:['knife']};
    r.cards = [dataCard]; r.board=[50,null,null]; r.bench=[null,null,null,null,null,null];
    var actual = advCardActualStats(dataCard);
    assert(actual.units.length >= 1 && actual.units[0].hp > 100 && actual.units[0].atk >= 0, '角色详情应返回实际数值');

    /* 敌阵至少覆盖玩家上阵人数。 */
    r.cards = [{uid:2,key:'ice',star:1,items:[]}]; r.board=[2,null,null]; r.bench=[null,null,null,null,null,null];
    r.trial = 1; r.node = 3; r.battle = null;
    var eb = advBuildBattle();
    assert(eb && eb.enemyKeys.length >= 1, '敌阵生成失败');
    assert(ADV_RECIPES.every(function(x){ return !!ADV_ITEM_BY_ID[x.out]; }), '配方产物不存在');

    /* 第二试炼 2-1 / 2-2 改为普攻小怪，并保留 2-2 固定海克斯。 */
    assert(advNode(1,1).type === 'gift' && advNode(1,1).reward, '1-1 应保持奖励关');
    assert(advNode(2,1).type === 'mob' && !advNode(2,1).reward && !advNode(2,1).hp1, '2-1 应为普攻小怪');
    assert(advNode(2,2).type === 'mob' && advNode(2,2).hex && !advNode(2,2).reward, '2-2 应为普攻小怪并保留海克斯');
    assert(advNodePower(1,4) > advNodePower(1,3), '1-4 应强于 1-3');
    assert(advNodePower(1,6) > advNodePower(1,5), '1-6 应强于 1-5');
    assert(advNodePower(2,1) > advNodePower(1,5) * ADV_CHALLENGE_STARS[5].hp, '2-1 应强于 1-5 最高星');
    assert(advNodePower(2,2) > advNodePower(2,1), '2-2 应强于 2-1');

    /* 难度：黄金 +2 / 棱彩 +5。 */
    r.env = 'peace'; r.hexes = [];
    assert(advDifficulty(r) === 6, '和平契约应为 6 难度');
    r.hexes = ['whet','merchant','titan'];
    assert(advDifficulty(r) === 13, '和平 + 黄金 + 棱彩应为 13');
    r.env = 'rainbow'; r.hexes = [];
    assert(advDifficulty(r) === 10, '彩虹时代基础难度应为 10');
    var hm = advHexMods(r);
    assert(hm.dmg >= 0, '海克斯聚合可用');

    /* BOSS 数值与普通 BOSS 分离：红青总 20,000 / 雷云总 50,000。 */
    assert(ADV_BOSS.duo.units.bossred + ADV_BOSS.duo.units.bosslapis + ADV_BOSS.duo.units.bosscore === 20000, '秘境红青总生命应为 20,000');
    assert(ADV_BOSS.storm.units.stormgolem + ADV_BOSS.storm.phase2Hp === 50000, '秘境雷云总生命应为 50,000');

    /* 主菜单快照 / 恢复。 */
    teamSize = 3; modeKind = 'relay'; roundDuration = 60; seriesBest = 5; draftMode = true;
    bossMode = false; bossRoleKey = 'storm';
    pick.A = ['ice','spear','bow']; pick.B = ['dog','grass','milk'];
    adventure.snapshot = advSnapshotMatch();
    teamSize = 1; modeKind = 'vs'; roundDuration = 180; seriesBest = 1; draftMode = false;
    pick.A = ['gaga']; pick.B = ['anvil'];
    adventurePrepareMenuReturn();
    assert(teamSize === 3 && modeKind === 'relay' && roundDuration === 60 && seriesBest === 5 && draftMode,
      '主菜单状态未恢复');
    assert(pick.A.join(',') === 'ice,spear,bow', '主菜单阵容未恢复');
    assert(adventure.snapshot === null, '快照未清空');

    /* UI 冒烟。 */
    adventure.run = advNewRun('rainbow');
    adventure.selectedCard = adventure.run.cards[0].uid;
    var hub = advHubHtml();
    assert(hub.indexOf('adv-board') >= 0 && hub.indexOf('adv-shop') >= 0, '主界面未渲染战斗席/商店');
    /* 详情已改为跟随气泡层渲染，不在 hub HTML 内；直接校验详情模板非空 */
    assert(advDetailHtml().indexOf('adv-detail') >= 0, '角色详情未渲染');
    assert(advResultHtml().length > 0, '结算界面渲染失败');
    adventure.run.step = 'reward';
    adventure.run.pending = { title: '测试', sub: '', options: advRewardOptions(advNode(1,1), 1) };
    assert(advRewardHtml().indexOf('adv-choice-grid') >= 0, '奖励三选一未渲染');
    adventure.run.step = 'hex';
    adventure.run.pending = { offers: advHexOffers(adventure.run) };
    assert(advHexChoiceHtml().indexOf('adv-choice-card') >= 0, '海克斯三选一未渲染');
    adventureCodex.tab = 'envs';
    assert(advCodexShellHtml().indexOf('秘境试炼 · 图鉴') >= 0, '图鉴未渲染');
    adventureCodex.tab = 'hexes';
    assert(advCodexShellHtml().indexOf('棱彩') >= 0, '图鉴海克斯未渲染');
    adventureCodex.tab = 'items';
    assert(advCodexShellHtml().indexOf('进阶装备') >= 0, '图鉴装备未渲染');
    adventureCodex.tab = 'nodes';
    assert(advCodexShellHtml().indexOf('第二试炼') >= 0, '图鉴节点未渲染');
    adventureCodex.tab = 'roles';
    assert(advCodexShellHtml().indexOf('角色池') >= 0, '图鉴角色未渲染');
    adventureCodex.tab = 'envs';
    adventure.run.step = 'hub';
    adventure.run.node = 1;
    adventure.run.pending = null;
    advOpenAutoReward(advNode(1,1));
    assert(adventure.run.step === 'rewardAuto' && adventure.run.pending.options.length === 2, '奖励关应系统发放 2 项奖励');
    assert(advAutoRewardHtml().indexOf('已获得') >= 0 && advAutoRewardHtml().indexOf('rewardContinue') >= 0, '自动奖励界面未渲染');
    advContinueAutoReward();
    assert(adventure.run.step === 'hub' && adventure.run.node === 2, '自动奖励继续后应进入下一节点');
    console.log('SELFTEST OK · 90 张牌库 / 自动升星 / 商店 / 海克斯 / 装备 / 双 BOSS / 主菜单隔离');
  `, sandbox);
  process.exit(0);
}

const envArg = argStr('env', '');
const envs = envArg ? envArg.split(',') : vm.runInContext('ADV_ENVS.map(function(e){return e.id;})', sandbox);
const summary = {};
for (const env of envs) {
  if (!summary[env]) summary[env] = { runs: 0, complete: 0, nodes: 0, hp: 0, fights: 0, wins: 0 };
  for (let i = 0; i < N; i++) {
    const out = vm.runInContext(`__run(${JSON.stringify(env)}, ${SEED + i * 7919})`, sandbox);
    if (!out || !out.fights) throw new Error('模拟未返回结果');
    const s = summary[env];
    s.runs++;
    s.complete += out.step === 'complete' ? 1 : 0;
    s.nodes += (out.trial - 1) * 7 + out.node;
    s.hp += out.hp;
    s.fights += out.fights.length;
    s.wins += out.fights.filter(f => f.win).length;
    const tag = out.step === 'complete' ? '通关' : (out.hp < 0 ? '征战耗尽' : '止步 ' + out.trial + '-' + out.node);
    console.log(`${env} #${i + 1}: ${tag} · 征战 ${out.hp} · 金币 ${out.gold} · ${out.wins}胜/${out.losses}负 · 海克斯 ${out.hexes.join(',') || '无'}`);
    for (const f of out.fights) {
      if (f.error) throw new Error('战斗未启动：' + f.error);
      if (!Number.isFinite(f.hp)) throw new Error('征战生命异常');
      if (argv.includes('--verbose')) {
        console.log(`  ${f.trial}-${f.node} ${f.win ? 'WIN ' : 'LOSE'} ${f.seconds}s hp=${f.hp} board=${f.board} enemies=${f.enemies.join(',')}`);
      }
    }
  }
}
console.log('\n===== 秘境试炼实测汇总 =====');
for (const env of envs) {
  const s = summary[env];
  console.log(`${env}: 通关 ${s.complete}/${s.runs} · 平均抵达 ${(s.nodes / s.runs).toFixed(1)} 节点 · 平均征战 ${(s.hp / s.runs).toFixed(0)} · 战斗胜率 ${Math.round(s.wins / Math.max(1, s.fights) * 100)}%`);
}
