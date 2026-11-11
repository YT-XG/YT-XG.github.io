/* ============================================================
   80-mobi.js —— 手机端独立界面（1024 × 512 固定画布）
   ------------------------------------------------------------
   设计约定（2026-11-11 重置版）：
   · 所有元素都按 1024×512 的绝对坐标摆放，整块画布按屏幕等比缩放，
     因此任何手机尺寸下按钮位置完全一致（不会再把按钮挤丢）。
   · 四个页面：主菜单 / 单机模式 / 赛事准备 / 分配后分组页。
   · 电脑端不进入这里：#mobi 默认隐藏，只有移动端或 ?mobi=1 才显示。
   · 复用现有全局：POOL / pick / teamSize / modeKind / roundDuration /
     tour / tourPlay / tourDeal 等，玩法逻辑不复制一份。
   ============================================================ */
'use strict';

var MOBI_W = 1024, MOBI_H = 512;
var MOBI_MQ = '(max-width: 980px), (pointer: coarse)';

var mobi = {
  on: false,
  screen: 'home',        // home | solo | tourSetup | tourGroups | tourStandings | tourKO | tourDone
  activeTeam: 'A',
  activeSlot: 0,
  drawer: '',            // '' | 'l' | 'r'
  namesOpen: false,
  tourIntent: false,     // 是否正停留在赛事页（防止后台赔率重绘把玩家从主菜单拽回赛事）
  gPage: 0,
  gTimer: null,
  koZoom: 'one',        // 'one' 1:1（默认，可拖动查看） / 'fit' 适应全图
  koCenterKey: '',
  toastTimer: null,
  touchX: 0
};

/* ---------- 基础工具 ---------- */
function mobiIsMobile() {
  if (/[?&]mobi=1/.test(location.search)) return true;
  return window.matchMedia(MOBI_MQ).matches;
}

function mobiRoot() { return document.getElementById('mobi'); }

function mobiEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mobiToast(text) {
  var t = document.getElementById('mToast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(mobi.toastTimer);
  mobi.toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1900);
}

function mobiRoleName(key) {
  var c = POOL_BY_KEY[key];
  return c ? c.name : '—';
}

function mobiRoleShort(key) {
  var c = POOL_BY_KEY[key];
  return c ? c.short : '—';
}

/* 角色/物品小图标：有贴图用贴图，否则用角色主色块 */
function mobiIco(key, size) {
  var c = POOL_BY_KEY[key];
  var st = 'width:' + size + 'px;height:' + size + 'px;';
  if (!c) return '<span class="mi-ico" style="' + st + '"></span>';
  if (c.img) return '<span class="mi-ico" style="' + st + '"><img src="' + c.img + '" alt=""></span>';
  return '<span class="mi-ico" style="' + st + 'background:' + c.body + ';box-shadow:0 0 12px ' + c.glow + '"></span>';
}

/* ---------- 画布缩放 ---------- */
function mobiScale() {
  var root = mobiRoot();
  if (!root) return;
  var vw = window.innerWidth, vh = window.innerHeight;
  var s = Math.min(vw / MOBI_W, vh / MOBI_H) * 0.995;
  s = Math.max(0.16, Math.min(3, s));
  root.style.setProperty('--ms', s.toFixed(4));
}

/* ---------- 显示 / 隐藏 ---------- */
function mobiShowScreen(screen) {
  if (!mobiIsMobile()) return;
  var changed = (mobi.screen !== screen) || !mobi.on;
  mobi.screen = screen;
  mobi.on = true;
  var root = mobiRoot();
  if (root) root.classList.add('on');
  document.body.classList.add('mobi-mode');
  document.body.classList.remove('mobi-battle');
  /* 赛事页期间让旧棋盘保持 .show：后台赔率模拟用 oddsAlive() 判断，
     视觉上由 body.mobi-mode 隐藏，不影响手机专属页面 */
  if ((screen === 'tourSetup' || screen === 'tourGroups' || screen === 'tourStandings' ||
       screen === 'tourKO' || screen === 'tourDone') && el.tourBoard) {
    el.tourBoard.classList.add('show');
  }
  mobiScale();
  mobiRender();
  if (changed) mobiArmCarousel();
}

/* 进入战斗：让出整块屏幕给 canvas（旧 HUD / 底部按钮继续可用） */
function mobiHide() {
  mobi.on = false;
  var root = mobiRoot();
  if (root) root.classList.remove('on');
  document.body.classList.remove('mobi-mode');
  document.body.classList.add('mobi-battle');
  mobiDisarmCarousel();
}

/* 淘汰赛 / 积分榜仍复用旧棋盘：只把手机新界面收起来 */
function mobiFallbackBoard() {
  mobi.on = false;
  var root = mobiRoot();
  if (root) root.classList.remove('on');
  document.body.classList.remove('mobi-mode');
  document.body.classList.remove('mobi-battle');
  mobiDisarmCarousel();
  if (el.tourBoard) el.tourBoard.classList.add('show');
}

/* ---------- 由现有流程调用的钩子 ---------- */
function mobiOnHome() {
  if (!mobiIsMobile()) return;
  mobi.tourIntent = false;
  /* 赛事打到一半回主菜单：把未完成的场次取消，避免下次进赛事卡在空战场上 */
  if (typeof tour !== 'undefined' && tour && tour.cur) {
    tour.cur = null;
    el.tourPanel.classList.remove('show');
  }
  mobi.screen = 'home';
  mobi.namesOpen = false;
  mobi.drawer = '';
  mobiShowScreen('home');
}

function mobiOnBattleStart() {
  if (!mobiIsMobile()) return;
  // 单机开打时，若还挂着一届赛事的棋盘，先把它的 .show 摘掉，避免盖住 canvas
  var inTour = (typeof tour !== 'undefined' && tour && tour.cur);
  if (!inTour && el.tourBoard) el.tourBoard.classList.remove('show');
  mobiHide();
}

/* 赛事每次重渲染后调用：把手机端拉到对应页面（或回落到旧棋盘） */
function mobiTourSync() {
  if (!mobiIsMobile() || typeof tour === 'undefined' || !tour) return;
  if (tour.cur) { mobiHide(); return; }
  /* 只在「玩家确实在赛事里」时切页：后台赔率跑完会重渲染一次，
     若已回主菜单 / 在单机页，不能被它拽回赛事 */
  if (!mobi.tourIntent && mobi.screen !== 'tourSetup' && mobi.screen !== 'tourGroups' &&
      mobi.screen !== 'tourStandings' && mobi.screen !== 'tourKO' && mobi.screen !== 'tourDone') return;
  if (tour.stage === 'setup') { mobiShowScreen('tourSetup'); return; }
  if (tour.stage === 'group') {
    if (!tourGroupDone()) mobiShowScreen('tourGroups');
    else mobiShowScreen('tourStandings');
    return;
  }
  if (tour.stage === 'ko') { mobiShowScreen('tourKO'); return; }
  if (tour.stage === 'done') {
    if (typeof mobiRecordSeason === 'function') mobiRecordSeason();
    mobiShowScreen('tourDone');
    return;
  }
  mobiFallbackBoard();
}

/* ---------- 构建骨架 ---------- */
function mobiBuild() {
  var root = document.getElementById('mobi');
  if (!root) {
    root = document.createElement('div');
    root.id = 'mobi';
    document.body.appendChild(root);
  }
  if (root.getAttribute('data-built') === '1') return;
  root.className = 'mobi';
  root.setAttribute('data-built', '1');
  root.innerHTML =
    '<div class="mobi-board" id="mobiBoard">' +
      '<section class="ms" data-s="home"></section>' +
      '<section class="ms" data-s="solo"></section>' +
      '<section class="ms" data-s="tourSetup"></section>' +
      '<section class="ms" data-s="tourGroups"></section>' +
      '<section class="ms" data-s="tourStandings"></section>' +
      '<section class="ms" data-s="tourKO"></section>' +
      '<section class="ms" data-s="tourDone"></section>' +
      '<div class="m-drawer l" data-drawer="l"></div>' +
      '<div class="m-drawer r" data-drawer="r"></div>' +
      '<div class="m-modal" data-modal></div>' +
    '</div>' +
    '<div class="m-toast" id="mToast"></div>';
  document.body.appendChild(root);
  root.addEventListener('click', mobiClick);
  root.addEventListener('touchstart', mobiTouchStart, { passive: true });
  root.addEventListener('touchend', mobiTouchEnd, { passive: true });
}

/* ---------- 渲染入口 ---------- */
function mobiRender() {
  var root = mobiRoot();
  if (!root || !mobi.on) return;
  var secs = root.querySelectorAll('.ms');
  for (var i = 0; i < secs.length; i++) {
    secs[i].classList.toggle('on', secs[i].getAttribute('data-s') === mobi.screen);
  }

  var box = root.querySelector('[data-s="home"]');
  if (mobi.screen === 'home') box.innerHTML = mobiHomeHtml();

  box = root.querySelector('[data-s="solo"]');
  if (mobi.screen === 'solo') box.innerHTML = mobiSoloHtml();

  box = root.querySelector('[data-s="tourSetup"]');
  if (mobi.screen === 'tourSetup') box.innerHTML = mobiTourSetupHtml();

  box = root.querySelector('[data-s="tourGroups"]');
  if (mobi.screen === 'tourGroups') box.innerHTML = mobiTourGroupsHtml();

  box = root.querySelector('[data-s="tourStandings"]');
  if (mobi.screen === 'tourStandings') box.innerHTML = mobiTourStandingsHtml();

  box = root.querySelector('[data-s="tourKO"]');
  if (mobi.screen === 'tourKO') box.innerHTML = mobiTourKoHtml();

  box = root.querySelector('[data-s="tourDone"]');
  if (mobi.screen === 'tourDone') box.innerHTML = mobiTourDoneHtml();

  var dl = root.querySelector('[data-drawer="l"]');
  var dr = root.querySelector('[data-drawer="r"]');
  dl.classList.toggle('open', mobi.drawer === 'l');
  dr.classList.toggle('open', mobi.drawer === 'r');
  dl.innerHTML = mobi.drawer === 'l' ? mobiSettingsHtml() : '';
  dr.innerHTML = mobi.drawer === 'r' ? mobiPoolHtml() : '';

  var md = root.querySelector('[data-modal]');
  md.classList.toggle('on', mobi.namesOpen);
  md.innerHTML = mobi.namesOpen ? mobiNamesHtml() : '';

  /* 淘汰赛 1:1 模式：渲染完把当前选中的方框滚到视口中间 */
  if (mobi.screen === 'tourKO') setTimeout(mobiKoCenter, 0);
}

/* 1:1 赛程图：把高亮的那场滚到面板中间（只在选中场次变化时执行） */
function mobiKoCenter() {
  if (!mobi.on || mobi.screen !== 'tourKO' || mobi.koZoom === 'fit') return;
  var root = mobiRoot();
  if (!root) return;
  var box = root.querySelector('.m-ko-graph');
  var g = root.querySelector('.m-ko-graph .bk-mt.sel');
  if (!box || !g) return;
  var key = tour.sel ? (tour.sel.zone + ':' + tour.sel.ri + ':' + tour.sel.mi) : '';
  if (mobi.koCenterKey === key) return;
  mobi.koCenterKey = key;
  try {
    var b = g.getBBox();
    box.scrollLeft = b.x + b.width / 2 - box.clientWidth / 2;
    box.scrollTop = b.y + b.height / 2 - box.clientHeight / 2;
  } catch (e) {}
}

/* ============================================================
   ① 主菜单（图 2）
   ============================================================ */
function mobiHomeHtml() {
  return '<div class="m-home">' +
    '<div class="m-home-head">' +
      '<h2>赛博斗蛐蛐</h2>' +
      '<div class="m-ver">v0.1.0</div>' +
    '</div>' +
    /* 左下半区不再空着：直接把角色池铺成 3×3 预览（第 92 条：充分利用画布） */
    '<div class="m-roster"><div class="m-roster-t">角色池 · ' + POOL.length + ' 个</div>' +
      '<div class="m-roster-g">' +
        POOL.map(function (c) {
          return '<div class="m-roster-i">' + mobiIco(c.key, 40) +
            '<div class="tx"><b>' + mobiEsc(c.short) + '</b><small>' + mobiEsc(c.role) + '</small></div></div>';
        }).join('') +
      '</div></div>' +
    '<div class="m-home-menu">' +
      '<button type="button" data-act="solo">单机模式</button>' +
      '<button type="button" class="dim" data-act="online">联机模式（探索中）</button>' +
      '<button type="button" data-act="tour">S' + seasonGet() + '　赛事模式</button>' +
    '</div>' +
    '<div class="m-credit">by YT_XG</div>' +
    '<div class="m-home-coin">金币 <b>' + coinsGet() + '</b></div>' +
    '<div class="m-home-note">' +
      '<div><b>玩法</b>匀速直线 · 只有技能 / 撞墙才转向</div>' +
      '<div><b>模式</b>1v1 / 2v2 / 3v3 · 最多 6v6 · 同时 / 接力</div>' +
      '<div><b>赛事</b>8 / 16 人 · 小组赛 BO2 → 双败 → BO5</div>' +
    '</div>' +
    '</div>';
}

/* ============================================================
   ② 单机模式（图 3）
   ============================================================ */
function mobiSoloPct() {
  try {
    var a = (pick.A || []).slice(0, teamSize).filter(function (k) { return !!POOL_BY_KEY[k]; });
    var b = (pick.B || []).slice(0, teamSize).filter(function (k) { return !!POOL_BY_KEY[k]; });
    return tourPredict({ roles: a }, { roles: b });
  } catch (e) { return 50; }
}

function mobiTeamPane(team) {
  var keys = pick[team] || [];
  var n = Math.max(1, teamSize);
  /* 阵容格按人数自适应：1–2 人一行一个（大卡），3 人以上两列；行高把 212px 的
     可用高度铺满，不再留「—」占位格浪费屏幕（第 92 条） */
  var cols = n <= 2 ? 1 : 2;
  var rows = Math.ceil(n / cols);
  var gap = 12;
  var hgt = Math.min(150, Math.floor((212 - (rows - 1) * gap) / rows));
  var big = hgt >= 90;
  var ico = hgt >= 130 ? 58 : (hgt >= 90 ? 46 : (hgt >= 70 ? 36 : 30));
  /* 3 人 / 5 人时最后一行只有一格：让它横跨两列，避免右半边空着 */
  var spanLast = (cols === 2 && n % 2 === 1);
  var h = '<div class="m-team ' + (team === 'A' ? 'a' : 'b') + '">' +
    '<div class="m-team-head"><span>' + SIDE_LABEL[team] + '</span>' +
    '<button type="button" data-act="rand' + team + '">随机</button></div>' +
    '<div class="m-slots" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr));' +
      'grid-auto-rows:' + hgt + 'px;gap:' + gap + 'px;align-content:center;height:212px">';
  for (var i = 0; i < n; i++) {
    var k = keys[i];
    var c = POOL_BY_KEY[k];
    var sel = (mobi.activeTeam === team && mobi.activeSlot === i) ? ' sel' : '';
    var wide = (spanLast && i === n - 1) ? ' style="grid-column:span 2"' : '';
    h += '<div class="m-slot' + sel + (big ? ' big' : '') + '"' + wide +
      ' data-act="slot" data-team="' + team + '" data-slot="' + i + '">' +
      (c
        ? mobiIco(k, ico) + '<div class="m-slot-tx"><b>' + mobiEsc(c.short) + '</b>' +
          (big ? '<em>' + mobiEsc(c.role) + '</em>' : '') + '</div>' +
          '<small>' + (i + 1) + '</small>'
        : '<span class="ph">空位 ' + (i + 1) + '</span>') +
      '</div>';
  }
  return h + '</div></div>';
}

function mobiSoloHtml() {
  var pct = mobiSoloPct();
  var h = '<div class="m-screen m-solo">' +
    '<button type="button" class="m-mini m-home-btn" data-act="home">主菜单</button>';

  /* 左栏只保留人数：上场方式 / 时长 / 随机双方都收进「设置」抽屉，避免重复 */
  h += '<div class="m-sizebar">' +
    '<div class="m-cap">人数（最多 6v6）</div>' +
    '<div class="m-size"><button type="button" class="m-sq" data-act="sizeDown">−</button>' +
    '<b>' + teamSize + ' v ' + teamSize + '</b>' +
    '<button type="button" class="m-sq" data-act="sizeUp">＋</button></div>' +
    '</div>';

  /* 中间：双方 6 格阵容 */
  h += '<div class="m-arena">' + mobiTeamPane('A') +
    '<div class="m-vs">VS</div>' + mobiTeamPane('B') + '</div>';

  /* 预测胜率 / 开始（单机不再押注，也不显示金币：金币只服务于赛事） */
  h += '<div class="m-odds">' +
    '<span>预测胜率</span>' +
    '<div><b class="ra">' + pct + '%</b><i>:</i><b class="rb">' + (100 - pct) + '%</b></div>' +
    '</div>';
  h += '<button type="button" class="m-start" data-act="start">开始对战</button>';

  /* 两侧滑出条 */
  h += '<button type="button" class="m-tab l" data-act="drawerL">设置</button>';
  h += '<button type="button" class="m-tab r" data-act="drawerR">角色池</button>';
  return h + '</div>';
}

/* 左侧设置抽屉 */
function mobiSettingsHtml() {
  return '<div class="m-drawer-h"><b>设置</b>' +
    '<button type="button" data-act="closeDrawer">×</button></div>' +
    '<div class="m-drawer-b">' +
    '<div class="m-set-row"><span>队伍人数</span><div class="m-size sm">' +
      '<button type="button" class="m-sq" data-act="sizeDown">−</button><b>' + teamSize + 'v' + teamSize + '</b>' +
      '<button type="button" class="m-sq" data-act="sizeUp">＋</button></div></div>' +
    '<div class="m-set-row"><span>上场方式</span><div class="m-seg">' +
      KINDS.map(function (k) {
        var dis = (teamSize === 1 && k.id === 'relay');
        return '<button type="button" data-act="kind" data-kind="' + k.id + '"' +
          (modeKind === k.id ? ' class="on"' : '') + (dis ? ' disabled' : '') + '>' + k.label + '</button>';
      }).join('') + '</div></div>' +
    '<div class="m-set-row"><span>对局时长</span><div class="m-seg m-min">' +
      ROUND_OPTIONS.map(function (sec) {
        return '<button type="button" data-act="round" data-sec="' + sec + '"' +
          (roundDuration === sec ? ' class="on"' : '') + '>' + (sec / 60) + '′</button>';
      }).join('') + '</div></div>' +
    '<button type="button" class="m-wide m-ghost" data-act="randBoth">随机双方</button>' +
    '<button type="button" class="m-wide m-ghost" data-act="home">返回主界面</button>' +
    '</div>';
}

/* 右侧角色池抽屉 */
function mobiPoolHtml() {
  var h = '<div class="m-drawer-h"><b>角色池</b>' +
    '<span>' + SIDE_LABEL[mobi.activeTeam] + ' · ' + (mobi.activeSlot + 1) + ' 号位</span>' +
    '<button type="button" data-act="closeDrawer">×</button></div>' +
    '<div class="m-pool">';
  for (var i = 0; i < POOL.length; i++) {
    var c = POOL[i];
    h += '<button type="button" class="m-pool-item" data-act="pickRole" data-key="' + c.key + '">' +
      mobiIco(c.key, 40) + '<b>' + mobiEsc(c.short) + '</b><small>' + mobiEsc(c.role) + '</small></button>';
  }
  h += '</div><div class="m-drawer-f">' +
    '<button type="button" class="m-wide m-ghost" data-act="randSel">随机这一方</button>' +
    '<button type="button" class="m-wide m-primary" data-act="closeDrawer">完成</button></div>';
  return h;
}

/* ============================================================
   ③ 赛事准备（图 4）
   ============================================================ */
function mobiTourSetupHtml() {
  if (typeof tour === 'undefined' || !tour) {
    return '<div class="m-screen"><div class="m-empty">正在载入赛事…</div></div>';
  }
  var size = tour.size;
  /* 8 人单列、16 人两列，行高按人数铺满整块面板（第 92 条） */
  var cols = size <= 8 ? 1 : 2;
  var rows = Math.ceil(size / cols);
  var cellH = Math.max(38, Math.floor((410 - (rows - 1) * 7) / rows));
  var saved = duelNamesGet();
  var h = '<div class="m-screen m-tour">';

  /* 参赛选手 */
  h += '<section class="m-panel m-players"><h3>参赛选手</h3>' +
    '<div class="m-pnames" style="grid-template-columns:repeat(' + cols + ',1fr);' +
      'grid-auto-rows:' + cellH + 'px">';
  for (var r = 0; r < rows; r++) {
    for (var col = 0; col < cols; col++) {
      var idx = r * cols + col;
      if (idx >= size) { h += '<span class="m-pcell empty"></span>'; continue; }
      var p = tour.players[idx];
      /* tour.names 在 tourOpen() 里就生成了（自定义 + 随机），抽签前后名字一致 */
      var nm = (tour.names && tour.names[idx]) ||
        (p && p.name) ||
        (saved && saved[idx]) || ('玩家' + (idx + 1));
      h += '<span class="m-pcell"><i>' + (idx + 1) + '、</i>' + mobiEsc(nm) + '</span>';
    }
  }
  h += '</div></section>';

  /* 中间操作区 */
  h += '<div class="m-tmid">' +
    '<div class="m-bank">资金 <b>' + coinsGet() + '</b><small>（全局）</small></div>' +
    '<div class="m-seg m-tsize">' +
      [8, 16].map(function (n) {
        return '<button type="button" data-act="tourSize" data-size="' + n + '"' +
          (size === n ? ' class="on"' : '') + '>' + n + ' 人</button>';
      }).join('') +
    '</div>' +
    '<button type="button" class="m-deal" data-act="deal">开始分配小组</button>' +
    '<button type="button" class="m-link" data-act="names">自定义玩家姓名' +
      '<em>浏览器保存避免重复设置</em></button>' +
    '<button type="button" class="m-home2" data-act="home">主界面</button>' +
    '<button type="button" class="m-ghost m-mini2" data-act="exitTour">退出赛事</button>' +
    '</div>';

  /* 物品（A / B 档） */
  h += '<section class="m-panel m-items"><h3>物品</h3><div class="m-items-grid">';
  for (var i = 0; i < POOL.length; i++) {
    var c = POOL[i];
    var band = (typeof tourBandOf === 'function') ? tourBandOf(c.key) : '?';
    h += '<div class="m-item"><div class="m-item-ico">' + mobiIco(c.key, 46) +
      '<i class="m-band ' + (band === 'A' ? 'a' : (band === 'B' ? 'b' : '')) + '">' + band + '</i></div>' +
      '<b>' + mobiEsc(c.short) + '</b><small>' + mobiEsc(c.role) + '</small></div>';
  }
  h += '</div></section>';

  return h + '</div>';
}

/* ============================================================
   ④ 分配队伍后（图 5）
   ============================================================ */
function mobiGroupLetter(g) { return String.fromCharCode(65 + (g || 0)); }

function mobiGroupBox(g) {
  var st = tourStandings(g);
  var list = tour.fixtures.filter(function (f) { return f.group === g; });
  var done = list.filter(function (f) { return f.done; }).length;
  var nx = tourNextFixture();
  var h = '<section class="m-gbox"><div class="m-ghead">' + mobiGroupLetter(g) + '组' +
    '<em>' + done + '/' + list.length + ' 场</em></div><div class="m-glist">';
  st.forEach(function (p, i) {
    var next = nx && nx.group === g && (nx.a === p || nx.b === p);
    h += '<div class="m-grow' + (next ? ' next' : '') + '">' +
      '<span class="rk">' + (i + 1) + '</span>' +
      '<span class="nm">' + mobiEsc(p.name) + '</span>' +
      '<span class="ro">' + tourRolesHtml(p) + '</span>' +
      '<span class="wl">' + p.w + '-' + p.l + '</span>' +
      '<span class="pt">' + p.pts + '分</span>' +
      '</div>';
  });
  return h + '</div></section>';
}

/* 对战记录：把该玩家在本组的每一场都列出来（对手 + 比分）；
   没打的显示「— : —」，正在打的这场高亮（第 93 条） */
function mobiH2hHtml(p, fx) {
  var group = fx.group;
  var list = tour.fixtures.filter(function (f) { return f.group === group; });
  var h = '<div class="m-h2h"><span class="t">对战记录</span>';
  var n = 0;
  list.forEach(function (f) {
    var opp = null, mine = 0, theirs = 0;
    if (f.a === p) { opp = f.b; mine = f.winsA; theirs = f.winsB; }
    else if (f.b === p) { opp = f.a; mine = f.winsB; theirs = f.winsA; }
    else return;
    if (!opp) return;
    var now = (f === fx);
    var txt, cls = '';
    if (f.done) {
      mine = Math.round(mine || 0);
      theirs = Math.round(theirs || 0);
      txt = mine + ' : ' + theirs;
      cls = mine > theirs ? ' win' : (mine < theirs ? ' lose' : ' draw');
    } else if (now) {
      txt = f.score || '0 : 0';
      cls = ' now';
    } else {
      txt = '— : —';
    }
    h += '<div class="r' + cls + '"><span>vs ' + mobiEsc(opp.name) + '</span><b>' + txt + '</b></div>';
    n++;
  });
  if (!n) h += '<div class="empty">暂无对局</div>';
  return h + '</div>';
}

function mobiCardSide(p, side, fx) {
  var roles = (p.roles || []).slice(0, 2);
  var h = '<div class="m-cside ' + side + '"><div class="m-cname ' + side + '">' + mobiEsc(p.name) + '</div>' +
    '<div class="m-cbody"><div class="m-croles">';
  roles.forEach(function (k) {
    h += '<div class="m-crole">' + mobiIco(k, 54) + '<span>' + mobiEsc(mobiRoleShort(k)) + '</span></div>';
  });
  /* 物品右侧 / 左侧的竖排数据块：把原本空着的竖条用满 */
  h += '</div><div class="m-cstats">' +
      '<span><i>积分</i><b>' + p.pts + '</b></span>' +
      '<span><i>战绩</i><b>' + p.w + '-' + p.l + '</b></span>' +
      '<span><i>伤害</i><b>' + Math.round(p.dmg || 0) + '</b></span>' +
    '</div></div>';
  /* 左：逐场对战记录；右：小组进度（名次 / 已赛 / 晋级线） */
  h += (side === 'a') ? mobiH2hHtml(p, fx) : mobiGroupPosHtml(p, fx.group);
  h += '</div>';
  return h;
}

function mobiGroupPosHtml(p, g) {
  var st = tourStandings(g);
  var idx = st.indexOf(p);
  var list = tour.fixtures.filter(function (f) { return f.group === g; });
  var done = list.filter(function (f) { return f.done; }).length;
  return '<div class="m-h2h"><span class="t">小组进度</span>' +
    '<div class="r"><span>' + mobiGroupLetter(g) + '组排名</span><b>' + (idx + 1) + ' / ' + st.length + '</b></div>' +
    '<div class="r"><span>已赛场次</span><b>' + done + ' / ' + list.length + '</b></div>' +
    '<div class="r"><span>晋级</span><b>前 2 名</b></div></div>';
}

function mobiTourGroupsHtml() {
  if (typeof tour === 'undefined' || !tour) {
    return '<div class="m-screen"><div class="m-empty">赛事已结束</div></div>';
  }
  var fx = tourNextFixture();
  if (!fx) return '<div class="m-screen"><div class="m-empty">小组赛已全部打完</div></div>';

  var pct = tourFxPct(fx);
  var key = tourBetKey(fx);
  var bet = tourBetOf(fx);
  var stakeA = bet && bet.side === 'A' ? bet.stake : 0;
  var stakeB = bet && bet.side === 'B' ? bet.stake : 0;

  var h = '<div class="m-screen m-groups">';

  /* 顶部对战卡 */
  h += '<section class="m-vs-card">' +
    '<div class="m-card-tag">组' + mobiGroupLetter(fx.group) + ' · BO2 · 第 2 局换边</div>' +
    '<div class="m-card-score">' + (fx.score || '0 : 0') + '</div>' +
    '<div class="m-win-note">赢了 2 分，打平 1 分</div>' +
    mobiCardSide(fx.a, 'a', fx) +
    mobiCardSide(fx.b, 'b', fx) +
    '<div class="m-cmid">' +
      '<div class="m-vs-big">VS</div>' +
      '<div class="m-prob" data-prob-bar="' + key + '">' +
        '<i class="ra" style="width:' + pct + '%"></i>' +
        '<i class="rb" style="width:' + (100 - pct) + '%"></i>' +
      '</div>' +
      '<div class="m-pred" data-prob="' + key + '">预测 ' + pct + '%·' + (100 - pct) + '%</div>' +
      '<button type="button" class="m-start sm" data-act="play">开始对决</button>' +
    '</div>' +
    '<button type="button" class="m-bet a' + (stakeA ? ' on' : '') + '" data-act="tourBetA">押主队' +
      (stakeA ? '<b>' + stakeA + '</b>' : '') + '</button>' +
    '<button type="button" class="m-bet b' + (stakeB ? ' on' : '') + '" data-act="tourBetB">押客队' +
      (stakeB ? '<b>' + stakeB + '</b>' : '') + '</button>' +
    '</section>';

  /* 分组轮播：8 人 A/B；16 人 A/C ↔ B/D */
  var pairs = tour.groups.length > 2 ? [[0, 2], [1, 3]] : [[0, 1]];
  var page = mobi.gPage % pairs.length;
  var pair = pairs[page];
  h += '<div class="m-gcarousel">' + mobiGroupBox(pair[0]) +
    '<div class="m-gmid">' +
      '<div class="m-bank">资金 <b>' + coinsGet() + '</b></div>' +
      '<button type="button" class="m-home2" data-act="home">主界面</button>' +
      '<button type="button" class="m-ghost m-mini2" data-act="restartTour">重开赛事</button>' +
      (pairs.length > 1
        ? '<div class="m-dots">' + pairs.map(function (_, i) {
            return '<i class="' + (i === page ? 'on' : '') + '" data-act="gpage" data-page="' + i + '"></i>';
          }).join('') + '</div>'
        : '') +
    '</div>' +
    mobiGroupBox(pair[1]) + '</div>';

  return h + '</div>';
}

/* ============================================================
   ④.1 小组赛结束（图 1）
   ============================================================ */
function mobiEndBox(g, cls) {
  var st = tourStandings(g);
  var h = '<section class="m-endbox ' + cls + '"><div class="m-endbox-t">' +
    mobiGroupLetter(g) + '组</div><div class="m-endbox-list">';
  st.forEach(function (p, i) {
    h += '<div class="m-end-row">' +
      '<span class="rk">' + (i + 1) + '</span>' +
      '<span class="nm">' + mobiEsc(p.name) +
        '<em class="sub">' + p.w + '-' + p.l + ' · 伤害 ' + Math.round(p.dmg || 0) + '</em></span>' +
      '<span class="ro">' + tourRolesHtml(p) + '</span>' +
      '<span class="pt">' + p.pts + '分</span>' +
      '</div>';
  });
  return h + '</div></section>';
}

function mobiTourStandingsHtml() {
  if (typeof tour === 'undefined' || !tour) {
    return '<div class="m-screen"><div class="m-empty">赛事已结束</div></div>';
  }
  var four = tour.groups.length > 2;
  var h = '<div class="m-screen m-standings">' +
    '<div class="m-standings-head">小组赛结束</div>';
  if (four) {
    h += mobiEndBox(0, 'pos-a') + mobiEndBox(1, 'pos-b') +
      mobiEndBox(2, 'pos-c') + mobiEndBox(3, 'pos-d');
  } else {
    h += mobiEndBox(0, 'pos-a tall') + mobiEndBox(1, 'pos-b tall');
  }
  h += '<div class="m-endmid">' +
    '<div class="m-bank">资金 <b>' + coinsGet() + '</b></div>' +
    '<button type="button" class="m-bigbtn" data-act="ko">开始淘汰赛</button>' +
    '<button type="button" class="m-ghost m-mini2" data-act="restartTour">重开赛制</button>' +
    '<button type="button" class="m-home2" data-act="home">主界面</button>' +
    '</div>';
  return h + '</div>';
}

/* ============================================================
   ④.2 淘汰赛（图 2）
   ============================================================ */

/* 找到当前应该展示的一场：优先 tour.sel（点赛程图选中的），否则按轮次取下一场可打的 */
function mobiNextKo() {
  if (!tour || !tour.ko) return null;
  var ko = tour.ko;
  var rounds = Math.max(ko.wb.length, ko.lb.length);
  for (var r = 0; r < rounds; r++) {
    if (ko.wb[r]) {
      for (var i = 0; i < ko.wb[r].matches.length; i++) {
        var m1 = ko.wb[r].matches[i];
        if (!m1.done && m1.a && m1.b) return { zone: 'wb', ri: r, mi: i, m: m1 };
      }
    }
    if (ko.lb[r]) {
      for (var j = 0; j < ko.lb[r].matches.length; j++) {
        var m2 = ko.lb[r].matches[j];
        if (!m2.done && m2.a && m2.b) return { zone: 'lb', ri: r, mi: j, m: m2 };
      }
    }
  }
  if (!ko.gf.done && ko.gf.a && ko.gf.b) return { zone: 'gf', ri: 0, mi: 0, m: ko.gf };
  return null;
}

function mobiKoFocus() {
  if (!tour || !tour.ko) return null;
  if (tour.sel) {
    var m = tourKoMatch(tour.sel.zone, tour.sel.ri, tour.sel.mi);
    if (m && !m.done && m.a && m.b) return { zone: tour.sel.zone, ri: tour.sel.ri, mi: tour.sel.mi, m: m };
  }
  return mobiNextKo();
}

function mobiKoRoles(p) {
  if (!p || !p.roles) return '';
  var h = '<div class="m-ko-roles">';
  p.roles.slice(0, 2).forEach(function (k) {
    h += '<div class="m-ko-role">' + mobiIco(k, 48) + '<span>' + mobiEsc(mobiRoleShort(k)) + '</span></div>';
  });
  return h + '</div>';
}

function mobiKoStat() {
  var ko = tour.ko, done = 0, ready = 0;
  if (!ko) return { done: 0, ready: 0 };
  var all = [];
  ['wb', 'lb'].forEach(function (z) {
    (ko[z] || []).forEach(function (r) {
      if (!r) return;
      (r.matches || []).forEach(function (m) { all = all.concat(m); });
    });
  });
  if (ko.gf) all.push(ko.gf);
  all.forEach(function (m) {
    if (m.done) done++;
    else if (m.a && m.b) ready++;
  });
  return { done: done, ready: ready };
}

function mobiTourKoHtml() {
  if (typeof tour === 'undefined' || !tour) {
    return '<div class="m-screen"><div class="m-empty">赛事已结束</div></div>';
  }
  if (!tour.ko) return '<div class="m-screen"><div class="m-empty">淘汰赛尚未开始</div></div>';

  var f = mobiKoFocus();
  if (f) tour.sel = { zone: f.zone, ri: f.ri, mi: f.mi };   // 让赛程图高亮当前场
  var svg = (typeof bracketSvg === 'function') ? bracketSvg() : '';
  /* 给 SVG 补上 viewBox 的原始宽高：1:1 模式下按原始尺寸渲染，
     用户可拖动查看；「适应」模式再由 CSS 缩到面板宽度 */
  var vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (vb) svg = svg.replace('<svg ', '<svg width="' + vb[1] + '" height="' + vb[2] + '" ');
  var zoomOne = mobi.koZoom !== 'fit';
  var ks = mobiKoStat();

  var h = '<div class="m-screen m-ko">' +
    '<div class="m-ko-bracket">' +
      '<div class="m-ko-bhead"><b>双败赛程图</b>' +
        '<button type="button" data-act="koZoom">' + (zoomOne ? '适应全图' : '1:1 放大') + '</button>' +
      '</div>' +
      '<div class="m-ko-graph ' + (zoomOne ? 'one' : 'fit') + '">' + svg + '</div>' +
      '<div class="m-ko-legend"><i class="pl"></i>可开打<i class="dn"></i>已结束<i class="ds"></i>败者掉落</div>' +
      '<div class="m-ko-hint">拖动查看 · 点方框切换场次</div>' +
    '</div>' +
    '<div class="m-ko-mid">' +
      '<div class="m-bank">资金 <b>' + coinsGet() + '</b></div>' +
      '<div class="m-ko-stat"><span>淘汰赛</span>' +
        '<div class="r"><span>已结束</span><b>' + ks.done + ' 场</b></div>' +
        '<div class="r"><span>待开打</span><b>' + ks.ready + ' 场</b></div>' +
      '</div>' +
      '<button type="button" class="m-home2" data-act="home">主界面</button>' +
    '</div>';

  if (!f) {
    h += '<div class="m-ko-card"><div class="m-empty">淘汰赛已结束</div></div>';
    return h + '</div>';
  }

  var m = f.m;
  var pct = tourFxPct(m);
  var key = tourBetKey(m);
  var bet = tourBetOf(m);
  var stakeA = bet && bet.side === 'A' ? bet.stake : 0;
  var stakeB = bet && bet.side === 'B' ? bet.stake : 0;

  h += '<section class="m-ko-card">' +
    '<div class="m-ko-title">下一场对决</div>' +
    '<div class="m-ko-round">' + mobiEsc(m.roundName) + ' · BO' + m.format + '</div>' +
    '<div class="m-ko-team a"><b>' + mobiEsc(m.a.name) + '</b>' + mobiKoRoles(m.a) + '</div>' +
    '<div class="m-ko-team b"><b>' + mobiEsc(m.b.name) + '</b>' + mobiKoRoles(m.b) + '</div>' +
    '<div class="m-ko-vs">VS</div>' +
    '<div class="m-ko-pred"><span>胜率</span><b data-prob="' + key + '">' + pct + '% · ' + (100 - pct) + '%</b></div>' +
    '<button type="button" class="m-bet a' + (stakeA ? ' on' : '') + '" data-act="koBetA">' +
      '押 ' + mobiEsc(m.a.name) + (stakeA ? '<i>' + stakeA + '</i>' : '') + '</button>' +
    '<button type="button" class="m-bet b' + (stakeB ? ' on' : '') + '" data-act="koBetB">' +
      '押 ' + mobiEsc(m.b.name) + (stakeB ? '<i>' + stakeB + '</i>' : '') + '</button>' +
    '<button type="button" class="m-start ko-start" data-act="playKo">开始</button>' +
    '<div class="m-ko-note">押注 100 / 次 · 点左侧方框可切换场次</div>' +
    '</section>';

  return h + '</div>';
}

/* ============================================================
   ④.3 结算（图 3）
   ============================================================ */
function mobiDoneRows(list, startPlace) {
  var h = '';
  list.forEach(function (r, i) {
    h += '<div class="m-done-row">' +
      '<span class="rk">' + (startPlace + i) + '</span>' +
      '<span class="nm">' + mobiEsc(r.p.name) + '</span>' +
      '<span class="ro">' + tourRolesHtml(r.p) + '</span>' +
      '<span class="wl">' + r.w + '-' + r.l + '</span>' +
      '<span class="dmg">' + Math.round(r.p.dmg) + '</span>' +
      '<span class="pt">' + Math.round(r.p.pts) + '分</span>' +
      '</div>';
  });
  return h;
}

function mobiDoneHead() {
  return '<div class="m-done-head"><span>#</span><span>玩家</span><span>角色</span>' +
    '<span>比分</span><span>伤害</span><span>积分</span></div>';
}

function mobiTourDoneHtml() {
  if (typeof tour === 'undefined' || !tour) {
    return '<div class="m-screen"><div class="m-empty">赛事已结束</div></div>';
  }
  var rank = tourFinalRanking();
  var half = Math.ceil(rank.length / 2);
  var top = rank.slice(0, half);
  var bottom = rank.slice(half);

  var h = '<div class="m-screen m-done">' +
    '<section class="m-done-panel l"><div class="m-done-t">前' + half + '/' + rank.length + '名</div>' +
      '<div class="m-done-list">' + mobiDoneHead() + mobiDoneRows(top, 1) + '</div></section>' +
    '<section class="m-done-panel r"><div class="m-done-t">后' + half + '/' + rank.length + '名</div>' +
      '<div class="m-done-list">' + mobiDoneHead() + mobiDoneRows(bottom, half + 1) + '</div></section>' +
    '<div class="m-done-mid">' +
      '<div class="m-podium champ"><span>冠军</span><b>' + (tour.champion ? mobiEsc(tour.champion.name) : '—') + '</b></div>' +
      '<div class="m-podium-row">' +
        '<div class="m-podium mini second"><span>亚军</span><b>' + (tour.runnerUp ? mobiEsc(tour.runnerUp.name) : '—') + '</b></div>' +
        '<div class="m-podium mini third"><span>季军</span><b>' + (tour.third ? mobiEsc(tour.third.name) : '—') + '</b></div>' +
      '</div>' +
      '<div class="m-bank">资金 <b>' + coinsGet() + '</b></div>' +
      '<button type="button" class="m-bigbtn" data-act="newSeason">新赛季</button>' +
      '<button type="button" class="m-home2" data-act="home">主界面</button>' +
      '<div class="m-done-hint">第 ' + seasonGet() + ' 赛季 · 姓名 / 赛季 / 排名 / 分数已存入浏览器</div>' +
    '</div>';
  return h + '</div>';
}

/* 结算成绩落盘：姓名 + 赛季 + 排名 + 分数（同一赛季重开则覆盖） */
function mobiRecordSeason() {
  if (typeof tour === 'undefined' || !tour || tour.recorded) return;
  var season = seasonGet();
  var rows = tourFinalRanking().map(function (r) {
    return { name: r.p.name, season: season, rank: r.place, score: Math.round(r.p.pts) };
  });
  recordsSaveSeason(season, rows);
  tour.recorded = true;
  tourSave();
}

/* 新赛季：赛季号 +1，清空本届赛事，回到赛事准备页 */
function mobiNewSeason() {
  seasonNext();
  var n = (typeof tour !== 'undefined' && tour) ? tour.size : 8;
  if (typeof tourWipe === 'function') tourWipe();
  tourOpen(n);
  mobi.gPage = 0;
}

/* ---------- 姓名编辑弹层 ---------- */
function mobiNamesHtml() {
  var n = (typeof tour !== 'undefined' && tour) ? tour.size : 16;
  var arr = duelNamesGet() || [];
  var cur = (typeof tour !== 'undefined' && tour && tour.names) ? tour.names : [];
  var h = '<div class="m-modal-box"><h3>自定义玩家姓名</h3>' +
    '<p>留空的名额会用随机名字，填了的存在浏览器里</p><div class="m-name-grid">';
  for (var i = 0; i < n; i++) {
    h += '<label><i>' + (i + 1) + '</i><input type="text" maxlength="8" data-name="' + i + '"' +
      ' value="' + mobiEsc(arr[i] || '') + '"' +
      ' placeholder="' + mobiEsc(cur[i] || ('玩家' + (i + 1))) + '"></label>';
  }
  h += '</div><div class="m-modal-act">' +
    '<button type="button" data-act="namesCancel">取消</button>' +
    '<button type="button" class="m-primary" data-act="namesSave">保存</button>' +
    '</div></div>';
  return h;
}

/* ============================================================
   交互
   ============================================================ */
function mobiClick(e) {
  /* 淘汰赛赛程图：点带 data-zone 的方框 → 选出这场，右侧卡片跟着换 */
  var knode = e.target.closest('[data-zone]');
  if (knode && mobi.screen === 'tourKO') {
    tour.sel = {
      zone: knode.getAttribute('data-zone'),
      ri: parseInt(knode.getAttribute('data-ri'), 10) || 0,
      mi: parseInt(knode.getAttribute('data-mi'), 10) || 0
    };
    mobiRender();
    return;
  }

  var t = e.target.closest('[data-act]');
  if (!t) return;
  var act = t.getAttribute('data-act');

  /* ---- 主菜单 / 页面切换 ---- */
  if (act === 'home') { mobiOnHome(); return; }
  if (act === 'solo') { mobiEnterSolo(); return; }
  if (act === 'online') { mobiToast('联机模式正在探索中，先用单机 / 赛事模式'); return; }
  if (act === 'tour') { mobiOpenTour(); return; }

  /* ---- 单机设置 ---- */
  if (act === 'sizeUp') { mobiSetSize(teamSize + 1); return; }
  if (act === 'sizeDown') { mobiSetSize(teamSize - 1); return; }
  if (act === 'kind') { mobiSetKind(t.getAttribute('data-kind')); return; }
  if (act === 'round') { mobiSetRound(parseInt(t.getAttribute('data-sec'), 10)); return; }
  if (act === 'randA') { randomTeam('A'); syncPick(); mobiRender(); return; }
  if (act === 'randB') { randomTeam('B'); syncPick(); mobiRender(); return; }
  if (act === 'randBoth') { randomTeam('A'); randomTeam('B'); syncPick(); mobiRender(); return; }
  if (act === 'randSel') { randomTeam(mobi.activeTeam); syncPick(); mobiRender(); return; }
  if (act === 'slot') {
    mobi.activeTeam = t.getAttribute('data-team');
    mobi.activeSlot = parseInt(t.getAttribute('data-slot'), 10) || 0;
    activeTeam = mobi.activeTeam;
    activeSlot = mobi.activeSlot;
    mobiRender();
    return;
  }
  if (act === 'drawerL' || act === 'drawerR') {
    mobi.drawer = (act === 'drawerL') ? (mobi.drawer === 'l' ? '' : 'l') : (mobi.drawer === 'r' ? '' : 'r');
    mobiRender();
    return;
  }
  if (act === 'closeDrawer') { mobi.drawer = ''; mobiRender(); return; }
  if (act === 'pickRole') { mobiPickRole(t.getAttribute('data-key')); return; }
  if (act === 'start') { mobiStart(); return; }

  /* ---- 赛事准备 ---- */
  if (act === 'tourSize') { mobiTourSize(parseInt(t.getAttribute('data-size'), 10)); return; }
  if (act === 'deal') { if (tour) { tourDeal(); mobi.gPage = 0; } return; }
  if (act === 'names') { mobi.namesOpen = true; mobiRender(); return; }
  if (act === 'namesCancel') { mobi.namesOpen = false; mobiRender(); return; }
  if (act === 'namesSave') { mobiSaveNames(); return; }
  if (act === 'exitTour') { if (typeof tourClose === 'function') tourClose(); return; }

  /* ---- 分组页 ---- */
  if (act === 'play') { var fx = tourNextFixture(); if (fx) tourPlay(fx.idx); return; }
  if (act === 'tourBetA') { mobiTourBet('A'); return; }
  if (act === 'tourBetB') { mobiTourBet('B'); return; }
  if (act === 'restartTour') {
    var n = tour ? tour.size : 8;
    if (typeof tourWipe === 'function') tourWipe();
    tourOpen(n);
    mobi.gPage = 0;
    return;
  }
  if (act === 'ko') { if (typeof tourBuildKO === 'function') tourBuildKO(); return; }
  if (act === 'playKo') {
    var kf = mobiKoFocus();
    if (kf) tourPlayKo(kf.zone, kf.ri, kf.mi);
    return;
  }
  if (act === 'koBetA' || act === 'koBetB') {
    var kbf = mobiKoFocus();
    if (!kbf) return;
    if (coinsGet() < 100) { mobiToast('金币不足，押注 100 起'); return; }
    tourPlaceBet(kbf.m, act === 'koBetA' ? 'A' : 'B', 100);
    mobiRender();
    return;
  }
  if (act === 'newSeason') { mobiNewSeason(); return; }
  if (act === 'koZoom') {
    mobi.koZoom = (mobi.koZoom === 'fit') ? 'one' : 'fit';
    mobi.koCenterKey = '';
    mobiRender();
    return;
  }
  if (act === 'gpage') {
    mobi.gPage = parseInt(t.getAttribute('data-page'), 10) || 0;
    mobiRender();
    return;
  }
}

function mobiTouchStart(e) {
  if (e.touches.length === 1) mobi.touchX = e.touches[0].clientX;
}

function mobiTouchEnd(e) {
  if (!mobi.touchX) return;
  var end = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : mobi.touchX;
  var dx = end - mobi.touchX;
  mobi.touchX = 0;
  if (Math.abs(dx) < 42 || mobi.screen !== 'tourGroups' || mobi.namesOpen) return;
  var pages = (typeof tour !== 'undefined' && tour && tour.groups.length > 2) ? 2 : 1;
  if (pages < 2) return;
  mobi.gPage = (mobi.gPage + (dx < 0 ? 1 : pages - 1)) % pages;
  mobiRender();
}

/* ---------- 单机操作 ---------- */
function mobiEnterSolo() {
  setSize(teamSize);            // 保证 pick 长度与人数一致
  mobi.activeTeam = 'A';
  mobi.activeSlot = 0;
  activeTeam = 'A'; activeSlot = 0;
  mobi.drawer = '';
  buildModePick();
  syncPick();
  mobiShowScreen('solo');
}

function mobiSetSize(n) {
  n = Math.max(1, Math.min(6, n | 0));
  setSize(n);
  if (mobi.activeSlot > teamSize - 1) mobi.activeSlot = teamSize - 1;
  if (activeSlot > teamSize - 1) activeSlot = teamSize - 1;
  buildModePick();
  syncPick();
  mobiRender();
}

function mobiSetKind(k) {
  if (k === 'relay' && teamSize === 1) { mobiToast('1v1 只有一个角色，无法接力'); return; }
  modeKind = k;
  buildModePick();
  syncPick();
  mobiRender();
}

function mobiSetRound(sec) {
  if (!sec) return;
  roundDuration = sec;
  buildRoundPick();
  syncPick();
  mobiRender();
}

function mobiPickRole(key) {
  if (!POOL_BY_KEY[key]) return;
  if (!pick[mobi.activeTeam]) pick[mobi.activeTeam] = [];
  pick[mobi.activeTeam][mobi.activeSlot] = key;
  if (mobi.activeSlot < teamSize - 1) {
    mobi.activeSlot++;
  } else {
    mobi.activeTeam = mobi.activeTeam === 'A' ? 'B' : 'A';
    mobi.activeSlot = 0;
  }
  activeTeam = mobi.activeTeam;
  activeSlot = mobi.activeSlot;
  syncPick();
  mobiRender();
}

function mobiStart() {
  for (var t = 0; t < 2; t++) {
    var team = t === 0 ? 'A' : 'B';
    for (var i = 0; i < teamSize; i++) {
      if (!POOL_BY_KEY[(pick[team] || [])[i]]) {
        mobiToast(SIDE_LABEL[team] + ' 还有空位，先从右侧角色池选人');
        return;
      }
    }
  }
  mobi.drawer = '';
  startBattle();
}

/* ---------- 赛事操作 ---------- */
function mobiOpenTour() {
  mobi.tourIntent = true;
  if (typeof tour !== 'undefined' && tour) { tourRender(); return; }
  var saved = tourLoad();
  if (saved) {
    tour = saved;
    tour.restored = true;
    tourSpeed = 1;
    if (el.home) el.home.classList.remove('show');
    el.menu.classList.remove('show');
    document.body.classList.remove('menu-open');
    el.banner.classList.remove('show');
    el.tourPanel.classList.remove('show');
    el.tourBoard.classList.add('show');
    tourLog('已恢复上次赛事进度');
    tourRender();
    return;
  }
  tourOpen(8);
}

function mobiTourSize(n) {
  if (typeof tour === 'undefined' || !tour) return;
  if (tour.stage !== 'setup') { mobiToast('赛事已开始，无法改人数'); return; }
  n = n === 16 ? 16 : 8;
  if (n === tour.size) return;
  tourWipe();
  tourOpen(n);
  mobi.gPage = 0;
}

function mobiTourBet(side) {
  var fx = tourNextFixture();
  if (!fx) return;
  if (coinsGet() < 100) { mobiToast('金币不足，押注 100 起'); return; }
  tourPlaceBet(fx, side, 100);
  mobiRender();
}

function mobiSaveNames() {
  var inputs = mobiRoot().querySelectorAll('[data-name]');
  var arr = [];
  for (var i = 0; i < inputs.length; i++) arr.push((inputs[i].value || '').trim());
  var prev = duelNamesGet() || [];
  duelNamesSet(arr);
  if (typeof tour !== 'undefined' && tour) {
    /* 填了名字的位置用自定义名；原本是随机名、这次留空的位置保持原样；
       原本是自定义名、这次被清空的位置重新随机（第 94 条） */
    var keep = [];
    for (var k = 0; k < tour.size; k++) {
      keep[k] = arr[k] || (prev[k] ? '' : ((tour.names && tour.names[k]) || ''));
    }
    tour.names = tourMakeNames(tour.size, keep);
    for (var j = 0; j < tour.players.length; j++) {
      if (tour.names[j]) tour.players[j].name = tour.names[j];
    }
    tourSave();
  }
  mobi.namesOpen = false;
  mobiRender();
  mobiToast('玩家姓名已保存到浏览器');
}

/* ---------- 轮播 ---------- */
function mobiDisarmCarousel() {
  if (mobi.gTimer) { clearInterval(mobi.gTimer); mobi.gTimer = null; }
}

function mobiArmCarousel() {
  mobiDisarmCarousel();
  if (!mobi.on || mobi.screen !== 'tourGroups') return;
  if (typeof tour === 'undefined' || !tour || tour.groups.length <= 2) return;
  mobi.gTimer = setInterval(function () {
    if (!mobi.on || mobi.screen !== 'tourGroups' || mobi.namesOpen) return;
    if (typeof tourNextFixture === 'function' && !tourNextFixture()) return;
    mobi.gPage = (mobi.gPage + 1) % 2;
    mobiRender();
  }, 7000);
}

function mobiOnResize() {
  mobiScale();
  var root = mobiRoot();
  if (!root) return;
  if (!mobiIsMobile()) {
    // 切回桌面：收起手机界面，把旧页面交还
    mobi.on = false;
    root.classList.remove('on');
    document.body.classList.remove('mobi-mode', 'mobi-battle');
    mobiDisarmCarousel();
    if (phase === 'menu' && el.home) el.home.classList.add('show');
    return;
  }
  if (!mobi.on && phase === 'menu' && !document.body.classList.contains('mobi-battle')) {
    mobiShowScreen(mobi.screen || 'home');
  }
}

/* ---------- 启动 ---------- */
function mobiInit() {
  mobiBuild();
  mobiScale();
  if (/[?&]mobi=1/.test(location.search)) document.body.classList.add('mobi-forced');
  window.addEventListener('resize', mobiOnResize);
  window.addEventListener('orientationchange', function () { setTimeout(mobiOnResize, 120); });
  /* 每日赠送仍然静默发放（金额可在主菜单金币处看到），但不再弹提示条：
     第 91 条起单机模式不显示金币，避免「每日赠送 1000 金币」压在其他页面上 */
  if (mobiIsMobile()) {
    mobiShowScreen('home');
  } else {
    var root = mobiRoot();
    if (root) root.classList.remove('on');
  }
}

mobiInit();
