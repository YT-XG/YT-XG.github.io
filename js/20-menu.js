/* ============================================================
   20-menu.js —— 主页面（角色池选人）、角色详情面板、菜单/战斗切换
   ------------------------------------------------------------
   选人模型：每方 teamSize 个「角色格子」（pick[team] 是 key 数组）
   · 点角色池里的角色 → 填进当前格子，自动跳下一格
   · 点某方的某个格子 → 把该格子设为当前编辑目标
   · 对战模式 1v1 / 2v2 / 3v3 为同时上场，接力为轮流上场
   ============================================================ */
'use strict';

/* 人数与上场方式分开设置：
   · 人数 1v1 / 2v2 / 3v3
   · 上场 同时上场 / 接力（1v1 只有一个角色，接力不可用） */
var SIZES = [1, 2, 3];
var KINDS = [
  { id: 'vs', label: '同时上场' },
  { id: 'relay', label: '接力' }
];

function rageSummary(key) {
  var R = TYPES[key].rage;
  if (!R) return '';
  var parts = ['移速 ×' + R.speedMul + ' 起，每秒 +' + R.speedRampPerSec + ' 倍，上限 ×' + R.speedMulCap];
  if (R.passThrough) parts.push('可穿透敌方');
  if (R.bomb) {
    parts.push('撞击伤害 0，只靠炸弹');
    parts.push('投弹 ' + R.bomb.interval + 's/颗 → 最快 ' + R.bomb.intervalMin + 's/颗，' +
      '引信 ' + R.bomb.fuse + 's，半径 ' + R.bomb.radius + 'px，伤害 ' + R.bomb.dmg);
  }
  if (R.dmgPerSec) parts.push('撞击伤害每秒 +' + R.dmgPerSec +
      (R.dmgCap ? '（上限 +' + R.dmgCap + '）' : '（无上限）'));
  if (R.shield) parts.push('每 ' + R.shield.interval + ' 秒刷新 ' + R.shield.amount + ' 点护盾');
  return parts.join('；');
}

// 把阵容里的角色展开成单位 key 列表（判断羁绊用）
function roleUnits(keys) {
  var out = [];
  for (var i = 0; i < keys.length; i++) {
    var c = POOL_BY_KEY[keys[i]];
    if (c) out = out.concat(c.units);
  }
  return out;
}

function detailHtml(team) {
  var keys = pick[team] || [];
  var totalHp = 0;
  for (var q = 0; q < keys.length; q++) {
    var cc = POOL_BY_KEY[keys[q]];
    if (!cc) continue;
    for (var w = 0; w < cc.units.length; w++) totalHp += TYPES[cc.units[w]].maxHp;
  }

  var html = '<div class="d-side">' + SIDE_LABEL[team] + '</div>' +
    '<div class="d-name">' + (modeKind === 'relay' ? '接力 ' : '') + keys.length + ' 个角色</div>' +
    '<div class="d-meta">合计 ' + totalHp + ' HP' +
    (modeKind === 'relay' ? ' · 逐个上场，胜者保留血量' : ' · 同时上场') + '</div>';

  for (var i = 0; i < keys.length; i++) {
    var c = POOL_BY_KEY[keys[i]];
    if (!c) continue;
    html += '<div class="d-unit"><b>' + (i + 1) + '. ' + c.name + '</b>' +
      '<span>' + c.role + ' · ' + c.units.length + ' 个单位</span>';
    for (var j = 0; j < c.units.length; j++) {
      var d = TYPES[c.units[j]];
      html += '<p><em>' + d.name + '</em> ' + d.maxHp + ' HP · ' + d.baseSpeed + ' px/s · 攻击 ' + d.atk.toFixed(2) + '</p>' +
        '<p><em>技能</em> ' + d.skill.name + '：' + d.skill.text + '</p>' +
        '<p><em>被动</em> ' + d.passive.name + '：' + d.passive.text + '</p>' +
        (d.rage ? '<p><em>狂暴</em> ' + rageSummary(d.key) + '</p>' : '');
    }
    html += '</div>';
  }

  if (lineupBond(roleUnits(keys))) {
    html += '<div class="d-bond">羁绊：一方阵亡 → 另一方原地无敌抖动 3 秒，随后进入狂暴（详情见上方各单位）</div>';
  }
  return html;
}

function lineupBond(keys) {
  for (var i = 0; i < keys.length; i++) {
    var bond = TYPES[keys[i]].bond;
    if (bond && keys.indexOf(bond) >= 0) return true;
  }
  return false;
}

function makeSlot(c) {
  var slot = document.createElement('div');
  slot.className = 'pool-slot';
  slot.setAttribute('data-key', c.key);
  slot.title = c.name + ' · ' + c.units.length + ' 个单位';
  slot.innerHTML =
    (c.img
      ? '<img class="ps-img" src="' + c.img + '" alt="' + c.name + '">'
      : '<span class="ps-dot" style="background:' + c.body + ';box-shadow:0 0 6px ' + c.glow + '"></span>') +
    '<b>' + c.short + '</b>' +
    '<span class="ps-tags"><i class="t-a">红</i><i class="t-b">蓝</i></span>';

  slot.addEventListener('click', function () {
    if (!pick[activeTeam]) pick[activeTeam] = [];
    pick[activeTeam][activeSlot] = c.key;
    // 填完自动跳下一格，整队填满后交给对面
    if (activeSlot < teamSize - 1) {
      activeSlot++;
    } else {
      activeTeam = activeTeam === 'A' ? 'B' : 'A';
      activeSlot = 0;
    }
    syncPick();
  });
  return slot;
}

function buildMenu() {
  el.pool.innerHTML = '';
  for (var i = 0; i < 8; i++) {
    if (i < POOL.length) {
      el.pool.appendChild(makeSlot(POOL[i]));
    } else {
      var empty = document.createElement('div');
      empty.className = 'pool-slot empty';
      empty.innerHTML = '<span>待加入</span>';
      el.pool.appendChild(empty);
    }
  }
  buildModePick();
  el.diceA.addEventListener('click', function () { randomTeam('A'); });
  el.diceB.addEventListener('click', function () { randomTeam('B'); });
  if (el.btnRandom) el.btnRandom.addEventListener('click', function () { randomTeam('A'); randomTeam('B'); });
}

function buildModePick() {
  el.modePick.innerHTML = '';

  // 第一行：人数
  var row1 = document.createElement('div');
  row1.className = 'rp-row';
  var t1 = document.createElement('span');
  t1.className = 'rp-title';
  t1.textContent = '人数';
  row1.appendChild(t1);
  SIZES.forEach(function (n) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = n + 'v' + n;
    if (n === teamSize) b.classList.add('on');
    b.addEventListener('click', function () {
      setSize(n);
      buildModePick();
      syncPick();
    });
    row1.appendChild(b);
  });

  // 第二行：上场方式
  var row2 = document.createElement('div');
  row2.className = 'rp-row';
  var t2 = document.createElement('span');
  t2.className = 'rp-title';
  t2.textContent = '上场';
  row2.appendChild(t2);
  KINDS.forEach(function (k) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = k.label;
    if (k.id === modeKind) b.classList.add('on');
    if (teamSize === 1 && k.id === 'relay') {
      b.disabled = true;
      b.title = '1v1 只有一个角色，无法接力';
    }
    b.addEventListener('click', function () {
      if (teamSize === 1 && k.id === 'relay') return;
      modeKind = k.id;
      buildModePick();
      syncPick();
    });
    row2.appendChild(b);
  });

  el.modePick.appendChild(row1);
  el.modePick.appendChild(row2);
}

// 改人数：1v1 强制回到「同时上场」；不够的格子用角色池里还没用过的角色补齐
function setSize(size) {
  teamSize = size;
  if (size === 1) modeKind = 'vs';

  ['A', 'B'].forEach(function (team) {
    var arr = (pick[team] || []).slice(0, size);
    while (arr.length < size) {
      var cand = null;
      for (var i = 0; i < POOL.length; i++) {
        if (arr.indexOf(POOL[i].key) < 0) { cand = POOL[i].key; break; }
      }
      arr.push(cand || POOL[arr.length % POOL.length].key);
    }
    pick[team] = arr;
  });

  activeSlot = Math.min(activeSlot, size - 1);
}

// 随机一支队伍：洗牌角色池后取前 teamSize 个（池子不够就循环取）
function randomTeam(team) {
  var keys = POOL.map(function (c) { return c.key; });
  for (var i = keys.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = keys[i]; keys[i] = keys[j]; keys[j] = tmp;
  }
  var out = [];
  for (var k = 0; k < teamSize; k++) out.push(keys[k % keys.length]);
  pick[team] = out;
  syncPick();
}

function syncPick() {
  // 角色池高亮：任一方阵容里出现即点亮
  var slots = el.pool.querySelectorAll('.pool-slot[data-key]');
  for (var i = 0; i < slots.length; i++) {
    var key = slots[i].getAttribute('data-key');
    var aOn = (pick.A || []).indexOf(key) >= 0;
    var bOn = (pick.B || []).indexOf(key) >= 0;
    slots[i].classList.toggle('picked-a', aOn);
    slots[i].classList.toggle('picked-b', bOn);

    var tags = slots[i].querySelectorAll('.ps-tags i');
    if (tags.length) {
      tags[0].classList.toggle('on', aOn);
      tags[1].classList.toggle('on', bOn);
    }
  }

  ['A', 'B'].forEach(function (team) {
    var card = team === 'A' ? el.cardA : el.cardB;
    var active = activeTeam === team;

    card.className = 'pick-card' + (active ? ' active' : '') + (teamSize > 1 ? ' multi' : '');
    card.style.color = team === 'A' ? '#e8483f' : '#4a7bf0';
    card.style.background = 'linear-gradient(160deg,' +
      rgba(team === 'A' ? '#e8483f' : '#4a7bf0', 0.14) + ',#11161f 72%)';

    var html = '';
    for (var s = 0; s < teamSize; s++) {
      var c = POOL_BY_KEY[(pick[team] || [])[s]];
      if (!c) continue;
      var sel = (active && activeSlot === s) ? ' sel' : '';
      html += '<div class="slot-chip' + sel + '" data-team="' + team + '" data-slot="' + s + '">' +
        '<span class="sc-idx">' + (s + 1) + '</span>' +
        (c.img
          ? '<img class="pc-img" src="' + c.img + '" alt="' + c.name + '">'
          : '<span class="pc-dot" style="background:' + c.body + ';box-shadow:0 0 10px ' + c.glow + '"></span>') +
        '<b>' + c.name + '</b>' +
        '<small>' + c.units.length + ' 单位</small>' +
        '</div>';
    }
    card.innerHTML = html;

    var chips = card.querySelectorAll('.slot-chip');
    for (var k = 0; k < chips.length; k++) {
      chips[k].addEventListener('click', function () {
        activeTeam = this.getAttribute('data-team');
        activeSlot = parseInt(this.getAttribute('data-slot'), 10) || 0;
        syncPick();
      });
    }

    var body = team === 'A' ? el.detailBodyA : el.detailBodyB;
    var panel = team === 'A' ? el.detailA : el.detailB;
    body.innerHTML = detailHtml(team);
    panel.classList.toggle('active', active);
  });

  var modeText = teamSize + 'v' + teamSize + (modeKind === 'relay' ? ' 接力' : ' 同时上场');
  el.pickSummary.innerHTML =
    '<b>' + modeText + '</b> ｜ ' +
    SIDE_LABEL.A + ' <b>' + (pick.A || []).length + '</b> 人  VS  ' +
    SIDE_LABEL.B + ' <b>' + (pick.B || []).length + '</b> 人 ｜ 对局 <b>' +
    (roundDuration / 60) + ' 分钟</b>' +
    (modeKind === 'relay' ? ' ｜ 胜者保留血量' : '');

  el.nameA.textContent = sideName('A');
  el.nameB.textContent = sideName('B');
}


/* ============================================================
   主页面 / 战斗切换
   ============================================================ */
function openMenu() {
  phase = 'menu';
  winner = null;
  paused = false;
  speedMul = 1;
  units = []; particles = []; rings = []; floaters = []; bombs = []; arrows = []; icePatches = [];
  anvilMarks = [];
  seeds = []; vines = []; reviveQueue = [];
  t = 0; roundTime = roundDuration; shake = 0; hitStop = 0;
  suddenDeath = false; deathAcc = 0; suddenStart = 0;

  el.stage.classList.remove('sudden');
  el.timerLabel.textContent = 'SEC';

  el.menu.classList.add('show');
  el.stage.classList.add('menu-open');
  document.body.classList.add('menu-open');
  el.banner.classList.remove('show');
  el.status.textContent = '';
  el.btns.classList.add('hidden');
  el.btnPause.textContent = '暂停';
  el.btnSpeed.textContent = '速度 ×1';
  activeTeam = 'A';
  activeSlot = 0;
  syncPick();
}

function startBattle() {
  reset();
  phase = 'fight';
  paused = false;
  el.menu.classList.remove('show');
  el.stage.classList.remove('menu-open');
  document.body.classList.remove('menu-open');
  el.btns.classList.remove('hidden');
  el.btnPause.textContent = '暂停';
}

