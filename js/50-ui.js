/* ============================================================
   50-ui.js —— 帧循环、键盘与按钮交互、阵容条、结算/暂停、音效、启动入口
   ============================================================ */
'use strict';

/* ============================================================
   帧循环
   ============================================================ */
var last = performance.now();
var pauseFrame = 0;

function frame(now) {
  requestAnimationFrame(frame);

  var dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;

  /* 后台赔率模拟（第 83 条）期间引擎全局被模拟占用：
     即使玩家按空格把 paused 改回 false，也不要再驱动这批状态，
     否则会和模拟互相踩（双保险，另一道是 paused=true） */
  var oddsBusy = (typeof oddsRunning !== 'undefined' && oddsRunning);

  if (!paused && !oddsBusy) {
    var sdt = dt * speedMul;
    /* 终局特写：模拟已停，演出时间降到 0.35× 做慢镜头，结束后再弹结算 */
    if (typeof endFx !== 'undefined' && endFx) sdt *= 0.35;
    /* 终末震荡演出：镜头按真实时间推进；期间模拟时间降到 0.3×（全程慢动作），
       慢动作只影响表现，不影响伤害结算与胜负判定。 */
    if (typeof bossCine !== 'undefined' && bossCine) {
      if (bossCine.slow) sdt *= bossCine.slow;
      bossCine.t += dt;
      if (bossCine.t >= bossCine.dur) bossCine = null;
    }
    // 命中顿帧只做视觉冲击（render 里的轻微放大），不改变模拟时间，
    // 这样普通局分享出去的幽灵链接也能逐 tick 复现
    if (hitStop > 0) hitStop -= dt;
    if (phase === 'fight') {
      // 固定步长：帧率 / 倍速只改变“每帧跑几步”，不改变 tick 的 dt
      var tourMul = (typeof tourSpeed === 'number' && tourSpeed > 0) ? tourSpeed : 1;
      simAcc += sdt * tourMul;
      var guard = 0;
      while (simAcc >= SIM_DT && guard++ < 240) {
        if (phase !== 'fight') break;
        tick(SIM_DT);
        simAcc -= SIM_DT;
      }
    }
    // 击杀演出期间粒子走慢动作（时间流速 0.28×）
    var fxScale = (typeof tourFx !== 'undefined' && tourFx) ? 0.28 : 1;
    fx(sdt * fxScale);
    if (typeof tourFx !== 'undefined' && tourFx && typeof tourFxTick === 'function') tourFxTick(dt);
    // 终局特写计时：演出走完后再出结算横幅 / 结算页
    if (typeof endFx !== 'undefined' && endFx) {
      endFx.t += dt;
      if (endFx.t >= endFx.dur && typeof endFxFinish === 'function') endFxFinish();
    }
  }

  // 暂停时画面完全静止：每 6 帧画一次即可，省下持续重绘的开销
  if (!paused || (pauseFrame++ % 6) === 0) render();
}

/* ============================================================
   阵容条：每个单位一张小卡（名字 / 血条 / 状态字）
   ============================================================ */
var rosterRefs = { A: [], B: [] };
var rosterFrame = 0;

function rosterStatus(u) {
  if (u.ultT > 0) return '终';
  if (u.castT > 0) return '蓄';
  if (u.st && u.st.rage) return u.st.rage.phase === 'shake' ? '抖' : '狂';
  if (u.boss && TYPES[u.key] && TYPES[u.key].bossLock && u.hp <= 1.05) return '锁';
  if (u.st && u.st.milkT > 0) return '域';
  if (u.bindT > 0) return '定';
  if (u.poisonStacks > 0) return '毒';
  if (u.drownStacks > 0) return '溺';
  if (typeof fieldHasBuff === 'function' && fieldHasBuff(u)) return '食';
  if (u.st && u.st.shield > 0) return '盾';
  return '';
}

function rebuildRoster() {
  // 后台赔率模拟不碰 DOM / 不发声
  if (typeof simHeadless !== 'undefined' && simHeadless) return;
  if (!el.rosterA || !el.rosterB) return;
  rosterRefs = { A: [], B: [] };

  ['A', 'B'].forEach(function (team) {
    var box = team === 'A' ? el.rosterA : el.rosterB;
    box.innerHTML = '';
    var color = team === 'A' ? '#e8483f' : '#4a7bf0';
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.team !== team || u.isSummon) continue;   // 临时分身不占阵容条
      var chip = document.createElement('div');
      chip.className = 'roster-chip';
      chip.innerHTML =
        '<span class="rc-dot" style="background:' + u.body + ';box-shadow:0 0 5px ' + u.glow + '"></span>' +
        '<span class="rc-name">' + u.name + '</span>' +
        '<span class="rc-hp"><i style="background:' + color + '"></i></span>' +
        '<span class="rc-st"></span>';
      box.appendChild(chip);
      rosterRefs[team].push({
        u: u,
        el: chip,
        hp: chip.querySelector('.rc-hp i'),
        st: chip.querySelector('.rc-st')
      });
    }
  });

  updateRoster(true);
}

function updateRoster(force) {
  if (typeof simHeadless !== 'undefined' && simHeadless) return;
  if (!force && (rosterFrame++ % 5) !== 0) return;
  ['A', 'B'].forEach(function (team) {
    var refs = rosterRefs[team];
    for (var i = 0; i < refs.length; i++) {
      var r = refs[i], u = r.u;
      var pct = u.maxHp > 0 ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 0;
      r.hp.style.width = (pct * 100).toFixed(1) + '%';
      r.el.classList.toggle('dead', !u.alive);
      r.el.classList.toggle('acting', !!(u.alive && u.castT > 0));
      var mark = u.alive ? rosterStatus(u) : '';
      if (r.st.textContent !== mark) r.st.textContent = mark;
      r.el.title = u.name + ' · ' + (u.alive ? Math.ceil(u.hp) + '/' + u.maxHp + ' HP' : '已阵亡');
    }
  });
}

/* ============================================================
   结算卡片
   ============================================================ */
function hideResult() {
  if (el.result) el.result.classList.remove('show');
}

function topDealer() {
  var best = null;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (u.isSummon) continue;   // MVP 只评角色本体
    if (!best || (u.dealt || 0) > (best.dealt || 0)) best = u;
  }
  return best;
}

function resultTile(label, value, small) {
  return '<div class="result-stat' + (small ? ' b' : '') + '"><i>' + label + '</i><b>' +
    deskEsc(String(value)) + '</b></div>';
}

/* BOSS 全屏播报：合体 / 狂暴这种"阶段切换"必须让观众一眼看到
   （结算横幅 #banner 只在终局用，这里另开一层，播 2.4 秒自动收起） */
var bossCryTimer = 0;
function bossCry(title, sub) {
  var box = document.getElementById('bossCry');
  if (!box) return;
  var b = box.querySelector('b'), s = box.querySelector('span');
  if (b) b.textContent = title || '';
  if (s) s.textContent = sub || '';
  box.classList.add('show');
  clearTimeout(bossCryTimer);
  bossCryTimer = setTimeout(function () { box.classList.remove('show'); }, 2400);
}

function showResult(winner, sub, by) {
  if (!el.result) return;

  var isSeries = seriesBest === 3 && !bossMode;
  var final = true;
  if (isSeries) {
    if (winner === 'A' || winner === 'B') seriesWins[winner]++;
    final = seriesWins.A >= 2 || seriesWins.B >= 2;
  }

  var dA = Math.round(dealtOf('A'));
  var dB = Math.round(dealtOf('B'));
  var mvp = topDealer();
  var title = winner === 'draw' ? '平局'
    : (isSeries && final ? sideName(winner) + ' 赢下系列赛' : sideName(winner) + ' 胜利');
  // BOSS 战只报结果，不念一长串角色名
  if (bossMode) {
    title = winner === 'draw' ? '平局'
      : (winner === 'A' ? 'BOSS 讨伐成功'
        : (bossMerged ? '紫晶核心 胜利' : (bossConfig().name + ' 胜利')));
  }

  var srcLabel = matchSource === 'daily' ? '每日挑战 · '
    : (matchSource === 'ghost' ? '幽灵挑战 · ' : '');
  el.resKicker.textContent = srcLabel + (isSeries ? '第 ' + seriesGame + ' 局 · ' : '') +
    (final ? '对局结束' : '本局结束');
  el.resTitle.textContent = title;
  el.resSub.textContent = sub + ' · 本局 ' + Math.floor(t) + ' 秒' +
    (isSeries ? ' · 系列赛 ' + seriesWins.A + ' : ' + seriesWins.B : '') +
    ' · 种子 #' + matchSeed;

  var tiles = '';
  tiles += resultTile('MVP · 伤害', mvp ? (mvp.name + ' ' + Math.round(mvp.dealt || 0)) : '—', true);
  tiles += resultTile('总伤害', dA + ' : ' + dB);
  tiles += resultTile('结束方式', by === 'time' ? '时间到' : (by === 'death' ? '决杀' : '击杀'), true);
  if (isSeries) tiles += resultTile('系列赛', seriesWins.A + ' : ' + seriesWins.B);
  if (bossMode) {
    tiles += resultTile('BOSS 阶段',
      bossTwoBar() ? (bossPhase > 1 ? '二阶段' : '一阶段') : (bossMerged ? '已合体' : '双生'), true);
  }
  el.resStats.innerHTML = tiles;

  if (matchSource === 'daily') dailyRecordSave(winner);

  if (el.resNext) el.resNext.classList.toggle('is-hidden', !(isSeries && !final));
  if (el.resAgain) {
    el.resAgain.classList.toggle('is-hidden', isSeries && !final);
    el.resAgain.textContent = (matchSource === 'daily' || matchSource === 'ghost')
      ? '重看本局' : (isSeries && final ? '再打一轮' : (bossMode ? '再打一次' : '再来一局'));
  }
  // BOSS 战的阵容是「玩家 5 人 vs 固定 BOSS」，没有幽灵链接的意义
  if (el.resGhost) el.resGhost.classList.toggle('is-hidden', !!bossMode);

  el.result.classList.add('show');
}

/* ============================================================
   暂停（仅切换 paused 状态与顶部按钮文字，无遮挡卡片）
   ============================================================ */
function togglePause() {
  if (phase !== 'fight') return;
  // 后台赔率模拟期间不响应暂停：它自己已经把 paused 置为 true
  if (typeof oddsRunning !== 'undefined' && oddsRunning) return;
  paused = !paused;
  el.btnPause.textContent = paused ? '继续' : '暂停';
}

function toggleSpeed() {
  speedMul = speedMul === 1 ? 2 : (speedMul === 2 ? 0.5 : 1);
  el.btnSpeed.textContent = '速度 ×' + speedMul;
}

/* ============================================================
   音效：WebAudio 合成，零依赖；只做少量关键提示音
   ============================================================ */
var SFX_KEY = 'mcduel.sfx.v1';
var sfx = { muted: false, ctx: null, last: {} };
try {
  if (localStorage.getItem(SFX_KEY) === '1') sfx.muted = true;
} catch (e) {}

function sfxInit() {
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!sfx.ctx) sfx.ctx = new AC();
  if (sfx.ctx.state === 'suspended') {
    try { sfx.ctx.resume(); } catch (e) {}
  }
  return sfx.ctx;
}

function sfxTone(ac, f1, f2, dur, type, vol, delay) {
  var o = ac.createOscillator();
  var g = ac.createGain();
  var t0 = ac.currentTime + (delay || 0);
  o.type = type || 'sine';
  o.frequency.setValueAtTime(Math.max(20, f1), t0);
  if (f2 && f2 !== f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(ac.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

function sfxPlay(name) {
  if (sfx.muted) return;
  // 后台赔率模拟 / 无渲染批量跑局时绝对不要出声
  if (typeof simHeadless !== 'undefined' && simHeadless) return;
  if (typeof oddsRunning !== 'undefined' && oddsRunning) return;
  var ac = sfxInit();
  if (!ac) return;
  // 用 performance.now 做节流：AudioContext 被挂起时 currentTime 不前进，会误吞后续音效
  var now = performance.now() / 1000;
  var gaps = { hit: 0.045, cast: 0.06, death: 0.12, bomb: 0.08, rage: 0.2, ult: 0.15, win: 0.5, lose: 0.5 };
  var gap = gaps[name] || 0.05;
  if (sfx.last[name] && now - sfx.last[name] < gap) return;
  sfx.last[name] = now;

  if (name === 'hit') sfxTone(ac, 190, 90, 0.07, 'square', 0.035, 0);
  else if (name === 'cast') sfxTone(ac, 520, 780, 0.09, 'sine', 0.05, 0);
  else if (name === 'death') sfxTone(ac, 240, 70, 0.34, 'sawtooth', 0.05, 0);
  else if (name === 'bomb') sfxTone(ac, 95, 40, 0.28, 'square', 0.08, 0);
  else if (name === 'rage') sfxTone(ac, 330, 660, 0.22, 'triangle', 0.06, 0);
  else if (name === 'ult') {
    sfxTone(ac, 260, 880, 0.28, 'triangle', 0.07, 0);
    sfxTone(ac, 520, 1040, 0.2, 'sine', 0.05, 0.06);
  }
  else if (name === 'win') {
    sfxTone(ac, 523, 523, 0.12, 'sine', 0.055, 0);
    sfxTone(ac, 784, 784, 0.18, 'sine', 0.055, 0.11);
  } else if (name === 'lose') sfxTone(ac, 300, 170, 0.3, 'sine', 0.05, 0);
}

function sfxSync() {
  var text = '音效 ' + (sfx.muted ? '关' : '开');
  if (el.btnSound) el.btnSound.textContent = text;
}

function sfxToggle() {
  sfx.muted = !sfx.muted;
  try { localStorage.setItem(SFX_KEY, sfx.muted ? '1' : '0'); } catch (e) {}
  sfxSync();
  if (!sfx.muted) sfxPlay('cast');
}

/* ============================================================
   竖屏战场镜头
   ------------------------------------------------------------
   竖屏时 canvas 按高度铺满，宽度会超出屏幕；这里按存活单位重心
   横向平移，让战斗中心始终在屏幕里。仅改 CSS transform，不动模拟。
   ============================================================ */
/* 缓存 clientWidth：每帧读取会强制浏览器重排，竖屏镜头只需要知道
   canvas 与 stage 谁更宽；尺寸变化由 resize / 重新打开战斗时刷新。 */
var portraitSize = { cssW: 0, stageW: 0, tick: 0 };
window.addEventListener('resize', function () { portraitSize.cssW = 0; });

function updatePortraitCamera() {
  if (!document.body.classList.contains('portrait')) {
    if (cv && cv.style.transform) cv.style.transform = '';
    return;
  }
  var stage = el.stage;
  if (!stage || !cv) return;

  if (!portraitSize.cssW || (portraitSize.tick++ % 30) === 0) {
    portraitSize.cssW = cv.clientWidth;
    portraitSize.stageW = stage.clientWidth || window.innerWidth;
  }
  var cssW = portraitSize.cssW;
  var stageW = portraitSize.stageW;
  if (!cssW || cssW <= stageW + 1) return;

  var ax = 0, an = 0, bx = 0, bn = 0;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) continue;
    if (u.team === 'A') { ax += u.x; an++; }
    else { bx += u.x; bn++; }
  }
  var cx = W / 2;
  if (an && bn) cx = (ax / an + bx / bn) / 2;
  else if (an) cx = ax / an;
  else if (bn) cx = bx / bn;

  var target = (cx / W - 0.5) * cssW;
  var max = Math.max(0, (cssW - stageW) / 2);
  target = clamp(target, -max, max);
  portraitCam += (target - portraitCam) * 0.18;
  cv.style.transform = 'translateX(calc(-50% + ' + portraitCam.toFixed(1) + 'px))';
}

/* ============================================================
   交互
   ============================================================ */
el.btnRestart.addEventListener('click', restartBattle);
el.btnStart.addEventListener('click', startBattle);
el.btnMenu.addEventListener('click', openMenu);
el.cardA.addEventListener('click', function () { if (!draftMode) { activeTeam = 'A'; syncPick(); } });
// BOSS 模式下点蓝方卡片：选中蓝方，下方列表切换成 BOSS 池
el.cardB.addEventListener('click', function () {
  if (draftMode) return;
  activeTeam = 'B';
  syncPick();
});
el.detailA.addEventListener('click', function () { if (!draftMode) { activeTeam = 'A'; syncPick(); } });
el.detailB.addEventListener('click', function () { if (!draftMode && !bossMode) { activeTeam = 'B'; syncPick(); } });
el.btnPause.addEventListener('click', togglePause);
el.btnSpeed.addEventListener('click', toggleSpeed);
if (el.btnSound) el.btnSound.addEventListener('click', sfxToggle);

if (el.resAgain) el.resAgain.addEventListener('click', replayAgain);
if (el.resNext) el.resNext.addEventListener('click', continueSeries);
if (el.resChange) el.resChange.addEventListener('click', function () {
  var wasBoss = bossMode;
  openMenu();
  if (wasBoss) enterBossPick(); else enterPick(teamSize);
});
if (el.resGhost) el.resGhost.addEventListener('click', function () {
  copyText(ghostUrl());
});
if (el.resHome) el.resHome.addEventListener('click', openMenu);

if (el.ghostStart) el.ghostStart.addEventListener('click', function () {
  var cfg = ghostPending;
  hideGhostInvite();
  if (cfg) applyGhost(cfg);
});
if (el.ghostClose) el.ghostClose.addEventListener('click', function () {
  hideGhostInvite();
  clearGhostQuery();
});

window.addEventListener('keydown', function (e) {
  if (e.code === 'KeyR') {
    if (phase !== 'menu') restartBattle();
  } else if (e.code === 'Space') {
    if (phase === 'menu') return;
    e.preventDefault();
    togglePause();
  } else if (e.code === 'KeyF') {
    toggleSpeed();
  } else if (e.code === 'Escape') {
    openMenu();
  }
});

// 主菜单对局时长档位：点击后只改 roundDuration，由下一局 reset() 生效
function buildRoundPick() {
  el.roundPick.innerHTML = '';
  var title = document.createElement('span');
  title.className = 'rp-title';
  title.textContent = '对局时长';
  el.roundPick.appendChild(title);
  ROUND_OPTIONS.forEach(function (sec) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = (sec / 60) + ' 分钟';
    if (sec === roundDuration) b.classList.add('on');
    b.addEventListener('click', function () {
      roundDuration = sec;   // 下一局生效
      buildRoundPick();
      syncPick();
    });
    el.roundPick.appendChild(b);
  });
}

buildMenu();
buildHome();
buildRoundPick();
syncPick();
sfxSync();
openMenu();
initGhostInvite();
requestAnimationFrame(frame);
