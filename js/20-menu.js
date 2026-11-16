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
var KINDS = [
  { id: 'vs', label: '同时上场' },
  { id: 'relay', label: '接力' }
];

/* 详情面板默认只显示定位与总结，点「展开数值明细」才铺开所有数值。
   状态只放在内存里，不写存档。 */
var detailOpen = { A: false, B: false };

function roleTags(keys) {
  var out = [];
  for (var i = 0; i < keys.length; i++) {
    var c = POOL_BY_KEY[keys[i]];
    if (!c || !c.role) continue;
    var parts = c.role.split('/');
    for (var j = 0; j < parts.length; j++) {
      var tag = parts[j].trim();
      if (tag && out.indexOf(tag) < 0) out.push(tag);
    }
  }
  return out;
}

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

  var tags = roleTags(keys);
  var hasBond = !!lineupBond(roleUnits(keys));

  var html = '<div class="d-side">' + SIDE_LABEL[team] + '</div>' +
    '<div class="d-name">' + (modeKind === 'relay' ? '接力 ' : '') + keys.length + ' 个角色</div>' +
    '<div class="d-meta">合计 ' + totalHp + ' HP' +
    (modeKind === 'relay' ? ' · 逐个上场，胜者保留血量' : ' · 同时上场') + '</div>';

  if (tags.length || hasBond) {
    html += '<div class="d-tags">';
    for (var t = 0; t < tags.length; t++) {
      html += '<span class="d-tag">' + deskEsc(tags[t]) + '</span>';
    }
    if (hasBond) html += '<span class="d-tag bond">羁绊</span>';
    html += '</div>';
  }

  if (!keys.length) return html;

  var open = !!detailOpen[team];
  html += '<button type="button" class="d-toggle" data-detail-toggle="' + team + '">' +
    (open ? '收起数值明细 ▴' : '展开数值明细 ▾') + '</button>';
  if (!open) {
    html += '<div class="d-hint">默认只显示定位与总血量，点开再看技能 / 被动 / 狂暴数值</div>';
    return html;
  }

  html += '<div class="d-more">';
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

  if (hasBond) {
    html += '<div class="d-bond">羁绊：一方阵亡 → 另一方原地无敌抖动 3 秒，随后进入狂暴（详情见上方各单位）</div>';
  }
  return html + '</div>';
}

function lineupBond(keys) {
  for (var i = 0; i < keys.length; i++) {
    var bond = TYPES[keys[i]].bond;
    if (bond && keys.indexOf(bond) >= 0) return true;
  }
  return false;
}

/* ============================================================
   征召模式（draft）：双方轮流选人，角色全局不可重复
   ------------------------------------------------------------
   · 顺序：A0,B0 → B1,A1 → A2,B2 …（蛇形，避免一方总拿先手）
   · 最多 4v4：角色池 9 个，8 个不重复角色刚好够用
   ============================================================ */
function uiToast(text) {
  if (typeof mobiIsMobile === 'function' && mobiIsMobile() && typeof mobiToast === 'function') {
    mobiToast(text);
    return;
  }
  if (typeof deskToast === 'function') deskToast(text);
}

function buildDraftOrder() {
  var out = [];
  for (var r = 0; r < teamSize; r++) {
    var first = r % 2 === 0 ? 'A' : 'B';
    var second = first === 'A' ? 'B' : 'A';
    out.push({ team: first, slot: r });
    out.push({ team: second, slot: r });
  }
  return out;
}

function draftCurrent() {
  if (!draftOrder.length) return null;
  return draftOrder[Math.min(draftStep, draftOrder.length - 1)];
}

function syncActiveFromDraft() {
  var cur = draftCurrent();
  if (!cur) return;
  activeTeam = cur.team;
  activeSlot = cur.slot;
  if (typeof mobi !== 'undefined' && mobi) {
    mobi.activeTeam = activeTeam;
    mobi.activeSlot = activeSlot;
  }
}

function resetDraftOrder() {
  draftOrder = buildDraftOrder();
  draftStep = 0;
  syncActiveFromDraft();
}

function draftFilledCount() {
  var n = 0;
  for (var i = 0; i < draftOrder.length; i++) {
    var o = draftOrder[i];
    if (POOL_BY_KEY[(pick[o.team] || [])[o.slot]]) n++;
  }
  return n;
}

/* 某个角色是否已经被别人选走（排除 team/slot 自己） */
function roleOwner(key, team, slot) {
  var teams = ['A', 'B'];
  for (var t = 0; t < 2; t++) {
    var T = teams[t], arr = pick[T] || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === key && !(T === team && i === slot)) return T;
    }
  }
  return '';
}

/* 双方每个格子都有合法角色才算选满 */
function lineupsComplete() {
  var teams = ['A', 'B'];
  for (var t = 0; t < 2; t++) {
    var arr = pick[teams[t]] || [];
    for (var i = 0; i < teamSize; i++) {
      if (!POOL_BY_KEY[arr[i]]) return false;
    }
  }
  return true;
}

function draftRefreshStep() {
  for (var i = 0; i < draftOrder.length; i++) {
    var o = draftOrder[i];
    if (!POOL_BY_KEY[(pick[o.team] || [])[o.slot]]) {
      draftStep = i;
      syncActiveFromDraft();
      return;
    }
  }
  draftStep = draftOrder.length;
}

/* 开启征召时清掉重复：A 先保留，B 的重复角色换成池子里还没用过的 */
function dedupeDraft() {
  var used = {};
  ['A', 'B'].forEach(function (team) {
    var arr = pick[team] || [];
    for (var i = 0; i < teamSize; i++) {
      var k = arr[i];
      if (k && !used[k]) { used[k] = 1; continue; }
      var cand = '';
      for (var p = 0; p < POOL.length; p++) {
        if (!used[POOL[p].key]) { cand = POOL[p].key; break; }
      }
      if (cand) { arr[i] = cand; used[cand] = 1; }
    }
    pick[team] = arr;
  });
}

function draftPickRole(key) {
  var cur = draftCurrent();
  if (!cur || !POOL_BY_KEY[key]) return false;
  var owner = roleOwner(key, cur.team, cur.slot);
  if (owner) {
    uiToast('该角色已被' + SIDE_LABEL[owner] + '选走');
    return false;
  }
  if (!pick[cur.team]) pick[cur.team] = [];
  pick[cur.team][cur.slot] = key;
  draftStep = Math.min(draftStep + 1, draftOrder.length);
  if (draftStep < draftOrder.length) syncActiveFromDraft();
  return true;
}

/* 统一入口：征召时忽略传入的 team/slot，按当前轮次写入 */
function pickRoleFor(team, slot, key) {
  if (draftMode) return draftPickRole(key);
  if (!POOL_BY_KEY[key]) return false;
  if (!pick[team]) pick[team] = [];
  pick[team][slot] = key;
  return true;
}

/* 开启征召时清空双方阵容，从红方第一手开始 */
function setDraftMode(on) {
  if (on && teamSize > 4) {
    uiToast('征召模式最多 4v4（角色池只有 9 个角色）');
    return;
  }
  var was = draftMode;
  draftMode = !!on;
  if (draftMode) {
    if (!was) {
      pick.A = [];
      pick.B = [];
      uiToast('征召模式：阵容已清空，从红方开始轮流选');
    }
    resetDraftOrder();
    draftRefreshStep();
  }
  buildDraftPick();
  syncPick();
  if (typeof mobiIsMobile === 'function' && mobiIsMobile() && typeof mobiRender === 'function') mobiRender();
}

function buildDraftPick() {
  if (!el.draftPick) return;
  el.draftPick.innerHTML = '';
  var row = document.createElement('div');
  row.className = 'rp-row';
  var t = document.createElement('span');
  t.className = 'rp-title';
  t.textContent = '选人';
  row.appendChild(t);
  [{ v: false, label: '自由' }, { v: true, label: '征召' }].forEach(function (o) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    if (draftMode === o.v) b.classList.add('on');
    if (o.v && teamSize > 4) {
      b.disabled = true;
      b.title = '征召最多 4v4';
    }
    b.addEventListener('click', function () { setDraftMode(o.v); });
    row.appendChild(b);
  });
  var tip = document.createElement('span');
  tip.className = 'draft-tip';
  tip.textContent = draftMode ? '双方轮流选 · 角色不可重复' : '可重复选人';
  row.appendChild(tip);
  el.draftPick.appendChild(row);
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
    if (draftMode) {
      if (draftPickRole(c.key)) syncPick();
      return;
    }
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
  // 至少保留 8 格视觉占位；角色池超过 8 个时按实际数量铺开（水桶加入后为 9 个）
  var slots = Math.max(8, POOL.length);
  for (var i = 0; i < slots; i++) {
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
  buildSizePick();
  buildSeriesPick();
  buildDraftPick();
  buildComboPick();
  el.diceA.addEventListener('click', function () { randomTeam('A'); });
  el.diceB.addEventListener('click', function () { randomTeam('B'); });
  if (el.btnRandom) el.btnRandom.addEventListener('click', function () { randomTeam('A'); randomTeam('B'); });
}

/* 推荐组合：一键把当前选择方填成常见搭配，降低第一次选人的门槛 */
var COMBOS = [
  { label: '红青 + 长矛', keys: ['duo', 'spear'] },
  { label: '草 + 水桶', keys: ['grass', 'bucket'] },
  { label: '冰 + 弓箭', keys: ['ice', 'bow'] },
  { label: '大狗 + 铁砧', keys: ['dog', 'anvil'] },
  { label: '红青 + 草 + 水桶', keys: ['duo', 'grass', 'bucket'] }
];

function applyCombo(keys) {
  if (draftMode) {
    uiToast('征召模式请手动选人，或先切回“自由”');
    return;
  }
  var out = keys.slice(0, teamSize);
  for (var i = 0; out.length < teamSize && i < POOL.length * 2; i++) {
    var k = POOL[i % POOL.length].key;
    if (out.indexOf(k) < 0) out.push(k);
  }
  pick[activeTeam] = out;
  activeSlot = Math.min(activeSlot, teamSize - 1);
  syncPick();
}

function buildComboPick() {
  if (!el.comboPick) return;
  el.comboPick.innerHTML = '';
  var label = document.createElement('span');
  label.className = 'cp-label';
  label.textContent = '推荐组合';
  el.comboPick.appendChild(label);
  COMBOS.forEach(function (c) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.label;
    b.title = '填入当前选择方（' + SIDE_LABEL[activeTeam] + '）';
    b.addEventListener('click', function () { applyCombo(c.keys); });
    el.comboPick.appendChild(b);
  });
}

/* 单机赛制：单局 / 三局两胜 */
function buildSeriesPick() {
  if (!el.seriesPick) return;
  el.seriesPick.innerHTML = '';
  var row = document.createElement('div');
  row.className = 'rp-row';
  var t = document.createElement('span');
  t.className = 'rp-title';
  t.textContent = '赛制';
  row.appendChild(t);
  [{ v: 1, label: '单局' }, { v: 3, label: '三局两胜' }].forEach(function (o) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    if (seriesBest === o.v) b.classList.add('on');
    b.addEventListener('click', function () {
      seriesBest = o.v;
      seriesWins = { A: 0, B: 0 };
      seriesGame = 1;
      buildSeriesPick();
      syncPick();
    });
    row.appendChild(b);
  });
  el.seriesPick.appendChild(row);
}

/* 桌面端：人数 1–6 快捷选择（与手机端共用 setSize / pick） */
function buildSizePick() {
  if (!el.sizePick) return;
  el.sizePick.innerHTML = '';
  var label = document.createElement('span');
  label.className = 'size-pick-t';
  label.textContent = '人数';
  el.sizePick.appendChild(label);
  for (var n = 1; n <= 6; n++) {
    (function (num) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = num + 'v' + num;
      if (teamSize === num) b.classList.add('on');
      b.addEventListener('click', function () {
        setSize(num);
        buildSizePick();
        buildModePick();
        syncPick();
      });
      el.sizePick.appendChild(b);
    })(n);
  }
}

/* ---------- 桌面端：金币 / 赛季 / 单机押注 ---------- */
function deskToast(text) {
  var t = el.deskToast;
  if (!t) return;
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(deskToast.timer);
  deskToast.timer = setTimeout(function () { t.classList.remove('on'); }, 1800);
}

function deskSyncChrome() {
  var c = coinsGet();
  var s = 'S' + seasonGet();
  if (el.homeCoins) el.homeCoins.textContent = c;
  if (el.homeSeason) el.homeSeason.textContent = s;
  if (el.homeSeasonBtn) el.homeSeasonBtn.textContent = s;
  deskSyncOdds();
  if (typeof syncDailyHint === 'function') syncDailyHint();
}

/* 单机不押注，只显示预测胜率（与手机端一致） */
function deskSyncOdds() {
  if (!el.oddsA) return;
  var pct = (typeof mobiSoloPct === 'function') ? mobiSoloPct() : 50;
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  el.oddsA.textContent = pct + '%';
  el.oddsB.textContent = (100 - pct) + '%';
  if (el.oddsBarA) el.oddsBarA.style.width = pct + '%';
  if (el.oddsBarB) el.oddsBarB.style.width = (100 - pct) + '%';
}

/* 桌面赛事页的角色/物品图标（不依赖手机端 CSS） */
function deskRoleIco(key, size) {
  var c = POOL_BY_KEY[key];
  var st = 'width:' + size + 'px;height:' + size + 'px;';
  if (!c) return '<span class="ico" style="' + st + '"></span>';
  if (c.img) return '<span class="ico" style="' + st + '"><img src="' + c.img + '" alt=""></span>';
  var svg = (typeof iconSvg === 'function') ? iconSvg(key) : '';
  if (svg) return '<span class="ico" style="' + st + '">' + svg + '</span>';
  return '<span class="ico" style="' + st + 'background:' + c.body + ';box-shadow:0 0 12px ' + c.glow + '"></span>';
}

/* 桌面赛事：自定义玩家姓名弹层（与手机端共用 localStorage） */
function deskNameEditor() {
  var box = el.deskNames;
  if (!box) return;
  var n = (typeof tour !== 'undefined' && tour) ? tour.size : 16;
  var arr = duelNamesGet() || [];
  var cur = (typeof tour !== 'undefined' && tour && tour.names) ? tour.names : [];
  var h = '<div class="desk-names-box"><h3>自定义玩家姓名</h3>' +
    '<p>留空的名额会用随机名字，填了的存在浏览器里</p><div class="desk-name-grid">';
  for (var i = 0; i < n; i++) {
    h += '<label><i>' + (i + 1) + '</i><input type="text" maxlength="8" data-dname="' + i + '"' +
      ' value="' + deskEsc(arr[i] || '') + '" placeholder="' + deskEsc(cur[i] || ('玩家' + (i + 1))) + '"></label>';
  }
  h += '</div><div class="desk-names-act">' +
    '<button type="button" data-dact="cancel">取消</button>' +
    '<button type="button" class="primary" data-dact="save">保存</button>' +
    '</div></div>';
  box.innerHTML = h;
  box.classList.add('on');
  box.onclick = function (e) {
    var b = e.target.closest('[data-dact]');
    if (!b) {
      if (e.target === box) box.classList.remove('on');
      return;
    }
    if (b.getAttribute('data-dact') === 'cancel') { box.classList.remove('on'); return; }

    var inputs = box.querySelectorAll('[data-dname]');
    var arr2 = [];
    for (var k = 0; k < inputs.length; k++) arr2.push((inputs[k].value || '').trim());
    var prev = duelNamesGet() || [];
    duelNamesSet(arr2);
    if (typeof tour !== 'undefined' && tour) {
      var keep = [];
      for (var j = 0; j < tour.size; j++) {
        keep[j] = arr2[j] || (prev[j] ? '' : ((tour.names && tour.names[j]) || ''));
      }
      tour.names = tourMakeNames(tour.size, keep);
      for (var m = 0; m < tour.players.length; m++) {
        if (tour.names[m]) tour.players[m].name = tour.names[m];
      }
      tourSave();
    }
    box.classList.remove('on');
    if (typeof tourRender === 'function') tourRender();
    deskToast('玩家姓名已保存到浏览器');
  };
}

function deskEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 人数已由主菜单入口决定，这里只保留「上场方式」开关 */
function buildModePick() {
  el.modePick.innerHTML = '';

  var row = document.createElement('div');
  row.className = 'rp-row';
  var t = document.createElement('span');
  t.className = 'rp-title';
  t.textContent = '上场方式';
  row.appendChild(t);

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
    row.appendChild(b);
  });

  el.modePick.appendChild(row);
}

// 改人数：1v1 强制回到「同时上场」；自由模式下不够的格子自动补齐
function setSize(size) {
  size = Math.max(1, Math.min(6, size | 0));   // 手机端最多 6v6
  var oldSize = teamSize;

  if (draftMode && size > 4) {
    draftMode = false;
    uiToast('征召模式最多 4v4，已切回自由选人');
  }
  if (draftMode && size !== oldSize) {
    pick.A = [];
    pick.B = [];
  }

  teamSize = size;
  if (size === 1) modeKind = 'vs';

  ['A', 'B'].forEach(function (team) {
    var arr = (pick[team] || []).slice(0, size);
    if (!draftMode) {
      while (arr.length < size) {
        var cand = null;
        for (var i = 0; i < POOL.length; i++) {
          if (arr.indexOf(POOL[i].key) < 0) { cand = POOL[i].key; break; }
        }
        arr.push(cand || POOL[arr.length % POOL.length].key);
      }
    }
    pick[team] = arr;
  });

  activeSlot = Math.min(activeSlot, size - 1);

  if (draftMode) {
    resetDraftOrder();
    draftRefreshStep();
  }
  if (typeof buildDraftPick === 'function') buildDraftPick();
}

/* 征召随机：只填当前这一方，避开对方已经选走的角色 */
function randomDraftTeam(team) {
  var other = team === 'A' ? 'B' : 'A';
  var used = {};
  (pick[other] || []).forEach(function (k) { if (k) used[k] = 1; });
  var keys = POOL.map(function (c) { return c.key; }).filter(function (k) { return !used[k]; });
  if (keys.length < teamSize) {
    uiToast('剩余角色不够，无法随机');
    return;
  }
  for (var i = keys.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = keys[i]; keys[i] = keys[j]; keys[j] = tmp;
  }
  pick[team] = keys.slice(0, teamSize);
  if (draftMode) draftRefreshStep();
  syncPick();
}

// 随机一支队伍：洗牌角色池后取前 teamSize 个（池子不够就循环取）
function randomTeam(team) {
  if (draftMode) { randomDraftTeam(team); return; }
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

    if (draftMode) {
      var owner = roleOwner(key);
      var cc = POOL_BY_KEY[key];
      slots[i].classList.toggle('taken', !!owner);
      slots[i].title = cc.name + ' · ' + cc.role +
        (owner ? ' · 已被' + SIDE_LABEL[owner] + '选走' : ' · 待选');
    } else {
      slots[i].classList.remove('taken');
    }
  }

  ['A', 'B'].forEach(function (team) {
    var card = team === 'A' ? el.cardA : el.cardB;
    var active = activeTeam === team;

    card.className = 'pick-card' + (active ? ' active' : '') +
      (teamSize > 1 ? ' multi' : '') + ' slots-' + teamSize;
    card.style.color = team === 'A' ? '#e8483f' : '#4a7bf0';
    card.style.background = 'linear-gradient(160deg,' +
      rgba(team === 'A' ? '#e8483f' : '#4a7bf0', 0.14) + ',#11161f 72%)';

    var html = '';
    for (var s = 0; s < teamSize; s++) {
      var c = POOL_BY_KEY[(pick[team] || [])[s]];
      var sel = (active && activeSlot === s) ? ' sel' : '';
      if (!c) {
        html += '<div class="slot-chip empty' + sel + '" data-team="' + team + '" data-slot="' + s + '"' +
          ' title="点击后从角色池选择"><span class="sc-idx">' + (s + 1) + '</span><b>待选</b></div>';
        continue;
      }
      html += '<div class="slot-chip' + sel + '" data-team="' + team + '" data-slot="' + s + '" title="' +
        deskEsc(c.role + ' · ' + c.units.length + ' 个单位') + '">' +
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
        if (draftMode) return;   // 征召模式由轮次决定，不能自由切边
        activeTeam = this.getAttribute('data-team');
        activeSlot = parseInt(this.getAttribute('data-slot'), 10) || 0;
        syncPick();
      });
    }

    var body = team === 'A' ? el.detailBodyA : el.detailBodyB;
    var panel = team === 'A' ? el.detailA : el.detailB;
    body.innerHTML = detailHtml(team);
    // 详情折叠按钮：阻止冒泡，避免同时触发「切换选择方」
    var tog = body.querySelector('[data-detail-toggle]');
    if (tog) {
      tog.addEventListener('click', function (e) {
        e.stopPropagation();
        var side = this.getAttribute('data-detail-toggle');
        detailOpen[side] = !detailOpen[side];
        syncPick();
      });
    }
    panel.classList.toggle('active', active);

    if (el.comboPick) {
      var cps = el.comboPick.querySelectorAll('button');
      for (var ci = 0; ci < cps.length; ci++) {
        cps[ci].title = '填入当前选择方（' + SIDE_LABEL[activeTeam] + '）';
      }
    }
  });

  var modeText = teamSize + 'v' + teamSize + (modeKind === 'relay' ? ' 接力' : ' 同时上场');
  if (el.menuMode) el.menuMode.textContent = modeText;
  var draftText = '';
  if (draftMode) {
    var filled = draftFilledCount(), total = draftOrder.length;
    draftText = ' ｜ <b>征召 ' + filled + '/' + total + '</b>' +
      (filled < total ? ' · ' + SIDE_LABEL[activeTeam] + ' 选择中' : ' · 选人完成');
  }
  el.pickSummary.innerHTML =
    '<b>' + modeText + '</b> ｜ ' +
    SIDE_LABEL.A + ' <b>' + (pick.A || []).length + '</b> 人  VS  ' +
    SIDE_LABEL.B + ' <b>' + (pick.B || []).length + '</b> 人 ｜ 对局 <b>' +
    (roundDuration / 60) + ' 分钟</b>' +
    (seriesBest === 3 ? ' ｜ <b>三局两胜</b>' : '') +
    (modeKind === 'relay' ? ' ｜ 胜者保留血量' : '') + draftText;

  el.nameA.textContent = sideName('A');
  el.nameB.textContent = sideName('B');

  if (el.btnStart) {
    var ready = lineupsComplete();
    el.btnStart.classList.toggle('disabled', !ready);
    el.btnStart.title = ready ? '' : '双方阵容还没选满';
  }
  if (el.comboPick) el.comboPick.classList.toggle('is-hidden', draftMode);

  if (typeof deskSyncChrome === 'function') deskSyncChrome();
}


/* ============================================================
   每日挑战 / 幽灵挑战
   ------------------------------------------------------------
   · 每日挑战：按本地日期生成固定种子 + 固定 2v2 阵容，2 分钟
   · 幽灵挑战：URL 携带 seed / 人数 / 模式 / 时长 / 双方阵容
   · 两者都走 setNextSeed(seed, source)，由固定步长引擎复现同一局
   ============================================================ */
var DAILY_KEY = 'mcduel.daily.v1';
var ghostPending = null;

function dailyKey() {
  var d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function dailyConfig() {
  var key = dailyKey();
  var seed = hashSeed('mcduel-daily-v1:' + key);
  var rng = mulberry32(seed);
  var keys = POOL.map(function (c) { return c.key; });
  for (var i = keys.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var tmp = keys[i]; keys[i] = keys[j]; keys[j] = tmp;
  }
  return {
    seed: seed, dateKey: key, size: 2, mode: 'vs', dur: 120,
    a: keys.slice(0, 2), b: keys.slice(2, 4)
  };
}

function dailyRecordGet() {
  try {
    var raw = localStorage.getItem(DAILY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function dailyRecordSave(winner) {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify({
      date: dailyKey(), seed: matchSeed, winner: winner, t: Math.floor(t)
    }));
  } catch (e) {}
}

function dailyDoneToday() {
  var r = dailyRecordGet();
  return !!(r && r.date === dailyKey());
}

function syncDailyHint() {
  var done = dailyDoneToday();
  if (el.dailyHint) {
    el.dailyHint.textContent = done ? '今日已完成 · 点击重看' : '固定种子 · 2v2 · 2 分钟';
  }
  var btn = document.querySelector('.home-daily');
  if (btn) btn.classList.toggle('done', done);
}

function roleNames(keys) {
  var out = [];
  for (var i = 0; i < (keys || []).length; i++) {
    var c = POOL_BY_KEY[keys[i]];
    out.push(c ? c.short : keys[i]);
  }
  return out.join(' + ');
}

function ghostUrl() {
  var base = location.href.split('#')[0].split('?')[0];
  return base + '?ghost=1&seed=' + matchSeed +
    '&size=' + teamSize + '&mode=' + modeKind + '&dur=' + roundDuration +
    '&a=' + (pick.A || []).join(',') + '&b=' + (pick.B || []).join(',');
}

function readGhostLink() {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('ghost') !== '1') return null;
    var seed = parseInt(q.get('seed'), 10) >>> 0;
    var size = clamp(parseInt(q.get('size'), 10) || 1, 1, 6);
    var mode = q.get('mode') === 'relay' ? 'relay' : 'vs';
    var dur = parseInt(q.get('dur'), 10);
    if (ROUND_OPTIONS.indexOf(dur) < 0) dur = 180;
    var a = (q.get('a') || '').split(',').filter(function (k) { return !!POOL_BY_KEY[k]; });
    var b = (q.get('b') || '').split(',').filter(function (k) { return !!POOL_BY_KEY[k]; });
    if (!seed || a.length !== size || b.length !== size) return null;
    return { seed: seed, size: size, mode: mode, dur: dur, a: a, b: b };
  } catch (e) {
    return null;
  }
}

function clearGhostQuery() {
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
}

function hideGhostInvite() {
  if (el.ghost) el.ghost.classList.remove('show');
}

function showGhostInvite(cfg) {
  ghostPending = cfg;
  if (!el.ghost) return;
  el.ghostTitle.textContent = '幽灵挑战 · ' + cfg.size + 'v' + cfg.size;
  el.ghostSub.textContent = '同一套种子与阵容，双方会打出完全相同的一局';
  el.ghostStats.innerHTML =
    '<div class="result-stat"><i>种子</i><b>#' + cfg.seed + '</b></div>' +
    '<div class="result-stat"><i>赛制</i><b>' + cfg.size + 'v' + cfg.size + ' · ' +
      (cfg.mode === 'relay' ? '接力' : '同时') + ' · ' + (cfg.dur / 60) + ' 分钟</b></div>' +
    '<div class="result-stat b"><i>红方</i><b>' + deskEsc(roleNames(cfg.a)) + '</b></div>' +
    '<div class="result-stat b"><i>蓝方</i><b>' + deskEsc(roleNames(cfg.b)) + '</b></div>';
  el.ghost.classList.add('show');
}

function initGhostInvite() {
  var cfg = readGhostLink();
  if (cfg) showGhostInvite(cfg);
}

/* 复现对局：幽灵与每日挑战共用 */
function startReplay(cfg, source) {
  hideGhostInvite();
  clearGhostQuery();
  openMenu();
  draftMode = false;
  teamSize = cfg.size;
  modeKind = cfg.mode;
  roundDuration = cfg.dur;
  pick.A = cfg.a.slice(0, cfg.size);
  pick.B = cfg.b.slice(0, cfg.size);
  seriesBest = 1;
  seriesWins = { A: 0, B: 0 };
  seriesGame = 1;
  setNextSeed(cfg.seed, source);
  buildDraftPick();
  buildModePick();
  buildSizePick();
  buildSeriesPick();
  if (typeof buildRoundPick === 'function') buildRoundPick();
  syncPick();
  startBattle();
}

function startDaily() {
  startReplay(dailyConfig(), 'daily');
}

function applyGhost(cfg) {
  if (!cfg) return;
  startReplay(cfg, 'ghost');
}

/* 赛后面板「重看本局」：每日 / 幽灵用原种子重放；普通局开新局 */
function replayAgain() {
  if ((matchSource === 'daily' || matchSource === 'ghost') && matchSeed) {
    startReplay({
      seed: matchSeed, size: teamSize, mode: modeKind, dur: roundDuration,
      a: (pick.A || []).slice(0, teamSize), b: (pick.B || []).slice(0, teamSize)
    }, matchSource);
    return;
  }
  startBattle();
}

function copyText(text) {
  function fallback() {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      uiToast('幽灵链接已复制');
    } catch (e) {
      uiToast('复制失败，请手动复制地址栏');
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      uiToast('幽灵链接已复制');
    }, fallback);
  } else {
    fallback();
  }
}


/* ============================================================
   主菜单 / 选人页 / 战斗切换
   ------------------------------------------------------------
   · 启动与「返回」都先到主菜单（home）
   · 主菜单三个入口：单机模式 / 联机模式 / S{n} 赛事模式
   ============================================================ */
function buildHome() {
  // 版本号与手机首页共用 APP_VERSION
  if (el.homeVer) el.homeVer.textContent = APP_VERSION;

  // 角色池预览：与手机首页的 3×3 名单保持一致
  var roster = document.getElementById('homeRoster');
  if (roster) {
    var rh = '<div class="home-roster-t">角色池 · ' + POOL.length + ' 个</div><div class="home-roster-g">';
    POOL.forEach(function (c) {
      rh += '<div class="home-roster-i">' + deskRoleIco(c.key, 30) +
        '<div class="tx"><b>' + deskEsc(c.short) + '</b><small>' + deskEsc(c.role) + '</small></div></div>';
    });
    roster.innerHTML = rh + '</div>';
  }

  var btns = document.querySelectorAll('.home-big[data-go], .home-daily[data-go]');
  for (var i = 0; i < btns.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var go = btn.getAttribute('data-go');
        if (go === 'solo') {
          enterPick(teamSize || 1);
        } else if (go === 'daily') {
          startDaily();
        } else if (go === 'tour') {
          if (typeof mobiOpenTour === 'function') mobiOpenTour();
          else tourOpen(8);
        } else {
          deskToast('联机模式正在探索中，先用单机 / 赛事模式');
        }
      });
    })(btns[i]);
  }
  if (el.btnBackHome) el.btnBackHome.addEventListener('click', openMenu);
  if (typeof syncDailyHint === 'function') syncDailyHint();
  deskSyncChrome();
}

/* 从主菜单进入某个对战人数的选人页 */
function enterPick(size) {
  // 手机端走独立的 1024×512 单机页（复用同一套 pick / teamSize 状态）
  if (typeof mobiIsMobile === 'function' && mobiIsMobile()) {
    if (typeof mobiEnterSolo === 'function') { mobiEnterSolo(); return; }
  }
  setSize(size);
  buildModePick();
  buildSizePick();
  el.home.classList.remove('show');
  el.menu.classList.add('show');
  el.stage.classList.add('menu-open');
  document.body.classList.add('menu-open');
  el.banner.classList.remove('show');
  el.status.textContent = '';
  el.btns.classList.add('hidden');
  activeTeam = 'A';
  activeSlot = 0;
  syncPick();
}

function openMenu() {
  // 后台赔率模拟占着引擎全局：先停下并还原，再做主菜单的重置
  if (typeof tourOddsStop === 'function') tourOddsStop();
  phase = 'menu';
  winner = null;
  paused = false;
  speedMul = 1;
  units = []; particles = []; rings = []; floaters = []; bombs = []; arrows = []; icePatches = [];
  waters = [];
  anvilMarks = [];
  seeds = []; vines = []; reviveQueue = [];
  t = 0; roundTime = roundDuration; shake = 0; hitStop = 0;
  simAcc = 0;
  suddenDeath = false; deathAcc = 0; suddenStart = 0;
  seriesWins = { A: 0, B: 0 };
  seriesGame = 1;
  if (typeof rebuildRoster === 'function') rebuildRoster();

  el.stage.classList.remove('sudden');
  el.timerLabel.textContent = 'SEC';

  // 离开赛事后恢复「红方 / 蓝方」默认标签
  teamNames.A = '';
  teamNames.B = '';

  el.menu.classList.remove('show');
  if (el.home) el.home.classList.add('show');
  el.stage.classList.add('menu-open');
  document.body.classList.add('menu-open');
  el.banner.classList.remove('show');
  el.status.textContent = '';
  el.btns.classList.add('hidden');
  el.btnPause.textContent = '暂停';
  el.btnSpeed.textContent = '速度 ×1';
  if (typeof hideResult === 'function') hideResult();
  if (typeof hidePause === 'function') hidePause();
  activeTeam = 'A';
  activeSlot = 0;

  // 回主菜单时刷新金币 / 赛季
  syncPick();
  buildSizePick();
  if (typeof deskSyncChrome === 'function') deskSyncChrome();

  // 手机端：回到独立的手机主菜单
  if (typeof mobiOnHome === 'function') mobiOnHome();
}

function startBattle() {
  if (!lineupsComplete()) {
    uiToast('请先把双方阵容选满');
    return;
  }
  // R 键 / 重开按钮在赛事棋盘上也会触发：后台模拟期间先停下再重置，避免两边抢全局
  if (typeof tourOddsStop === 'function') tourOddsStop();
  // 手机端：进战斗先把独立界面收起，让 canvas 占满
  if (typeof mobiOnBattleStart === 'function') mobiOnBattleStart();
  // 新开一轮系列赛
  seriesWins = { A: 0, B: 0 };
  seriesGame = 1;
  reset();
  applyFightChrome();
}

/* 系列赛「下一局」：保留 seriesWins / seriesGame，只重置这一局的战场 */
function continueSeries() {
  seriesGame++;
  reset();
  applyFightChrome();
}

/* 「重开 / R」：系列赛未结束时只重打当前局，不把比分清零 */
function restartBattle() {
  if (seriesBest === 3 && seriesWins.A < 2 && seriesWins.B < 2) {
    reset();
    applyFightChrome();
    return;
  }
  startBattle();
}

function applyFightChrome() {
  phase = 'fight';
  paused = false;
  if (el.home) el.home.classList.remove('show');
  el.menu.classList.remove('show');
  el.stage.classList.remove('menu-open');
  document.body.classList.remove('menu-open');
  el.btns.classList.remove('hidden');
  el.btnPause.textContent = '暂停';
  if (typeof hideResult === 'function') hideResult();
  if (typeof hidePause === 'function') hidePause();
}

