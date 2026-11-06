/* ============================================================
   60-tournament.js —— 赛事模式（棋盘式赛程，手动逐场点着打）
   ------------------------------------------------------------
   三种界面：
     1. 分组棋盘（#tourBoard）：N 个空组框 + 「开始分配玩家和物品」
     2. 组内对阵：每个组框里是「玩家x vs 玩家y + 两人积分 + 开始」
     3. 淘汰赛赛程图：树状方框 + 连接线，未打的比赛框可点开打
   战斗时棋盘收起，只留左下角比分条（#tourPanel）。
   赛制：小组赛 BO2（积分制），淘汰赛 BO3，总决赛 BO5。
   ============================================================ */
'use strict';

var TOUR_NAMES = ['阿石', '小七', '老白', '阿青', '铁蛋', '小满', '阿竹', '大熊',
                  '阿梨', '小九', '灰灰', '阿灯', '豆子', '阿海', '小鹿', '黑桃'];

var tour = null;          // 当前赛事
var tourSpeed = 1;        // 观战倍速（1/2/4）
var tourFx = null;        // 击杀演出：{ t, dur, zoom, focus, win }
var tourFxWin = null;     // 演出结束后要结算的胜方
var TOUR_KEY = 'mcduel.tournament.v2';

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

/* 6 个角色两两对位的实测胜率（已双向对称化，数值 = 行角色胜率 %）
   ------------------------------------------------------------
   数据来源：2026-11-6 无头模拟，每对位双向各 16 局，取平均后对称化。
   只用于「赛程里的预测胜率」，不参与任何战斗计算。 */
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

// 2v2 预测：两边角色两两对位求平均（不参与战斗，只是给赛程一个参考值）
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

function tourLog(text) {
  if (!tour) return;
  tour.log.unshift(text);
  if (tour.log.length > 40) tour.log.pop();
}

/* ---------- 开赛：只搭空棋盘 ---------- */
function tourOpen(size) {
  tour = {
    size: size, players: [], groups: [], fixtures: [],
    ko: [], cur: null,
    stage: 'setup',            // setup | group | ko | done
    champion: null, log: []
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

/* ---------- 一键分配玩家和物品 ---------- */
function tourDeal() {
  if (!tour) return;

  // 1) 生成玩家 + 随机 2 个角色
  var keys = POOL.map(function (p) { return p.key; });
  var players = [];
  for (var i = 0; i < tour.size; i++) {
    var s = tourShuffle(keys.slice());
    players.push({
      id: i, name: TOUR_NAMES[i] || ('玩家' + (i + 1)),
      roles: [s[0], s[1]], pts: 0, w: 0, l: 0, dmg: 0, group: -1
    });
  }

  // 2) 随机分到 N/4 个组
  var gCount = tour.size / 4;
  var groups = [];
  for (var g = 0; g < gCount; g++) groups.push([]);
  tourShuffle(players.slice()).forEach(function (p, idx) {
    p.group = idx % gCount;
    groups[p.group].push(p);
  });

  // 3) 组内单循环对阵
  var fx = [];
  for (var gi = 0; gi < groups.length; gi++) {
    var gp = groups[gi];
    for (var a = 0; a < gp.length; a++) {
      for (var b = a + 1; b < gp.length; b++) {
        fx.push({
          kind: 'group', group: gi, a: gp[a], b: gp[b], format: 2,
          done: false, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, score: '', winner: null
        });
      }
    }
  }

  tour.players = players;
  tour.groups = groups;
  tour.fixtures = fx;
  tour.stage = 'group';
  tourLog('已分配 ' + tour.size + ' 名玩家 · ' + gCount + ' 组 · 共 ' + fx.length + ' 场（BO2）');
  tourSave();
  tourRender();
}

/* ---------- 开始某一场 ---------- */
function tourPlay(idx) {
  if (!tour || tour.cur) return;
  var fx = tour.fixtures[idx];
  if (!fx || fx.done) return;
  tour.cur = { fx: fx, format: fx.format, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, game: 0, roundName: '' };
  tourStartGame();
}

function tourPlayKo(r, i) {
  if (!tour || tour.cur) return;
  var m = tour.ko[r] && tour.ko[r].matches[i];
  if (!m || m.done || !m.a || !m.b) return;
  tour.cur = { fx: m, format: m.format, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, game: 0, roundName: m.roundName };
  tourStartGame();
}

function tourStartGame() {
  var c = tour.cur;
  if (!c) return;
  c.game++;
  el.banner.classList.remove('show');
  el.tourBoard.classList.remove('show');
  el.tourPanel.classList.add('show');
  pick.A = c.fx.a.roles.slice(0, 2);
  pick.B = c.fx.b.roles.slice(0, 2);
  teamSize = 2;
  modeKind = 'vs';
  startBattle();
  tourRender();
}

/* ---------- 一局结束 ---------- */
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
  fx.winner = aWin ? fx.a : (bWin ? fx.b : fx.a);

  if (fx.kind === 'group') {
    if (aWin) { fx.a.pts += 3; fx.a.w++; fx.b.l++; }
    else if (bWin) { fx.b.pts += 3; fx.b.w++; fx.a.l++; }
    else { fx.a.pts += 1; fx.b.pts += 1; }
    fx.a.dmg += c.dmgA;
    fx.b.dmg += c.dmgB;
    tourLog('组' + (fx.group + 1) + ' ' + fx.a.name + ' ' + fx.score + ' ' + fx.b.name + ' → ' + fx.winner.name + ' 胜');
  } else {
    tourLog(fx.roundName + ' ' + fx.a.name + ' ' + fx.score + ' ' + fx.b.name + ' → ' + fx.winner.name + ' 晋级');
    setTimeout(tourTryAdvanceKO, 800);
  }
  tourSave();
}

/* ---------- 淘汰赛 ---------- */
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

function tourBuildKO() {
  var firsts = [], seconds = [];
  for (var g = 0; g < tour.groups.length; g++) {
    var st = tourStandings(g);
    firsts.push(st[0]);
    seconds.push(st[1]);
  }
  var pairs = [];
  for (var i = 0; i < firsts.length; i++) {
    pairs.push({ a: firsts[i], b: seconds[(i + 1) % seconds.length] });
  }
  var name = firsts.length >= 4 ? '8强赛' : (firsts.length === 2 ? '半决赛' : '总决赛');
  tour.ko = [{
    name: name, format: 3,
    matches: pairs.map(function (pr) {
      return { roundName: name, a: pr.a, b: pr.b, format: 3, done: false,
        winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, score: '', winner: null };
    })
  }];
  tour.stage = 'ko';
  tourLog('小组赛结束 · ' + name + '（BO3）');
  tourSave();
  tourRender();
}

function tourRoundDone(round) {
  return round.matches.every(function (m) { return m.done; });
}

function tourTryAdvanceKO() {
  if (!tour || tour.stage !== 'ko' || tour.cur) return;
  var last = tour.ko[tour.ko.length - 1];
  if (!tourRoundDone(last)) return;

  var winners = last.matches.map(function (m) { return m.winner; });
  if (winners.length === 1) {
    tour.champion = winners[0];
    tour.stage = 'done';
    el.banner.querySelector('strong').textContent = '冠军 · ' + tour.champion.name;
    el.banner.querySelector('em').textContent = tourRolesText(tour.champion) + ' · 点「退出赛事」回主菜单';
    el.banner.classList.add('show');
    tourLog('冠军：' + tour.champion.name);
    tourSave();
    tourRender();
    return;
  }

  var name = winners.length === 2 ? '总决赛' : (winners.length === 4 ? '半决赛' : '4强赛');
  var fmt = winners.length === 2 ? 5 : 3;
  var matches = [];
  for (var i = 0; i < winners.length; i += 2) {
    matches.push({ roundName: name, a: winners[i], b: winners[i + 1], format: fmt,
      done: false, winsA: 0, winsB: 0, dmgA: 0, dmgB: 0, score: '', winner: null });
  }
  tour.ko.push({ name: name, format: fmt, matches: matches });
  tourLog(name + ' 对阵已生成（BO' + fmt + '）');
  tourSave();
  tourRender();
}

function tourSkipMatch() {
  if (!tour || !tour.cur) return;
  var guard = 0;
  while (phase === 'fight' && guard < 40000) { tick(1 / 60); guard++; }
}

/* ---------- 渲染总入口 ---------- */
function tourRender() {
  if (!tour) return;
  if (tour.cur) { renderBattleStrip(); return; }
  el.tourPanel.classList.remove('show');
  el.tourPanel.innerHTML = '';
  el.tourBoard.classList.add('show');
  if (tour.stage === 'ko' || tour.stage === 'done') renderBracket();
  else renderGroups();
}

/* ---------- ① 分组棋盘 / 组内对阵 ---------- */
function renderGroups() {
  var b = el.tourBoard;
  var gCount = tour.size / 4;
  var html = '';

  html += '<div class="tb-head">赛事模式 · ' + tour.size + ' 名玩家 · 以 ' + gCount + ' 组为例' +
    (tour.restored ? ' <i class="tb-tag">已恢复上次进度</i>' : '') + '</div>';

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
    b.innerHTML = html;
    bindBoardClicks();
    return;
  }

  // 组内对阵：每组一个框，框里是「玩家x vs 玩家y + 两人积分 + 开始」
  html += '<div class="tb-groups">';
  for (var g = 0; g < tour.groups.length; g++) {
    html += '<div class="tb-group"><div class="tb-gtitle">组' + (g + 1) + '</div><div class="tb-cards">';
    tour.fixtures.forEach(function (f, idx) {
      if (f.group !== g) return;
      var dis = tour.cur ? ' disabled' : '';
      html += '<div class="tb-card' + (f.done ? ' done' : '') + '">' +
        '<div class="tb-side a">' +
          '<span class="tb-nm a' + (f.winner === f.a ? ' win' : '') + '">' + f.a.name + '</span>' +
          '<span class="tb-roles">' + tourRolesText(f.a) + '</span>' +
          '<span class="tb-pt">' + f.a.pts + ' 分</span>' +
        '</div>' +
        '<div class="tb-mid">' +
          '<span class="tb-sc">' + (f.done ? f.score : 'vs') + '</span>' +
          '<span class="tb-prob">' + tourPredict(f.a, f.b) + '% · ' + (100 - tourPredict(f.a, f.b)) + '%</span>' +
          (f.done
            ? '<span class="tb-done">已完</span>'
            : '<button type="button" data-act="play" data-idx="' + idx + '"' + dis + '>开始</button>') +
        '</div>' +
        '<div class="tb-side b">' +
          '<span class="tb-nm b' + (f.winner === f.b ? ' win' : '') + '">' + f.b.name + '</span>' +
          '<span class="tb-roles">' + tourRolesText(f.b) + '</span>' +
          '<span class="tb-pt">' + f.b.pts + ' 分</span>' +
        '</div>' +
      '</div>';
    });
    html += '</div></div>';
  }
  html += '</div>';

  html += '<div class="tb-foot">';
  if (tourGroupDone()) {
    html += '<button type="button" class="tb-big" data-act="ko">小组赛结束 · 生成淘汰赛</button>';
  } else {
    var doneN = tour.fixtures.filter(function (f) { return f.done; }).length;
    html += '<span class="tb-hint">已完成 ' + doneN + ' / ' + tour.fixtures.length +
      ' 场 · 中间百分比是系统按对位实测给出的预测胜率</span>';
  }
  html += '<button type="button" class="tb-ghost" data-act="restart">重开赛事</button>' +
    '<button type="button" class="tb-ghost" data-act="exit">退出赛事</button></div>';

  b.innerHTML = html;
  bindBoardClicks();
}

/* ---------- ② 淘汰赛赛程图（树状 + 连线） ---------- */
function renderBracket() {
  var b = el.tourBoard;
  var rounds = tour.ko;
  var n0 = rounds[0].matches.length * 2;        // 首轮人数（4 或 8）
  var levels = rounds.length + 1;               // 玩家层 + 每轮结果层

  var BOXW = 132, BOXH = 26, GAPY = 22, GAPX = 46;
  var step = BOXH + GAPY;

  function yOf(k, j) {
    // 第 k 层第 j 个框的中心：对应 2^k 个叶子槽位的中点
    return 12 + (j * Math.pow(2, k) + (Math.pow(2, k) - 1) / 2) * step;
  }
  function xOf(k) { return 20 + k * (BOXW + GAPX); }

  var W = xOf(levels - 1) + BOXW + 20;
  var H = 12 + n0 * step + 12;

  var svg = '<svg class="tb-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';

  // 列标题
  for (var k = 0; k < levels; k++) {
    var label = k === 0 ? '参赛' : (rounds[k - 1] ? rounds[k - 1].name : '');
    svg += '<text class="tb-lbl" x="' + (xOf(k) + BOXW / 2) + '" y="' + (H - 2) + '" text-anchor="middle">' + label + '</text>';
  }

  // 第 0 层：参赛玩家
  var entries = [];
  rounds[0].matches.forEach(function (m) { entries.push(m.a); entries.push(m.b); });
  for (var i = 0; i < entries.length; i++) {
    var p = entries[i];
    svg += '<g class="tb-nd"><rect x="' + xOf(0) + '" y="' + (yOf(0, i) - BOXH / 2) + '" width="' + BOXW + '" height="' + BOXH + '" rx="5"/>' +
      '<text x="' + (xOf(0) + 10) + '" y="' + (yOf(0, i) + 4) + '">' + p.name + '</text>' +
      '<text class="tb-role" x="' + (xOf(0) + BOXW - 10) + '" y="' + (yOf(0, i) + 4) + '" text-anchor="end">' + p.roles.map(tourRoleName).join('·') + '</text>' +
      '</g>';
  }

  // 各轮结果层 + 连线
  for (var r = 0; r < rounds.length; r++) {
    for (var mi = 0; mi < rounds[r].matches.length; mi++) {
      var m2 = rounds[r].matches[mi];
      var y1 = yOf(r, mi * 2), y2 = yOf(r, mi * 2 + 1);
      var yc = (y1 + y2) / 2;
      var xa = xOf(r) + BOXW, xb = xOf(r + 1), xm = xa + GAPX / 2;

      svg += '<path class="tb-edge" d="M' + xa + ' ' + y1 + ' H' + xm + ' V' + y2 + ' H' + xa + '"/>';
      svg += '<path class="tb-edge" d="M' + xm + ' ' + yc + ' H' + xb + '"/>';

      var canPlay = !m2.done && m2.a && m2.b && !tour.cur;
      var cls = 'tb-nd tb-mt' + (m2.done ? ' done' : '') + (canPlay ? ' playable' : '');
      svg += '<g class="' + cls + '"' + (canPlay ? ' data-r="' + r + '" data-i="' + mi + '"' : '') + '>' +
        '<rect x="' + xb + '" y="' + (yc - BOXH / 2) + '" width="' + BOXW + '" height="' + BOXH + '" rx="5"/>' +
        '<text x="' + (xb + 10) + '" y="' + (yc + 4) + '">' +
        (m2.done ? m2.winner.name : (canPlay ? '点击开打' : '待定')) + '</text>' +
        (m2.done ? '<text class="tb-role" x="' + (xb + BOXW - 10) + '" y="' + (yc + 4) + '" text-anchor="end">' + m2.score + '</text>' : '') +
        '</g>';
    }
  }

  svg += '</svg>';

  var html = '<div class="tb-head">' + (tour.stage === 'done'
    ? '赛事结束 · 冠军 ' + tour.champion.name
    : '淘汰赛 · ' + rounds[rounds.length - 1].name) + '</div>';
  html += '<div class="tb-sub">' + (tour.stage === 'done'
    ? tourRolesText(tour.champion)
    : '点方框里的「点击开打」继续（BO3 · 总决赛 BO5）') + '</div>';
  html += '<div class="tb-bracket">' + svg + '</div>';
  html += '<div class="tb-foot">' + (tour.stage === 'done' ? '' :
    '<span class="tb-hint">打完一轮自动出下一轮</span>') +
    '<button type="button" class="tb-ghost" data-act="restart">重开赛事</button>' +
    '<button type="button" class="tb-ghost" data-act="exit">退出赛事</button></div>';

  b.innerHTML = html;
  bindBoardClicks();
}

/* ---------- ③ 战斗中的比分条 ---------- */
function renderBattleStrip() {
  el.tourBoard.innerHTML = '';      // 棋盘收起时清空，避免残留旧的「开始」按钮
  var c = tour.cur;
  var fx = c.fx;
  var html =
    '<div class="tour-head">' + (c.roundName || ('组' + (fx.group + 1))) + ' · BO' + c.format + ' · 第 ' + c.game + ' 局</div>' +
    '<div class="tour-cur"><div class="tour-vs">' +
      '<span class="tour-side a">' + fx.a.name + '</span>' +
      '<b>' + Math.round(c.winsA) + ' : ' + Math.round(c.winsB) + '</b>' +
      '<span class="tour-side b">' + fx.b.name + '</span></div>' +
      '<div class="tour-roles">' + tourRolesText(fx.a) + ' &nbsp;vs&nbsp; ' + tourRolesText(fx.b) + '</div>' +
      '<div class="tour-prob">系统预测 ' + tourPredict(fx.a, fx.b) + '% : ' + (100 - tourPredict(fx.a, fx.b)) + '%</div></div>' +
    '<div class="tour-btns">' +
      '<button type="button" data-act="speed">速度 ×' + tourSpeed + '</button>' +
      '<button type="button" data-act="skip">跳过本局</button>' +
      '<button type="button" data-act="exit">退出赛事</button></div>';
  el.tourPanel.classList.add('show');
  el.tourPanel.innerHTML = html;
  bindBoardClicks();
}

/* ---------- 点击绑定 ---------- */
function bindBoardClicks() {
  var handler = function (e) {
    var g = e.target.closest('[data-r]');
    if (g && tour && !tour.cur) { tourPlayKo(parseInt(g.getAttribute('data-r'), 10), parseInt(g.getAttribute('data-i'), 10)); return; }
    var btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    var act = btn.getAttribute('data-act');
    if (act === 'deal') tourDeal();
    else if (act === 'play') tourPlay(parseInt(btn.getAttribute('data-idx'), 10));
    else if (act === 'ko') tourBuildKO();
    else if (act === 'speed') { tourSpeed = tourSpeed === 1 ? 2 : (tourSpeed === 2 ? 4 : 1); tourRender(); }
    else if (act === 'skip') tourSkipMatch();
    else if (act === 'restart') { tourWipe(); tourOpen(tour ? tour.size : 8); }
    else if (act === 'exit') tourClose();
  };
  el.tourBoard.onclick = handler;
  el.tourPanel.onclick = handler;
}

/* ---------- 启动 ---------- */
if (el.btnTour) {
  el.btnTour.addEventListener('click', function () {
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
   击杀演出：放大 + 时缓 + 加分动画
   ============================================================ */
function tourBeginFinishFx(win) {
  var c = tour.cur;
  if (!c) return;
  var fx2 = c.fx;

  // 镜头焦点：胜方存活单位中心；全灭就用场地中心
  var winTeam = win === 'B' ? 'B' : 'A';
  var sx = 0, sy = 0, n = 0;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (u.team !== winTeam) continue;
    sx += u.x; sy += u.y; n++;
  }
  var focus = n
    ? { x: sx / n, y: sy / n }
    : { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h / 2 };

  tourFx = { t: 0, dur: 1.9, zoom: 1, focus: focus, win: win };
  tourFxWin = win;

  // 本局结束后的比分
  var a = Math.round(c.winsA) + (win === 'A' ? 1 : 0);
  var b = Math.round(c.winsB) + (win === 'B' ? 1 : 0);
  var name = win === 'draw' ? '平局' : (win === 'A' ? fx2.a.name : fx2.b.name) + ' 胜';
  var gain = '';
  if (win !== 'draw') {
    if (c.fx.kind === 'group') gain = '+' + (c.format === 2 ? 1 : 3) + ' 分';
    else gain = (c.winsA + (win === 'A' ? 1 : 0)) > (c.winsB + (win === 'B' ? 1 : 0)) ? '赛点' : '追平';
  }

  var box = el.tourFxEl;
  if (box) {
    box.innerHTML = '<div class="fx-score">' + a + ' : ' + b + '</div>' +
      '<div class="fx-name">' + name + '</div>' +
      (gain ? '<div class="fx-gain">' + gain + '</div>' : '');
    box.className = 'tour-fx';
    void box.offsetWidth;          // 强制回流，重播动画
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
   存档：localStorage（只存稳定态，战斗中的这一场不存）
   ============================================================ */
function tourSave() {
  if (!tour) return;
  try {
    var data = {
      v: 2, size: tour.size, stage: tour.stage,
      champion: tour.champion ? tour.champion.id : null,
      log: tour.log.slice(0, 30),
      players: tour.players.map(function (p) {
        return { id: p.id, name: p.name, roles: p.roles, pts: p.pts, w: p.w, l: p.l, dmg: p.dmg, group: p.group };
      }),
      groups: tour.groups.map(function (g) { return g.map(function (p) { return p.id; }); }),
      fixtures: tour.fixtures.map(function (f) {
        return { group: f.group, a: f.a.id, b: f.b.id, format: f.format, done: f.done,
          winsA: f.winsA, winsB: f.winsB, dmgA: f.dmgA, dmgB: f.dmgB, score: f.score,
          winner: f.winner ? f.winner.id : null };
      }),
      ko: tour.ko.map(function (r) {
        return { name: r.name, format: r.format, matches: r.matches.map(function (m) {
          return { roundName: m.roundName, a: m.a ? m.a.id : null, b: m.b ? m.b.id : null, format: m.format,
            done: m.done, winsA: m.winsA, winsB: m.winsB, dmgA: m.dmgA, dmgB: m.dmgB, score: m.score,
            winner: m.winner ? m.winner.id : null };
        }) };
      })
    };
    localStorage.setItem(TOUR_KEY, JSON.stringify(data));
  } catch (e) { /* 隐私模式 / 配额满：静默跳过 */ }
}

function tourLoad() {
  var raw = null;
  try { raw = localStorage.getItem(TOUR_KEY); } catch (e) { return null; }
  if (!raw) return null;
  var d;
  try { d = JSON.parse(raw); } catch (e) { return null; }
  if (!d || d.v !== 2 || !d.players || !d.players.length) return null;

  var byId = {};
  var players = d.players.map(function (p) {
    var np = { id: p.id, name: p.name, roles: p.roles, pts: p.pts, w: p.w, l: p.l, dmg: p.dmg, group: p.group };
    byId[p.id] = np;
    return np;
  });

  return {
    size: d.size, players: players,
    groups: (d.groups || []).map(function (g) { return g.map(function (id) { return byId[id]; }); }),
    fixtures: (d.fixtures || []).map(function (f) {
      return { kind: 'group', group: f.group, a: byId[f.a], b: byId[f.b], format: f.format, done: f.done,
        winsA: f.winsA, winsB: f.winsB, dmgA: f.dmgA, dmgB: f.dmgB, score: f.score,
        winner: f.winner != null ? byId[f.winner] : null };
    }),
    ko: (d.ko || []).map(function (r) {
      return { name: r.name, format: r.format, matches: r.matches.map(function (m) {
        return { roundName: m.roundName, a: m.a != null ? byId[m.a] : null, b: m.b != null ? byId[m.b] : null,
          format: m.format, done: m.done, winsA: m.winsA, winsB: m.winsB, dmgA: m.dmgA, dmgB: m.dmgB,
          score: m.score, winner: m.winner != null ? byId[m.winner] : null };
      }) };
    }),
    cur: null, stage: d.stage,
    champion: d.champion != null ? byId[d.champion] : null,
    log: d.log || []
  };
}

function tourWipe() {
  try { localStorage.removeItem(TOUR_KEY); } catch (e) {}
}
