/* ============================================================
   60-tournament.js —— 赛事模式（棋盘赛程 + 竞猜 + 双败淘汰）
   ------------------------------------------------------------
   阶段：setup → group → ko（胜者组/败者组/季军赛/总决赛）→ done
   界面：
     1. 分组棋盘（空框 → 一键分配）
     2. 组内对阵卡（名字 / 角色 / 积分 / 预测赔率 / 押注 / 开始）
     3. 小组赛全部打完 → 积分排名表（不再列对阵）
     4. 淘汰赛：胜者组、败者组、季军赛、总决赛（双败）
   竞猜：初始资金 1000，赔率 = 100 / 预测胜率，赛前可押，结算立即到账。
   ============================================================ */
'use strict';

var TOUR_NAMES = ['阿石', '小七', '老白', '阿青', '铁蛋', '小满', '阿竹', '大熊',
                  '阿梨', '小九', '灰灰', '阿灯', '豆子', '阿海', '小鹿', '黑桃'];

var TOUR_START_BANK = 1000;

var tour = null;
var tourSpeed = 1;
var tourFx = null;
var tourFxWin = null;
var TOUR_KEY = 'mcduel.tournament.v3';

/* ---------- 工具 ---------- */
function tourShuffle(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function tourRoleName(key) {
  for (var i = 0; i < POOL.length; i++) if (POOL[i].key === key) return POOL[i].short;
  return key;
}

function tourRolesText(p) { return p.roles.map(tourRoleName).join(' / '); }

/* 6 角色两两对位实测胜率（对称化，数值 = 行角色胜率 %） */
var TOUR_MATCHUP = {
  duo:   { spear: 23.5, bow: 53.2, ice: 53.2, grass: 26.6, dog: 23.5 },
  spear: { duo: 76.5, bow: 68.8, ice: 53.8, grass: 46.9, dog: 78.1 },
  bow:   { duo: 46.8, spear: 31.2, ice: 100.0, grass: 100.0, dog: 98.5 },
  ice:   { duo: 46.8, spear: 46.2, bow: 0.0,  grass: 45.3, dog: 15.6 },
  grass: { duo: 73.4, spear: 53.1, bow: 0.0,  ice: 54.7,   dog: 9.4 },
  dog:   { duo: 76.5, spear: 21.9, bow: 1.5,  ice: 84.4,   grass: 90.6 }
};

function tourPairProb(x, y) {
  if (x === y) return 50;
  var row = TOUR_MATCHUP[x];
  if (row && row[y] != null) return row[y];
  return 50;
}

function tourPredict(teamA, teamB) {
  var sum = 0, n = 0;
  for (var i = 0; i < teamA.roles.length; i++) {
    for (var j = 0; j < teamB.roles.length; j++) {
      sum += tourPairProb(teamA.roles[i], teamB.roles[j]);
      n++;
    }
  }
  return n ? Math.round(sum / n) : 50;
}

/* 赔率：EU 盘口 = 100 / 胜率，最低 1.05、最高 20 */
function tourOdds(pct) {
  var p = Math.max(1, Math.min(99, pct));
  return Math.max(1.05, Math.min(20, 100 / p));
}

function tourFmtOdds(o) { return o.toFixed(2); }

function tourLog(text) {
  if (!tour) return;
  tour.log.unshift(text);
  if (tour.log.length > 40) tour.log.pop();
}

/* ---------- 开赛 ---------- */
function tourOpen(size) {
  tour = {
    size: size, players: [], groups: [], fixtures: [],
    ko: null, cur: null,
    stage: 'setup',
    champion: null, runnerUp: null, third: null,
    bank: TOUR_START_BANK, bets: [], settled: 0, winBets: 0,
    log: []
  };
  tourSpeed = 1;
  el.menu.classList.remove('show');
  document.body.classList.remove('menu-open');
  el.banner.classList.remove('show');
  el.tourBoard.classList.add('show');
  el.tourPanel.classList.remove('show');
  tourRender();
}

function tourClose() {
  tour = null;
  tourSpeed = 1;
  el.tourBoard.classList.remove('show');
  el.tourPanel.classList.remove('show');
  el.banner.classList.remove('show');
  openMenu();
}

/* ---------- 一键分配 ---------- */
function tourDeal() {
  if (!tour) return;
  var keys = POOL.map(function (p) { return p.key; });
  var players = [];
  for (var i = 0; i < tour.size; i++) {
    var s = tourShuffle(keys.slice());
    players.push({
      id: i, name: TOUR_NAMES[i] || ('玩家' + (i + 1)),
      roles: [s[0], s[1]], pts: 0, w: 0, l: 0, dmg: 0, group: -1
    });
  }

  var gCount = tour.size / 4;
  var groups = [];
  for (var g = 0; g < gCount; g++) groups.push([]);
  tourShuffle(players.slice()).forEach(function (p, idx) {
    p.group = idx % gCount;
    groups[p.group].push(p);
  });

  var fx = [];
  for (var gi = 0; gi < groups.length; gi++) {
    var gp = groups[gi];
    for (var a = 0; a < gp.length; a++) {
      for (var b = a + 1; b < gp.length; b++) {
        fx.push({
          kind: 'group', group: gi, idx: fx.length, a: gp[a], b: gp[b], format: 2,
          done: false, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, score: '', winner: null
        });
      }
    }
  }

  tour.players = players;
  tour.groups = groups;
  tour.fixtures = fx;
  tour.stage = 'group';
  tourLog('已分配 ' + tour.size + ' 名玩家 · ' + gCount + ' 组 · ' + fx.length + ' 场（BO2）· 资金 ' + tour.bank);
  tourSave();
  tourRender();
}

/* ---------- 玩一场 ---------- */
function tourPlay(idx) {
  if (!tour || tour.cur) return;
  var fx = tour.fixtures[idx];
  if (!fx || fx.done) return;
  tour.cur = { kind: 'group', fx: fx, format: 2, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, game: 0, roundName: '' };
  tourStartGame();
}

function tourPlayKo(zone, ri, mi) {
  if (!tour || tour.cur || !tour.ko) return;
  var m = tourKoMatch(zone, ri, mi);
  if (!m || m.done || !m.a || !m.b) return;
  tour.cur = { kind: zone, fx: m, format: m.format, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, game: 0, roundName: m.roundName };
  tourStartGame();
}

function tourKoMatch(zone, ri, mi) {
  if (!tour.ko) return null;
  if (zone === 'gf') return tour.ko.gf;
  var lanes = tour.ko[zone];
  return lanes && lanes[ri] ? lanes[ri].matches[mi] : null;
}

function tourStartGame() {
  var c = tour.cur;
  if (!c) return;
  c.game++;
  el.banner.classList.remove('show');
  el.tourBoard.classList.remove('show');
  el.tourPanel.classList.add('show');
  // 手机上场地小，默认把比分条收成一行，需要时再展开
  if (window.innerWidth <= 980) el.tourPanel.classList.add('folded');
  else el.tourPanel.classList.remove('folded');
  pick.A = c.fx.a.roles.slice(0, 2);
  pick.B = c.fx.b.roles.slice(0, 2);
  teamSize = 2;
  modeKind = 'vs';
  startBattle();
  tourTryFullscreen();
  tourRender();
}

/* ---------- 结算 ---------- */
function tourOnRoundEnd(win) {
  var c = tour.cur;
  if (!c) return;

  c.dmgA += dealtOf('A');
  c.dmgB += dealtOf('B');
  if (win === 'A') c.winsA++;
  else if (win === 'B') c.winsB++;
  else { c.winsA += 0.5; c.winsB += 0.5; }

  var over = tourMatchOver(c);
  tourRender();

  if (!over) {
    setTimeout(function () { if (tour && tour.cur === c) tourStartGame(); }, 900);
  } else {
    tourSettleMatch(c);
    tour.cur = null;
    el.tourPanel.classList.remove('show');
    el.tourBoard.classList.add('show');
    tourRender();
  }
}

function tourMatchOver(c) {
  if (c.format === 2) return c.game >= 2;
  var need = Math.ceil(c.format / 2);
  return c.winsA >= need || c.winsB >= need || c.game >= c.format;
}

function tourSettleMatch(c) {
  var fx = c.fx;
  fx.winsA = c.winsA; fx.winsB = c.winsB;
  fx.dmgA = c.dmgA; fx.dmgB = c.dmgB;
  fx.score = Math.round(c.winsA) + ':' + Math.round(c.winsB);
  fx.done = true;

  var aWin = c.winsA > c.winsB || (c.winsA === c.winsB && c.dmgA > c.dmgB);
  var bWin = c.winsB > c.winsA || (c.winsA === c.winsB && c.dmgB > c.dmgA);
  var draw = !aWin && !bWin;
  fx.winner = aWin ? fx.a : (bWin ? fx.b : null);
  fx.loser = aWin ? fx.b : (bWin ? fx.a : null);

  if (fx.kind === 'group') {
    if (aWin) { fx.a.pts += 3; fx.a.w++; fx.b.l++; }
    else if (bWin) { fx.b.pts += 3; fx.b.w++; fx.a.l++; }
    else { fx.a.pts += 1; fx.b.pts += 1; }
    fx.a.dmg += c.dmgA;
    fx.b.dmg += c.dmgB;
    tourLog('组' + (fx.group + 1) + ' ' + fx.a.name + ' ' + fx.score + ' ' + fx.b.name +
      ' → ' + (fx.winner ? fx.winner.name + ' 胜' : '平局'));
  } else {
    tourLog(fx.roundName + ' ' + fx.a.name + ' ' + fx.score + ' ' + fx.b.name +
      ' → ' + fx.winner.name + (fx.kind === 'lb' && fx.roundName === '季军赛' ? ' 进总决赛' : ''));
  }

  tourSettleBets(fx, draw);
  if (fx.kind !== 'group') tourAdvanceKO();
  tourSave();
}

/* ---------- 竞猜 ---------- */
function tourBetKey(fx) {
  return fx.kind === 'group' ? ('g' + fx.idx) : (fx.kind + ':' + fx.roundName + ':' + fx.a.id + ':' + fx.b.id);
}

function tourBetOf(fx) {
  var key = tourBetKey(fx);
  for (var i = 0; i < tour.bets.length; i++) if (tour.bets[i].key === key) return tour.bets[i];
  return null;
}

function tourPlaceBet(fx, side, amount) {
  if (!tour || fx.done) return;
  if (tour.bank < amount) { tourLog('资金不足，无法下注'); tourRender(); return; }
  var pct = tourPredict(fx.a, fx.b);
  var odds = tourOdds(side === 'A' ? pct : 100 - pct);
  var key = tourBetKey(fx);
  var bet = tourBetOf(fx);
  if (!bet) {
    bet = { key: key, side: side, stake: 0, odds: odds, name: side === 'A' ? fx.a.name : fx.b.name };
    tour.bets.push(bet);
  }
  if (bet.side !== side) {
    tour.bank += bet.stake;              // 换边：退回原押注
    bet.side = side;
    bet.stake = 0;
    bet.odds = odds;
    bet.name = side === 'A' ? fx.a.name : fx.b.name;
  }
  bet.stake += amount;
  bet.odds = odds;
  tour.bank -= amount;
  tourSave();
  tourRender();
}

function tourSettleBets(fx, draw) {
  var key = tourBetKey(fx);
  var idx = -1;
  for (var i = 0; i < tour.bets.length; i++) if (tour.bets[i].key === key) { idx = i; break; }
  if (idx < 0) return;
  var bet = tour.bets[idx];
  tour.bets.splice(idx, 1);
  if (!bet.stake) return;
  tour.settled++;
  if (draw) {
    tour.bank += bet.stake;
    tourLog('竞猜：' + bet.name + ' 平局，退回 ' + bet.stake);
    return;
  }
  var win = fx.winner && (fx.winner === fx.a ? 'A' : 'B') === bet.side;
  if (win) {
    var payout = Math.round(bet.stake * bet.odds);
    tour.bank += payout;
    tour.winBets++;
    tourLog('竞猜：押 ' + bet.name + ' 赢，+' + (payout - bet.stake) + '（余额 ' + tour.bank + '）');
  } else {
    tourLog('竞猜：押 ' + bet.name + ' 输，-' + bet.stake + '（余额 ' + tour.bank + '）');
  }
}

function tourBetRow(fx) {
  if (fx.done) return '';
  var pct = tourPredict(fx.a, fx.b);
  var oa = tourOdds(pct), ob = tourOdds(100 - pct);
  var bet = tourBetOf(fx);
  var stakeA = bet && bet.side === 'A' ? bet.stake : 0;
  var stakeB = bet && bet.side === 'B' ? bet.stake : 0;
  var key = tourBetKey(fx);
  return '<div class="tb-bet">' +
    '<button type="button" class="tb-odd a" data-bet="A" data-key="' + key + '"' +
      (tour.bank < 50 ? ' disabled' : '') + '>' +
      '押红 ' + tourFmtOdds(oa) + (stakeA ? ' · ' + stakeA : '') + '</button>' +
    '<span class="tb-prob">预测 ' + pct + '% · ' + (100 - pct) + '%</span>' +
    '<button type="button" class="tb-odd b" data-bet="B" data-key="' + key + '"' +
      (tour.bank < 50 ? ' disabled' : '') + '>' +
      '押蓝 ' + tourFmtOdds(ob) + (stakeB ? ' · ' + stakeB : '') + '</button>' +
    '</div>';
}

/* ---------- 淘汰赛结构（双败） ---------- */
/* N=4：WB[2,1] LB[1,1]；N=8：WB[4,2,1] LB[2,2,1,1]
   LB 计划：wbLoser(r) / mix(lb, wb) / lbOnly(lb) */
var TOUR_LB_PLAN = {
  4: [{ from: 'wbLoser', r: 0 }, { from: 'mix', lb: 0, wb: 1 }],
  8: [{ from: 'wbLoser', r: 0 }, { from: 'mix', lb: 0, wb: 1 }, { from: 'lbOnly', lb: 1 }, { from: 'mix', lb: 2, wb: 2 }]
};

function tourWbCounts(n) {
  var c = [], k = n / 2;
  while (k >= 1) { c.push(k); k = Math.floor(k / 2); }
  return c;
}

function tourLbCounts(n) {
  return n === 4 ? [1, 1] : [2, 2, 1, 1];
}

function tourKoName(zone, ri, total) {
  var last = ri === total - 1;
  if (zone === 'wb') {
    if (last) return '胜者组决赛';
    if (ri === total - 2) return '胜者组半决赛';
    return '胜者组首轮';
  }
  if (last) return '季军赛';
  return '败者组第' + (ri + 1) + '轮';
}

function tourBuildKO() {
  var firsts = [], seconds = [];
  for (var g = 0; g < tour.groups.length; g++) {
    var st = tourStandings(g);
    firsts.push(st[0]);
    seconds.push(st[1]);
  }
  var seeds = [];
  for (var i = 0; i < firsts.length; i++) {
    seeds.push(firsts[i]);
    seeds.push(seconds[(i + 1) % seconds.length]);
  }

  var n = seeds.length;
  var wbC = tourWbCounts(n), lbC = tourLbCounts(n);
  var wb = [], lb = [];

  for (var r = 0; r < wbC.length; r++) {
    var ms = [];
    for (var m = 0; m < wbC[r]; m++) {
      ms.push({ kind: 'wb', roundName: tourKoName('wb', r, wbC.length), a: null, b: null,
        format: r === wbC.length - 1 ? 3 : 3, done: false, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0,
        score: '', winner: null, loser: null });
    }
    wb.push({ name: tourKoName('wb', r, wbC.length), matches: ms });
  }
  for (var lr = 0; lr < lbC.length; lr++) {
    var lms = [];
    for (var lm = 0; lm < lbC[lr]; lm++) {
      lms.push({ kind: 'lb', roundName: tourKoName('lb', lr, lbC.length), a: null, b: null,
        format: 3, done: false, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, score: '', winner: null, loser: null });
    }
    lb.push({ name: tourKoName('lb', lr, lbC.length), matches: lms });
  }

  // 胜者组首轮填入种子
  for (var s = 0; s < wb[0].matches.length; s++) {
    wb[0].matches[s].a = seeds[s * 2] || null;
    wb[0].matches[s].b = seeds[s * 2 + 1] || null;
  }

  tour.ko = {
    wb: wb, lb: lb,
    gf: { kind: 'gf', roundName: '总决赛', a: null, b: null, format: 5,
          done: false, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, score: '', winner: null, loser: null }
  };
  tour.stage = 'ko';
  tourLog('小组赛结束 · 进入双败淘汰赛（胜者组 ' + wbC.length + ' 轮 / 败者组 ' + lbC.length + ' 轮）');
  tourAdvanceKO();
  tourSave();
  tourRender();
}

/* 把已完成的结果传播到后续槽位（幂等，每次结算后调用） */
function tourAdvanceKO() {
  var ko = tour.ko;
  if (!ko) return;

  // 胜者组：后一轮由前一轮胜者填入
  for (var r = 1; r < ko.wb.length; r++) {
    var entries = [];
    ko.wb[r - 1].matches.forEach(function (m) { if (m.done && m.winner) entries.push(m.winner); });
    ko.wb[r].matches.forEach(function (m, i) {
      if (!m.done) {
        m.a = entries[i * 2] || null;
        m.b = entries[i * 2 + 1] || null;
      }
    });
  }

  var plan = TOUR_LB_PLAN[tour.ko.wb.length === 3 ? 8 : 4];
  for (var j = 0; j < ko.lb.length; j++) {
    var p = plan[j];
    var slotA = [], slotB = [];
    if (p.from === 'wbLoser') {
      ko.wb[p.r].matches.forEach(function (m) { if (m.done && m.loser) slotA.push(m.loser); });
      ko.lb[j].matches.forEach(function (m, i) {
        if (!m.done) { m.a = slotA[i * 2] || null; m.b = slotA[i * 2 + 1] || null; }
      });
    } else if (p.from === 'lbOnly') {
      ko.lb[p.lb].matches.forEach(function (m) { if (m.done && m.winner) slotA.push(m.winner); });
      ko.lb[j].matches.forEach(function (m, i) { if (!m.done) m.a = slotA[i * 2] || null, m.b = slotA[i * 2 + 1] || null; });
    } else if (p.from === 'mix') {
      ko.lb[p.lb].matches.forEach(function (m) { if (m.done && m.winner) slotA.push(m.winner); });
      ko.wb[p.wb].matches.forEach(function (m) { if (m.done && m.loser) slotB.push(m.loser); });
      ko.lb[j].matches.forEach(function (m, i) {
        if (!m.done) { m.a = slotA[i] || null; m.b = slotB[i] || null; }
      });
    }
  }

  // 总决赛：胜者组冠军 vs 败者组冠军
  var wbFinal = ko.wb[ko.wb.length - 1].matches[0];
  var lbFinal = ko.lb[ko.lb.length - 1].matches[0];
  if (!ko.gf.done) {
    ko.gf.a = wbFinal.done ? wbFinal.winner : null;
    ko.gf.b = lbFinal.done ? lbFinal.winner : null;
  }

  // 名次
  if (lbFinal.done && lbFinal.loser) tour.third = lbFinal.loser;
  if (ko.gf.done && ko.gf.winner) {
    tour.champion = ko.gf.winner;
    tour.runnerUp = ko.gf.loser;
    tour.stage = 'done';
    el.banner.querySelector('strong').textContent = '冠军 · ' + tour.champion.name;
    el.banner.querySelector('em').textContent =
      tourRolesText(tour.champion) + ' · 亚军 ' + (tour.runnerUp ? tour.runnerUp.name : '—') +
      ' · 季军 ' + (tour.third ? tour.third.name : '—');
    tour.finalView = 'rank';
    el.banner.classList.add('show');
    tourLog('冠军：' + tour.champion.name + '（亚军 ' + (tour.runnerUp ? tour.runnerUp.name : '—') +
      ' · 季军 ' + (tour.third ? tour.third.name : '—') + '）');
  }
}

/* 最终排名：冠军 → 亚军 → 季军 → 其余按「淘汰赛胜场 / 小组积分 / 总伤害」排 */
function tourFinalRanking() {
  var list = tour.players.map(function (p) {
    var koWins = 0;
    if (tour.ko) {
      var all = [];
      tour.ko.wb.forEach(function (rd) { rd.matches.forEach(function (m) { all.push(m); }); });
      tour.ko.lb.forEach(function (rd) { rd.matches.forEach(function (m) { all.push(m); }); });
      all.push(tour.ko.gf);
      all.forEach(function (m) { if (m.done && m.winner === p) koWins++; });
    }
    var koPlayed = 0;
    if (tour.ko) {
      var all2 = [];
      tour.ko.wb.forEach(function (rd) { rd.matches.forEach(function (m) { all2.push(m); }); });
      tour.ko.lb.forEach(function (rd) { rd.matches.forEach(function (m) { all2.push(m); }); });
      all2.push(tour.ko.gf);
      all2.forEach(function (m) { if (m.done && (m.a === p || m.b === p)) koPlayed++; });
    }
    return { p: p, koWins: koWins, koPlayed: koPlayed, place: 0, tag: '' };
  });

  list.forEach(function (r) {
    if (tour.champion && r.p === tour.champion) { r.place = 1; r.tag = '冠军'; }
    else if (tour.runnerUp && r.p === tour.runnerUp) { r.place = 2; r.tag = '亚军'; }
    else if (tour.third && r.p === tour.third) { r.place = 3; r.tag = '季军'; }
  });

  var rest = list.filter(function (r) { return !r.place; });
  rest.sort(function (a, b) {
    if (b.koWins !== a.koWins) return b.koWins - a.koWins;
    if (b.p.pts !== a.p.pts) return b.p.pts - a.p.pts;
    return b.p.dmg - a.p.dmg;
  });
  rest.forEach(function (r, i) { r.place = 4 + i; });

  var restPlace = 4;
  rest.forEach(function (r) {
    r.tag = r.koPlayed === 0 ? '小组赛止步'
      : (r.koPlayed >= 3 || r.koWins >= 2 ? '四强' : '八强');
    r.place = restPlace++;
  });

  list.sort(function (a, b) { return a.place - b.place; });
  return list;
}

function tourGroupDone() {
  return tour.fixtures.length > 0 && tour.fixtures.every(function (f) { return f.done; });
}

function tourStandings(gIdx) {
  var list = tour.groups[gIdx].slice();
  list.sort(function (x, y) {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if ((y.w - y.l) !== (x.w - x.l)) return (y.w - y.l) - (x.w - x.l);
    return y.dmg - x.dmg;
  });
  return list;
}

function tourSkipMatch() {
  if (!tour || !tour.cur) return;
  var guard = 0;
  while (phase === 'fight' && guard < 40000) { tick(1 / 60); guard++; }
}

/* ---------- 渲染入口 ---------- */
function tourRender() {
  if (!tour) return;
  if (tour.cur) { renderBattleStrip(); return; }
  el.tourPanel.classList.remove('show');
  el.tourPanel.innerHTML = '';
  el.tourBoard.classList.add('show');
  if (tour.stage === 'ko' || tour.stage === 'done') renderBracket();
  else if (tour.stage === 'group' && tourGroupDone()) renderStandings();
  else renderGroups();
}

/* ---------- 手机顶部资金条 ---------- */
function tourMobileBar() {
  var pending = tour.bets.reduce(function (sum, b) { return sum + b.stake; }, 0);
  var h = '<div class="tb-mobile-bar">' +
    '<span class="mb-bank">资金 <b>' + tour.bank + '</b></span>' +
    '<span class="mb-sub">押注中 ' + pending + '</span>' +
    '<span class="mb-sub">已结算 ' + tour.settled + '</span>' +
    (tour.settled ? '<span class="mb-sub">赢 ' + tour.winBets + '</span>' : '') +
    '</div>';
  return h;
}

/* ---------- 侧栏（资金 / 竞猜 / 日志） ---------- */
function tourSideHtml() {
  var pending = tour.bets.reduce(function (s, b) { return s + b.stake; }, 0);
  var h = '<div class="tb-side-block">' +
    '<div class="tb-side-t">资金</div>' +
    '<div class="tb-bank">' + tour.bank + '</div>' +
    '<div class="tb-side-sub">初始 ' + TOUR_START_BANK + ' · 押注中 ' + pending +
    ' · 已结算 ' + tour.settled + '（赢 ' + tour.winBets + '）</div>' +
    '</div>';

  if (tour.bets.length) {
    h += '<div class="tb-side-block"><div class="tb-side-t">本场押注</div>';
    tour.bets.forEach(function (b) {
      h += '<div class="tb-side-row"><span>' + b.name + '</span><b>' + b.stake +
        ' @' + tourFmtOdds(b.odds) + '</b></div>';
    });
    h += '</div>';
  }

  h += '<div class="tb-side-block grow"><div class="tb-side-t">赛事日志</div><div class="tb-log">';
  tour.log.slice(0, 12).forEach(function (t) { h += '<div class="tb-log-row">' + t + '</div>'; });
  h += '</div></div>';
  return h;
}

/* ---------- ① 分组棋盘 / 组内对阵 ---------- */
function renderGroups() {
  var b = el.tourBoard;
  var gCount = tour.size / 4;
  var html = '<div class="tb-head">赛事模式 · ' + tour.size + ' 名玩家 · 以 ' + gCount + ' 组为例' +
    (tour.restored ? ' <i class="tb-tag">已恢复上次进度</i>' : '') + '</div>';

  html += '<div class="tb-wrap"><aside class="tb-left">' + tourSideHtml() + '</aside><main class="tb-main">' +
    tourMobileBar();

  if (tour.stage === 'setup') {
    html += '<div class="tb-sub">点下面的按钮，随机分配玩家、角色与分组</div>';
    html += '<div class="tb-groups">';
    for (var i = 0; i < gCount; i++) {
      html += '<div class="tb-group empty"><div class="tb-gtitle">组' + (i + 1) + '</div></div>';
    }
    html += '</div>';
    html += '<div class="tb-foot"><button type="button" class="tb-big" data-act="deal">开始分配玩家和物品</button>' +
      '<button type="button" class="tb-ghost" data-act="restart">重开赛事</button>' +
      '<button type="button" class="tb-ghost" data-act="exit">退出赛事</button></div>';
    html += '</main></div>';
    b.innerHTML = html;
    bindBoardClicks();
    return;
  }

  html += '<div class="tb-groups">';
  for (var g = 0; g < tour.groups.length; g++) {
    html += '<div class="tb-group"><div class="tb-gtitle">组' + (g + 1) + '</div><div class="tb-cards">';
    tour.fixtures.forEach(function (f, idx) {
      if (f.group !== g) return;
      html += '<div class="tb-card' + (f.done ? ' done' : '') + '">' +
        '<div class="tb-side a">' +
          '<span class="tb-nm a' + (f.winner === f.a ? ' win' : '') + '">' + f.a.name + '</span>' +
          '<span class="tb-roles">' + tourRolesText(f.a) + '</span>' +
          '<span class="tb-pt">' + f.a.pts + ' 分</span>' +
        '</div>' +
        '<div class="tb-mid">' +
          '<span class="tb-sc">' + (f.done ? f.score : 'vs') + '</span>' +
          (f.done
            ? '<span class="tb-done">已完</span>'
            : '<button type="button" data-act="play" data-idx="' + idx + '"' + (tour.cur ? ' disabled' : '') + '>开始</button>') +
        '</div>' +
        '<div class="tb-side b">' +
          '<span class="tb-nm b' + (f.winner === f.b ? ' win' : '') + '">' + f.b.name + '</span>' +
          '<span class="tb-roles">' + tourRolesText(f.b) + '</span>' +
          '<span class="tb-pt">' + f.b.pts + ' 分</span>' +
        '</div>' +
        tourBetRow(f) +
      '</div>';
    });
    html += '</div></div>';
  }
  html += '</div>';

  var doneN = tour.fixtures.filter(function (f) { return f.done; }).length;
  html += '<div class="tb-foot">' +
    '<span class="tb-hint">已完成 ' + doneN + ' / ' + tour.fixtures.length +
    ' 场 · 点「开始」进入战斗 · 赛前可押注（100 起，赔率按预测胜率）</span>' +
    '<button type="button" class="tb-ghost" data-act="restart">重开赛事</button>' +
    '<button type="button" class="tb-ghost" data-act="exit">退出赛事</button></div>';

  html += '</main></div>';
  b.innerHTML = html;
  bindBoardClicks();
}

/* ---------- ② 小组赛结束：积分排名 ---------- */
function renderStandings() {
  var b = el.tourBoard;
  var html = '<div class="tb-head">小组赛结束 · 积分排名</div>';
  html += '<div class="tb-wrap"><aside class="tb-left">' + tourSideHtml() + '</aside><main class="tb-main">' +
    tourMobileBar();
  html += '<div class="tb-sub">每组前两名晋级双败淘汰赛 · 同分看胜负差，再看总伤害</div>';

  html += '<div class="tb-groups">';
  for (var g = 0; g < tour.groups.length; g++) {
    var st = tourStandings(g);
    html += '<div class="tb-group"><div class="tb-gtitle">组' + (g + 1) + '</div>' +
      '<div class="tb-rank">' +
      '<div class="tb-rank-head"><span>#</span><span>玩家</span><span>角色</span><span>胜-负</span><span>积分</span><span>伤害</span></div>';
    st.forEach(function (p, i) {
      html += '<div class="tb-rank-row' + (i < 2 ? ' q' : '') + '">' +
        '<span>' + (i + 1) + '</span>' +
        '<span class="nm">' + p.name + '</span>' +
        '<span class="ro">' + tourRolesText(p) + '</span>' +
        '<span>' + p.w + '-' + p.l + '</span>' +
        '<span class="pt">' + p.pts + '</span>' +
        '<span>' + Math.round(p.dmg) + '</span>' +
        '</div>';
    });
    html += '</div></div>';
  }
  html += '</div>';

  html += '<div class="tb-foot">' +
    '<button type="button" class="tb-big" data-act="ko">生成淘汰赛（双败）</button>' +
    '<span class="tb-hint">胜者组 → 败者组 → 季军赛 → 总决赛</span>' +
    '<button type="button" class="tb-ghost" data-act="restart">重开赛事</button>' +
    '<button type="button" class="tb-ghost" data-act="exit">退出赛事</button></div>';

  html += '</main></div>';
  b.innerHTML = html;
  bindBoardClicks();
}

/* ---------- ③ 双败赛程 ---------- */
function koCard(zone, ri, mi, m) {
  var canPlay = !m.done && m.a && m.b && !tour.cur;
  var cls = 'tb-mt' + (m.done ? ' done' : '') + (canPlay ? ' playable' : '');
  var betBtn = '';
  if (m.done) betBtn = '<span class="tb-done">已完</span>';
  else if (canPlay) betBtn = '<button type="button" data-act="playKo" data-zone="' + zone +
    '" data-ri="' + ri + '" data-mi="' + mi + '">开打</button>';
  else betBtn = '<span class="tb-wait">待定</span>';

  var html = '<div class="tb-match ' + cls + '">' +
    '<div class="tb-mt-row"><span class="nm a' + (m.done && m.winner === m.a ? ' win' : '') + '">' +
      (m.a ? m.a.name : '待定') + '</span><b>' + (m.done ? m.score : '') + '</b></div>' +
    '<div class="tb-mt-row b"><span class="nm b' + (m.done && m.winner === m.b ? ' win' : '') + '">' +
      (m.b ? m.b.name : '待定') + '</span></div>';
  if (m.a && m.b && !m.done) {
    var pct = tourPredict(m.a, m.b);
    html += '<div class="tb-mt-odds">预测 ' + pct + '% · ' + (100 - pct) + '%</div>' +
      '<div class="tb-mt-btns">' + betBtn +
      '<button type="button" class="tb-odd a" data-bet2="A" data-zone="' + zone + '" data-ri="' + ri + '" data-mi="' + mi + '">押红</button>' +
      '<button type="button" class="tb-odd b" data-bet2="B" data-zone="' + zone + '" data-ri="' + ri + '" data-mi="' + mi + '">押蓝</button></div>';
  } else {
    html += '<div class="tb-mt-odds">' + m.roundName + '</div><div class="tb-mt-btns">' + betBtn + '</div>';
  }
  html += '</div>';
  return html;
}

function renderBracket() {
  var b = el.tourBoard;
  var ko = tour.ko;
  var html = '<div class="tb-head">' + (tour.stage === 'done'
    ? ('赛事结束 · 冠军 ' + tour.champion.name +
       (tour.finalView === 'bracket' ? ' <i class="tb-tag">赛程</i>' : ' <i class="tb-tag">最终排名</i>'))
    : '淘汰赛（双败）· ' + (ko.gf.a && ko.gf.b ? '总决赛' : '进行中')) + '</div>';
  html += '<div class="tb-wrap"><aside class="tb-left">' + tourSideHtml() + '</aside><main class="tb-main">' +
    tourMobileBar();

  if (tour.stage === 'done' && tour.finalView !== 'bracket') {
    var net = tour.bank - TOUR_START_BANK;
    html += '<div class="tb-podium">' +
      '<div class="p1"><span>冠军</span><b>' + tour.champion.name + '</b><i>' + tourRolesText(tour.champion) + '</i></div>' +
      '<div class="p2"><span>亚军</span><b>' + (tour.runnerUp ? tour.runnerUp.name : '—') + '</b></div>' +
      '<div class="p3"><span>季军</span><b>' + (tour.third ? tour.third.name : '—') + '</b></div>' +
      '</div>';

    html += '<div class="tb-final">' +
      '<div class="tb-final-head">全部 ' + tour.size + ' 名玩家最终排名</div>' +
      '<div class="tb-rank tb-rank-final">' +
      '<div class="tb-rank-head"><span>#</span><span>玩家</span><span>角色</span><span>名次</span><span>胜-负</span><span>积分</span><span>伤害</span></div>';
    tourFinalRanking().forEach(function (r) {
      html += '<div class="tb-rank-row' + (r.place <= 3 ? ' top top' + r.place : '') + '">' +
        '<span>' + r.place + '</span>' +
        '<span class="nm">' + r.p.name + '</span>' +
        '<span class="ro">' + tourRolesText(r.p) + '</span>' +
        '<span class="tag">' + r.tag + '</span>' +
        '<span>' + r.p.w + '-' + r.p.l + '</span>' +
        '<span class="pt">' + r.p.pts + '</span>' +
        '<span>' + Math.round(r.p.dmg) + '</span>' +
        '</div>';
    });
    html += '</div></div>';

    html += '<div class="tb-cash">' +
      '<div class="cash-label">最终资金</div>' +
      '<div class="cash-value">' + tour.bank + '</div>' +
      '<div class="cash-detail">初始 ' + TOUR_START_BANK + ' · 结算 ' + tour.settled +
        ' 场（赢 ' + tour.winBets + '）· 净' + (net >= 0 ? '赚 ' : '亏 ') + Math.abs(net) + '</div>' +
      '</div>';
  } else if (tour.stage === 'done') {
    html += '<div class="tb-podium">' +
      '<div class="p1"><span>冠军</span><b>' + tour.champion.name + '</b><i>' + tourRolesText(tour.champion) + '</i></div>' +
      '<div class="p2"><span>亚军</span><b>' + (tour.runnerUp ? tour.runnerUp.name : '—') + '</b></div>' +
      '<div class="p3"><span>季军</span><b>' + (tour.third ? tour.third.name : '—') + '</b></div>' +
      '</div>';
  }

  if (!(tour.stage === 'done' && tour.finalView !== 'bracket')) {
    html += '<div class="tb-lanes">';
  html += '<div class="tb-lane wb"><div class="tb-lane-t">胜者组</div><div class="tb-lane-body">';
  ko.wb.forEach(function (rd, ri) {
    html += '<div class="tb-round"><div class="tb-round-t">' + rd.name + '</div>';
    rd.matches.forEach(function (m, mi) { html += koCard('wb', ri, mi, m); });
    html += '</div>';
  });
  html += '</div></div>';

  html += '<div class="tb-lane lb"><div class="tb-lane-t">败者组</div><div class="tb-lane-body">';
  ko.lb.forEach(function (rd, ri) {
    html += '<div class="tb-round"><div class="tb-round-t">' + rd.name + '</div>';
    rd.matches.forEach(function (m, mi) { html += koCard('lb', ri, mi, m); });
    html += '</div>';
  });
  html += '</div></div>';

  html += '<div class="tb-lane gf"><div class="tb-lane-t">总决赛 BO5</div><div class="tb-lane-body">' +
    '<div class="tb-round">' + koCard('gf', 0, 0, ko.gf) + '</div></div></div>';
  html += '</div>';
  }

  html += '<div class="tb-foot">' +
    (tour.stage === 'done'
      ? '<button type="button" class="tb-ghost" data-act="toggleView">' +
        (tour.finalView === 'bracket' ? '← 回到排名' : '查看赛程 →') + '</button>'
      : '<span class="tb-hint">胜者组输了会掉进败者组；败者组输了就淘汰。季军赛胜者进总决赛，败者得季军。</span>') +
    '<button type="button" class="tb-ghost" data-act="restart">重开赛事</button>' +
    '<button type="button" class="tb-ghost" data-act="exit">退出赛事</button></div>';

  html += '</main></div>';
  b.innerHTML = html;
  bindBoardClicks();
}

/* ---------- ④ 战斗中的比分条 ---------- */
function renderBattleStrip() {
  el.tourBoard.innerHTML = '';
  var c = tour.cur;
  var fx = c.fx;
  var html =
    '<button type="button" class="tour-fold" data-act="fold" title="收起/展开">' +
      (el.tourPanel.classList.contains('folded') ? '▸' : '▾') + '</button>' +
    '<div class="tour-head">' + (c.roundName || ('组' + (fx.group + 1))) + ' · BO' + c.format + ' · 第 ' + c.game + ' 局</div>' +
    '<div class="tour-cur"><div class="tour-vs">' +
      '<span class="tour-side a">' + fx.a.name + '</span>' +
      '<b>' + Math.round(c.winsA) + ' : ' + Math.round(c.winsB) + '</b>' +
      '<span class="tour-side b">' + fx.b.name + '</span></div>' +
      '<div class="tour-roles">' + tourRolesText(fx.a) + ' &nbsp;vs&nbsp; ' + tourRolesText(fx.b) + '</div>' +
      '<div class="tour-prob">系统预测 ' + tourPredict(fx.a, fx.b) + '% : ' + (100 - tourPredict(fx.a, fx.b)) + '%</div>' +
      '</div>' +
    '<div class="tour-btns">' +
      '<button type="button" data-act="speed">速度 ×' + tourSpeed + '</button>' +
      '<button type="button" data-act="skip">跳过本局</button>' +
      '<button type="button" data-act="full">全屏</button>' +
      '<button type="button" data-act="exit">退出赛事</button></div>';
  el.tourPanel.classList.add('show');
  el.tourPanel.innerHTML = html;
  bindBoardClicks();
}

/* ---------- 全屏 ---------- */
function tourTryFullscreen() {
  var isTouch = window.matchMedia && window.matchMedia('(hover: none)').matches;
  if (!isTouch) return;
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(function () {});
  }
}

/* ---------- 点击 ---------- */
function bindBoardClicks() {
  var handler = function (e) {
    var betBtn = e.target.closest('[data-bet],[data-bet2]');
    if (betBtn && !betBtn.disabled) {
      var side = betBtn.getAttribute('data-bet') || betBtn.getAttribute('data-bet2');
      var fx = null;
      if (betBtn.hasAttribute('data-bet')) {
        var key = betBtn.getAttribute('data-key');
        for (var i = 0; i < tour.fixtures.length; i++) {
          if (tourBetKey(tour.fixtures[i]) === key) { fx = tour.fixtures[i]; break; }
        }
      } else {
        fx = tourKoMatch(betBtn.getAttribute('data-zone'),
          parseInt(betBtn.getAttribute('data-ri'), 10), parseInt(betBtn.getAttribute('data-mi'), 10));
      }
      if (fx) tourPlaceBet(fx, side, 100);
      return;
    }

    var btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    var act = btn.getAttribute('data-act');
    if (act === 'deal') tourDeal();
    else if (act === 'play') tourPlay(parseInt(btn.getAttribute('data-idx'), 10));
    else if (act === 'playKo') tourPlayKo(btn.getAttribute('data-zone'),
      parseInt(btn.getAttribute('data-ri'), 10), parseInt(btn.getAttribute('data-mi'), 10));
    else if (act === 'ko') tourBuildKO();
    else if (act === 'speed') { tourSpeed = tourSpeed === 1 ? 2 : (tourSpeed === 2 ? 4 : 1); tourRender(); }
    else if (act === 'skip') tourSkipMatch();
    else if (act === 'fold') {
      el.tourPanel.classList.toggle('folded');
      tourRender();
    } else if (act === 'full') {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(function () {});
      } else if (document.exitFullscreen) document.exitFullscreen();
    } else if (act === 'toggleView') {
      tour.finalView = tour.finalView === 'bracket' ? 'rank' : 'bracket';
      tourRender();
    } else if (act === 'restart') { tourWipe(); tourOpen(tour ? tour.size : 8); }
    else if (act === 'exit') tourClose();
  };
  el.tourBoard.onclick = handler;
  el.tourPanel.onclick = handler;
}

/* ---------- 启动 ---------- */
if (el.btnTour) {
  el.btnTour.addEventListener('click', function () {
    tourTryFullscreen();
    var saved = tourLoad();
    if (saved) {
      tour = saved;
      tour.restored = true;
      tourSpeed = 1;
      el.menu.classList.remove('show');
      document.body.classList.remove('menu-open');
      el.banner.classList.remove('show');
      el.tourBoard.classList.add('show');
      el.tourPanel.classList.remove('show');
      tourLog('已恢复上次赛事进度');
      tourRender();
      return;
    }
    var n = el.tourSize ? parseInt(el.tourSize.value, 10) : 8;
    tourOpen(n === 16 ? 16 : 8);
  });
}

window.addEventListener('keydown', function (e) {
  if (!tour) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); tourClose(); }
  else if (e.code === 'KeyR') { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

/* ============================================================
   击杀演出
   ============================================================ */
function tourBeginFinishFx(win) {
  var c = tour.cur;
  if (!c) return;
  var fx2 = c.fx;

  var winTeam = win === 'B' ? 'B' : 'A';
  var sx = 0, sy = 0, n = 0;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (u.team !== winTeam) continue;
    sx += u.x; sy += u.y; n++;
  }
  var focus = n ? { x: sx / n, y: sy / n } : { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h / 2 };

  tourFx = { t: 0, dur: 1.9, zoom: 1, focus: focus, win: win };
  tourFxWin = win;

  var a = Math.round(c.winsA) + (win === 'A' ? 1 : 0);
  var b = Math.round(c.winsB) + (win === 'B' ? 1 : 0);
  var name = win === 'draw' ? '平局' : (win === 'A' ? fx2.a.name : fx2.b.name) + ' 胜';
  var gain = '';
  if (win !== 'draw') {
    if (c.fx.kind === 'group') gain = '+' + (c.format === 2 ? 1 : 3) + ' 分';
    else gain = '晋级';
  }

  var box = el.tourFxEl;
  if (box) {
    box.innerHTML = '<div class="fx-score">' + a + ' : ' + b + '</div>' +
      '<div class="fx-name">' + name + '</div>' +
      (gain ? '<div class="fx-gain">' + gain + '</div>' : '');
    box.className = 'tour-fx';
    void box.offsetWidth;
    box.className = 'tour-fx show';
  }

  setTimeout(tourEndFinishFx, 1900);
}

function tourEndFinishFx() {
  if (!tourFx) return;
  tourFx = null;
  if (el.tourFxEl) el.tourFxEl.className = 'tour-fx';
  var win = tourFxWin;
  tourFxWin = null;
  if (tour && tour.cur) tourOnRoundEnd(win);
}

function tourFxTick(dt) {
  if (!tourFx) return;
  tourFx.t += dt;
  var inK = Math.min(1, tourFx.t / 0.45);
  var ease = 1 - Math.pow(1 - inK, 3);
  tourFx.zoom = 1 + 0.32 * ease;
  var tail = tourFx.dur - 0.45;
  if (tourFx.t > tail) {
    var outK = Math.min(1, (tourFx.t - tail) / 0.45);
    tourFx.zoom = 1 + 0.32 * (1 - outK * outK);
  }
}

/* ============================================================
   存档
   ============================================================ */
function tourPlayerRef(p) { return p ? p.id : null; }

function tourSerializeMatch(m) {
  return { roundName: m.roundName, a: tourPlayerRef(m.a), b: tourPlayerRef(m.b), format: m.format,
    done: m.done, winsA: m.winsA, winsB: m.winsB, dmgA: m.dmgA, dmgB: m.dmgB, score: m.score,
    winner: tourPlayerRef(m.winner), loser: tourPlayerRef(m.loser) };
}

function tourSave() {
  if (!tour) return;
  try {
    var data = {
      v: 3, size: tour.size, stage: tour.stage,
      champion: tourPlayerRef(tour.champion),
      runnerUp: tourPlayerRef(tour.runnerUp),
      third: tourPlayerRef(tour.third),
      bank: tour.bank, settled: tour.settled, winBets: tour.winBets,
      log: tour.log.slice(0, 30),
      players: tour.players.map(function (p) {
        return { id: p.id, name: p.name, roles: p.roles, pts: p.pts, w: p.w, l: p.l, dmg: p.dmg, group: p.group };
      }),
      groups: tour.groups.map(function (g) { return g.map(function (p) { return p.id; }); }),
      fixtures: tour.fixtures.map(function (f) {
        return { group: f.group, idx: f.idx, a: f.a.id, b: f.b.id, format: f.format, done: f.done,
          winsA: f.winsA, winsB: f.winsB, dmgA: f.dmgA, dmgB: f.dmgB, score: f.score,
          winner: tourPlayerRef(f.winner), loser: tourPlayerRef(f.loser) };
      }),
      ko: tour.ko ? {
        wb: tour.ko.wb.map(function (rd) { return { name: rd.name, matches: rd.matches.map(tourSerializeMatch) }; }),
        lb: tour.ko.lb.map(function (rd) { return { name: rd.name, matches: rd.matches.map(tourSerializeMatch) }; }),
        gf: tourSerializeMatch(tour.ko.gf)
      } : null
    };
    localStorage.setItem(TOUR_KEY, JSON.stringify(data));
  } catch (e) {}
}

function tourLoad() {
  var raw = null;
  try { raw = localStorage.getItem(TOUR_KEY); } catch (e) { return null; }
  if (!raw) return null;
  var d;
  try { d = JSON.parse(raw); } catch (e) { return null; }
  if (!d || d.v !== 3 || !d.players || !d.players.length) return null;

  var byId = {};
  var players = d.players.map(function (p) {
    var np = { id: p.id, name: p.name, roles: p.roles, pts: p.pts, w: p.w, l: p.l, dmg: p.dmg, group: p.group };
    byId[p.id] = np;
    return np;
  });
  var P = function (id) { return id != null ? byId[id] : null; };

  var out = {
    size: d.size, players: players,
    groups: (d.groups || []).map(function (g) { return g.map(function (id) { return byId[id]; }); }),
    fixtures: (d.fixtures || []).map(function (f) {
      return { kind: 'group', group: f.group, idx: f.idx, a: byId[f.a], b: byId[f.b], format: f.format,
        done: f.done, winsA: f.winsA, winsB: f.winsB, dmgA: f.dmgA, dmgB: f.dmgB, score: f.score,
        winner: P(f.winner), loser: P(f.loser) };
    }),
    ko: null, cur: null, stage: d.stage,
    champion: P(d.champion), runnerUp: P(d.runnerUp), third: P(d.third),
    bank: d.bank == null ? TOUR_START_BANK : d.bank,
    bets: [], settled: d.settled || 0, winBets: d.winBets || 0,
    log: d.log || []
  };

  if (d.ko) {
    var mk = function (m) {
      return { roundName: m.roundName, a: P(m.a), b: P(m.b), format: m.format, done: m.done,
        winsA: m.winsA, winsB: m.winsB, dmgA: m.dmgA, dmgB: m.dmgB, score: m.score,
        winner: P(m.winner), loser: P(m.loser), kind: 'x' };
    };
    out.ko = {
      wb: d.ko.wb.map(function (rd) { return { name: rd.name, matches: rd.matches.map(mk) }; }),
      lb: d.ko.lb.map(function (rd) { return { name: rd.name, matches: rd.matches.map(mk) }; }),
      gf: mk(d.ko.gf)
    };
    out.ko.wb.forEach(function (rd) { rd.matches.forEach(function (m) { m.kind = 'wb'; }); });
    out.ko.lb.forEach(function (rd) { rd.matches.forEach(function (m) { m.kind = 'lb'; }); });
    out.ko.gf.kind = 'gf';
  }
  return out;
}

function tourWipe() {
  try { localStorage.removeItem(TOUR_KEY); } catch (e) {}
}
