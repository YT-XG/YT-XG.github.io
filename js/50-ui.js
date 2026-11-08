/* ============================================================
   50-ui.js —— 帧循环、键盘与按钮交互、启动入口（最后加载）
   ============================================================ */
'use strict';

/* ============================================================
   帧循环
   ============================================================ */
var last = performance.now();

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
    if (hitStop > 0) {
      hitStop -= dt;
      sdt *= 0.12;
    }
    if (phase === 'fight') {
      // 赛事观战可以加速：把一帧拆成多次 tick，避免单次 dt 过大导致穿透
      var steps = (typeof tourSpeed === 'number' && tourSpeed > 0) ? tourSpeed : 1;
      for (var si = 0; si < steps; si++) {
        if (phase !== 'fight') break;
        tick(sdt);
      }
    }
    // 击杀演出期间粒子走慢动作（时间流速 0.28×）
    var fxScale = (typeof tourFx !== 'undefined' && tourFx) ? 0.28 : 1;
    fx(sdt * fxScale);
    if (typeof tourFx !== 'undefined' && tourFx) tourFxTick(dt);
  }

  render();
}

/* ============================================================
   交互
   ============================================================ */
function togglePause() {
  if (phase === 'menu') return;
  // 后台赔率模拟期间不响应暂停：它自己已经把 paused 置为 true
  if (typeof oddsRunning !== 'undefined' && oddsRunning) return;
  paused = !paused;
  el.btnPause.textContent = paused ? '继续' : '暂停';
}
function toggleSpeed() {
  speedMul = speedMul === 1 ? 2 : (speedMul === 2 ? 0.5 : 1);
  el.btnSpeed.textContent = '速度 ×' + speedMul;
}

el.btnRestart.addEventListener('click', startBattle);
el.btnStart.addEventListener('click', startBattle);
el.btnMenu.addEventListener('click', openMenu);
el.cardA.addEventListener('click', function () { activeTeam = 'A'; syncPick(); });
el.cardB.addEventListener('click', function () { activeTeam = 'B'; syncPick(); });
el.detailA.addEventListener('click', function () { activeTeam = 'A'; syncPick(); });
el.detailB.addEventListener('click', function () { activeTeam = 'B'; syncPick(); });
el.btnPause.addEventListener('click', togglePause);
el.btnSpeed.addEventListener('click', toggleSpeed);

window.addEventListener('keydown', function (e) {
  if (e.code === 'KeyR') {
    if (phase !== 'menu') startBattle();
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
openMenu();
requestAnimationFrame(frame);
