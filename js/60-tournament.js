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

/* 8 角色两两对位实测胜率（数值 = 行角色胜率 %）
   ⚠️ 2026-11-7（第 82 条）用「全角色双向各 100 局、相邻档位 600 局」的最新矩阵整体替换：
   旧表最迟在草·种子改动之前，冰块 vs 长矛（46.2→29.5）、草 vs 冰块（54.7→69.5）、
   弓箭 vs 长矛（68.8→80.5）等偏差已超过 10 个百分点，继续沿用会让竞猜赔率明显失真。 */
var TOUR_MATCHUP = {
  duo:   { spear: 30.0, bow: 53.5, ice: 51.2, grass: 20.0, dog: 31.5, anvil: 0.5,  milk: 1.0 },
  spear: { duo: 70.0, bow: 80.5, ice: 70.5, grass: 47.0, dog: 76.0, anvil: 71.0, milk: 95.7 },
  bow:   { duo: 46.5, spear: 19.5, ice: 100.0, grass: 98.5, dog: 97.0, anvil: 64.3, milk: 45.5 },
  ice:   { duo: 48.8, spear: 29.5, bow: 0.0,  grass: 30.5, dog: 16.5, anvil: 2.5,  milk: 0.0 },
  grass: { duo: 80.0, spear: 53.0, bow: 1.5,  ice: 69.5,   dog: 28.2, anvil: 7.5,  milk: 0.0 },
  dog:   { duo: 68.5, spear: 24.0, bow: 3.0,  ice: 83.5,   grass: 71.8, anvil: 34.0, milk: 0.0 },
  anvil: { duo: 99.5, spear: 29.0, bow: 35.7, ice: 97.5,   grass: 92.5, dog: 66.0, milk: 57.5 },
  milk:  { duo: 99.0, spear: 4.3, bow: 54.5, ice: 100.0,  grass: 100.0, dog: 100.0, anvil: 42.5 }
};

/* ---------- 抽签分档（第 82 条） ----------
   一强一弱：每人必得 1 个 A 档 + 1 个 B 档。
   分档依据 = 上表总体胜率：A 档 67.6%~73.0%，B 档 18.3%~40.4%；
   这样 28 种阵容被压缩到 16 种「一强一弱」组合，期望胜率 43.7%~56.0%（SD 3.8）。
   注意：这是赛事专用档位，版本平衡大改后需要重新排序。 */
var TOUR_BANDS = {
  A: ['spear', 'milk', 'anvil', 'bow'],
  B: ['dog', 'grass', 'duo', 'ice']
};

function tourBandOf(key) {
  if (TOUR_BANDS.A.indexOf(key) >= 0) return 'A';
  if (TOUR_BANDS.B.indexOf(key) >= 0) return 'B';
  return '?';
}

/* 选手卡上的角色行：每个角色后面跟一个 A/B 档小徽标 */
function tourRolesHtml(p) {
  if (!p || !p.roles) return '';
  return p.roles.map(function (k) {
    var band = tourBandOf(k);
    var cls = band === 'A' ? 'a' : (band === 'B' ? 'b' : '');
    return tourRoleName(k) + '<i class="tb-band ' + cls + '">' + band + '</i>';
  }).join(' / ');
}

/* 阵容档位组合（一强一弱 → “A+B”） */
function tourBandTag(p) {
  if (!p || !p.roles) return '';
  return p.roles.map(tourBandOf).sort().join('+');
}

/* 阵容期望强度：两个角色对 7 个对手的胜率平均（只用于蛇形分组排序） */
function tourRosterPower(p) {
  var sum = 0, n = 0;
  p.roles.forEach(function (r) {
    var row = TOUR_MATCHUP[r] || {};
    for (var k in row) {
      if (!row.hasOwnProperty(k)) continue;
      sum += row[k]; n++;
    }
  });
  return n ? sum / n : 50;
}

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

/* ---------- 赔率口径（第 83 条） ----------
   有后台模拟样本（fx.sim.ok）就用模拟胜率，否则回落到静态矩阵。
   fx.sim 由 js/70-tour-odds.js 维护：{ n 局数, w 玩家 a 的胜场(平局算 0.5), ok, st }

   小样本用「静态矩阵当先验」做收缩：p = (w + k·p0) / (n + k)。
   否则 4 局全胜就会给出 100% 胜率（赔率 1.05），既不可信也容易被压注套利。
   n = 48 时先验只占 11%，最终仍以模拟结果为主。 */
function tourFxPct(fx) {
  var s = fx && fx.sim;
  if (s && s.ok && s.n > 0) {
    var k = (typeof ODDS_PRIOR === 'number') ? ODDS_PRIOR : 0;
    var base = tourPredict(fx.a, fx.b) / 100;
    return Math.max(1, Math.min(99, Math.round((s.w + k * base) / (s.n + k) * 100)));
  }
  return tourPredict(fx.a, fx.b);
}

/* 赔率后面的状态小字：计算中 / AI n / 矩阵 */
function tourFxNote(fx) {
  var s = fx && fx.sim;
  if (!s) return '';
  if (s.st === 'off') return ' · 矩阵';
  if (s.st === 'done') return ' · AI ' + s.n;
  if (s.ok) return ' · 计算中 ' + s.n;
  return ' · 计算中';
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
  // 重新开赛事会重建 tour：先把可能还在跑的后台模拟停掉并还原现场
  if (typeof tourOddsStop === 'function') tourOddsStop();
  tour = {
    size: size, players: [], groups: [], fixtures: [],
    ko: null, cur: null,
    stage: 'setup',
    champion: null, runnerUp: null, third: null,
    bank: TOUR_START_BANK, bets: [], settled: 0, winBets: 0,
    mg: 0,                     // 手机端当前查看的组
    sel: null,                 // 赛程图里选中的场次 {zone, ri, mi}
    log: []
  };
  tourSpeed = 1;
  bkResetView();               // 新赛事从自然尺寸（缩放 1）开始
  el.menu.classList.remove('show');
  document.body.classList.remove('menu-open');
  el.banner.classList.remove('show');
  el.tourBoard.classList.add('show');
  el.tourPanel.classList.remove('show');
  tourRender();
}

function tourClose() {
  if (typeof tourOddsStop === 'function') tourOddsStop();
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
  // 重新抽签会重建所有 fixture：旧的后台模拟必须立刻停下（否则会把样本记到已丢弃的场次上）
  if (typeof tourOddsStop === 'function') tourOddsStop();
  tour.oddsN = 0;   // 赛段变了：重新按待算场次分摊样本量

  /* 一强一弱配额抽签（第 82 条）
     · 每人固定 1 个 A 档 + 1 个 B 档，玩家之间不出现完全相同的阵容（因此不会有镜像对局）
     · 每个角色被抽次数相同：8 人 = 每人 2 次，16 人 = 每人 4 次
     · 构造方式：把两个档位各自打乱后，用「偏移 k」的两两配对（k = 0…count-1），
       同一档位内每个角色出现 count 次，且不会产生重复组合 */
  var count = Math.floor(tour.size / 4);
  if (count < 1) count = 1;
  var bandA = tourShuffle(TOUR_BANDS.A.slice());
  var bandB = tourShuffle(TOUR_BANDS.B.slice());
  var combos = [];
  for (var k = 0; k < count; k++) {
    for (var c = 0; c < bandA.length; c++) {
      combos.push([bandA[c], bandB[(c + k) % bandB.length]]);
    }
  }
  combos = combos.slice(0, tour.size);
  tourShuffle(combos);

  var players = [];
  for (var i = 0; i < tour.size; i++) {
    players.push({
      id: i, name: TOUR_NAMES[i] || ('玩家' + (i + 1)),
      roles: combos[i], pts: 0, w: 0, l: 0, dmg: 0, group: -1
    });
  }

  /* 蛇形分组：按阵容期望强度从高到低，依次 0→N→N→0 地填组，
     让每个小组都拿到「一强一弱」且平均强度接近，避免死亡之组 */
  var gCount = tour.size / 4;
  var groups = [];
  for (var g = 0; g < gCount; g++) groups.push([]);
  var order = players.slice().sort(function (x, y) {
    return tourRosterPower(y) - tourRosterPower(x) || x.id - y.id;
  });
  for (var n = 0; n < order.length; n++) {
    var round = Math.floor(n / gCount);
    var pos = n % gCount;
    var gi = (round % 2 === 0) ? pos : (gCount - 1 - pos);
    order[n].group = gi;
    groups[gi].push(order[n]);
  }

  var fx = [];
  for (var gi2 = 0; gi2 < groups.length; gi2++) {
    var gp = groups[gi2];
    for (var a = 0; a < gp.length; a++) {
      for (var b = a + 1; b < gp.length; b++) {
        fx.push({
          kind: 'group', group: gi2, idx: fx.length, a: gp[a], b: gp[b], format: 2,
          done: false, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, score: '', winner: null,
          sim: { n: 0, w: 0, ok: false, st: 'wait' }   // 后台模拟样本（第 83 条，不落存档）
        });
      }
    }
  }

  tour.players = players;
  tour.groups = groups;
  tour.fixtures = fx;
  tour.stage = 'group';
  tour.dealAnim = true;   // 只在下一次渲染播放抽签/落位动画，之后重渲染不再播
  tourLog('平衡抽签：A 档 4 + B 档 4，每人 1A+1B · 蛇形分 ' + gCount + ' 组 · ' +
    fx.length + ' 场（BO2）· 资金 ' + tour.bank);
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
  // 后台赔率模拟会占用引擎全局：开打前必须先停下并还原现场（第 83 条）
  if (typeof tourOddsStop === 'function') tourOddsStop();
  c.game++;
  el.banner.classList.remove('show');
  el.tourBoard.classList.remove('show');
  el.tourPanel.classList.add('show');
  // 手机上场地小，默认把比分条收成一行，需要时再展开
  if (window.innerWidth <= 980) el.tourPanel.classList.add('folded');
  else el.tourPanel.classList.remove('folded');

  /* 换边（第 82 条）：偶数局交换红蓝进场，抵消出生侧的固定偏差。
     ⚠️ 只交换「本局谁站红/蓝」，c.fx.a / c.fx.b 始终代表玩家，
     winsA / winsB / dmgA / dmgB 也始终按玩家记 —— 不按红蓝方记。 */
  c.swap = (c.game % 2 === 0);
  var ra = c.fx.a.roles.slice(0, 2);
  var rb = c.fx.b.roles.slice(0, 2);
  pick.A = c.swap ? rb : ra;
  pick.B = c.swap ? ra : rb;
  teamSize = 2;
  modeKind = 'vs';
  startBattle();
  tourTryFullscreen();
  tourRender();
}

/* ---------- 结算 ---------- */
/* win 与 dealtOf 都是「本局红/蓝方」，换边局必须折回玩家维度再记分。
   例：c.swap=true 时红方打的是玩家 b，所以红方造成的伤害记到 c.dmgB、红方获胜记 c.winsB。 */
function tourOnRoundEnd(win) {
  var c = tour.cur;
  if (!c) return;

  var swap = !!c.swap;
  c.dmgA += dealtOf(swap ? 'B' : 'A');
  c.dmgB += dealtOf(swap ? 'A' : 'B');
  if (win === 'A') { if (swap) c.winsB++; else c.winsA++; }
  else if (win === 'B') { if (swap) c.winsA++; else c.winsB++; }
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

/* 下注反馈：在按钮位置飘一个 -100，并让资金数字闪一下 */
function tourBetPop(rect, amount, ok) {
  var d = document.createElement('div');
  d.className = 'bet-pop' + (ok ? '' : ' bad');
  d.textContent = (ok ? '-' : '') + amount + (ok ? '' : ' 资金不足');
  d.style.left = (rect.left + rect.width / 2) + 'px';
  d.style.top = (rect.top - 4) + 'px';
  document.body.appendChild(d);
  setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 900);
}

function tourFlashBank(kind) {
  tour.flash = kind;            // 'gain' | 'loss'
  var els = document.querySelectorAll('.tb-bank, .mb-bank b');
  for (var i = 0; i < els.length; i++) {
    els[i].classList.remove('flash-gain', 'flash-loss');
    void els[i].offsetWidth;
    els[i].classList.add(kind === 'gain' ? 'flash-gain' : 'flash-loss');
  }
  setTimeout(function () { if (tour) tour.flash = null; }, 700);
}

function tourPlaceBet(fx, side, amount) {
  if (!tour || fx.done) return;
  if (tour.bank < amount) {
    tourLog('资金不足，无法下注');
    tourRender();
    var lowEls = document.querySelectorAll('.tb-odd:not(:disabled)');
    if (lowEls.length) {
      var r = lowEls[0].getBoundingClientRect();
      tourBetPop(r, amount, false);
    }
    return;
  }
  var pct = tourFxPct(fx);
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
    tourLog('竞猜：押 ' + bet.name + ' 赢 +' + (payout - bet.stake) + '（余额 ' + tour.bank + '）');
    tourFlashBank('gain');
  } else {
    tourLog('竞猜：押 ' + bet.name + ' 输 -' + bet.stake + '（余额 ' + tour.bank + '）');
    tourFlashBank('loss');
  }
}

function tourBetBtn(fx, side) {
  if (fx.done) return '';
  var pct = tourFxPct(fx);
  var odds = tourOdds(side === 'A' ? pct : 100 - pct);
  var bet = tourBetOf(fx);
  var stake = bet && bet.side === side ? bet.stake : 0;
  var key = tourBetKey(fx);
  return '<button type="button" class="tb-odd ' + (side === 'A' ? 'a' : 'b') +
    (stake ? ' has' : '') + '" data-bet="' + side + '" data-key="' + key + '"' +
    (tour.bank < 100 ? ' disabled' : '') + '>' +
    (side === 'A' ? '押A ' : '押B ') + tourFmtOdds(odds) +
    (stake ? ' · ' + stake : '') + '</button>';
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
  tour.oddsOff = false;   // 淘汰赛新对局：重新给后台模拟一次机会（第 83 条）
  tour.oddsN = 0;         // 赛段变了：按剩下的淘汰赛场次重新分摊样本量
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

  // 统计整届赛事（小组 + 淘汰）的胜负场
  list.forEach(function (r) {
    var w = 0, l = 0;
    tour.fixtures.forEach(function (f) {
      if (!f.done) return;
      if (f.winner === r.p) w++;
      else if (f.loser === r.p) l++;
    });
    if (tour.ko) {
      var allM = [];
      tour.ko.wb.forEach(function (rd) { rd.matches.forEach(function (m) { allM.push(m); }); });
      tour.ko.lb.forEach(function (rd) { rd.matches.forEach(function (m) { allM.push(m); }); });
      allM.push(tour.ko.gf);
      allM.forEach(function (m) {
        if (!m.done) return;
        if (m.winner === r.p) w++;
        else if (m.loser === r.p) l++;
      });
    }
    r.w = w; r.l = l;
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
  /* 棋盘渲染完再启动后台赔率模拟（第 83 条）：
     先给「计算中」占位，算完一场就只改那一场的胜率文字，不整块重绘 */
  if (typeof tourOddsKick === 'function') tourOddsKick();
}

/* ---------- 手机顶部资金条 ---------- */
function tourMobileBar() {
  var pending = tour.bets.reduce(function (sum, b) { return sum + b.stake; }, 0);
  var h = '<div class="tb-mobile-bar">' +
    '<div class="mb-line"><i>资金</i><b>' + tour.bank + '</b></div>' +
    '<div class="mb-line small">押注 ' + pending + ' · 结算 ' + tour.settled +
      (tour.settled ? ' · 赢 ' + tour.winBets : '') + '</div>' +
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
    html += '<div class="tb-sub">点下面的按钮：每人抽 1 个 A 档 + 1 个 B 档，再按阵容强度蛇形分组</div>';
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

  var narrow = window.innerWidth <= 980;
  /* 抽签揭晓动画：只在 tourDeal() 之后第一次渲染时播放（tour.dealAnim 不落存档）。
     延迟用 CSS 变量 --gseq / --cseq 交给 @keyframes，JS 不跑逐帧动画，手机也不掉帧。 */
  var animate = !!tour.dealAnim;
  var cseq = 0;
  html += '<div class="tb-sub">A 档（' + TOUR_BANDS.A.map(tourRoleName).join(' / ') + '）· ' +
    'B 档（' + TOUR_BANDS.B.map(tourRoleName).join(' / ') + '）· 每人各抽 1 个 · ' +
    '按阵容强度蛇形分 ' + gCount + ' 组 · 组内 BO2（第 2 局换边）</div>';
  html += '<div class="tb-groups' + (narrow ? ' narrow' : '') + (tour.groups.length > 2 ? ' four' : '') + '">';
  for (var g = 0; g < tour.groups.length; g++) {
    html += '<div class="tb-group' + (animate ? ' deal" style="--gseq:' + g : '') + '">' +
      '<div class="tb-gtitle">组' + (g + 1) + '</div><div class="tb-cards">';
    tour.fixtures.forEach(function (f, idx) {
      if (f.group !== g) return;
      var cAttr = animate ? ' deal" style="--cseq:' + (cseq++) : '';
      html += '<div class="tb-card' + (f.done ? ' done' : '') + cAttr + '">' +
        '<div class="tb-side a">' +
          '<span class="tb-nm a' + (f.winner === f.a ? ' win' : '') + '">' + f.a.name + '</span>' +
          '<span class="tb-roles">' + tourRolesHtml(f.a) + '</span>' +
          '<span class="tb-pt">' + f.a.pts + ' 分</span>' +
          tourBetBtn(f, 'A') +
        '</div>' +
        '<div class="tb-mid">' +
          '<span class="tb-sc">' + (f.done ? f.score : 'vs') + '</span>' +
          (f.done
            ? '<span class="tb-done">已完</span>'
            : '<button type="button" data-act="play" data-idx="' + idx + '"' + (tour.cur ? ' disabled' : '') + '>开始</button>') +
          '<span class="tb-prob" data-prob="' + tourBetKey(f) + '">' + tourFxPct(f) + '%·' + (100 - tourFxPct(f)) + '%' + tourFxNote(f) + '</span>' +
        '</div>' +
        '<div class="tb-side b">' +
          '<span class="tb-nm b' + (f.winner === f.b ? ' win' : '') + '">' + f.b.name + '</span>' +
          '<span class="tb-roles">' + tourRolesHtml(f.b) + '</span>' +
          '<span class="tb-pt">' + f.b.pts + ' 分</span>' +
          tourBetBtn(f, 'B') +
        '</div>' +
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
  tour.dealAnim = false;      // 动画只播一次：之后的重渲染（押注 / 窗口缩放）不再重播
  bindBoardClicks();
}

/* ---------- ② 小组赛结束：积分排名 ---------- */
function renderStandings() {
  var b = el.tourBoard;
  var html = '<div class="tb-head">小组赛结束 · 积分排名</div>';
  html += '<div class="tb-wrap"><aside class="tb-left">' + tourSideHtml() + '</aside><main class="tb-main">' +
    tourMobileBar();
  html += '<div class="tb-sub">每组前两名晋级双败淘汰赛 · 同分看胜负差，再看总伤害</div>';

  var narrowS = window.innerWidth <= 980;
  html += '<div class="tb-groups' + (narrowS ? ' narrow' : '') + (tour.groups.length > 2 ? ' four' : '') + '">';
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
    (m.a ? '<div class="tb-mt-roles">' + tourRolesHtml(m.a) + '</div>' : '') +
    '<div class="tb-mt-row b"><span class="nm b' + (m.done && m.winner === m.b ? ' win' : '') + '">' +
      (m.b ? m.b.name : '待定') + '</span></div>' +
    (m.b ? '<div class="tb-mt-roles">' + tourRolesHtml(m.b) + '</div>' : '');
  if (m.a && m.b && !m.done) {
    var pct = tourFxPct(m);
    html += '<div class="tb-mt-odds" data-prob="' + tourBetKey(m) + '">预测 ' + pct + '% · ' + (100 - pct) + '%' + tourFxNote(m) + '</div>' +
      '<div class="tb-mt-btns">' + betBtn +
      '<button type="button" class="tb-odd a" data-bet2="A" data-zone="' + zone + '" data-ri="' + ri + '" data-mi="' + mi + '">押A</button>' +
      '<button type="button" class="tb-odd b" data-bet2="B" data-zone="' + zone + '" data-ri="' + ri + '" data-mi="' + mi + '">押B</button></div>';
  } else {
    html += '<div class="tb-mt-odds">' + m.roundName + '</div><div class="tb-mt-btns">' + betBtn + '</div>';
  }
  html += '</div>';
  return html;
}

/* ---------- ③.5 手机分段式赛程图（仍是树状连线，不做列表） ---------- */
/* 窄屏放不下整张双败大图，就按「小组赛 / 胜者组 / 败者组 / 总决赛」
   拆成四段独立的连线图纵向排列；每张图内部保留完整的方框 + 折线连接。
   2026-11-7（第 78 条）：节点 / 字号 / 间距整体放大一档，节点内多一行
   「双方物品」；外层 .tb-chart.mob 改由 transform 做双指缩放 + 拖动平移。 */

// 统一尺寸（四张图共用）：宽 176 / 高 72（内含 4 行文字）/ 列距 68 / 行距 22
var BK_BW = 176, BK_BH = 72, BK_GAPX = 68, BK_GAPY = 22;
var BK_STEP = BK_BH + BK_GAPY, BK_TOP = 30;

/* 节点内的物品行：把玩家两个角色的简称并成一行（如「红青组合 · 弓箭」）
   前置档位组合（A+B），让手机赛程图也能看出抽签规则 */
function bkItemsText(p) {
  if (!p || !p.roles || !p.roles.length) return '';
  var out = [];
  for (var i = 0; i < p.roles.length; i++) out.push(tourRoleName(p.roles[i]));
  return tourBandTag(p) + ' · ' + out.join(' · ');
}

// 方框 + 折线沿用桌面 SVG 的类名与配色，保证两端视觉一致
function bkPanelBox(x, y, bw, bh, m, zone, ri, mi) {
  var canPlay = !m.done && m.a && m.b && !tour.cur;
  var isSel = tour.sel && tour.sel.zone === zone && tour.sel.ri === ri && tour.sel.mi === mi;
  var cls = 'bk-mt' + (m.done ? ' done' : '') + (canPlay ? ' playable' : '') + (isSel ? ' sel' : '');
  var aN = m.a ? m.a.name : '待定';
  var bN = m.b ? m.b.name : '待定';
  var sc = m.done ? m.score : (m.a && m.b ? '开打' : '待定');
  var pad = 10;
  // 四行布局：A 名 / A 物品 / B 名 / B 物品（队名用红蓝主色，物品用更小字号柔色）；
  // 比分靠右、垂直居中，单独占一条竖带，不与左列文字抢位置
  return '<g class="' + cls + '"' + (canPlay ? ' data-zone="' + zone + '" data-ri="' + ri + '" data-mi="' + mi + '"' : '') + '>' +
    '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="9"/>' +
    '<text class="bk-n1' + (m.done && m.winner === m.a ? ' win' : '') + '" x="' + (x + pad) + '" y="' + (y + 22) + '">' + aN + '</text>' +
    '<text class="bk-it" x="' + (x + pad) + '" y="' + (y + 35) + '">' + bkItemsText(m.a) + '</text>' +
    '<text class="bk-n2' + (m.done && m.winner === m.b ? ' win' : '') + '" x="' + (x + pad) + '" y="' + (y + 55) + '">' + bN + '</text>' +
    '<text class="bk-it" x="' + (x + pad) + '" y="' + (y + 68) + '">' + bkItemsText(m.b) + '</text>' +
    '<text class="bk-sc" x="' + (x + bw - pad) + '" y="' + (y + bh / 2 + 5) + '" text-anchor="end">' + sc + '</text>' +
    '</g>';
}

/* 折线：从右列节点右边中点 (x1,y1) 走到左列节点左边中点 (x2,y2)。
   竖干固定落在两列正中线 colX（= (x1+x2)/2）：两个子节点汇入同一父节点时，
   上子线只有 colX 以上、下子线只有 colX 以下，二者刚好在父节点中心上下对称，
   不会出现两条半透明线压在同一条竖干上（重叠会明显变深、看起来像画歪了）。
   折角用二次贝塞尔倒圆角，避免直角拐点在高分屏缩放后发毛。 */
function bkEdgeD(x1, y1, x2, y2) {
  var colX = (x1 + x2) / 2;
  var dy = y2 - y1;
  var r = Math.min(10, Math.abs(dy) / 2, Math.abs(colX - x1), Math.abs(x2 - colX));
  if (Math.abs(dy) < 0.5) return 'M' + x1 + ' ' + y1 + ' H' + x2;   // 同一行：直接一根横线
  if (r < 2) {                                                     // 折角太小放不下圆角：直角折线
    return 'M' + x1 + ' ' + y1 + ' H' + colX + ' V' + y2 + ' H' + x2;
  }
  var s = dy > 0 ? 1 : -1;
  return 'M' + x1 + ' ' + y1 +
    ' H' + (colX - r) +
    ' Q' + colX + ' ' + y1 + ' ' + colX + ' ' + (y1 + s * r) +
    ' V' + (y2 - s * r) +
    ' Q' + colX + ' ' + y2 + ' ' + (colX + r) + ' ' + y2 +
    ' H' + x2;
}

function bkPanelEdge(x1, y1, x2, y2, dashed) {
  return '<path class="bk-edge' + (dashed ? ' dash' : '') + '" d="' + bkEdgeD(x1, y1, x2, y2) + '"/>';
}

function bkPanelSvg(w, h, inner) {
  // 固定为自然宽度（1:1）：四张图字号完全一致；
  // 屏幕比图窄时不压缩成看不清，而是由外层 .tb-chart.mob 做缩放 / 平移
  return '<svg class="bk-svg bk-panel" viewBox="0 0 ' + w + ' ' + h +
    '" style="width:' + w + 'px;min-width:' + w + 'px">' + inner + '</svg>';
}

function bkPanelWB() {
  var ko = tour.ko;
  var BW = BK_BW, BH = BK_BH, GAPX = BK_GAPX, step = BK_STEP;
  var wbR = ko.wb.length, leaves = ko.wb[0].matches.length * 2;

  function ys(count) {
    var span = Math.pow(2, Math.round(Math.log2(leaves / count)));
    var arr = [];
    for (var i = 0; i < count; i++) arr.push((i * span + (span - 1) / 2) * step);
    return arr;
  }

  var yOf = [];
  for (var r = 0; r < wbR; r++) yOf.push(ys(ko.wb[r].matches.length));

  var top = BK_TOP;
  var w = 24 + wbR * (BW + GAPX) + 70;
  var out = [];
  var maxBottom = 0;

  for (var r2 = 0; r2 < wbR; r2++) {
    // 每轮一列，列顶写轮次名（胜者组首轮 / 半决赛 / 决赛），层次一眼可辨
    out.push('<text class="bk-lab wb" x="' + (24 + r2 * (BW + GAPX) + BW / 2) +
      '" y="16" text-anchor="middle">' + ko.wb[r2].name + '</text>');
    var ms = ko.wb[r2].matches;
    for (var i = 0; i < ms.length; i++) {
      var x = 24 + r2 * (BW + GAPX), y = top + yOf[r2][i];
      out.push(bkPanelBox(x, y, BW, BH, ms[i], 'wb', r2, i));
      if (y + BH > maxBottom) maxBottom = y + BH;
      if (r2 + 1 < wbR) {
        var py = top + yOf[r2 + 1][Math.floor(i / 2)];
        out.push(bkPanelEdge(x + BW, y + BH / 2, 24 + (r2 + 1) * (BW + GAPX), py + BH / 2, false));
      }
    }
  }

  // 胜者组冠军出口：与总决赛面板里的来源标签对应
  var lastY = top + yOf[wbR - 1][0];
  out.push('<text class="bk-lab gf" x="' + (24 + (wbR - 1) * (BW + GAPX) + BW + 10) +
    '" y="' + (lastY + BH / 2 + 5) + '">→ 总决赛</text>');

  // 高度按实际最低的方框收紧，避免底部留一大片空白
  return bkPanelSvg(w, maxBottom + 8, out.join(''));
}

function bkPanelLB() {
  var ko = tour.ko;
  var BW = BK_BW, BH = BK_BH, GAPX = BK_GAPX, step = BK_STEP;
  var lbR = ko.lb.length;
  var leaves = 0;
  for (var t = 0; t < lbR; t++) leaves = Math.max(leaves, ko.lb[t].matches.length * 2);

  function ys(count) {
    var span = Math.pow(2, Math.round(Math.log2(leaves / count)));
    var arr = [];
    for (var i = 0; i < count; i++) arr.push((i * span + (span - 1) / 2) * step);
    return arr;
  }

  var yOf = [];
  for (var r = 0; r < lbR; r++) yOf.push(ys(ko.lb[r].matches.length));

  var top = BK_TOP;
  var w = 24 + lbR * (BW + GAPX) + 70;
  var out = [];
  var maxBottom = 0;

  for (var r2 = 0; r2 < lbR; r2++) {
    out.push('<text class="bk-lab lb" x="' + (24 + r2 * (BW + GAPX) + BW / 2) +
      '" y="16" text-anchor="middle">' + ko.lb[r2].name + '</text>');
    var ms = ko.lb[r2].matches;
    for (var i = 0; i < ms.length; i++) {
      var x = 24 + r2 * (BW + GAPX), y = top + yOf[r2][i];
      out.push(bkPanelBox(x, y, BW, BH, ms[i], 'lb', r2, i));
      if (y + BH > maxBottom) maxBottom = y + BH;
      if (r2 + 1 < lbR) {
        var nCount = ko.lb[r2 + 1].matches.length;
        var ni = nCount === 1 ? 0 : Math.floor(i / 2);
        var ny = top + yOf[r2 + 1][ni];
        out.push(bkPanelEdge(x + BW, y + BH / 2, 24 + (r2 + 1) * (BW + GAPX), ny + BH / 2, false));
      }
    }
  }

  // 败者组冠军（末轮 = 季军赛）出口
  var lastY = top + yOf[lbR - 1][0];
  out.push('<text class="bk-lab gf" x="' + (24 + (lbR - 1) * (BW + GAPX) + BW + 10) +
    '" y="' + (lastY + BH / 2 + 5) + '">→ 总决赛</text>');

  // 高度按实际最低的方框收紧：单场轮次不会再留下整块空白
  return bkPanelSvg(w, maxBottom + 8, out.join(''));
}

function bkPanelGF() {
  // 两个来源框（胜者组冠军 / 败者组冠军）各占上下对称的一半，汇入同一张决赛框；
  // 决赛框左边缘设两个入口（fy+24 / fy+48，关于框中心 fy+36 上下对称），
  // 两条线的端点因此都落在节点边框上，不会挤在同一个点上糊成一团
  var bw = BK_BW, bh = BK_BH;
  var srcW = 150, srcH = 46;
  var s1y = 30, s2y = 104;                 // 两个来源框顶边
  var fx = 14 + srcW + BK_GAPX;            // 232
  var fy = 54;                             // 决赛框顶边：来源中点 90 上下各 36
  var w = fx + bw + 20;                    // 428
  var h = Math.max(s2y + srcH, fy + bh) + 8;
  var p1 = fy + 24, p2 = fy + bh - 24;     // 78 / 102，上下对称的两个入口

  var out = [];
  out.push('<g class="bk-src"><rect x="14" y="' + s1y + '" width="' + srcW + '" height="' + srcH + '" rx="8"/>' +
    '<text x="24" y="' + (s1y + 29) + '">胜者组冠军</text></g>');
  out.push('<g class="bk-src"><rect x="14" y="' + s2y + '" width="' + srcW + '" height="' + srcH + '" rx="8"/>' +
    '<text x="24" y="' + (s2y + 29) + '">败者组冠军</text></g>');
  out.push(bkPanelEdge(14 + srcW, s1y + srcH / 2, fx, p1, false));
  out.push(bkPanelEdge(14 + srcW, s2y + srcH / 2, fx, p2, true));
  out.push(bkPanelBox(fx, fy, bw, bh, tour.ko.gf, 'gf', 0, 0));

  return bkPanelSvg(w, h, out.join(''));
}

function bkPanelGroup() {
  if (!tour.groups || !tour.groups.length) return '';
  var n = tour.groups.length;
  var BW = BK_BW, BH = BK_BH, GAPX = BK_GAPX, step = BK_STEP;
  var top = BK_TOP, col1 = 24, col2 = 24 + BW + GAPX;
  var w = col2 + BW + 20;
  var h = top + n * step + 8;
  var out = [];

  // 列标题：各组 / 晋级
  out.push('<text class="bk-lab" x="' + (col1 + BW / 2) + '" y="16" text-anchor="middle">各组（前 2 晋级）</text>');
  out.push('<text class="bk-lab" x="' + (col2 + BW / 2) + '" y="16" text-anchor="middle">晋级双败</text>');

  var nodeY = top + ((n - 1) * step) / 2;
  for (var g = 0; g < n; g++) {
    var st = tourStandings(g);
    var y = top + g * step;
    var q1 = st[0] ? st[0].name : '—';
    var q2 = st[1] ? st[1].name : '—';
    out.push('<g class="bk-grp"><rect x="' + col1 + '" y="' + y + '" width="' + BW +
      '" height="' + BH + '" rx="9"/>' +
      '<text class="bk-gt" x="' + (col1 + 10) + '" y="' + (y + 31) + '">组' + (g + 1) + '</text>' +
      '<text class="bk-gs" x="' + (col1 + 10) + '" y="' + (y + 53) + '">① ' + q1 + '　② ' + q2 + '</text></g>');
    out.push(bkPanelEdge(col1 + BW, y + BH / 2, col2, nodeY + BH / 2, false));
  }

  // 汇入节点：双败阶段的参赛人数（每组 2 人）
  out.push('<g class="bk-grp"><rect x="' + col2 + '" y="' + nodeY + '" width="' + BW + '" height="' + BH + '" rx="9"/>' +
    '<text class="bk-gt" x="' + (col2 + 10) + '" y="' + (nodeY + 31) + '">晋级 ' + (n * 2) + ' 人</text>' +
    '<text class="bk-gs" x="' + (col2 + 10) + '" y="' + (nodeY + 53) + '">进入双败淘汰</text></g>');

  return bkPanelSvg(w, h, out.join(''));
}

function mobBracket() {
  return '<div class="tb-bk-m">' +
    '<section class="tb-bk-sec grp">' +
      '<div class="tb-bk-h"><b>小组赛</b><i>每组前 2 名晋级双败</i></div>' +
      '<div class="tb-graph">' + bkPanelGroup() + '</div>' +
    '</section>' +
    '<section class="tb-bk-sec wb">' +
      '<div class="tb-bk-h"><b>胜者组</b><i>输一场 → 下方败者组</i></div>' +
      '<div class="tb-graph">' + bkPanelWB() + '</div>' +
    '</section>' +
    '<section class="tb-bk-sec lb">' +
      '<div class="tb-bk-h"><b>败者组</b><i>再输一场即淘汰</i></div>' +
      '<div class="tb-graph">' + bkPanelLB() + '</div>' +
    '</section>' +
    '<section class="tb-bk-sec gf">' +
      '<div class="tb-bk-h"><b>总决赛</b><i>BO5</i></div>' +
      '<div class="tb-graph">' + bkPanelGF() + '</div>' +
    '</section>' +
  '</div>';
}

/* ---------- ③.6 赛程图缩放 / 平移（第 78 条） ----------
   手机：双指捏合缩放 + 单指拖动平移；缩放作用在 .tb-bk-m 的 transform 上，
        因此不产生系统滚动条，也不会带动整页滚动。
   桌面：在 .tb-chart 里按住拖动 = 改 scrollLeft / scrollTop（滚轮仍是原生滚动）；
        窄窗口（仍走 .mob 布局）时滚轮平移、Ctrl/⌘ + 滚轮缩放。
   缩放范围：[适配整图的倍率（0.2 ~ 1）] ~ 2.6；初始 1（自然尺寸，不为塞进一屏而缩小）。 */
var BK_ZOOM_MAX = 2.6;
var bkView = { s: 1, tx: 0, ty: 0 };
var bkBox = null, bkContent = null, bkDragged = false;

/* 最小倍率 = 刚好把整张图缩进视口（图比视口小时不放大超过 1；下限 0.1 保证能总览） */
function bkMinScale() {
  if (!bkBox || !bkContent) return 1;
  var cw = bkContent.offsetWidth || 1, ch = bkContent.offsetHeight || 1;
  var fit = Math.min(bkBox.clientWidth / cw, bkBox.clientHeight / ch);
  return Math.max(0.1, Math.min(1, fit));
}

function bkResetView() { bkView.s = 1; bkView.tx = 0; bkView.ty = 0; }

/* 应用 transform，并把内容夹在视口内：比视口窄/矮时居中，超出时可拖到边缘 */
function bkApply() {
  if (!bkBox || !bkContent) return;
  var vw = bkBox.clientWidth, vh = bkBox.clientHeight;
  var cw = bkContent.offsetWidth || 1, ch = bkContent.offsetHeight || 1;
  if (vw <= 0 || vh <= 0) return;
  var sw = cw * bkView.s, sh = ch * bkView.s;
  bkView.tx = sw <= vw ? (vw - sw) / 2 : Math.min(0, Math.max(vw - sw, bkView.tx));
  bkView.ty = sh <= vh ? 0 : Math.min(0, Math.max(vh - sh, bkView.ty));
  bkContent.style.transform =
    'translate3d(' + bkView.tx + 'px,' + bkView.ty + 'px,0) scale(' + bkView.s + ')';
}

/* 以视口坐标 (cx,cy) 为锚点缩放到 ns（锚点下的内容保持不动） */
function bkZoomTo(ns, cx, cy) {
  ns = Math.max(bkMinScale(), Math.min(BK_ZOOM_MAX, ns));
  var k = ns / bkView.s;
  bkView.tx = cx - (cx - bkView.tx) * k;
  bkView.ty = cy - (cy - bkView.ty) * k;
  bkView.s = ns;
  bkApply();
}

/* 手机 / 窄窗口：双指缩放 + 拖动平移。
   不使用 setPointerCapture：触摸指针本身有隐式捕获，pointermove 会从子元素冒泡上来；
   一旦显式捕获，click 会被改派到 chart 上，赛程节点的点击选中就会失效。 */
function bkBindMobileView(chart) {
  var pts = [];
  var baseTx = 0, baseTy = 0, baseS = 1, baseD = 1, baseMx = 0, baseMy = 0;
  var dragFrom = null;

  function local(e) {
    var r = chart.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function find(id) {
    for (var i = 0; i < pts.length; i++) if (pts[i].id === id) return i;
    return -1;
  }
  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  chart.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var p = local(e);
    var i = find(e.pointerId);
    if (i >= 0) pts.splice(i, 1);          // 同一个指针重复按下：先清掉残留状态
    pts.push({ id: e.pointerId, x: p.x, y: p.y });
    if (pts.length === 1) {
      dragFrom = p; baseTx = bkView.tx; baseTy = bkView.ty; bkDragged = false;
    } else if (pts.length === 2) {
      baseD = dist(pts[0], pts[1]) || 1;
      var m = mid(pts[0], pts[1]);
      baseMx = m.x; baseMy = m.y;
      baseS = bkView.s; baseTx = bkView.tx; baseTy = bkView.ty;
      bkDragged = true;                  // 双指按下即视为拖动，松手不再触发"选中/开打"
    }
  });

  chart.addEventListener('pointermove', function (e) {
    var i = find(e.pointerId);
    if (i < 0) return;
    var p = local(e);
    pts[i].x = p.x; pts[i].y = p.y;

    if (pts.length >= 2) {
      var ns = Math.max(bkMinScale(), Math.min(BK_ZOOM_MAX, baseS * dist(pts[0], pts[1]) / baseD));
      var m2 = mid(pts[0], pts[1]);
      var k = ns / baseS;
      // 两指中点下的内容跟着中点走：一次手势同时完成缩放 + 平移
      bkView.s = ns;
      bkView.tx = m2.x - (baseMx - baseTx) * k;
      bkView.ty = m2.y - (baseMy - baseTy) * k;
      bkApply();
    } else if (dragFrom) {
      var dx = p.x - dragFrom.x, dy = p.y - dragFrom.y;
      if (!bkDragged && Math.abs(dx) + Math.abs(dy) > 8) bkDragged = true;
      if (!bkDragged) return;
      bkView.tx = baseTx + dx;
      bkView.ty = baseTy + dy;
      bkApply();
    }
  });

  function up(e) {
    var i = find(e.pointerId);
    if (i < 0) return;
    pts.splice(i, 1);
    if (pts.length === 1) {
      // 双指松开一指后，按剩余手指当前位置重新起算，画面不会跳一下
      dragFrom = { x: pts[0].x, y: pts[0].y };
      baseTx = bkView.tx; baseTy = bkView.ty;
    } else if (!pts.length) {
      dragFrom = null;
    }
  }
  chart.addEventListener('pointerup', up);
  chart.addEventListener('pointercancel', up);

  // 拖动 / 捏合结束后紧跟的那次 click 要吞掉，否则会误选中赛程节点
  chart.addEventListener('click', function (e) {
    if (bkDragged) { e.preventDefault(); e.stopPropagation(); bkDragged = false; }
  }, true);

  // 窄窗口（.mob 布局）下没有原生滚动，滚轮改为平移；Ctrl/⌘ + 滚轮缩放
  chart.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      var p = local(e);
      bkZoomTo(bkView.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12), p.x, p.y);
    } else {
      bkView.tx -= e.deltaX;
      bkView.ty -= (e.shiftKey ? e.deltaX : e.deltaY);
      bkApply();
    }
  }, { passive: false });
}

/* 桌面：按住拖动平移（改原生滚动位置，布局与字号完全不动） */
function bkBindDesktopPan(chart) {
  var dragging = false, sx = 0, sy = 0, sl = 0, st = 0;
  chart.style.cursor = 'grab';
  chart.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    dragging = true; bkDragged = false;
    sx = e.clientX; sy = e.clientY;
    sl = chart.scrollLeft; st = chart.scrollTop;
  });
  chart.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    if (e.buttons === 0) { stop(); return; }   // 在别处松手：不再继续平移
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (!bkDragged && Math.abs(dx) + Math.abs(dy) > 6) bkDragged = true;
    if (!bkDragged) return;
    chart.scrollLeft = sl - dx;
    chart.scrollTop = st - dy;
  });
  function stop() {
    if (!dragging) return;
    dragging = false;
    chart.style.cursor = 'grab';
  }
  chart.addEventListener('pointerup', stop);
  chart.addEventListener('pointercancel', stop);
  chart.addEventListener('pointerleave', stop);
  chart.addEventListener('click', function (e) {
    if (bkDragged) { e.preventDefault(); e.stopPropagation(); bkDragged = false; }
  }, true);
}

/* 每次 renderBracket 重建 .tb-chart 后调用：重新绑定并恢复缩放状态 */
function bkAfterRender() {
  bkBox = el.tourBoard.querySelector('.tb-chart');
  bkContent = bkBox ? bkBox.querySelector('.tb-bk-m') : null;
  bkDragged = false;
  if (!bkBox) return;
  if (bkContent) {
    bkContent.style.transformOrigin = '0 0';
    bkContent.style.willChange = 'transform';
    bkBindMobileView(bkBox);
    bkApply();
  } else {
    bkBindDesktopPan(bkBox);
  }
}

window.addEventListener('resize', function () {
  if (bkBox && bkContent) bkApply();
});

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
      '<div class="tb-final-head">全部 ' + tour.size + ' 名玩家最终排名（战绩为整届赛事的胜负场）</div>' +
      '<div class="tb-rank tb-rank-final">' +
      '<div class="tb-rank-head"><span>#</span><span>玩家</span><span>角色</span><span>名次</span><span>总胜负</span><span>积分</span><span>伤害</span></div>';
    tourFinalRanking().forEach(function (r) {
      html += '<div class="tb-rank-row' + (r.place <= 3 ? ' top top' + r.place : '') + '">' +
        '<span>' + r.place + '</span>' +
        '<span class="nm">' + r.p.name + '</span>' +
        '<span class="ro">' + tourRolesText(r.p) + '</span>' +
        '<span class="tag">' + r.tag + '</span>' +
        '<span>' + r.w + '-' + r.l + '</span>' +
        '<span class="pt">' + r.p.pts + '</span>' +
        '<span>' + Math.round(r.p.dmg) + '</span>' +
        '</div>';
    });
    html += '</div></div>';
    html += '<div class="tb-cash-line">资金 ' + tour.bank + ' · 初始 ' + TOUR_START_BANK +
      ' · 结算 ' + tour.settled + ' 场（赢 ' + tour.winBets + '）· 净' +
      (net >= 0 ? '赚 ' : '亏 ') + Math.abs(net) + '</div>';
  } else {
    if (tour.stage === 'done') {
      html += '<div class="tb-podium">' +
        '<div class="p1"><span>冠军</span><b>' + tour.champion.name + '</b><i>' + tourRolesText(tour.champion) + '</i></div>' +
        '<div class="p2"><span>亚军</span><b>' + (tour.runnerUp ? tour.runnerUp.name : '—') + '</b></div>' +
        '<div class="p3"><span>季军</span><b>' + (tour.third ? tour.third.name : '—') + '</b></div>' +
        '</div>';
    }
    html += koActBar();
    // 窄屏：拆成「小组赛 / 胜者组 / 败者组 / 总决赛」四段树状图纵向排列（仍是连线图，不是列表）
    var narrowB = window.innerWidth <= 980;
    html += '<div class="tb-chart' + (narrowB ? ' mob' : '') + '">' +
      (narrowB ? mobBracket() : bracketSvg()) + '</div>';
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
  bkAfterRender();          // 重新绑定缩放 / 平移，并恢复上一次的缩放位置
}

/* ---------- 双败赛程图（SVG，方框 + 连线） ---------- */
/* 赛程图选中某场后的操作条：押红 / 押蓝 / 开打 */
function koActBar() {
  if (!tour.sel) {
    return '<div class="tb-actbar tip">点赛程图里带「开打」的方框选中一场，再押注或开打</div>';
  }
  var m = tourKoMatch(tour.sel.zone, tour.sel.ri, tour.sel.mi);
  if (!m || m.done || !m.a || !m.b) {
    tour.sel = null;
    return '<div class="tb-actbar tip">该场已结束或还没产生对阵</div>';
  }
  var pct = tourFxPct(m);
  var oa = tourOdds(pct), ob = tourOdds(100 - pct);
  var bet = tourBetOf(m);
  var stakeA = bet && bet.side === 'A' ? bet.stake : 0;
  var stakeB = bet && bet.side === 'B' ? bet.stake : 0;
  var key = tourBetKey(m);
  var z = tour.sel.zone, ri = tour.sel.ri, mi = tour.sel.mi;
  return '<div class="tb-actbar">' +
    '<span class="ab-vs"><b class="a">' + m.a.name + '</b> vs <b class="b">' + m.b.name + '</b></span>' +
    '<span class="ab-pct" data-prob="' + key + '">' + pct + '%·' + (100 - pct) + '%' + tourFxNote(m) + '</span>' +
    '<button type="button" class="tb-odd a' + (stakeA ? ' has' : '') + '" data-bet2="A" data-zone="' + z +
      '" data-ri="' + ri + '" data-mi="' + mi + '">押红 ' + tourFmtOdds(oa) + (stakeA ? ' · ' + stakeA : '') + '</button>' +
    '<button type="button" class="tb-odd b' + (stakeB ? ' has' : '') + '" data-bet2="B" data-zone="' + z +
      '" data-ri="' + ri + '" data-mi="' + mi + '">押蓝 ' + tourFmtOdds(ob) + (stakeB ? ' · ' + stakeB : '') + '</button>' +
    '<button type="button" class="tb-big sm" data-act="playKo" data-zone="' + z +
      '" data-ri="' + ri + '" data-mi="' + mi + '">开打</button>' +
    '</div>';
}

function bracketSvg() {
  var ko = tour.ko;
  var BW = 150, BH = 40, GAPX = 62, GAPY = 16;
  var step = BH + GAPY;
  var wbR = ko.wb.length, lbR = ko.lb.length;
  var cols = Math.max(wbR, lbR);
  var wbLeaves = ko.wb[0].matches.length * 2;

  function ys(count, leaves) {
    var span = Math.pow(2, Math.round(Math.log2(leaves / count)));
    var out = [];
    for (var i = 0; i < count; i++) out.push((i * span + (span - 1) / 2) * step);
    return out;
  }

  var wbY = [], lbY = [];
  for (var r = 0; r < wbR; r++) wbY.push(ys(ko.wb[r].matches.length, wbLeaves));
  var lbLeaves = ko.lb[0].matches.length * 2;
  for (var lr = 0; lr < lbR; lr++) lbY.push(ys(ko.lb[lr].matches.length, Math.max(lbLeaves, ko.lb[lr].matches.length * 2)));

  var wbTop = 22;
  var wbH = wbLeaves * step;
  var lbTop = wbTop + wbH + 46;
  var lbH = Math.max(lbLeaves, 4) * step;
  var totalH = lbTop + lbH + 30;
  var totalW = 40 + cols * (BW + GAPX) + BW + 30;

  function xOf(col) { return 24 + col * (BW + GAPX); }

  var out = ['<svg class="bk-svg" viewBox="0 0 ' + totalW + ' ' + totalH + '" preserveAspectRatio="xMidYMid meet">'];

  // 区域标题
  out.push('<text class="bk-lab wb" x="10" y="14">胜者组 · 输一场掉入败者组</text>');
  out.push('<text class="bk-lab lb" x="10" y="' + (lbTop - 16) + '">败者组 · 再输一场即淘汰</text>');

  function box(x, y, m, zone, ri, mi) {
    var canPlay = !m.done && m.a && m.b && !tour.cur;
    var isSel = tour.sel && tour.sel.zone === zone && tour.sel.ri === ri && tour.sel.mi === mi;
    var cls = 'bk-mt' + (m.done ? ' done' : '') + (canPlay ? ' playable' : '') + (isSel ? ' sel' : '');
    var aN = m.a ? m.a.name : '待定';
    var bN = m.b ? m.b.name : '待定';
    var sc = m.done ? m.score : (m.a && m.b ? '开打' : '待定');
    var h = '<g class="' + cls + '"' + (canPlay ? ' data-zone="' + zone + '" data-ri="' + ri + '" data-mi="' + mi + '"' : '') + '>' +
      '<rect x="' + x + '" y="' + y + '" width="' + BW + '" height="' + BH + '" rx="6"/>' +
      '<text class="bk-n1' + (m.done && m.winner === m.a ? ' win' : '') + '" x="' + (x + 9) + '" y="' + (y + 16) + '">' + aN + '</text>' +
      '<text class="bk-n2' + (m.done && m.winner === m.b ? ' win' : '') + '" x="' + (x + 9) + '" y="' + (y + 32) + '">' + bN + '</text>' +
      '<text class="bk-sc" x="' + (x + BW - 9) + '" y="' + (y + 24) + '" text-anchor="end">' + sc + '</text>' +
      '</g>';
    return h;
  }

  function elb(x1, y1, x2, y2, dashed) {
    var mx = (x1 + x2) / 2;
    return '<path class="bk-edge' + (dashed ? ' dash' : '') + '" d="M' + x1 + ' ' + y1 +
      ' H' + mx + ' V' + y2 + ' H' + x2 + '"/>';
  }

  // 胜者组方框 + 连线
  for (var r2 = 0; r2 < wbR; r2++) {
    var ms = ko.wb[r2].matches;
    for (var i = 0; i < ms.length; i++) {
      var x = xOf(r2), y = wbTop + wbY[r2][i];
      out.push(box(x, y, ms[i], 'wb', r2, i));
      if (r2 + 1 < wbR) {
        var py = wbTop + wbY[r2 + 1][Math.floor(i / 2)];
        out.push(elb(x + BW, y + BH / 2, xOf(r2 + 1), py + BH / 2, false));
      }
    }
  }

  // 败者组方框 + 连线
  for (var l2 = 0; l2 < lbR; l2++) {
    var lms = ko.lb[l2].matches;
    for (var j = 0; j < lms.length; j++) {
      var lx = xOf(l2), ly = lbTop + lbY[l2][j];
      out.push(box(lx, ly, lms[j], 'lb', l2, j));
      if (l2 + 1 < lbR && lms.length > 1) {
        var nY = lbTop + lbY[l2 + 1][Math.floor(j / 2)];
        out.push(elb(lx + BW, ly + BH / 2, xOf(l2 + 1), nY + BH / 2, false));
      }
    }
  }

  // 胜者组败者 → 败者组：从框底垂直落下，沿空隙横向，再进目标框顶
  var plan = TOUR_LB_PLAN[wbR === 3 ? 8 : 4];
  var dropBase = lbTop - 26;
  for (var k = 0; k < plan.length; k++) {
    var pl = plan[k];
    if (pl.from === 'wbLoser') {
      for (var w = 0; w < ko.wb[pl.r].matches.length; w++) {
        var toI = Math.floor(w / 2);
        if (!ko.lb[k].matches[toI]) continue;
        var sx1 = xOf(pl.r) + BW / 2, sy1 = wbTop + wbY[pl.r][w] + BH;
        var tx1 = xOf(k) + BW / 2, ty1 = lbTop + lbY[k][toI];
        var gx1 = xOf(pl.r) - 16 - (w % 2) * 10;      // 走到框左侧的空隙，避免穿过下面的框
        var my1 = dropBase - (w % 2) * 8;
        out.push('<path class="bk-edge dash" d="M' + sx1 + ' ' + sy1 +
          ' V' + (sy1 + 12) + ' H' + gx1 + ' V' + my1 + ' H' + tx1 + ' V' + ty1 + '"/>');
      }
    } else if (pl.from === 'mix') {
      for (var q = 0; q < ko.wb[pl.wb].matches.length; q++) {
        if (!ko.lb[k].matches[q]) continue;
        var sx2 = xOf(pl.wb) + BW / 2, sy2 = wbTop + wbY[pl.wb][q] + BH;
        var tx2 = xOf(k) + BW / 2, ty2 = lbTop + lbY[k][q];
        var gx2 = xOf(pl.wb) - 16 - q * 10;
        var my2 = dropBase - 14 - q * 6;
        out.push('<path class="bk-edge dash" d="M' + sx2 + ' ' + sy2 +
          ' V' + (sy2 + 12) + ' H' + gx2 + ' V' + my2 + ' H' + tx2 + ' V' + ty2 + '"/>');
      }
    }
  }

  // 总决赛（右下）
  var gfX = xOf(cols), gfY = lbTop + lbY[lbR - 1][0] - 6;
  out.push('<text class="bk-lab gf" x="' + (gfX - 6) + '" y="' + (gfY - 10) + '">总决赛 BO5</text>');
  out.push(box(gfX, gfY, ko.gf, 'gf', 0, 0));

  // 胜者组冠军 → 总决赛
  var wbLast = ko.wb[wbR - 1].matches[0];
  out.push(elb(xOf(wbR - 1) + BW, wbTop + wbY[wbR - 1][0] + BH / 2, gfX, gfY + BH / 2, false));
  // 败者组冠军 → 总决赛
  var lbLast = ko.lb[lbR - 1].matches[0];
  out.push(elb(xOf(lbR - 1) + BW, lbTop + lbY[lbR - 1][0] + BH / 2, gfX, gfY + BH / 2, false));

  out.push('</svg>');
  return out.join('');
}

/* ---------- ④ 战斗中的比分条 ---------- */
function renderBattleStrip() {
  el.tourBoard.innerHTML = '';
  var c = tour.cur;
  var fx = c.fx;
  // 换边局：本局站红/蓝的角色和玩家归属是反的，这里按实际进场显示
  var redP = c.swap ? fx.b : fx.a;
  var blueP = c.swap ? fx.a : fx.b;
  var html =
    '<button type="button" class="tour-fold" data-act="fold" title="收起/展开">' +
      (el.tourPanel.classList.contains('folded') ? '▸' : '▾') + '</button>' +
    '<div class="tour-head">' + (c.roundName || ('组' + (fx.group + 1))) + ' · BO' + c.format + ' · 第 ' + c.game + ' 局' +
      (c.swap ? ' · 换边' : '') + '</div>' +
    '<div class="tour-cur"><div class="tour-vs">' +
      '<span class="tour-side a">' + fx.a.name + '</span>' +
      '<b>' + Math.round(c.winsA) + ' : ' + Math.round(c.winsB) + '</b>' +
      '<span class="tour-side b">' + fx.b.name + '</span></div>' +
      '<div class="tour-roles">红 ' + tourRolesHtml(redP) + ' &nbsp;vs&nbsp; 蓝 ' + tourRolesHtml(blueP) + '</div>' +
      '<div class="tour-prob">系统预测 ' + tourFxPct(fx) + '% : ' + (100 - tourFxPct(fx)) + '%' + tourFxNote(fx) + '</div>' +
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
      if (fx) {
        var r0 = betBtn.getBoundingClientRect();
        var okBefore = tour.bank >= 100 && !fx.done;
        tourPlaceBet(fx, side, 100);
        if (okBefore) tourBetPop(r0, 100, true);
      }
      return;
    }

    var node = e.target.closest('[data-zone]');
    if (node && tour && !tour.cur) {
      var zz = node.getAttribute('data-zone');
      var rr = parseInt(node.getAttribute('data-ri'), 10);
      var mm = parseInt(node.getAttribute('data-mi'), 10);
      var curSel = tour.sel;
      if (curSel && curSel.zone === zz && curSel.ri === rr && curSel.mi === mm) {
        tourPlayKo(zz, rr, mm);          // 同一场再点一次 = 直接开打
      } else {
        tour.sel = { zone: zz, ri: rr, mi: mm };
        tourRender();
      }
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

  // 演出里的比分/胜者按「玩家」显示：换边局把本局红蓝方折回 a / b
  var swap = !!c.swap;
  var pWin = win === 'draw' ? 'draw' : (swap ? (win === 'A' ? 'B' : 'A') : win);
  var a = Math.round(c.winsA) + (pWin === 'A' ? 1 : 0);
  var b = Math.round(c.winsB) + (pWin === 'B' ? 1 : 0);
  var name = pWin === 'draw' ? '平局' : (pWin === 'A' ? fx2.a.name : fx2.b.name) + ' 胜';
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
