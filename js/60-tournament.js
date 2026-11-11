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

/* 赛事选手名单（第 94 条）：默认全部用随机名字。
   · 名字池 18 个，每届随机取 N 个、不重复
   · 「自定义玩家姓名」里填过的位置优先用自定义名，其余位置继续随机
   · 名字只决定显示与身份，抽签 / 分组 / A·B 档搭配 / 排名 / 赛程逻辑完全不看名字 */
var TOUR_NAMES = ['阿石', '小七', '老白', '阿青', '铁蛋', '小满', '阿竹', '大熊',
                  '阿梨', '小九', '灰灰', '阿灯', '豆子', '阿海', '小鹿', '黑桃',
                  '兮眠', '西瓜'];

/* 从名字池随机取 count 个（不重复、顺序也随机） */
function tourPickNames(count) {
  var pool = TOUR_NAMES.slice();
  tourShuffle(pool);
  return pool.slice(0, Math.min(count, pool.length));
}

/* 生成一届的选手名：custom 里非空的用自定义名，其余随机补足且不与任何人重名 */
function tourMakeNames(count, custom) {
  if (!custom) custom = (typeof duelNamesGet === 'function') ? (duelNamesGet() || []) : [];
  var pool = tourPickNames(TOUR_NAMES.length);
  var out = [], used = {};
  for (var i = 0; i < count; i++) {
    var name = String(custom[i] || '').trim();
    if (name) { out.push(name); used[name] = 1; continue; }
    var pick = '';
    for (var j = 0; j < pool.length; j++) {
      if (!used[pool[j]]) { pick = pool[j]; break; }
    }
    if (pick) used[pick] = 1;
    out.push(pick || ('玩家' + (i + 1)));
  }
  return out;
}

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

/* 9 角色两两对位实测胜率（数值 = 行角色胜率 %）
   ⚠️ 2026-11-7（第 82 条）用「全角色双向各 100 局、相邻档位 600 局」的最新矩阵整体替换；
   2026-11-9（第 89 条）补入 water 桶行：bucket 用「双向各 24 局」的 1v1 实测，
   其余 8 行与 bucket 的对位取补值（100 - bucket 行）。 */
var TOUR_MATCHUP = {
  duo:   { spear: 30.0, bow: 53.5, ice: 51.2, grass: 20.0, dog: 31.5, anvil: 0.5,  milk: 1.0,  bucket: 21.0 },
  spear: { duo: 70.0, bow: 80.5, ice: 70.5, grass: 47.0, dog: 76.0, anvil: 71.0, milk: 95.7, bucket: 87.0 },
  bow:   { duo: 46.5, spear: 19.5, ice: 100.0, grass: 98.5, dog: 97.0, anvil: 64.3, milk: 45.5, bucket: 87.0 },
  ice:   { duo: 48.8, spear: 29.5, bow: 0.0,  grass: 30.5, dog: 16.5, anvil: 2.5,  milk: 0.0,  bucket: 0.0 },
  grass: { duo: 80.0, spear: 53.0, bow: 1.5,  ice: 69.5,   dog: 28.2, anvil: 7.5,  milk: 0.0,  bucket: 37.0 },
  dog:   { duo: 68.5, spear: 24.0, bow: 3.0,  ice: 83.5,   grass: 71.8, anvil: 34.0, milk: 0.0,  bucket: 46.0 },
  anvil: { duo: 99.5, spear: 29.0, bow: 35.7, ice: 97.5,   grass: 92.5, dog: 66.0, milk: 57.5, bucket: 54.0 },
  milk:  { duo: 99.0, spear: 4.3, bow: 54.5, ice: 100.0,  grass: 100.0, dog: 100.0, anvil: 42.5, bucket: 100.0 },
  bucket:{ duo: 79.0, spear: 13.0, bow: 13.0, ice: 100.0,  grass: 63.0, dog: 54.0, anvil: 46.0, milk: 0.0 }
};

/* ---------- 抽签分档（第 82 条；2026-11-9 第 89 条补入 bucket） ----------
   一强一弱：每人必得 1 个 A 档 + 1 个 B 档。
   分档依据 = 上表总体胜率（A 档 67.6%~73.0%，B 档 18.3%~40.4%）；
   bucket 的 1v1 总胜率约 46%（落在两档之间），2v2 位置模拟：
     当 A 位（搭档弱 B，对手 A+B）43%、当 B 位（搭档强 A）65%，
   低于现有 A 位均值 53%，因此划入 B 档（B 档共 5 人）。
   ⚠️ 9 个角色时，8/16 人赛无法让每个角色被抽次数完全相同，抽签改为
      「轮转配对 + 尽量均衡」，仍然保证每人 1A+1B、且组合不重复。 */
var TOUR_BANDS = {
  A: ['spear', 'milk', 'anvil', 'bow'],
  B: ['dog', 'grass', 'duo', 'ice', 'bucket']
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

/* 阵容期望强度：两个角色对 8 个对手的胜率平均（只用于蛇形分组排序） */
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
    names: tourMakeNames(size),   // 本届选手名（自定义 + 随机补足），抽签时直接沿用
    ko: null, cur: null,
    stage: 'setup',
    champion: null, runnerUp: null, third: null,
    bank: (typeof coinsGet === 'function' ? coinsGet() : TOUR_START_BANK),
    bets: [], settled: 0, winBets: 0,
    recorded: false,           // 本届最终成绩是否已写入浏览器存档
    mg: 0,                     // 手机端当前查看的组
    sel: null,                 // 赛程图里选中的场次 {zone, ri, mi}
    log: []
  };
  tourSpeed = 1;
  bkResetView();               // 新赛事从自然尺寸（缩放 1）开始
  if (el.home) el.home.classList.remove('show');
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
     · 构造方式：把两个档位各自打乱后，用「偏移 k」的两两配对（k = 0…count-1），
       A 档每个角色出现 count 次；B 档 5 人时无法整除（8 人赛出现 1~2 次、
       16 人赛出现 3~4 次），但组合不会重复 */
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
  // 选手名在 tourOpen() 就定好了（自定义优先、其余随机）；恢复旧存档时兜底重算
  var names = (tour.names && tour.names.length === tour.size) ? tour.names : tourMakeNames(tour.size);
  for (var i = 0; i < tour.size; i++) {
    players.push({
      id: i, name: names[i] || ('玩家' + (i + 1)),
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
  tourLog('平衡抽签：A 档 ' + bandA.length + ' + B 档 ' + bandB.length + '，每人 1A+1B · 蛇形分 ' + gCount + ' 组 · ' +
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
  // 本局红/蓝方对应的玩家名：HUD、伤害条、结算横幅都按这个显示
  teamNames.A = (c.swap ? c.fx.b : c.fx.a).name;
  teamNames.B = (c.swap ? c.fx.a : c.fx.b).name;
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
    // 淘汰赛也累计伤害，结算页的「累计伤害」才是整届总和
    fx.a.dmg += c.dmgA;
    fx.b.dmg += c.dmgB;
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
  var els = document.querySelectorAll('[data-bank]');
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
    tourSyncBetUi(fx);          // 只改文字/按钮状态，不重建棋盘（第 84 条：重建会丢滚动位置）
    var lowEls = document.querySelectorAll('[data-bet-key="' + tourBetKey(fx) + '"]:not(:disabled)');
    if (!lowEls.length) lowEls = document.querySelectorAll('.tb-odd:not(:disabled)');
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
  tourSyncBetUi(fx);            // 押注后只刷新资金/押注按钮（第 84 条：不再整块重建）
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
  /* data-bet-key / data-bet-side / data-bet-label 供 tourSyncBetUi() 局部改写按钮，
     这样押注后不必重建 DOM，滚动位置与双指缩放状态都不会丢 */
  return '<button type="button" class="tb-odd ' + (side === 'A' ? 'a' : 'b') +
    (stake ? ' has' : '') + '" data-bet="' + side + '" data-key="' + key +
    '" data-bet-key="' + key + '" data-bet-side="' + side +
    '" data-bet-label="押' + side + '"' +
    (tour.bank < 100 ? ' disabled' : '') + '>' +
    (side === 'A' ? '押A ' : '押B ') + tourFmtOdds(odds) +
    (stake ? ' · ' + stake : '') + '</button>';
}

/* ---------- 押注后的局部刷新（第 84 条） ----------
   押注只影响「资金数字 / 押注小字 / 押注列表 / 押注按钮」，直接改这些节点：
   · 资金：所有 [data-bank]
   · 顶部窄条第二行：[data-betline]
   · 侧栏小字：[data-betmeta]
   · 本场押注列表：[data-bets-box]
   · 日志：[data-log]
   · 按钮：本场的 [data-bet-key]，按 side 重算赔率、已押金额与 disabled
   不再调用 tourRender()，所以不会整块 innerHTML 重建，也不会把滚动位置清零。 */
function tourSyncBetUi(fx) {
  if (!tour || !el.tourBoard) return;
  var bank = String(tour.bank);
  var nodes = el.tourBoard.querySelectorAll('[data-bank]');
  for (var i = 0; i < nodes.length; i++) nodes[i].textContent = bank;

  nodes = el.tourBoard.querySelectorAll('[data-betline]');
  for (var j = 0; j < nodes.length; j++) nodes[j].innerHTML = tourBetLineInner();

  nodes = el.tourBoard.querySelectorAll('[data-betmeta]');
  for (var k = 0; k < nodes.length; k++) nodes[k].innerHTML = tourBetMetaInner();

  nodes = el.tourBoard.querySelectorAll('[data-bets-box]');
  for (var m = 0; m < nodes.length; m++) nodes[m].innerHTML = tourBetsInner();

  nodes = el.tourBoard.querySelectorAll('[data-log]');
  for (var n = 0; n < nodes.length; n++) nodes[n].innerHTML = tourLogInner();

  if (!fx || fx.done) return;
  var key = tourBetKey(fx);
  var pct = tourFxPct(fx);
  var bet = tourBetOf(fx);
  var btns = el.tourBoard.querySelectorAll('[data-bet-key="' + key + '"]');
  for (var q = 0; q < btns.length; q++) {
    var btn = btns[q];
    var side = btn.getAttribute('data-bet-side');
    var stake = (bet && bet.side === side) ? bet.stake : 0;
    var odds = tourOdds(side === 'A' ? pct : 100 - pct);
    var label = btn.getAttribute('data-bet-label') || ('押' + side);
    btn.textContent = label + ' ' + tourFmtOdds(odds) + (stake ? ' · ' + stake : '');
    if (stake) btn.classList.add('has');
    else btn.classList.remove('has');
    btn.disabled = tour.bank < 100;
  }
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

/* ---------- 滚动位置保持（第 84 条） ----------
   赛事页本身不滚，真正滚的是带 data-scroll 的局部容器
   （新版小组赛整页 .tb-ng、桌面赛程图 .tb-chart、日志 .tb-log 等）。
   任何整块重建前先拍快照，重建后按 key 还原 —— 不再只保存 .tour-board 的 scrollTop。 */
function tourScrollSnapshot() {
  var out = [];
  if (!el.tourBoard) return out;
  var nodes = el.tourBoard.querySelectorAll('[data-scroll]');
  for (var i = 0; i < nodes.length; i++) {
    out.push({
      k: nodes[i].getAttribute('data-scroll'),
      t: nodes[i].scrollTop, l: nodes[i].scrollLeft
    });
  }
  out.push({ k: '@board', t: el.tourBoard.scrollTop, l: el.tourBoard.scrollLeft });
  return out;
}

function tourScrollRestore(snap) {
  if (!snap || !el.tourBoard) return;
  for (var i = 0; i < snap.length; i++) {
    var n = snap[i].k === '@board' ? el.tourBoard
      : el.tourBoard.querySelector('[data-scroll="' + snap[i].k + '"]');
    if (!n) continue;
    if (snap[i].t) n.scrollTop = snap[i].t;
    if (snap[i].l) n.scrollLeft = snap[i].l;
  }
}

/* ---------- 渲染入口 ---------- */
function tourRender() {
  if (!tour) return;
  if (tour.cur) { renderBattleStrip(); return; }
  var snap = tourScrollSnapshot();
  el.tourPanel.classList.remove('show');
  el.tourPanel.innerHTML = '';
  el.tourBoard.classList.add('show');
  if (tour.stage === 'ko' || tour.stage === 'done') renderBracket();
  else if (tour.stage === 'group' && tourGroupDone()) renderStandings();
  else renderGroups();
  tourScrollRestore(snap);
  /* 棋盘渲染完再启动后台赔率模拟（第 83 条）：
     先给「计算中」占位，算完一场就只改那一场的胜率文字，不整块重绘 */
  if (typeof tourOddsKick === 'function') tourOddsKick();
  /* 手机端：按阶段切到独立页面（或回落到旧棋盘） */
  if (typeof mobiTourSync === 'function') mobiTourSync();
}

/* ---------- 手机顶部资金条 ---------- */
function tourMobileBar() {
  return '<div class="tb-mobile-bar">' +
    '<div class="mb-line"><i>资金</i><b data-bank>' + tour.bank + '</b></div>' +
    '<div class="mb-line small" data-betline>' + tourBetLineInner() + '</div>' +
    '</div>';
}

/* 顶部窄条的第二行 / 侧栏资金小字 / 押注列表 / 日志：抽成 inner 生成器，
   押注后只替换这几段文字，不重建整块棋盘（第 84 条） */
function tourBetLineInner() {
  var pending = tour.bets.reduce(function (s, b) { return s + b.stake; }, 0);
  return '押注 ' + pending + ' · 结算 ' + tour.settled +
    (tour.settled ? ' · 赢 ' + tour.winBets : '');
}

function tourBetMetaInner() {
  var pending = tour.bets.reduce(function (s, b) { return s + b.stake; }, 0);
  return '初始 ' + TOUR_START_BANK + ' · 押注中 ' + pending +
    ' · 已结算 ' + tour.settled + '（赢 ' + tour.winBets + '）';
}

function tourBetsInner() {
  if (!tour.bets.length) return '';
  var h = '<div class="tb-side-t">本场押注</div>';
  tour.bets.forEach(function (b) {
    h += '<div class="tb-side-row"><span>' + b.name + '</span><b>' + b.stake +
      ' @' + tourFmtOdds(b.odds) + '</b></div>';
  });
  return h;
}

function tourLogInner() {
  var h = '';
  tour.log.slice(0, 12).forEach(function (t) { h += '<div class="tb-log-row">' + t + '</div>'; });
  return h;
}

/* ---------- 侧栏（资金 / 竞猜 / 日志） ---------- */
function tourSideHtml() {
  return '<div class="tb-side-block">' +
    '<div class="tb-side-t">资金</div>' +
    '<div class="tb-bank" data-bank>' + tour.bank + '</div>' +
    '<div class="tb-side-sub" data-betmeta>' + tourBetMetaInner() + '</div>' +
    '</div>' +
    '<div class="tb-side-block" data-bets-box>' + tourBetsInner() + '</div>' +
    '<div class="tb-side-block grow"><div class="tb-side-t">赛事日志</div>' +
    '<div class="tb-log" data-scroll="log" data-log>' + tourLogInner() + '</div></div>';
}

/* ---------- ① 分组棋盘 / 组内对阵 ----------
   第 84 条改版：小组赛不再把 6 场 vs 卡全部铺开。
   · 每组只列「谁 · 什么角色（A/B 档）· 胜-负 · 几分」，按积分排；
   · 全场只显示「下一场对决」一张卡，押注也只针对这一场。 */

/* 4 人组的标准循环赛轮次：组内名单顺序固定（蛇形分组写入的顺序），
   (0,1)(2,3) 为第 1 轮，(0,2)(1,3) 第 2 轮，(0,3)(1,2) 第 3 轮。
   下一场按「轮次 → 组号 → 组内序号」取，保证各组先打完第 1 轮再进第 2 轮。 */
function tourPairRound(gp, pa, pb) {
  var ia = gp.indexOf(pa), ib = gp.indexOf(pb);
  if (ia < 0 || ib < 0) return 99;
  var x = ia < ib ? ia : ib, y = ia < ib ? ib : ia;
  if ((x === 0 && y === 1) || (x === 2 && y === 3)) return 1;
  if ((x === 0 && y === 2) || (x === 1 && y === 3)) return 2;
  if ((x === 0 && y === 3) || (x === 1 && y === 2)) return 3;
  return 99;
}

/* 组内第几场（同一轮里的先后）：第 1 轮 (0,1) 先、(2,3) 后；第 2 轮 (0,2) 先、(1,3) 后；
   第 3 轮 (0,3) 先、(1,2) 后。用来把各组同轮的比赛交错排，避免一个组连打两场。 */
function tourPairOrder(gp, pa, pb) {
  var ia = gp.indexOf(pa), ib = gp.indexOf(pb);
  if (ia < 0 || ib < 0) return 1;
  return (ia < ib ? ia : ib) === 0 ? 0 : 1;
}

function tourNextFixture() {
  if (!tour || tour.stage !== 'group') return null;
  var best = null, bestKey = Infinity;
  for (var i = 0; i < tour.fixtures.length; i++) {
    var f = tour.fixtures[i];
    if (f.done || !f.a || !f.b) continue;
    var rd = tourPairRound(tour.groups[f.group], f.a, f.b);
    var ord = tourPairOrder(tour.groups[f.group], f.a, f.b);
    /* 轮次 → 同轮先后 → 组号：全场先打完第 1 轮，再第 2 轮；同轮内各组交错进行 */
    var k = rd * 10000 + ord * 100 + f.group;
    if (k < bestKey) { bestKey = k; best = f; }
  }
  return best;
}

/* 组框：标题 + 4 名玩家的排名行 */
function tourGroupPanel(g, animate) {
  var st = tourStandings(g);
  var list = tour.fixtures.filter(function (f) { return f.group === g; });
  var doneN = list.filter(function (f) { return f.done; }).length;
  var nx = tourNextFixture();
  var h = '<div class="tb-group tb-ng-group' + (animate ? ' deal' : '') + '"' +
    (animate ? ' style="--gseq:' + g + '"' : '') + '>' +
    '<div class="tb-gtitle">组' + (g + 1) +
    '<em class="tb-ng-prog">' + doneN + '/' + list.length + ' 场</em></div>' +
    '<div class="tb-ng-list" data-scroll="gl' + g + '">';
  st.forEach(function (p, i) {
    var isNext = nx && nx.group === g && (nx.a === p || nx.b === p);
    var cls = 'tb-ng-row' + (i < 2 ? ' q' : '') + (isNext ? ' next' : '') + (animate ? ' deal' : '');
    h += '<div class="' + cls + '"' + (animate ? ' style="--cseq:' + (g * 4 + i) + '"' : '') + '>' +
      '<span class="rk">' + (i + 1) + '</span>' +
      '<span class="nm">' + p.name + '</span>' +
      '<span class="ro">' + tourRolesHtml(p) + '</span>' +
      '<span class="wl">' + p.w + '-' + p.l + '</span>' +
      '<span class="pt">' + p.pts + ' 分</span>' +
      '</div>';
  });
  h += '</div></div>';
  return h;
}

/* 下一场对决卡：双方名字 / 角色 / 积分 + 预测 + 押A / 开始 / 押B */
function tourNextCard(fx) {
  if (!fx) return '<div class="tb-ng-next empty">小组赛已全部打完 · 点下方生成积分排名</div>';
  var pct = tourFxPct(fx);
  var key = tourBetKey(fx);
  return '<section class="tb-ng-next">' +
    '<div class="tb-ng-next-head"><i>下一场对决</i>' +
    '<span>组' + (fx.group + 1) + ' · BO2 · 第 2 局换边</span></div>' +
    '<div class="tb-ng-vs">' +
    '<div class="tb-ng-team a">' +
    '<span class="nm a">' + fx.a.name + '</span>' +
    '<span class="ro">' + tourRolesHtml(fx.a) + '</span>' +
    '<span class="pt">' + fx.a.pts + ' 分 · ' + fx.a.w + '-' + fx.a.l + '</span></div>' +
    '<div class="tb-ng-vsmid">VS</div>' +
    '<div class="tb-ng-team b">' +
    '<span class="nm b">' + fx.b.name + '</span>' +
    '<span class="ro">' + tourRolesHtml(fx.b) + '</span>' +
    '<span class="pt">' + fx.b.pts + ' 分 · ' + fx.b.w + '-' + fx.b.l + '</span></div>' +
    '</div>' +
    '<div class="tb-ng-odds" data-prob="' + key + '">预测 ' + pct + '% · ' + (100 - pct) + '%' +
    tourFxNote(fx) + '</div>' +
    '<div class="tb-ng-actions">' +
    tourBetBtn(fx, 'A') +
    '<button type="button" class="tb-big sm" data-act="play" data-idx="' + fx.idx + '"' +
    (tour.cur ? ' disabled' : '') + '>开始对决</button>' +
    tourBetBtn(fx, 'B') +
    '</div></section>';
}

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
  html += '<div class="tb-sub">A 档（' + TOUR_BANDS.A.map(tourRoleName).join(' / ') + '）· ' +
    'B 档（' + TOUR_BANDS.B.map(tourRoleName).join(' / ') + '）· 每人各抽 1 个 · ' +
    '按阵容强度蛇形分 ' + gCount + ' 组 · 组内 BO2（第 2 局换边）</div>';

  /* 新版小组赛页（第 84 条）：外层 .tb-ng 是唯一滚动容器（手机整页也只滚这一块），
     上面一张「下一场对决」，下面各组排名。押注只针对下一场。 */
  html += '<div class="tb-ng" data-scroll="stage">';
  html += tourNextCard(tourNextFixture());
  html += '<div class="tb-groups' + (narrow ? ' narrow' : '') + (tour.groups.length > 2 ? ' four' : '') + '">';
  for (var g = 0; g < tour.groups.length; g++) {
    html += tourGroupPanel(g, animate);
  }
  html += '</div></div>';

  var doneN = tour.fixtures.filter(function (f) { return f.done; }).length;
  html += '<div class="tb-foot">' +
    '<span class="tb-hint">已完成 ' + doneN + ' / ' + tour.fixtures.length +
    ' 场 · 每组只显示下一场 · 赛前可押注（100 起，赔率按预测胜率）</span>' +
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
      '<div class="tb-rank" data-scroll="rank' + g + '">' +
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
    var bk = tourBetKey(m);
    var betM = tourBetOf(m);
    var sA = betM && betM.side === 'A' ? betM.stake : 0;
    var sB = betM && betM.side === 'B' ? betM.stake : 0;
    html += '<div class="tb-mt-odds" data-prob="' + bk + '">预测 ' + pct + '% · ' + (100 - pct) + '%' + tourFxNote(m) + '</div>' +
      '<div class="tb-mt-btns">' + betBtn +
      '<button type="button" class="tb-odd a' + (sA ? ' has' : '') + '" data-bet2="A" data-zone="' + zone + '" data-ri="' + ri +
      '" data-mi="' + mi + '" data-bet-key="' + bk + '" data-bet-side="A" data-bet-label="押A"' +
      (tour.bank < 100 ? ' disabled' : '') + '>押A' + (sA ? ' · ' + sA : '') + '</button>' +
      '<button type="button" class="tb-odd b' + (sB ? ' has' : '') + '" data-bet2="B" data-zone="' + zone + '" data-ri="' + ri +
      '" data-mi="' + mi + '" data-bet-key="' + bk + '" data-bet-side="B" data-bet-label="押B"' +
      (tour.bank < 100 ? ' disabled' : '') + '>押B' + (sB ? ' · ' + sB : '') + '</button></div>';
  } else {
    html += '<div class="tb-mt-odds">' + m.roundName + '</div><div class="tb-mt-btns">' + betBtn + '</div>';
  }
  html += '</div>';
  return html;
}

/* ---------- ③.5 手机分段式赛程图（仍是树状连线，不做列表） ---------- */
/* 窄屏赛程图（第 80 条）：小组赛单独一段；胜者组 + 败者组 + 总决赛合并为**一张**双败图。
   坐标系统一：第 col 轮左边缘 = 24 + col*(BW+GAPX)，胜者组在上、败者组在下、总决赛在最右列；
   · 胜者组内部：胜者折线进下一轮；
   · 胜者组败者：橙色虚线从框底落到败者组对应轮的框顶（败者组列标题下写明「接 XX 败者」）；
   · 败者组内部：上一轮胜者实线进下一轮（按 TOUR_LB_PLAN：mix 1:1、lbOnly 两两合并）；
   · 总决赛：胜者组冠军（实线）/ 败者组冠军（虚线）汇入右侧总决赛框的上下两个入口。 */

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

/* 折线倒圆角：沿 pts 顺序连线，中间拐点用二次贝塞尔抹圆；半径自动夹到相邻两段的一半，
   段太短时退化为直角。专用于「胜者组败者下落线」，避免缩放后折角发毛。 */
function bkPolyD(pts, rad) {
  function sgn(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
  var d = 'M' + pts[0][0] + ' ' + pts[0][1];
  for (var i = 1; i < pts.length - 1; i++) {
    var p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    var len1 = Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]);
    var len2 = Math.abs(p2[0] - p1[0]) + Math.abs(p2[1] - p1[1]);
    var r = Math.min(rad, len1 / 2, len2 / 2);
    if (r < 1) { d += ' L' + p1[0] + ' ' + p1[1]; continue; }
    var ax = p1[0] - sgn(p1[0] - p0[0]) * r, ay = p1[1] - sgn(p1[1] - p0[1]) * r;
    var bx = p1[0] + sgn(p2[0] - p1[0]) * r, by = p1[1] + sgn(p2[1] - p1[1]) * r;
    d += ' L' + ax + ' ' + ay + ' Q' + p1[0] + ' ' + p1[1] + ' ' + bx + ' ' + by;
  }
  var last = pts[pts.length - 1];
  return d + ' L' + last[0] + ' ' + last[1];
}

/* 手机端统一双败图：胜者组（上）+ 败者组（下）+ 总决赛（右），同一套坐标、同一张 SVG。
   取胜者组 / 败者组共用列位置，因此「哪一轮掉进哪一轮」在纵向上一眼可辨。 */
function bkPanelKO() {
  var ko = tour.ko;
  var BW = BK_BW, BH = BK_BH, GAPX = BK_GAPX, step = BK_STEP;
  var wbR = ko.wb.length, lbR = ko.lb.length;
  var cols = Math.max(wbR, lbR);
  var wbLeaves = ko.wb[0].matches.length * 2;
  var lbLeaves = ko.lb[0].matches.length * 2;

  // 同一轮的槽位纵向坐标：按 2 的幂铺开，最后一轮正好落在首轮的中点
  function ys(count, leaves) {
    var span = Math.pow(2, Math.round(Math.log2(leaves / count)));
    var arr = [];
    for (var i = 0; i < count; i++) arr.push((i * span + (span - 1) / 2) * step);
    return arr;
  }

  var wbY = [], lbY = [];
  for (var r = 0; r < wbR; r++) wbY.push(ys(ko.wb[r].matches.length, wbLeaves));
  for (var lr = 0; lr < lbR; lr++) lbY.push(ys(ko.lb[lr].matches.length, lbLeaves));

  var outer = 24;
  function xOf(col) { return outer + col * (BW + GAPX); }

  var wbTop = BK_TOP;
  var lbTop = wbTop + wbLeaves * step + 64;   // 两段之间留 64px：败者组列标题 + 下落线走廊

  // 总决赛在最右一列，纵向取「胜者组决赛中心」与「败者组决赛中心」的中点：
  // 两条冠军线各自只在一侧拐一次，终点落在决赛框左边缘的上下两个入口
  var wbC = wbTop + wbY[wbR - 1][0] + BH / 2;
  var lbC = lbTop + lbY[lbR - 1][0] + BH / 2;
  var gfX = xOf(cols), gfY = (wbC + lbC) / 2 - BH / 2;
  var w = gfX + BW + 30;
  var h = Math.max(lbTop + lbLeaves * step, gfY + BH) + 8;

  var out = [];

  // ---- 胜者组（上）：轮次标题 + 方框 + 胜者连线 ----
  for (var r2 = 0; r2 < wbR; r2++) {
    out.push('<text class="bk-lab wb" x="' + (xOf(r2) + 8) + '" y="16">' + ko.wb[r2].name + '</text>');
    var ms = ko.wb[r2].matches;
    for (var i = 0; i < ms.length; i++) {
      var x = xOf(r2), y = wbTop + wbY[r2][i];
      out.push(bkPanelBox(x, y, BW, BH, ms[i], 'wb', r2, i));
      if (r2 + 1 < wbR) {
        var py = wbTop + wbY[r2 + 1][Math.floor(i / 2)];
        out.push(bkPanelEdge(x + BW, y + BH / 2, xOf(r2 + 1), py + BH / 2, false));
      }
    }
  }

  // ---- 败者组（下）：列标题 + 「接 XX 败者」来源说明（下落线不靠猜）----
  var plan = TOUR_LB_PLAN[wbR === 3 ? 8 : 4];
  for (var l2 = 0; l2 < lbR; l2++) {
    var p = plan[l2];
    var sub;
    if (p.from === 'wbLoser' || p.from === 'mix') {
      sub = '接' + ko.wb[p.from === 'mix' ? p.wb : p.r].name + '败者';
    } else {
      sub = ko.lb[p.lb].name + '胜者';
    }
    out.push('<text class="bk-lab lb" x="' + (xOf(l2) + 8) + '" y="' + (lbTop - 26) + '">' +
      ko.lb[l2].name + '</text>');
    out.push('<text class="bk-sub" x="' + (xOf(l2) + 8) + '" y="' + (lbTop - 9) + '">' + sub + '</text>');
    var lms = ko.lb[l2].matches;
    for (var j = 0; j < lms.length; j++) {
      out.push(bkPanelBox(xOf(l2), lbTop + lbY[l2][j], BW, BH, lms[j], 'lb', l2, j));
    }
  }

  // 败者组内部：上一轮胜者 → 下一轮（mix 时 1:1，lbOnly 时两两合并）
  for (var k = 0; k < lbR; k++) {
    var pk = plan[k];
    if (pk.from !== 'mix' && pk.from !== 'lbOnly') continue;
    var srcMs = ko.lb[pk.lb].matches;
    for (var s = 0; s < srcMs.length; s++) {
      var ti = pk.from === 'lbOnly' ? Math.floor(s / 2) : s;
      if (!ko.lb[k].matches[ti]) continue;
      out.push(bkPanelEdge(xOf(pk.lb) + BW, lbTop + lbY[pk.lb][s] + BH / 2,
        xOf(k), lbTop + lbY[k][ti] + BH / 2, false));
    }
  }

  // ---- 胜者组败者下落（橙色虚线）：框底 → 右侧走廊 → 目标框顶 ----
  // 走廊放在「来源轮次右侧的列间空隙」，逐条错开 10px，避免多条竖干叠在一起变深；
  // 目标框顶的进入点靠右（+30 / +58），避开左侧的轮次标题与来源说明文字
  var chanN = {};
  for (var k2 = 0; k2 < lbR; k2++) {
    var p2 = plan[k2];
    if (p2.from !== 'wbLoser' && p2.from !== 'mix') continue;
    var srcRound = p2.from === 'wbLoser' ? p2.r : p2.wb;
    var srcMs2 = ko.wb[srcRound].matches;
    for (var w2 = 0; w2 < srcMs2.length; w2++) {
      var toI = p2.from === 'wbLoser' ? Math.floor(w2 / 2) : w2;
      if (!ko.lb[k2].matches[toI]) continue;
      var seq = chanN[k2] || 0; chanN[k2] = seq + 1;
      var sx = xOf(srcRound) + BW / 2, sy = wbTop + wbY[srcRound][w2] + BH;
      var cx = xOf(srcRound) + BW + 16 + seq * 10;
      var tcx = xOf(k2) + BW / 2, ty2 = lbTop + lbY[k2][toI];
      var tx = tcx + (p2.from === 'wbLoser' ? (w2 % 2 ? 58 : 30) : 30);
      var hy = ty2 - (seq % 2 ? 18 : 10);
      out.push('<path class="bk-edge dash" d="' +
        bkPolyD([[sx, sy], [sx, sy + 14], [cx, sy + 14], [cx, hy], [tx, hy], [tx, ty2]], 8) + '"/>');
    }
  }

  // ---- 总决赛（最右）：胜者组冠军（实线）/ 败者组冠军（虚线）汇入 ----
  out.push('<text class="bk-lab gf" x="' + gfX + '" y="' + (gfY - 10) + '">总决赛 BO5</text>');
  out.push(bkPanelBox(gfX, gfY, BW, BH, ko.gf, 'gf', 0, 0));
  out.push(bkPanelEdge(xOf(wbR - 1) + BW, wbC, gfX, gfY + 22, false));
  out.push(bkPanelEdge(xOf(lbR - 1) + BW, lbC, gfX, gfY + BH - 22, true));

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

/* 小组赛是否已结束：全部场次打完，或已经进入淘汰阶段（stage = 'ko' / 'done'）。
   结束后手机赛程图不再渲染「小组赛」那一段（连带标题一起），只留双败合并连线图，
   让双败图直接顶到原来的顶部位置，内容高度随之收紧（第 87 条）。 */
function tourGroupPhaseOver() {
  return tour.stage === 'ko' || tour.stage === 'done' ||
    (tour.stage === 'group' && tourGroupDone());
}

function mobBracket() {
  var koOnly = tourGroupPhaseOver();
  var h = '<div class="tb-bk-m' + (koOnly ? ' ko-only' : '') + '">';
  if (!koOnly) {
    h += '<section class="tb-bk-sec grp">' +
      '<div class="tb-bk-h"><b>小组赛</b><i>每组前 2 名晋级双败</i></div>' +
      '<div class="tb-graph">' + bkPanelGroup() + '</div>' +
      '</section>';
  }
  h += '<section class="tb-bk-sec ko">' +
    '<div class="tb-bk-h"><b>双败淘汰</b><i>胜者组在上 · 败者组在下 · 虚线 = 败者下落 · 可拖动 / 双指缩放</i></div>' +
    '<div class="tb-graph">' + bkPanelKO() + '</div>' +
    '</section>';
  return h + '</div>';
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
var bkKoOnly = false;   // 上次渲染时手机赛程图是否只剩双败一段（用于切换时重置缩放）

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
    /* 从「小组赛 + 双败」两段切到只剩双败一段时，内容高度骤减：
       沿用旧倍率会把整张图缩得很小、位置也偏掉，因此这次切换重置视图（之后照常保留缩放） */
    var koOnly = bkContent.classList.contains('ko-only');
    if (koOnly !== bkKoOnly) { bkResetView(); bkKoOnly = koOnly; }
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
      '<div class="tb-rank tb-rank-final" data-scroll="finalRank">' +
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
    // 窄屏：赛程图。小组赛未结束时两段（小组赛 + 双败合并图）；结束后只留双败段（第 80 / 87 条）
    var narrowB = window.innerWidth <= 980;
    html += '<div class="tb-chart' + (narrowB ? ' mob' : '') + '" data-scroll="chart">' +
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
/* 赛程图选中某场后的操作条：押红 / 押蓝 / 开打。
   拆成「取内容」与「拼外壳」两步：选中节点时只换操作条内容，不重建赛程图（第 84 条）。 */
function koActBarInfo() {
  if (!tour.sel) {
    return { tip: true, html: '点赛程图里带「开打」的方框选中一场，再押注或开打' };
  }
  var m = tourKoMatch(tour.sel.zone, tour.sel.ri, tour.sel.mi);
  if (!m || m.done || !m.a || !m.b) {
    tour.sel = null;
    return { tip: true, html: '该场已结束或还没产生对阵' };
  }
  var pct = tourFxPct(m);
  var oa = tourOdds(pct), ob = tourOdds(100 - pct);
  var bet = tourBetOf(m);
  var stakeA = bet && bet.side === 'A' ? bet.stake : 0;
  var stakeB = bet && bet.side === 'B' ? bet.stake : 0;
  var key = tourBetKey(m);
  var z = tour.sel.zone, ri = tour.sel.ri, mi = tour.sel.mi;
  return {
    tip: false,
    html: '<span class="ab-vs"><b class="a">' + m.a.name + '</b> vs <b class="b">' + m.b.name + '</b></span>' +
      '<span class="ab-pct" data-prob="' + key + '">' + pct + '%·' + (100 - pct) + '%' + tourFxNote(m) + '</span>' +
      '<button type="button" class="tb-odd a' + (stakeA ? ' has' : '') + '" data-bet2="A" data-zone="' + z +
      '" data-ri="' + ri + '" data-mi="' + mi + '" data-bet-key="' + key + '" data-bet-side="A" data-bet-label="押红"' +
      (tour.bank < 100 ? ' disabled' : '') + '>押红 ' + tourFmtOdds(oa) + (stakeA ? ' · ' + stakeA : '') + '</button>' +
      '<button type="button" class="tb-odd b' + (stakeB ? ' has' : '') + '" data-bet2="B" data-zone="' + z +
      '" data-ri="' + ri + '" data-mi="' + mi + '" data-bet-key="' + key + '" data-bet-side="B" data-bet-label="押蓝"' +
      (tour.bank < 100 ? ' disabled' : '') + '>押蓝 ' + tourFmtOdds(ob) + (stakeB ? ' · ' + stakeB : '') + '</button>' +
      '<button type="button" class="tb-big sm" data-act="playKo" data-zone="' + z +
      '" data-ri="' + ri + '" data-mi="' + mi + '">开打</button>'
  };
}

function koActBar() {
  var info = koActBarInfo();
  return '<div class="tb-actbar' + (info.tip ? ' tip' : '') + '" data-actbar>' + info.html + '</div>';
}

/* 选中节点：只改 .sel 类 + 操作条内容，赛程图 SVG 不重建（缩放/平移与滚动位置都不受影响） */
function tourSelectKo(zone, ri, mi) {
  tour.sel = { zone: zone, ri: ri, mi: mi };
  if (!el.tourBoard) return;
  var olds = el.tourBoard.querySelectorAll('.bk-mt.sel, .tb-mt.sel');
  for (var i = 0; i < olds.length; i++) olds[i].classList.remove('sel');
  var nw = el.tourBoard.querySelector('.bk-mt[data-zone="' + zone + '"][data-ri="' + ri + '"][data-mi="' + mi + '"]');
  if (nw) nw.classList.add('sel');
  var bar = el.tourBoard.querySelector('[data-actbar]');
  if (bar) {
    var info = koActBarInfo();
    bar.className = 'tb-actbar' + (info.tip ? ' tip' : '');
    bar.innerHTML = info.html;
  }
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
  // 比分按玩家记（winsA / winsB），但左右位置跟着本局颜色走
  var redW = c.swap ? c.winsB : c.winsA;
  var blueW = c.swap ? c.winsA : c.winsB;
  // 系统预测同样是「玩家 a : 玩家 b」，换边局左右要交换百分比
  var p = tourFxPct(fx);
  var redPct = c.swap ? 100 - p : p;
  var html =
    '<button type="button" class="tour-fold" data-act="fold" title="收起/展开">' +
      (el.tourPanel.classList.contains('folded') ? '▸' : '▾') + '</button>' +
    '<div class="tour-head">' + (c.roundName || ('组' + (fx.group + 1))) + ' · BO' + c.format + ' · 第 ' + c.game + ' 局' +
      (c.swap ? ' · 换边' : '') + '</div>' +
    '<div class="tour-cur"><div class="tour-vs">' +
      '<span class="tour-side a"><i class="ts-tag">红</i>' + redP.name + '</span>' +
      '<b>' + Math.round(redW) + ' : ' + Math.round(blueW) + '</b>' +
      '<span class="tour-side b"><i class="ts-tag b">蓝</i>' + blueP.name + '</span></div>' +
      '<div class="tour-roles"><span class="tr-side a">' + redP.name + '</span> ' + tourRolesHtml(redP) +
      ' &nbsp;vs&nbsp; <span class="tr-side b">' + blueP.name + '</span> ' + tourRolesHtml(blueP) + '</div>' +
      '<div class="tour-prob">系统预测 ' + Math.round(redPct) + '% : ' + Math.round(100 - redPct) + '%' + tourFxNote(fx) + '</div>' +
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
        tourSelectKo(zz, rr, mm);        // 只切换选中类与操作条，不重建赛程图（第 84 条）
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
      if (el.home) el.home.classList.remove('show');
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
      names: (tour.names || []).slice(),
      champion: tourPlayerRef(tour.champion),
      runnerUp: tourPlayerRef(tour.runnerUp),
      third: tourPlayerRef(tour.third),
      bank: tour.bank, settled: tour.settled, winBets: tour.winBets,
      recorded: !!tour.recorded,
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
    // 赛事资金就是全局金币：每次存档同步回钱包（手机端每日赠送 / 单机押注共用）
    if (typeof coinsSet === 'function') coinsSet(tour.bank);
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
    names: (d.names && d.names.length) ? d.names.slice() : players.map(function (p) { return p.name; }),
    groups: (d.groups || []).map(function (g) { return g.map(function (id) { return byId[id]; }); }),
    fixtures: (d.fixtures || []).map(function (f) {
      return { kind: 'group', group: f.group, idx: f.idx, a: byId[f.a], b: byId[f.b], format: f.format,
        done: f.done, winsA: f.winsA, winsB: f.winsB, dmgA: f.dmgA, dmgB: f.dmgB, score: f.score,
        winner: P(f.winner), loser: P(f.loser) };
    }),
    ko: null, cur: null, stage: d.stage,
    champion: P(d.champion), runnerUp: P(d.runnerUp), third: P(d.third),
    bank: (typeof coinsGet === 'function' ? coinsGet() : (d.bank == null ? TOUR_START_BANK : d.bank)),
    bets: [], settled: d.settled || 0, winBets: d.winBets || 0,
    recorded: !!d.recorded,
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
