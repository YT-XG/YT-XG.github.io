/* ============================================================
   30-sim.js —— 一局对战的全部规则
   特效原语 · 伤害与护盾 · 羁绊狂暴与炸弹 · 箭矢 · 冰面
   技能施放与决策 · 匀速直线运动 · 弹性碰撞 · 回合判定 · tick()
   ============================================================ */
'use strict';

/* ============================================================
   特效
   ============================================================ */
function burst(x, y, n, color, speed) {
  for (var i = 0; i < n; i++) {
    var a = rand(0, TAU), s = rand(speed * 0.25, speed);
    particles.push({
      x: x, y: y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.25, 0.62), max: 0.62,
      size: rand(1.6, 3.6), color: color, grav: 120
    });
  }
}
function ring(x, y, r0, r1, life, color) {
  rings.push({ x: x, y: y, r0: r0, r1: r1, life: life, max: life, color: color });
}
function floater(x, y, text, color, size) {
  floaters.push({ x: x, y: y, vy: -34, life: 0.9, max: 0.9, text: text, color: color, size: size || 13 });
}

/* ============================================================
   伤害
   ============================================================ */
function hurt(u, amount, src) {
  if (!u.alive || amount <= 0) return;

  // 羁绊狂暴前的 3 秒：原地无敌
  if (u.st.rage && u.st.rage.phase === 'shake') {
    floater(u.x, u.y - u.r - 14, '无敌', '#ffe08a', 12);
    return;
  }

  // 承伤统计：在被护盾吸收之前记，代表"这个单位实际挨了多少"
  u.taken = (u.taken || 0) + amount;

  if (u.st.shield > 0) {
    var absorbed = Math.min(u.st.shield, amount);
    u.st.shield -= absorbed;
    amount -= absorbed;
    if (absorbed > 0) floater(u.x, u.y - u.r - 12, '吸收 ' + Math.round(absorbed), '#93b6ff', 12);
    if (u.st.shield <= 0.01) {
      u.st.shield = 0; u.st.shieldT = 0;
      ring(u.x, u.y, u.r, 128, 0.45, '#8fb4ff');
      burst(u.x, u.y, 14, '#9cc0ff', 220);
    }
  }

  if (amount > 0) {
    u.hp -= amount;
    if (src) src.dealt += amount;
    u.flash = 1;
    floater(u.x + rand(-9, 9), u.y - u.r - 28, '-' + Math.round(amount), '#ffd166', 15);
    burst(u.x, u.y, 7, '#ffb199', 170);
  }

  if (u.hp <= 0) {
    u.hp = 0;
    u.alive = false;
    burst(u.x, u.y, 34, u.glow, 360);
    ring(u.x, u.y, 8, 170, 0.6, u.glow);
    shake = Math.max(shake, 9);
    floater(u.x, u.y - 8, u.name + ' 倒下', '#ffffff', 14);
    onUnitDeath(u);
  }
}

function nearestEnemy(u) {
  var best = null, bd = 1e9;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    var d = Math.hypot(v.x - u.x, v.y - u.y);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

/* ============================================================
   羁绊·狂暴 + 红石炸弹
   ------------------------------------------------------------
   · 红石块 / 青金石块是一个整体：一方阵亡 → 另一方先原地无敌抖动 3 秒
   · 之后进入狂暴：
       红石块   → 移速 ×3 起并随时间加快；可穿透敌方；攻击方式改为沿途扔炸弹
       青金石块 → 移速 ×3 起并随时间加快；不再释放技能；撞击伤害每秒 +10；每 3 秒刷新 50 护盾
   ============================================================ */
function isShaking(u) {
  return !!(u && u.st && u.st.rage && u.st.rage.phase === 'shake');
}

// 狂暴穿透：只对敌方生效；命中的那一方跳过位置分离与弹性反弹
function canPassThrough(u, other) {
  var R = u && u.st && u.st.rage;
  var T = u && TYPES[u.key];
  return !!(R && R.phase === 'rage' && T && T.rage && T.rage.passThrough && other.team !== u.team);
}

function startRage(u) {
  if (!u.alive || u.st.rage) return;
  u.st.rage = { phase: 'shake', t: BALANCE.bondShake, since: 0 };
  u.dashT = 0; u.dmgMult = 1; u.vx = 0; u.vy = 0; u.trail = [];
  ring(u.x, u.y, u.r, 170, 0.6, '#ffd166');
  burst(u.x, u.y, 22, '#ffe08a', 260);
  floater(u.x, u.y - u.r - 28, '羁绊·狂暴', '#ffe08a', 15);
  shake = Math.max(shake, 6);
}

function onUnitDeath(u) {
  // 大狗：死亡立刻收回激光，否则 onTick 不再跑、laserT 永远 > 0，光束会一直挂在场上
  if (u.st && u.st.laserT > 0) {
    u.st.laserT = 0;   // 死亡立刻收回
    u.st.laserTick = 0;
  }

  // 草：场上还有自己的种子 → 排队在种子上复活（这次不算真死，不触发羁绊）
  if (TYPES[u.key].revivesAtSeed && queueRevive(u)) return;

  var bond = TYPES[u.key].bond;
  if (!bond) return;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (v.alive && v.team === u.team && v.key === bond) startRage(v);
  }
}

function updateRage(u, dt) {
  var R = u.st.rage;
  if (!R || R.phase !== 'shake') return;
  R.t -= dt;
  if (R.t > 0) return;
  R.phase = 'rage';
  R.since = t;
  var T = TYPES[u.key];
  if (T.onRageStart) T.onRageStart(u);
  ring(u.x, u.y, u.r, 190, 0.5, '#ff9c6b');
  floater(u.x, u.y - u.r - 24, '狂暴', '#ffd166', 14);
  shake = Math.max(shake, 4);
}

function dropBomb(u) {
  var cfg = TYPES.red.rage.bomb;
  bombs.push({
    x: u.x, y: u.y,
    fuse: cfg.fuse, max: cfg.fuse,
    radius: cfg.radius, dmg: cfg.dmg,
    team: u.team, owner: u, spin: rand(0, TAU)
  });
  ring(u.x, u.y, 3, 24, 0.18, '#ffb14d');
  burst(u.x, u.y, 3, '#ffd166', 90);
}

function updateBombs(dt) {
  for (var i = bombs.length - 1; i >= 0; i--) {
    var b = bombs[i];
    b.fuse -= dt;
    if (b.fuse > 0) continue;
    bombs.splice(i, 1);

    ring(b.x, b.y, 6, b.radius, 0.42, '#ffb14d');
    ring(b.x, b.y, 3, b.radius * 0.55, 0.3, '#fff1c9');
    burst(b.x, b.y, 20, '#ffd166', 300);
    shake = Math.min(15, shake + 3.5);
    hitStop = Math.max(hitStop, 0.025);

    for (var k = 0; k < units.length; k++) {
      var v = units[k];
      if (!v.alive || v.team === b.team) continue;
      if (Math.hypot(v.x - b.x, v.y - b.y) < b.radius + v.r) {
        hurt(v, b.dmg, b.owner);
      }
    }
  }
}

/* ============================================================
   箭矢（弓箭专属飞行物）
   ------------------------------------------------------------
   · 直线飞行、不反弹；寿命耗尽或飞出场地即销毁
   · 普通箭命中第一个敌人后消失；强化箭对每个敌人只结算一次并继续飞
   · 伤害统一走 hurt()，与护盾 / 无敌抖动 / 死亡流程保持一致
   ============================================================ */
// 点到线段的最短距离：避免高速箭在相邻两帧之间"穿过"目标
function segDist(px, py, x1, y1, x2, y2) {
  var dx = x2 - x1, dy = y2 - y1;
  var l2 = dx * dx + dy * dy;
  if (l2 < 0.0001) return Math.hypot(px - x1, py - y1);
  var k = clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
  return Math.hypot(px - (x1 + dx * k), py - (y1 + dy * k));
}

// 瞄准角：按箭速迭代命中时间，加入目标匀速直线的提前量
function aimAngle(u, sx, sy, speed) {
  var v = nearestEnemy(u);
  if (!v) return u.ang;
  var vx = Math.cos(v.ang) * speedOf(v);
  var vy = Math.sin(v.ang) * speedOf(v);
  var px = v.x, py = v.y, tt = 0;
  for (var i = 0; i < 3; i++) {
    tt = Math.hypot(px - sx, py - sy) / speed;
    px = v.x + vx * tt;
    py = v.y + vy * tt;
  }
  return Math.atan2(py - sy, px - sx);
}

function fireArrow(u, power) {
  var C = power ? TYPES.bow.arrow.power : TYPES.bow.arrow.normal;
  var aim = aimAngle(u, u.x, u.y, C.speed);
  u.faceAng = aim;   // 仅用于绘制朝向；移动方向 u.ang 保持不变

  var sx = u.x + Math.cos(aim) * (u.r + 6);
  var sy = u.y + Math.sin(aim) * (u.r + 6);
  arrows.push({
    x: sx, y: sy, px: sx, py: sy,
    ang: aim, speed: C.speed,
    life: C.life, max: C.life,
    power: !!power, dmg: C.dmg, hitR: C.hitR,
    team: u.team, owner: u, hit: []
  });

  ring(sx, sy, 2, C.hitR * 4, 0.16, power ? '#ffd166' : '#c9f59b');
  burst(sx, sy, power ? 6 : 3, power ? '#ffd166' : '#b9e88a', 110);
}

function updateArrows(dt) {
  var A = ARENA;
  for (var i = arrows.length - 1; i >= 0; i--) {
    var a = arrows[i];
    a.life -= dt;
    if (a.life <= 0) { arrows.splice(i, 1); continue; }

    a.px = a.x; a.py = a.y;
    a.x += Math.cos(a.ang) * a.speed * dt;
    a.y += Math.sin(a.ang) * a.speed * dt;

    for (var k = 0; k < units.length; k++) {
      var v = units[k];
      if (!v.alive || v.team === a.team) continue;
      if (a.hit.indexOf(v) >= 0) continue;
      if (segDist(v.x, v.y, a.px, a.py, a.x, a.y) > v.r + a.hitR) continue;

      a.hit.push(v);
      hurt(v, a.dmg, a.owner);
      ring(v.x, v.y, 3, 26, 0.22, a.power ? '#ffd166' : '#c9f59b');
      burst(v.x, v.y, a.power ? 8 : 4, a.power ? '#ffd166' : '#b9e88a', 180);
      if (!a.power) { a.life = 0; break; }   // 普通箭命中即消失
    }

    // 出界即销毁（箭不反弹）
    if (a.life <= 0 || a.x < A.x - 24 || a.x > A.x + A.w + 24 ||
        a.y < A.y - 24 || a.y > A.y + A.h + 24) {
      arrows.splice(i, 1);
    }
  }
}

/* ============================================================
   冰面：冰块移动时留下的地面残留
   ------------------------------------------------------------
   · 每块存活 hold 秒，再用 fade 秒线性淡出（总寿命 hold+fade）
   · 只对敌方生效：减速仍走 slowT，伤害每 dotInterval 秒结算一次
   · 冰面不改方向、不推动单位，符合"只有技能/撞墙才转向"的红线
   ============================================================ */
function dropIcePatch(owner, x, y) {
  var C = TYPES.ice.iceTrail;
  icePatches.push({
    x: x, y: y, r: C.r,
    life: C.hold + C.fade,
    team: owner.team, owner: owner
  });
  if (icePatches.length > ICE_PATCH_MAX) {
    icePatches.splice(0, icePatches.length - ICE_PATCH_MAX);
  }
}

function updateIcePatches(dt) {
  var C = TYPES.ice.iceTrail;
  var i, j;

  for (i = icePatches.length - 1; i >= 0; i--) {
    icePatches[i].life -= dt;
    if (icePatches[i].life <= 0) icePatches.splice(i, 1);
  }

  for (i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive) continue;

    // 站上任意一块敌方冰面即生效（重叠多块不叠加）
    var onIce = false, src = null;
    for (j = 0; j < icePatches.length; j++) {
      var p = icePatches[j];
      if (p.team === v.team) continue;
      var dx = v.x - p.x, dy = v.y - p.y;
      var rr = p.r + v.r * 0.35;
      if (dx * dx + dy * dy <= rr * rr) { onIce = true; src = p.owner; break; }
    }

    if (onIce) {
      v.slowT = Math.max(v.slowT, C.slowTime);
      v.slowMul = Math.min(v.slowMul || 1, C.slowMul);
      // 冰霜累积：在冰面上的时间累计满 dotInterval（1 秒）结算一次，每个目标独立计时，
      // 避免每帧重复扣血；高速单位单次穿过不足 1 秒，多次踩冰会累加。
      v.iceTick -= dt;
      if (v.iceTick <= 0) {
        v.iceTick += C.dotInterval;   // 每 dotInterval 秒一次
        hurt(v, C.dot, src);
      }
    } else if (v.iceTick < C.dotInterval) {
      // 离开冰面后缓慢恢复，避免"很久以前踩过一次，回来一下就掉血"
      v.iceTick = Math.min(C.dotInterval, v.iceTick + dt);
    }
  }
}

/* ============================================================
   草：种子 / 藤蔓 / 在种子上复活
   ------------------------------------------------------------
   · plantSeed   在当前位置种一颗种子（100 HP、不移动、不挡路）
   · updateSeeds 敌方单位贴身会打掉种子（每次命中 25，0.35s 内不重复）
   · tryVine     向范围内最近的敌人伸藤蔓：定身 3s + 中毒 5s（每秒 20）
   · queueRevive 草阵亡时消耗一颗自己的种子，延迟 1s 原地复活
   ============================================================ */
var SEED_HIT_DMG = 25, SEED_HIT_CD = 0.35;

function plantSeed(u, cfg) {
  // 同队同时只保留最新的一颗：再种就先把旧的收掉，避免满地种子
  for (var i = seeds.length - 1; i >= 0; i--) {
    if (seeds[i].team === u.team) {
      burst(seeds[i].x, seeds[i].y, 10, '#9be36f', 140);
      seeds.splice(i, 1);
    }
  }
  seeds.push({
    x: u.x, y: u.y, r: cfg.r, hp: cfg.hp, maxHp: cfg.hp,
    team: u.team, owner: u, hitCd: 0, phase: rand(0, TAU)
  });
  if (seeds.length > SEED_MAX) seeds.shift();

  ring(u.x, u.y, u.r, 96, 0.45, '#c8f5b0');
  burst(u.x, u.y, 14, '#bff5a0', 190);
  floater(u.x, u.y - u.r - 18, '生花 · 种子', '#c8f5b0', 13);
}

function updateSeeds(dt) {
  for (var i = seeds.length - 1; i >= 0; i--) {
    var s = seeds[i];
    s.hitCd = Math.max(0, s.hitCd - dt);

    for (var j = 0; j < units.length; j++) {
      var v = units[j];
      if (!v.alive || v.team === s.team) continue;
      var reach = v.r + s.r;
      if ((v.x - s.x) * (v.x - s.x) + (v.y - s.y) * (v.y - s.y) > reach * reach) continue;
      if (s.hitCd > 0) continue;

      s.hitCd = SEED_HIT_CD;
      s.hp -= SEED_HIT_DMG;
      burst(s.x, s.y, 6, '#c8f5b0', 150);
      if (s.hp <= 0) {
        burst(s.x, s.y, 18, '#9be36f', 230);
        floater(s.x, s.y - 16, '种子被踩碎', '#c8f5b0', 12);
        seeds.splice(i, 1);
        break;
      }
    }
  }
}

function tryVine(u, V) {
  var best = null, bd = V.range;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    var d = Math.hypot(v.x - u.x, v.y - u.y);
    if (d < bd) { bd = d; best = v; }
  }

  // 没目标也甩一下藤蔓（空放），保证"CD 好了就放"的决策不变
  var ex = best ? best.x : u.x + Math.cos(u.ang) * 80;
  var ey = best ? best.y : u.y + Math.sin(u.ang) * 80;
  vines.push({ x1: u.x, y1: u.y, x2: ex, y2: ey, life: 0.45, max: 0.45, hit: !!best });

  if (!best) return;
  best.bindT = V.root;
  best.poisonT = V.poisonTime;
  best.poisonAcc = 1.0;      // 1 秒后第一次掉血
  best.poisonSrc = u;

  ring(best.x, best.y, best.r, 118, 0.45, '#8ce06a');
  floater(best.x, best.y - best.r - 18, '捆绑 ' + V.root + 's', '#9be36f', 13);
}

function updateVines(dt) {
  for (var i = vines.length - 1; i >= 0; i--) {
    vines[i].life -= dt;
    if (vines[i].life <= 0) vines.splice(i, 1);
  }
}

function pendingRevive(team) {
  for (var i = 0; i < reviveQueue.length; i++) if (reviveQueue[i].team === team) return true;
  return false;
}

// 阵亡时调用：有种子就排队复活（返回 true 表示"还会回来"）
function queueRevive(u) {
  var T = TYPES[u.key];
  if ((u.revives || 0) >= (T.maxRevives || 0)) return false;   // 复活次数用完
  var idx = -1;
  for (var i = seeds.length - 1; i >= 0; i--) {
    if (seeds[i].team === u.team) { idx = i; break; }
  }
  if (idx < 0) return false;

  var s = seeds[idx];
  seeds.splice(idx, 1);
  // 以种子剩余血量复活；记录这次是第几次复活，超过 maxRevives 就真死
  reviveQueue.push({ team: u.team, key: u.key, x: s.x, y: s.y, t: REVIVE_DELAY,
                     hp: s.hp, revives: (u.revives || 0) + 1 });

  ring(s.x, s.y, s.r, 120, 0.8, '#c8f5b0');
  burst(s.x, s.y, 16, '#bff5a0', 200);
  floater(s.x, s.y - 30, '种子萌发 ' + REVIVE_DELAY.toFixed(1) + 's', '#c8f5b0', 13);
  return true;
}

function updateRevive(dt) {
  for (var i = reviveQueue.length - 1; i >= 0; i--) {
    var q = reviveQueue[i];
    q.t -= dt;
    if (q.t > 0) continue;
    reviveQueue.splice(i, 1);
    if (phase !== 'fight') continue;

    var nu = addUnit(q.key, q.x, q.y, q.team);
    nu.revives = q.revives || 0;
    nu.hp = Math.max(1, Math.min(nu.maxHp, q.hp || 0));   // 以种子剩余血量复活
    faceInward(nu);
    burst(q.x, q.y, 24, '#c8f5b0', 280);
    ring(q.x, q.y, 12, 160, 0.6, '#9be36f');
    floater(q.x, q.y - 34, '复活 ' + Math.round(nu.hp) + ' HP', '#c8f5b0', 15);
    shake = Math.max(shake, 5);
  }
}

/* ============================================================
   场地收缩：每 5 秒左右各收 30px，最小宽度 SHRINK.minW
   ------------------------------------------------------------
   只改 ARENA.x / ARENA.w；move() 每帧读 ARENA 做边界钳制，
   所以落在新墙外的单位会在下一帧被推回场内并触发撞墙反弹。
   ============================================================ */
function resetArena() {
  ARENA.x = ARENA_FULL.x;
  ARENA.y = ARENA_FULL.y;
  ARENA.w = ARENA_FULL.w;
  ARENA.h = ARENA_FULL.h;
}

// 持续收缩：每帧按 rate * dt 收窄，墙是"慢慢推过来"的，不是跳一下
function updateShrink(dt) {
  if (ARENA.w <= SHRINK.minW) return;
  var d = Math.min(SHRINK.rate * dt, ARENA.w - SHRINK.minW);
  if (d <= 0) return;
  ARENA.w -= d;
  ARENA.x += d / 2;

  // 被新墙压到的单位直接推到墙内（不改朝向，下一帧 move 会处理反弹）
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) continue;
    if (u.x - u.r < ARENA.x) u.x = ARENA.x + u.r;
    if (u.x + u.r > ARENA.x + ARENA.w) u.x = ARENA.x + ARENA.w - u.r;
  }
  // 落在墙外的种子被压碎
  for (var j = seeds.length - 1; j >= 0; j--) {
    var s = seeds[j];
    if (s.x < ARENA.x || s.x > ARENA.x + ARENA.w) {
      burst(s.x, s.y, 12, '#9be36f', 180);
      floater(s.x, s.y - 14, '种子被压碎', '#c8f5b0', 12);
      seeds.splice(j, 1);
    }
  }
}

/* 大狗激光：每 0.1 秒结算一次
   ------------------------------------------------------------
   光束 = 从狗当前位置沿"施放瞬间锁定"的方向射出的线段（长度 laser.len）。
   敌人的圆碰到线段就算被扫到，吃一段伤害；方向不追踪，靠走位躲。 */
function laserStrike(u, L) {
  var ex = u.x + Math.cos(u.st.laserAng) * L.len;
  var ey = u.y + Math.sin(u.st.laserAng) * L.len;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (segDist(v.x, v.y, u.x, u.y, ex, ey) > L.width * 0.5 + v.r) continue;
    hurt(v, L.dmg, u);
  }
}

function statusText() {
  var parts = [];
  if (suddenDeath && phase === 'fight') {
    parts.push('决杀 · 全体每秒 -5% 最大生命（已 ' + Math.floor(t - suddenStart) + 's）');
  }
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    var R = u.st.rage;
    if (!u.alive || !R) continue;
    if (R.phase === 'shake') {
      parts.push(u.name + ' 无敌抖动 ' + Math.max(0, Math.ceil(R.t)) + 's');
    } else {
      var T = TYPES[u.key];
      var txt = (T.rage && T.rage.status) ? T.rage.status : '狂暴';
      if (T.rage && T.rage.ramp) {
        var rampDmg = (t - R.since) * T.rage.dmgPerSec;
        if (T.rage.dmgCap) rampDmg = Math.min(T.rage.dmgCap, rampDmg);
        txt += ' +' + Math.floor(rampDmg) + ' 伤害/次';
        // 有撞击冷却的角色（青金石）额外显示「就绪 / 冷却 N.Ns」
        if (T.rage.hitCd) {
          txt += u.st.rageHitCd > 0
            ? '（冷却 ' + u.st.rageHitCd.toFixed(1) + 's）'
            : '（就绪）';
        }
      }
      parts.push(u.name + ' ' + txt);
    }
  }
  return parts.join(' · ');
}

/* ============================================================
   技能：唯一主动改变方向的手段
   ============================================================ */
function cast(u, target) {
  var T = TYPES[u.key];
  var S = T.skill;
  var aim = Math.atan2(target.y - u.y, target.x - u.x);

  // 远程技能声明 noTurn 时只瞄准、不改自身运动方向（方向仍只由撞墙 / 其他技能改变）
  if (!S.noTurn) u.ang = aim;   // 转向
  u.dashT = S.dashTime;        // 冲刺
  u.dashSpeed = S.dashSpeed;
  u.dmgMult = S.dmgMult;
  u.cd = S.cd;

  if (T.onCast) T.onCast(u);
}

/* ============================================================
   技能施放：CD 好了直接放，不做距离 / 角度 / 反应试探
   ============================================================ */
function think(u, dt) {
  if (!u.alive || u.st.rage || u.dashT > 0 || u.cd > 0) return;
  // 被动型"技能"（冰块的寒冰轨迹）不需要主动施放，由 onTick 持续生效
  if (TYPES[u.key].skill.passiveOnly) return;

  var s = sense(u);
  if (!s.enemy) return;

  // 物品可以声明 canCast(u) 做"能用但暂时不能放"的判定（如：草已有种子时不能再种）
  var T = TYPES[u.key];
  if (T.canCast && !T.canCast(u)) return;

  // CD 好了就直接放技能，不做距离 / 角度 / 反应试探
  cast(u, s.enemy);
}

/* ============================================================
   匀速直线运动 + 撞墙随机转向
   ============================================================ */
// 撞墙后随机取一个朝向场内的角度，避免固定对角反弹
function wallBounceAngle(hx, hy) {
  if (hx > 0 && hy > 0) return rand(0, Math.PI / 2);
  if (hx < 0 && hy > 0) return rand(Math.PI / 2, Math.PI);
  if (hx < 0 && hy < 0) return rand(Math.PI, Math.PI * 1.5);
  if (hx > 0 && hy < 0) return rand(-Math.PI / 2, 0);
  if (hx > 0) return rand(-Math.PI / 2, Math.PI / 2);
  if (hx < 0) return rand(Math.PI / 2, Math.PI * 1.5);
  if (hy > 0) return rand(0, Math.PI);
  return rand(Math.PI, Math.PI * 2);
}

function move(u, dt) {
  var T = TYPES[u.key];

  if (u.dashT > 0) {
    u.dashT -= dt;

    // 物品自己的冲刺效果（长矛在突刺期间微调朝向）
    if (T.onDash) T.onDash(u, dt);

    if (u.dashT <= 0) u.dmgMult = 1;
  }

  var sp = speedOf(u);
  u.vx = Math.cos(u.ang) * sp;
  u.vy = Math.sin(u.ang) * sp;

  u.x += u.vx * dt;
  u.y += u.vy * dt;

  var a = ARENA;
  var hx = 0, hy = 0;

  if (u.x - u.r < a.x) { u.x = a.x + u.r; hx = 1; }
  if (u.x + u.r > a.x + a.w) { u.x = a.x + a.w - u.r; hx = -1; }
  if (u.y - u.r < a.y) { u.y = a.y + u.r; hy = 1; }
  if (u.y + u.r > a.y + a.h) { u.y = a.y + a.h - u.r; hy = -1; }

  if (hx || hy) {
    // 场地在持续收缩：贴着墙的单位会被连续钳制。
    // 用 wallCd 同时限制"随机转向"的频率，否则贴着移动墙的单位会每帧随机变向、抖成筛子。
    if (u.wallCd <= 0) {
      u.wallCd = 0.12;
      u.ang = wallBounceAngle(hx, hy);   // 撞墙后方向随机，但一定朝场内
      var wx = u.x + hx * u.r, wy = u.y + hy * u.r;
      ring(wx, wy, 3, 30, 0.26, rgba(u.glow, 0.9));
      burst(wx, wy, 5, u.glow, 130);
      shake = Math.min(8, shake + 1.2);
    }
  }

  // 冲刺残影
  if (u.dashT > 0) {
    u.trail.unshift({ x: u.x, y: u.y });
    if (u.trail.length > 12) u.trail.pop();
  } else if (u.trail.length) {
    u.trail.pop();
  }
}

/* ============================================================
   碰撞：敌方弹性反弹，友军只做位置分离（不改方向）
   ============================================================ */
function collide() {
  for (var i = 0; i < units.length; i++) {
    for (var j = i + 1; j < units.length; j++) {
      var a = units[i], b = units[j];
      if (!a.alive || !b.alive) continue;

      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.hypot(dx, dy) || 0.001;
      var min = a.r + b.r;
      if (d >= min) continue;

      var nx = dx / d, ny = dy / d;
      var overlap = min - d;

      // 红石狂暴「可穿透」：只跳过位置分离与弹性反弹，仍保留撞击伤害结算
      var pass = canPassThrough(a, b) || canPassThrough(b, a);

      if (!pass) {
        // 无敌抖动中的单位必须原地不动：只推另一方
        var aFixed = isShaking(a), bFixed = isShaking(b);
        if (!aFixed) {
          var ka = bFixed ? 1 : 0.5;
          a.x -= nx * overlap * ka;
          a.y -= ny * overlap * ka;
        }
        if (!bFixed) {
          var kb = aFixed ? 1 : 0.5;
          b.x += nx * overlap * kb;
          b.y += ny * overlap * kb;
        }
      }

      if (a.team === b.team) continue;

      var sa = speedOf(a);
      var sb = speedOf(b);
      var vax = Math.cos(a.ang) * sa, vay = Math.sin(a.ang) * sa;
      var vbx = Math.cos(b.ang) * sb, vby = Math.sin(b.ang) * sb;
      var rel = (vbx - vax) * nx + (vby - vay) * ny;

      if (rel >= 0) continue;

      // 穿透时不做弹性反弹：方向保持不变，但撞击伤害照常结算
      if (!pass) {
        // 等质量弹性碰撞：交换法线方向的速度分量，大小各自保持不变
        a.ang = Math.atan2(vay + rel * ny, vax + rel * nx);
        b.ang = Math.atan2(vby - rel * ny, vbx - rel * nx);
      }

      var impact = -rel;
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;

      if (impact < BALANCE.impactMin || a.hitCd > 0 || b.hitCd > 0) {
        if (impact > BALANCE.impactMin) burst(mx, my, 2, '#ffd8a8', 120);
        continue;
      }
      a.hitCd = BALANCE.hitCd;
      b.hitCd = BALANCE.hitCd;

      var col = impact > 320 ? '#fff1c9' : '#ffd8a8';
      ring(mx, my, 4, 34 + impact * 0.08, 0.28, col);
      burst(mx, my, 8, col, 200 + impact * 0.25);
      shake = Math.min(15, shake + impact * 0.02);
      hitStop = Math.max(hitStop, 0.045);

      // da 是 a 承受的伤害（乘 b 的攻击力与倍率）；db 同理
      var da = dmgOf(b, impact, a);
      var db = dmgOf(a, impact, b);

      hurt(a, da, b);
      hurt(b, db, a);

      // 物品自己的撞击被动（红石溅射）
      var TA = TYPES[a.key], TB = TYPES[b.key];
      if (a.alive && TA.onHit) TA.onHit(a, b);
      if (b.alive && TB.onHit) TB.onHit(b, a);
    }
  }
}

/* ============================================================
   回合
   ============================================================ */
function teamHp(team) {
  var cur = 0, max = 0;
  var keys = pick[team] || [];
  // 分母 = 全阵容的总生命；分子 = 已在场单位的剩余生命 + 还没上场的单位按满血计
  for (var i = 0; i < keys.length; i++) {
    var role = POOL_BY_KEY[keys[i]];
    if (!role) continue;
    var pending = modeKind === 'relay' && i > lineupIndex[team];
    for (var j = 0; j < role.units.length; j++) {
      var m = TYPES[role.units[j]].maxHp;
      max += m;
      if (pending) cur += m;
    }
  }
  for (var k = 0; k < units.length; k++) {
    if (units[k].team === team) cur += Math.max(0, units[k].hp);
  }
  return { cur: cur, max: max };
}

// 该方「已造成伤害」总和：与 hurt() 里累加的单位 u.dealt 同源，
// 只统计真正扣到敌方 HP 的部分（被护盾吸收的不计），每帧实时求和。
function dealtOf(team) {
  var sum = 0;
  for (var i = 0; i < units.length; i++) {
    if (units[i].team === team) sum += units[i].dealt;
  }
  return sum;
}

function finish(by) {
  if (phase !== 'fight') return;
  phase = 'over';

  // 结算时收回所有激光：tick 停了之后 laserT 不再递减，光束会定格在结算画面上
  for (var li = 0; li < units.length; li++) {
    if (units[li].st) units[li].st.laserT = 0;
  }

  var A = teamHp('A'), B = teamHp('B');
  var ratioA = A.cur / A.max, ratioB = B.cur / B.max;

  if (by === 'time') {
    winner = ratioA > ratioB ? 'A' : (ratioB > ratioA ? 'B' : 'draw');
  } else {
    winner = (A.cur <= 0 && B.cur <= 0) ? 'draw' : (A.cur <= 0 ? 'B' : (B.cur <= 0 ? 'A' : 'draw'));
  }

  var sub = by === 'time' ? '时间到 · 按剩余血量判定'
    : (by === 'death' ? '决杀结束 · 每秒扣 5% 最大生命' : '对手倒下');

  if (by !== 'time' && A.cur <= 0 && B.cur <= 0) {
    var dA = dealtOf('A'), dB = dealtOf('B');
    winner = dA > dB ? 'A' : (dB > dA ? 'B' : 'draw');
    sub = (by === 'death' ? '决杀 · ' : '') + '同归于尽 · 总伤害 ' + Math.round(dA) + ' : ' + Math.round(dB);
  }

  // 赛事模式：先播「放大 + 时缓 + 加分」演出，动画结束后才结算回赛程
  if (typeof tour !== 'undefined' && tour && tour.cur) {
    for (var ti = 0; ti < units.length; ti++) {
      if (units[ti].alive) ring(units[ti].x, units[ti].y, units[ti].r, 220, 0.7, units[ti].glow);
    }
    tourBeginFinishFx(winner);
    return;
  }

  var title = winner === 'draw' ? '平局' : (sideName(winner) + ' 胜利');
  el.banner.querySelector('strong').textContent = title;
  el.banner.querySelector('em').textContent = sub + ' · 按 R 再来一局 · Esc 返回主菜单';
  el.banner.classList.add('show');

  for (var i = 0; i < units.length; i++) {
    if (units[i].alive) ring(units[i].x, units[i].y, units[i].r, 220, 0.7, units[i].glow);
  }
}

// 决杀阶段：每秒扣除全体存活单位 5% 最大生命，无视护盾与 3 秒无敌抖动
function deathStrike() {
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) continue;
    var loss = u.maxHp * DEATH_DRAIN;
    u.hp = Math.max(0, u.hp - loss);
    u.flash = 1;
    floater(u.x + rand(-8, 8), u.y - u.r - 26, '-' + Math.round(loss), '#ff6b5a', 13);
    burst(u.x, u.y, 5, '#ff8a6b', 120);
    if (u.hp <= 0) {
      u.alive = false;
      burst(u.x, u.y, 30, u.glow, 340);
      ring(u.x, u.y, 8, 170, 0.6, u.glow);
      shake = Math.max(shake, 9);
      floater(u.x, u.y - 8, u.name + ' 倒下', '#ffffff', 14);
      onUnitDeath(u);
    }
  }

  // 决杀同样侵蚀种子：每秒扣 5% 最大生命（100 HP 的种子每秒 -5）
  for (var s = seeds.length - 1; s >= 0; s--) {
    var sd = seeds[s];
    var sl = sd.maxHp * DEATH_DRAIN;
    sd.hp -= sl;
    floater(sd.x, sd.y - 14, '-' + Math.round(sl), '#ff8a6b', 11);
    if (sd.hp <= 0) {
      burst(sd.x, sd.y, 14, '#9be36f', 200);
      seeds.splice(s, 1);
    }
  }
}

/* 接力模式：一方全灭后，若还有后备角色，延迟 RELAY_DELAY 秒放下一个进场。
   胜者的血量、护盾、冷却全部保留（就是同一个单位继续打）。 */
function updateRelay(dt) {
  if (modeKind !== 'relay') return;
  ['A', 'B'].forEach(function (team) {
    if (countAlive(team) > 0 || pendingRevive(team)) { relayTimer[team] = 0; return; }
    if (!hasBackup(team)) return;
    relayTimer[team] += dt;
    if (relayTimer[team] < RELAY_DELAY) return;
    relayTimer[team] = 0;
    lineupIndex[team]++;
    deployRole(team, lineupIndex[team]);
    var role = POOL_BY_KEY[(pick[team] || [])[lineupIndex[team]]];
    if (role) {
      var ac = ARENA;
      floater(team === 'A' ? ac.x + 90 : ac.x + ac.w - 90, ac.y + ac.h / 2,
        SIDE_LABEL[team] + ' 换上 ' + role.name, team === 'A' ? '#ffb4aa' : '#b9cdff', 16);
    }
  });
}

function checkOver() {
  // 一方「没人了 + 没后备 + 没有正在复活的种子」才算出局
  var aOut = countAlive('A') === 0 && !hasBackup('A') && !pendingRevive('A');
  var bOut = countAlive('B') === 0 && !hasBackup('B') && !pendingRevive('B');
  if (aOut || bOut) finish(suddenDeath ? 'death' : 'kill');
}

/* ============================================================
   主循环
   ============================================================ */
function tick(dt) {
  t += dt;

  // 倒计时归零 → 进入决杀阶段；之后不再按剩余时间判定
  if (!suddenDeath) {
    roundTime = Math.max(0, roundTime - dt);
    if (roundTime <= 0) {
      suddenDeath = true;
      suddenStart = t;
      deathAcc = 1.0;   // 满 1 秒后第一次扣除
      shake = Math.max(shake, 7);
      var ac = ARENA;
      ring(ac.x + ac.w / 2, ac.y + ac.h / 2, 30, 430, 0.8, '#ff6b5a');
      floater(ac.x + ac.w / 2, ac.y + ac.h / 2 - 22, '决杀 · 每秒 -5% 生命', '#ff8a6b', 22);
    }
  } else {
    deathAcc -= dt;
    while (deathAcc <= 0) {   // 倍速下 dt 可能一次跨过多个整秒
      deathAcc += 1.0;
      deathStrike();
    }
  }

  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    u.cd = Math.max(0, u.cd - dt);
    u.hitCd = Math.max(0, u.hitCd - dt);
    u.wallCd = Math.max(0, u.wallCd - dt);
    u.flash = Math.max(0, u.flash - dt * 5);
    if (u.slowT > 0) {
      u.slowT = Math.max(0, u.slowT - dt);
      if (u.slowT <= 0) u.slowMul = BALANCE.slowSpeedMul;   // 减速结束后恢复默认系数
    }
    // 捆绑：定身计时（速度由 speedOf 归零，方向不变）
    if (u.bindT > 0) u.bindT = Math.max(0, u.bindT - dt);
    // 中毒：每满 1 秒结算一次，伤害走 hurt()（护盾可吸收）
    if (u.poisonT > 0 && u.alive) {
      u.poisonT = Math.max(0, u.poisonT - dt);
      u.poisonAcc -= dt;
      while (u.poisonAcc <= 0 && u.alive) {
        u.poisonAcc += 1.0;
        hurt(u, TYPES.grass.vine.poisonDps, u.poisonSrc);
      }
      if (u.poisonT <= 0) u.poisonSrc = null;
    }
    if (u.st.shieldT > 0) {
      u.st.shieldT -= dt;
      if (u.st.shieldT <= 0) u.st.shield = 0;
    }
    if (u.alive) updateRage(u, dt);
  }

  // 物品自己的每帧被动（青金石光环）
  for (var p = 0; p < units.length; p++) {
    var pu = units[p];
    if (!pu.alive) continue;
    var PT = TYPES[pu.key];
    if (PT.onTick) PT.onTick(pu, dt);
  }

  for (var a = 0; a < units.length; a++) think(units[a], dt);
  for (var b = 0; b < units.length; b++) if (units[b].alive) move(units[b], dt);

  collide();
  updateBombs(dt);
  updateArrows(dt);
  updateIcePatches(dt);
  updateSeeds(dt);
  updateVines(dt);
  updateRevive(dt);
  updateShrink(dt);
  updateRelay(dt);
  checkOver();
}

function fx(dt) {
  var i;
  for (i = particles.length - 1; i >= 0; i--) {
    var p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += p.grav * dt;
    p.vx *= Math.exp(-2.2 * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  for (i = rings.length - 1; i >= 0; i--) {
    rings[i].life -= dt;
    if (rings[i].life <= 0) rings.splice(i, 1);
  }
  for (i = floaters.length - 1; i >= 0; i--) {
    var f = floaters[i];
    f.life -= dt;
    if (f.life <= 0) { floaters.splice(i, 1); continue; }
    f.y += f.vy * dt;
    f.vy *= Math.exp(-1.6 * dt);
  }
  shake *= Math.exp(-7 * dt);
  if (shake < 0.05) shake = 0;
}




