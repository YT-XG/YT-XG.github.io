/* ============================================================
   30-sim.js —— 一局对战的全部规则
   特效原语 · 伤害与护盾 · 羁绊狂暴与炸弹 · 箭矢 · 冰面
   技能施放与决策 · 匀速直线运动 · 弹性碰撞 · 回合判定 · tick()
   ============================================================ */
'use strict';

/* ============================================================
   特效
   ------------------------------------------------------------
   终结技 / 6v6 同时开打时特效会短时间暴涨，这里给三个特效数组设上限：
   超出后丢最早的，保证低端机不会因为粒子数无限增长而掉帧。 */
var FX_PARTICLE_MAX = 900;
var FX_RING_MAX = 160;
var FX_FLOATER_MAX = 120;

function trimFx(arr, max) {
  if (arr.length > max) arr.splice(0, arr.length - max);
}

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
  trimFx(particles, FX_PARTICLE_MAX);
}
function ring(x, y, r0, r1, life, color) {
  rings.push({ x: x, y: y, r0: r0, r1: r1, life: life, max: life, color: color });
  trimFx(rings, FX_RING_MAX);
}
/* 飘字。opt.pop = 伤害数字专用：入场弹出放大 + 描边加粗 + 同色辉光（见 drawFloaters） */
function floater(x, y, text, color, size, opt) {
  floaters.push({
    x: x, y: y, vy: -34, life: 0.9, max: 0.9,
    text: text, color: color, size: size || 13,
    pop: !!(opt && opt.pop)
  });
  trimFx(floaters, FX_FLOATER_MAX);
}

/* 能量：红青组合的终结技由能量条驱动。
   旧角色 energyMax=0，仍然走 ultCd 冷却，行为完全不变。 */
function ultReady(u) {
  if (!u || !u.alive) return false;
  return u.energyMax ? u.energy >= u.energyMax : (u.ultCd || 0) <= 0;
}
function gainEnergy(u, amt) {
  if (!u || !u.alive || !u.energyMax || amt <= 0) return;
  u.energy = Math.min(u.energyMax, (u.energy || 0) + amt);
}

/* ============================================================
   伤害
   ============================================================ */
/* 伤害统一入口
   ------------------------------------------------------------
   · opt = { pct: 1 }  —— 按目标最大生命算的百分比伤害，不乘全局倍率
   · opt = { dot: 1 }  —— 持续伤害（冰面 / 中毒 / 浸水 / 狗奶引导 / 大狗每段激光）：
                        不播音效、不爆粒子、不逐跳飘字，改为每满 1 秒汇总一条小飘字
   · 其余（撞击 / 箭矢 / 落点 / 炸弹 / 终结技 / 种子被撞）都走绝对值口径，
     统一乘 BALANCE.dmgScale —— 保证「生命上限整体上调」时所有固定伤害同步放大 */
function hurt(u, amount, src, opt) {
  var pct = !!(opt && opt.pct);
  var dot = !!(opt && opt.dot);
  /* 新数值体系（红青组合）标记 calibrated：伤害已按 2000 HP 口径校准，
     不再乘 dmgScale；旧角色没有这个标记，行为完全不变。 */
  var cal = !!(src && TYPES[src.key] && TYPES[src.key].calibrated);
  /* 虚弱（终末震荡）：出手方 10 秒内普攻 / 技能 / 终结技伤害 -20% */
  if (src && src.weakT > 0) amount *= (src.weakMul || 0.8);
  /* 防御减伤：比值式 DEF/(DEF+defK)，边际递减、永远不为负。def=0 的旧角色跳过。 */
  if (u.def > 0) amount *= BALANCE.defK / (BALANCE.defK + u.def);
  // 1v1 单挑修正：按「出手方」缩放全部非百分比伤害（含箭矢 / 激光等固定伤害技能）
  // 百分比伤害（狗奶 / 缺氧 / 决杀）不缩放，避免二次放大
  if (!pct && src && soloMode()) amount *= (BALANCE.solo.dmgMul[src.key] || 1);
  if (pct && src && soloMode()) amount *= (BALANCE.solo.pctMul[src.key] || 1);
  /* BOSS 出手的整体倍率：挑战者不做任何血量加成（沿用常规数值），
     对局时长完全靠压低 BOSS 输出来换，新增角色时无需再补数值。
     已标记 calibrated 的 BOSS（新体系）数值已在自身配置里算好，不再走这层。 */
  if (!pct && src && src.boss && bossMode && BALANCE.boss.dmgMul &&
      !(TYPES[src.key] && TYPES[src.key].calibrated)) amount *= BALANCE.boss.dmgMul;
  /* 新体系 BOSS（calibrated）：技能系数按设定写死，出手强度用独立旋钮整体缩放 */
  if (!pct && src && src.boss && bossMode && BALANCE.boss.calibratedDmgMul &&
      (TYPES[src.key] && TYPES[src.key].calibrated)) amount *= BALANCE.boss.calibratedDmgMul;
  if (!pct && !cal) amount *= BALANCE.dmgScale;
  /* BOSS 硬壳：非百分比伤害再乘一层 dmgTakeMul。
     8 倍血量的 BOSS 如果按常规 DPS 结算，5 个玩家 35 秒就能把它打到合体；
     这一层把 TTK 拉长到 1 分钟左右（百分比伤害不受影响）。 */
  if (!pct && u.boss && BALANCE.boss.dmgTakeMul) amount *= BALANCE.boss.dmgTakeMul;
  /* BOSS 对「百分比伤害」（狗奶引导 / 缺氧 / 决杀）另设一层抗性：
     否则野生狗奶一人每秒 6.6% 最大生命，两个狗奶 8 秒就能把 3000 HP 的 BOSS 打到锁血，
     BOSS 战直接变成"开局 10 秒合体"。这里只压外部百分比伤害，决杀不走这条路径。 */
  if (pct && u.boss && BALANCE.boss.pctTakeMul) amount *= BALANCE.boss.pctTakeMul;
  if (!u.alive || amount <= 0) return;
  /* 合体演出期间的免伤：①两只锁到 1 血后先停顿 0.7 秒（不可打断），
     ②紫晶核心登场后血条从 1 涨到满（mergeFill），充能完才可被击伤。 */
  if (u.st && u.st.mergeFill > 0) return;
  if (bossMergeAct && (bossMergeAct.a === u || bossMergeAct.b === u)) return;
  if (!dot && typeof sfxPlay === 'function') sfxPlay('hit');

  // 野生狗奶：引导期间受击先扣「打断护盾」（128 点）；护盾存在时不掉血，打空立即打断
  if (u.st && u.st.milkT > 0) {
    var absorbed = Math.min(u.st.shield, amount);
    u.st.shield -= absorbed;
    u.taken += amount;       // 承伤统计照常累加（含被护盾吸收的部分）
    if (!dot) {
      floater(u.x, u.y - u.r - 12, '护盾 ' + Math.ceil(Math.max(0, u.st.shield)), '#93b6ff', 12);
      ring(u.x, u.y, u.r + 4, u.r + 30, 0.2, '#93b6ff');
    }
    if (u.st.shield <= 0.01) { u.st.shield = 0; interruptMilk(u); }
    return;
  }

  // 羁绊狂暴前的 3 秒：原地无敌
  if (u.st.rage && u.st.rage.phase === 'shake') {
    if (!dot) floater(u.x, u.y - u.r - 14, '无敌', '#ffe08a', 12);
    return;
  }

  // 承伤统计：在被护盾吸收之前记，代表"这个单位实际挨了多少"
  u.taken = (u.taken || 0) + amount;

  if (u.st.shield > 0) {
    var absorbed2 = Math.min(u.st.shield, amount);
    u.st.shield -= absorbed2;
    amount -= absorbed2;
    if (absorbed2 > 0 && !dot) floater(u.x, u.y - u.r - 12, '吸收 ' + Math.round(absorbed2), '#93b6ff', 12);
    if (u.st.shield <= 0.01) {
      u.st.shield = 0; u.st.shieldT = 0;
      ring(u.x, u.y, u.r, 128, 0.45, '#8fb4ff');
      burst(u.x, u.y, 14, '#9cc0ff', 220);
    }
  }

  if (amount > 0) {
    /* BOSS 锁血：合体前的红青双血条不会降到 1 以下（TYPES[key].bossLock）。
       这里先按「最多扣到 1 血」截断，再把剩余量记进 dealt —— 伤害统计不会虚高。 */
    if (TYPES[u.key] && TYPES[u.key].bossLock) {
      var lockCap = Math.max(0, (BALANCE.boss.lockHp == null ? 1 : BALANCE.boss.lockHp) - 0);
      var canLose = Math.max(0, u.hp - lockCap);
      if (amount > canLose) {
        amount = canLose;
        u.st.locked = true;   // 锁血后不再被敌人锁定（铁砧等指向性技能会跳过）
        if (!dot && !(u.st.lockFxT > 0)) {
          u.st.lockFxT = 0.8;
          ring(u.x, u.y, u.r, u.r + 52, 0.45, '#ffe08a');
          floater(u.x, u.y - u.r - 30, '锁血 ' + lockCap + ' HP', '#ffe08a', 13);
        }
      }
    }
    if (amount <= 0) return;
    u.hp -= amount;
    if (src) src.dealt += amount;
    if (dot) {
      // 持续伤害不逐跳表现：累加到 dotAmt，由 tick() 每秒合并成一条小飘字
      u.dotAmt = (u.dotAmt || 0) + amount;
      if (!(u.dotT > 0)) u.dotT = 1.0;
      if (u.flash < 0.25) u.flash = 0.25;
    } else {
      u.flash = 1;
      floater(u.x + rand(-9, 9), u.y - u.r - 72, '-' + Math.round(amount), '#ffd166', 22, { pop: 1 });
      burst(u.x, u.y, 7, '#ffb199', 170);
    }
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

/* 多目标收益衰减：同一次范围效果命中 N 个目标时，每个目标只吃 aoeFalloff^(N-1)。
   N=1 时返回 1（1v1 / 单目标完全保持原值）；2v2 / 3v3 里避免范围效果线性翻倍。 */
function aoeScale(n) {
  var k = BALANCE.aoeFalloff;
  if (n <= 1) return 1;
  return Math.pow(k, n - 1);
}

function nearestEnemy(u) {
  var best = null, bd = 1e9;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (v.st && v.st.locked) continue;   // 锁 1 血的 BOSS 不可被锁定
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
       青金石块 → 移速 ×3 起并随时间加快；不再释放技能；撞击伤害每秒 +10；每 3 秒刷新 30 护盾
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
  if (typeof sfxPlay === 'function') sfxPlay('rage');
  u.st.rage = { phase: 'shake', t: BALANCE.bondShake, since: 0 };
  u.dashT = 0; u.dmgMult = 1; u.vx = 0; u.vy = 0; u.trail = [];
  u.ultT = 0; u.ultAim = null;
  if (u.st.ultChain) u.st.ultChain = null;
  ring(u.x, u.y, u.r, 170, 0.6, '#ffd166');
  burst(u.x, u.y, 22, '#ffe08a', 260);
  floater(u.x, u.y - u.r - 28, '羁绊·狂暴', '#ffe08a', 15);
  shake = Math.max(shake, 6);
}

function onUnitDeath(u) {
  if (typeof sfxPlay === 'function') sfxPlay('death');
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

/* 炸弹唯一生成入口：{x,y,fuse,max,radius,dmg,team,owner,spin}
   ------------------------------------------------------------
   红石普攻 / 红石终结技 / BOSS 的投弹都走这里：
   { fuse, radius, dmg }，可选 { energy, budget } 用于命中回能 */
function spawnBomb(owner, x, y, cfg) {
  bombs.push({
    x: x, y: y,
    fuse: cfg.fuse, max: cfg.fuse,
    radius: cfg.radius, dmg: cfg.dmg,
    energy: cfg.energy || 0, budget: cfg.budget || null,
    team: owner.team, owner: owner, spin: rand(0, TAU)
  });
}

/* ============================================================
   BOSS 合体：红青同时被打到 1 血 → 紫晶核心
   ------------------------------------------------------------
   · 合体前两只都锁 1 血，谁都打不死；必须「两只都到 1 血」才触发
   · 触发时移除两只（不是阵亡，不触发羁绊），在两者中点生成紫晶核心：
     2000 HP，出生即进入狂暴（跳过 3 秒无敌抖动）
   · 合体演出由 50-ui 的 bossCry() 负责（无头模拟里该函数不存在，安全跳过）
   ============================================================ */
function updateBossMerge(dt) {
  if (!bossMode) return;

  /* 阶段 1：两只锁到 1 血后先「停下来」，0.7 秒内被吸向中点（速度归零 + 免伤）。
     这一段是纯演出：位置用插值直接改写，不参与直线运动 / 墙面反弹。 */
  if (bossMergeAct) {
    var m = bossMergeAct;
    m.t += dt;
    // 前 0.55s：原地定住（只亮环 + 播报「停止行动」）；之后 0.45s 滑向中点
    var moved = Math.max(0, m.t - m.pause);
    var p = m.move > 0 ? Math.min(1, moved / m.move) : 1;
    var e = p * p * (3 - 2 * p);
    if (m.a) { m.a.x = m.ax + (m.mx - m.ax) * e; m.a.y = m.ay + (m.my - m.ay) * e; }
    if (m.b) { m.b.x = m.bx + (m.mx - m.bx) * e; m.b.y = m.by + (m.my - m.by) * e; }
    if (m.t >= m.dur) completeBossMerge();
    return;
  }
  if (bossMerged) return;
  var cfg = bossConfig();
  if (!cfg || !cfg.merged) return;

  var a = null, b = null;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive || u.team !== 'B') continue;
    if (u.key === cfg.units[0]) a = u;
    else if (u.key === cfg.units[1]) b = u;
  }
  if (!a || !b) return;

  var lock = BALANCE.boss.lockHp == null ? 1 : BALANCE.boss.lockHp;
  if (a.hp > lock + 0.05 || b.hp > lock + 0.05) return;

  var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  var holdPause = BALANCE.boss.mergePause == null ? 0.55 : BALANCE.boss.mergePause;
  var holdSlide = BALANCE.boss.mergeSlide == null ? 0.45 : BALANCE.boss.mergeSlide;
  bossMergeAct = {
    a: a, b: b,
    ax: a.x, ay: a.y, bx: b.x, by: b.y,
    mx: mx, my: my,
    t: 0, pause: holdPause, move: holdSlide, dur: holdPause + holdSlide
  };
  // 停顿提示：两只身上同时亮一圈，然后开始互相吸引
  a.dashT = 0; b.dashT = 0;                 // 停手：清掉进行中的冲刺
  a.castT = 0; b.castT = 0; a.ultT = 0; b.ultT = 0;
  ring(a.x, a.y, a.r, a.r + 70, 0.5, '#ff9a6b');
  ring(b.x, b.y, b.r, b.r + 70, 0.5, '#8fd0ff');
  burst(a.x, a.y, 12, '#ffb08a', 180);
  burst(b.x, b.y, 12, '#9fd8ff', 180);
  floater(mx, my - 46, '红青锁血 · 停止行动', '#ffe08a', 15);
  if (typeof sfxPlay === 'function') sfxPlay('cast');
}

/* 阶段 2：原地合体 —— 残影 + 白光 + 紫环炸开，然后紫晶核心登场；
   核心初始只有 1 HP，靠 mergeFill 把血条「从 1 涨到 5000」（期间免伤）。 */
function completeBossMerge() {
  var m = bossMergeAct;
  var cfg = bossConfig();
  if (!m || !cfg) return;
  var a = m.a, b = m.b;
  bossMergeAct = null;
  bossMerged = true;

  bossMergeFx = {
    x: m.mx, y: m.my,
    ax: a.x, ay: a.y, bx: b.x, by: b.y,
    t: 0, dur: 1.15
  };
  a.alive = false;
  b.alive = false;
  for (var q = units.length - 1; q >= 0; q--) {
    if (units[q] === a || units[q] === b) units.splice(q, 1);
  }

  // 合体演出：白紫双环 + 大范围粒子 + 震屏（BOSS 战的核心高光）
  ring(m.mx, m.my, 10, 260, 0.75, '#c79bff');
  ring(m.mx, m.my, 8, 170, 0.55, '#ffffff');
  burst(m.mx, m.my, 44, '#d9bcff', 460);
  shake = Math.max(shake, 15);
  hitStop = Math.max(hitStop, 0.05);
  floater(m.mx, m.my - 44, '红青合体', '#ffe9ff', 20);

  var core = addUnit(cfg.merged, m.mx, m.my, 'B');
  core.roleIdx = 0;
  var fill = BALANCE.boss.mergeFill == null ? 1.2 : BALANCE.boss.mergeFill;
  core.hp = 1;                       // 血条起点 = 1
  core.st.mergeFill = fill;          // 剩余充能时间（>0 时免伤、不可移动）
  core.st.mergeFillRate = (core.maxHp - 1) / fill;
  core.st.rage = { phase: 'rage', since: t + fill };   // 充能完才开始提速
  core.st.appear = 0.9;              // 放大 → 正常 的浮现动画（见 drawBossBlock）
  faceInward(core);
  if (TYPES[core.key].onRageStart) TYPES[core.key].onRageStart(core);

  if (typeof sfxPlay === 'function') sfxPlay('rage');
  if (typeof bossCry === 'function') bossCry('红青合体 · 紫晶核心', '血条充能 · 狂暴降临');
  if (typeof rebuildRoster === 'function') rebuildRoster();
}

function updateBombs(dt) {
  for (var i = bombs.length - 1; i >= 0; i--) {
    var b = bombs[i];
    b.fuse -= dt;
    if (b.fuse > 0) continue;
    bombs.splice(i, 1);
    if (typeof sfxPlay === 'function') sfxPlay('bomb');

    ring(b.x, b.y, 6, b.radius, 0.42, '#ffb14d');
    ring(b.x, b.y, 3, b.radius * 0.55, 0.3, '#fff1c9');
    burst(b.x, b.y, 20, '#ffd166', 300);
    shake = Math.min(15, shake + 3.5);
    hitStop = Math.max(hitStop, 0.025);

    var hits = 0;
    for (var k = 0; k < units.length; k++) {
      var v = units[k];
      if (!v.alive || v.team === b.team) continue;
      if (Math.hypot(v.x - b.x, v.y - b.y) < b.radius + v.r) {
        hurt(v, b.dmg, b.owner);
        hits++;
      }
    }
    /* 普攻炸弹回能：按命中数给，但同一轮普攻共享 budget，
       避免 5 颗炸弹全中时充能速度翻倍 */
    if (hits > 0 && b.energy > 0 && b.owner) {
      var gain = b.energy * hits;
      if (b.budget) {
        gain = Math.min(gain, Math.max(0, b.budget.left));
        b.budget.left -= gain;
      }
      gainEnergy(b.owner, gain);
    }

    // 敌方种子同样被炸弹波及（半径 + 种子身位）
    for (var q = seeds.length - 1; q >= 0; q--) {
      var sd = seeds[q];
      if (sd.team === b.team) continue;
      if (Math.hypot(sd.x - b.x, sd.y - b.y) >= b.radius + sd.r) continue;
      hurtSeed(sd, b.dmg, b.owner);
      if (sd.hp <= 0) destroySeed(q, '种子被炸碎');
    }
  }
}

/* ============================================================
   野生狗奶：全域引导（百分比扣血 / 次数盾打断）
   ------------------------------------------------------------
   · 引导期间自身不可移动（speedOf 返回 0）、免疫伤害（hurt() 直接返回）
   · 每秒对「所有敌方单位 + 敌方召唤物（草的种子）」扣 6.6% 最大生命
   · 百分比扣血走 hurt()：会被护盾吸收、计入 dealt / taken、可触发死亡与羁绊
   · 不推人、不改 ang，符合匀速直线运动红线
   ============================================================ */
function isMilkChannel(u) {
  return !!(u && u.st && u.st.milkT > 0);
}

// 每次引导满 1 秒结算一次：敌方单位走 hurt()，敌方种子直接扣血（种子没有护盾 / 无敌）
function milkDrain(u, D) {
  var i, n = 0;
  for (i = 0; i < units.length; i++) if (units[i].alive && units[i].team !== u.team) n++;
  for (i = 0; i < seeds.length; i++) if (seeds[i].team !== u.team) n++;
  var mul = aoeScale(n);
  for (i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    hurt(v, v.maxHp * D.pctPerSec * mul, u, { pct: 1, dot: 1 });
  }
  for (i = seeds.length - 1; i >= 0; i--) {
    var s = seeds[i];
    if (s.team === u.team) continue;
    hurtSeed(s, s.maxHp * D.pctPerSec * mul, u, { pct: 1, dot: 1 });
    if (s.hp <= 0) destroySeed(i, '种子枯萎');
  }
}

// 打断护盾（128）打空：立即打断引导，CD 从 0 重新计（= 完整 8 秒），不进入新的引导
function interruptMilk(u) {
  u.st.milkT = 0;
  u.st.milkAcc = 0;
  u.st.shield = 0;
  u.cd = TYPES.milk.skill.cd;
  ring(u.x, u.y, u.r, u.r + 80, 0.55, '#ff9c6b');
  burst(u.x, u.y, 20, '#ffb4aa', 260);
  floater(u.x, u.y - u.r - 26, '引导被打断', '#ff8f7a', 14);
  shake = Math.max(shake, 4);
}

/* ============================================================
   铁砧：落点预警圆 → 延迟砸落
   ------------------------------------------------------------
   · 落点在生成瞬间锁定坐标（不跟随敌人），delay 秒后结算
   · 砸落时对圆内敌方一次性结算伤害：核心区全额、外圈 edgeMul
   · 伤害统一走 hurt()（护盾可吸收 / 无敌抖动免疫），与炸弹一致
   · 不推人、不改 ang，只做伤害与表现，符合匀速直线运动红线
   ============================================================ */
// cfg 可选：{ r, delay, dmg }，普攻 / 技能 / 终结技可以各用一套落点参数
function spawnAnvilMark(owner, x, y, cfg) {
  var C = TYPES.anvil.anvil;
  var r = (cfg && cfg.r) || C.markR;
  var delay = (cfg && cfg.delay) || C.delay;
  anvilMarks.push({
    x: x, y: y, r: r,
    t: delay, max: delay,
    dmg: (cfg && cfg.dmg) || C.dmg,
    team: owner.team, owner: owner
  });
  if (anvilMarks.length > ANVIL_MARK_MAX) {
    anvilMarks.splice(0, anvilMarks.length - ANVIL_MARK_MAX);
  }
}

function updateAnvilMarks(dt) {
  var C = TYPES.anvil.anvil;
  for (var i = anvilMarks.length - 1; i >= 0; i--) {
    var m = anvilMarks[i];
    m.t -= dt;
    if (m.t > 0) continue;
    anvilMarks.splice(i, 1);

    // 砸落表现：地面冲击环 + 碎石粒子（不改变任何单位的位置/朝向）
    ring(m.x, m.y, 10, m.r, 0.5, '#cfd9e8');
    ring(m.x, m.y, 5, m.r * 0.6, 0.3, '#ffffff');
    burst(m.x, m.y, 26, '#dfe8f4', 330);
    shake = Math.min(15, shake + 6);
    hitStop = Math.max(hitStop, 0.03);

    // 圆内敌人：最近的一个承受全额，其余只吃 splashMul（避免一次落点同时清场）
    // 伤害优先读该落点自己的 dmg（普攻 / 技能 / 终结技各不相同）
    var markDmg = m.dmg == null ? C.dmg : m.dmg;
    var hits = [];
    for (var k = 0; k < units.length; k++) {
      var v = units[k];
      if (!v.alive || v.team === m.team) continue;
      var d = Math.hypot(v.x - m.x, v.y - m.y);
      if (d > m.r + v.r * 0.5) continue;   // 圆外 + 半个身位都算没砸到
      hits.push({ v: v, d: d });
    }
    hits.sort(function (a, b) { return a.d - b.d; });
    for (var h = 0; h < hits.length; h++) {
      var dmg = markDmg;
      if (hits[h].d > m.r * C.coreRatio) dmg *= C.edgeMul;   // 边缘区减伤
      if (h > 0) dmg *= C.splashMul;                          // 非最近目标只吃溅射
      hurt(hits[h].v, dmg, m.owner);
    }

    // 敌方种子永远按"非最近目标"处理：只吃溅射（外圈再乘 edgeMul），不会顶掉单位的全额伤害
    for (var q = seeds.length - 1; q >= 0; q--) {
      var sd = seeds[q];
      if (sd.team === m.team) continue;
      var sdD = Math.hypot(sd.x - m.x, sd.y - m.y);
      if (sdD > m.r + sd.r * 0.5) continue;
      var sdDmg = markDmg * C.splashMul;
      if (sdD > m.r * C.coreRatio) sdDmg *= C.edgeMul;
      hurtSeed(sd, sdDmg, m.owner);
      if (sd.hp <= 0) destroySeed(q, '种子被砸碎');
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

function fireArrow(u, power, opts) {
  var base = power ? TYPES.bow.arrow.power : TYPES.bow.arrow.normal;
  var C = {
    speed: (opts && opts.speed) || base.speed,
    dmg: (opts && opts.dmg) || base.dmg,
    life: (opts && opts.life) || base.life,
    hitR: (opts && opts.hitR) || base.hitR
  };
  var aim = aimAngle(u, u.x, u.y, C.speed) + ((opts && opts.spread) || 0);
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

    // 箭矢也能命中敌方种子（种子是实体）；普通箭命中即消失，强化箭对每个种子只结算一次
    if (a.life > 0) {
      for (var q = seeds.length - 1; q >= 0; q--) {
        var sd = seeds[q];
        if (sd.team === a.team) continue;
        if (a.seedHit && a.seedHit.indexOf(sd) >= 0) continue;
        if (segDist(sd.x, sd.y, a.px, a.py, a.x, a.y) > sd.r + a.hitR) continue;

        a.seedHit = a.seedHit || [];
        a.seedHit.push(sd);
        hurtSeed(sd, a.dmg, a.owner);
        ring(sd.x, sd.y, 3, 24, 0.2, a.power ? '#ffd166' : '#c9f59b');
        burst(sd.x, sd.y, a.power ? 8 : 4, a.power ? '#ffd166' : '#b9e88a', 180);
        if (sd.hp <= 0) destroySeed(q, '种子被射落');
        if (!a.power) { a.life = 0; break; }
      }
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

  // 多目标衰减：先数当前踩在敌方冰面上的目标数（单位 + 种子），
  // 同一块地面效果不再按人数线性翻倍（1 个目标时保持原值）
  var iced = 0;
  for (i = 0; i < units.length; i++) {
    var iu = units[i];
    if (!iu.alive) continue;
    for (j = 0; j < icePatches.length; j++) {
      var ip = icePatches[j];
      if (ip.team === iu.team) continue;
      var idx2 = iu.x - ip.x, idy2 = iu.y - ip.y;
      var irr2 = ip.r + iu.r * 0.35;
      if (idx2 * idx2 + idy2 * idy2 <= irr2 * irr2) { iced++; break; }
    }
  }
  for (i = 0; i < seeds.length; i++) {
    var isd = seeds[i];
    for (j = 0; j < icePatches.length; j++) {
      var ip2 = icePatches[j];
      if (ip2.team === isd.team) continue;
      var sdx2 = isd.x - ip2.x, sdy2 = isd.y - ip2.y;
      var srr2 = ip2.r + isd.r * 0.35;
      if (sdx2 * sdx2 + sdy2 * sdy2 <= srr2 * srr2) { iced++; break; }
    }
  }
  var iceMul = aoeScale(iced);

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
      if (!v.boss) {   // BOSS 免疫减速；冰面 DoT 照常结算
        v.slowT = Math.max(v.slowT, C.slowTime);
        v.slowMul = Math.min(v.slowMul || 1, C.slowMul);
      }
      // 冰冻值（0 → 1）：在冰面上单调累积，满 1 秒结算一次伤害并清空重来，
      // 离开冰面按 dt 回落。这样 HUD 上的冰冻条是「一直往上长」的，
      // 而不是每秒在满/空之间来回跳（旧写法 -dt 再 +=1 会闪，实战几乎看不见）。
      v.iceTick += dt;
      if (v.iceTick >= C.dotInterval) {
        v.iceTick -= C.dotInterval;   // 每 dotInterval 秒一次
        hurt(v, C.dot * iceMul, src, { dot: 1 });
      }
    } else if (v.iceTick > 0) {
      // 离开冰面后缓慢恢复，避免"很久以前踩过一次，回来一下就掉血"
      v.iceTick = Math.max(0, v.iceTick - dt);
    }
  }

  // 种子同样会被敌方冰面侵蚀：判定口径与单位一致（半径 + 0.35 身位），每 dotInterval 秒扣 dot 点
  for (i = seeds.length - 1; i >= 0; i--) {
    var sd = seeds[i];
    var sdIce = false, sdSrc = null;
    for (j = 0; j < icePatches.length; j++) {
      var p2 = icePatches[j];
      if (p2.team === sd.team) continue;
      var sdx = sd.x - p2.x, sdy = sd.y - p2.y;
      var srr = p2.r + sd.r * 0.35;
      if (sdx * sdx + sdy * sdy <= srr * srr) { sdIce = true; sdSrc = p2.owner; break; }
    }
    if (sdIce) {
      sd.iceTick -= dt;
      if (sd.iceTick <= 0) {
        sd.iceTick += C.dotInterval;
        hurtSeed(sd, C.dot * iceMul, sdSrc, { dot: 1 });
      }
    } else if (sd.iceTick < C.dotInterval) {
      sd.iceTick = Math.min(C.dotInterval, sd.iceTick + dt);
    }
    if (sd.hp <= 0) destroySeed(i, '种子被冻碎');
  }
}

/* ============================================================
   水桶：涌泉水面（从圆心扩散 → 6 秒持续 → 2 秒淡出）
   ------------------------------------------------------------
   · 水面是**地面力场**：水面向圆心产生引力，越靠圆心拉力越大；
     每帧只按 g*dt 拖拽敌方**位置**，不修改 u.ang ——
     离开水面后仍按原方向继续直线滑行，符合"只有技能/撞墙才转向"的红线
   · **消散途中仍然生效**：引力、缺氧累积与掉血会一直持续到 hold+fade
     结束（水面被移除）为止，不是 hold 一结束就停
   · 缺氧值存在每个单位的 waterT / waterAcc 上（见 addUnit）：
     在水里累积到 wetThreshold 充满后，每满 dotInterval 秒扣 dotPct 最大生命；
     离开水面按 oxicDecay 缓慢回落
   · 百分比伤害走 hurt()：会被护盾吸收、计入 dealt / taken、可触发死亡与羁绊
   · 水只对敌方单位生效；不伤害种子、不推动己方
   ============================================================ */
function spawnWater(owner, x, y) {
  var C = TYPES.bucket.water;
  waters.push({
    x: x, y: y, r: C.r, age: 0,
    team: owner.team, owner: owner, phase: rand(0, TAU)
  });
  if (waters.length > WATER_MAX) waters.splice(0, waters.length - WATER_MAX);
}

// 当前可见半径：grow 秒内从 0 扩散到 r，随后保持（消退只淡透明度，不缩圈）
function waterRadius(w) {
  var C = TYPES.bucket.water;
  var k = clamp(w.age / C.grow, 0, 1);
  return w.r * (1 - (1 - k) * (1 - k));
}

function updateWaters(dt) {
  var C = TYPES.bucket.water;
  var i, j;

  // 1) 水面寿命：age >= hold+fade 时才移除；在此之前（含淡出中途）一直生效
  for (i = waters.length - 1; i >= 0; i--) {
    var w = waters[i];
    w.age += dt;
    if (w.age >= C.hold + C.fade) waters.splice(i, 1);
  }

  // 1b) 多目标衰减：先数当前站在任意敌方水面上的敌方单位数
  //     （1 个目标 = 原值；2 个目标每人 72%，合计 144%，不再线性翻倍）
  var wetFoes = 0;
  for (i = 0; i < units.length; i++) {
    var wu = units[i];
    if (!wu.alive) continue;
    for (j = 0; j < waters.length; j++) {
      var wp = waters[j];
      if (wp.team === wu.team) continue;
      var wrad = waterRadius(wp);
      var wd = Math.hypot(wu.x - wp.x, wu.y - wp.y);
      if (wd <= wrad + wu.r * 0.35) { wetFoes++; break; }
    }
  }
  var wetMul = aoeScale(wetFoes);

  // 2) 逐个敌方单位：找脚下的敌方水面（重叠只取最近圆心的一滩） → 引力 + 浸水
  for (i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) continue;

    var src = null, bestD = 1e9, rr = 0;
    for (j = 0; j < waters.length; j++) {
      var p = waters[j];
      if (p.team === u.team) continue;
      // 消散（fade）阶段仍然生效：引力、缺氧累积与掉血会一直持续到水面完全消失
      var rad = waterRadius(p);
      var d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d > rad + u.r * 0.35) continue;
      if (d < bestD) { bestD = d; src = p; rr = rad; }
    }

    if (!src) {
      // 离开水面：头顶的「缺氧」值缓慢回落（oxicDecay/s），再次入水会继续累积
      if (u.waterT > 0) u.waterT = Math.max(0, u.waterT - C.oxicDecay * dt);
      u.waterAcc = C.dotInterval;
      continue;
    }

    // 2a) 引力：边缘接近 0，越靠圆心越大。无敌抖动 / 狗奶引导 / BOSS 视为固定桩，不被拖拽
    if (!isShaking(u) && !isMilkChannel(u) && !u.boss && bestD > 0.5) {
      var g = C.gravity * Math.max(0, 1 - bestD / Math.max(1, rr)) * wetMul;
      if (g > 0) {
        u.x += (src.x - u.x) / bestD * g * dt;
        u.y += (src.y - u.y) / bestD * g * dt;
      }
      // 拖拽不能把单位推出墙外（撞墙转向仍由 move() 的 wallBounceAngle 负责）
      u.x = clamp(u.x, ARENA.x + u.r, ARENA.x + ARENA.w - u.r);
      u.y = clamp(u.y, ARENA.y + u.r, ARENA.y + ARENA.h - u.r);
    }

    // 2b) 缺氧值：在水里累积到 wetThreshold 充满；充满期间每满 dotInterval 秒扣一次
    u.waterT = Math.min(C.wetThreshold, u.waterT + dt);
    if (u.waterT >= C.wetThreshold) {
      u.waterAcc -= dt;
      while (u.waterAcc <= 0 && u.alive) {
        u.waterAcc += C.dotInterval;
        hurt(u, u.maxHp * C.dotPct * wetMul, src.owner, { pct: 1, dot: 1 });
      }
    } else {
      u.waterAcc = C.dotInterval;
    }
  }
}

/* ============================================================
   草：种子 / 藤蔓 / 在种子上复活
   ------------------------------------------------------------
   · plantSeed   在当前位置种一颗种子（160 HP、不移动、不挡路）
   · hurtSeed    种子唯一的受击入口：没有护盾 / 无敌，血量归零才消失
   · updateSeeds 普通贴身接触不再掉血；敌方技能冲刺撞到才算攻击，
                 同时每满 1 秒给 healRadius 内友军回复 8 HP（同队只留最新一颗，不叠加）
   · tryVine     向范围内最近的敌人伸藤蔓：定身 3s + 中毒 5s（每秒 12）
   · queueRevive 草阵亡时消耗一颗自己的种子，延迟 1s 原地复活
   ============================================================ */

// 种子受伤：统一入口。种子不参与 dealt 排行以外的单位结算，但伤害仍计入攻击方 dealt
// opt 口径与 hurt() 一致：{pct:1} 百分比不缩放；{dot:1} 持续伤害不逐跳飘字 / 爆粒子
function hurtSeed(s, amount, src, opt) {
  var cal = !!(src && TYPES[src.key] && TYPES[src.key].calibrated);
  if (!(opt && opt.pct) && !cal) amount *= BALANCE.dmgScale;
  if (!s || s.hp <= 0 || amount <= 0) return;
  var dot = !!(opt && opt.dot);
  s.hp -= amount;
  s.flash = 0.22;
  s.lastHit = t;
  if (src && typeof src.dealt === 'number') src.dealt += amount;
  if (!dot) {
    floater(s.x, s.y - s.r - 22, '-' + Math.round(amount), '#ffb1a0', 14, { pop: 1 });
    burst(s.x, s.y, 4, '#c8f5b0', 120);
  }
}

// 种子被摧毁（血量归零）：统一的表现 + 移除
function destroySeed(i, text) {
  var s = seeds[i];
  if (!s) return;
  burst(s.x, s.y, 18, '#9be36f', 230);
  ring(s.x, s.y, s.r, s.r + 42, 0.3, '#c8f5b0');
  floater(s.x, s.y - 16, text || '种子枯萎', '#c8f5b0', 12);
  seeds.splice(i, 1);
}

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
    team: u.team, owner: u, hitCd: 0, phase: rand(0, TAU),
    healAcc: 1.0, iceTick: 1.0, flash: 0, lastHit: -99
  });
  if (seeds.length > SEED_MAX) seeds.shift();

  ring(u.x, u.y, u.r, 96, 0.45, '#c8f5b0');
  burst(u.x, u.y, 14, '#bff5a0', 190);
  floater(u.x, u.y - u.r - 18, '生花 · 种子', '#c8f5b0', 13);
}

function updateSeeds(dt) {
  var S = TYPES.grass.seed;
  for (var i = seeds.length - 1; i >= 0; i--) {
    var s = seeds[i];
    s.hitCd = Math.max(0, s.hitCd - dt);
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);

    // 1) 只有「技能冲刺」撞到种子才算被攻击；普通贴身接触不再掉血（种子是独立血条实体）
    for (var j = 0; j < units.length; j++) {
      var v = units[j];
      if (!v.alive || v.team === s.team || v.dashT <= 0) continue;
      var reach = v.r + s.r;
      var ddx = v.x - s.x, ddy = v.y - s.y;
      if (ddx * ddx + ddy * ddy > reach * reach) continue;
      if (s.hitCd > 0) continue;
      s.hitCd = S.hitCd;
      hurtSeed(s, dmgOf(v, v.dashSpeed, s), v);
    }
    if (s.hp <= 0) { destroySeed(i, '种子被击碎'); continue; }

    // 2) 治疗光环：每满 1 秒给 healRadius 内「除自己以外」的友方单位回血
    //    多目标衰减：同时治疗 2 个友军时，每人只吃 aoeFalloff 倍的回复（不线性翻倍）
    s.healAcc += dt;
    if (s.healAcc >= 1.0) {
      s.healAcc -= 1.0;
      var targets = [];
      for (var k = 0; k < units.length; k++) {
        var a = units[k];
        if (!a.alive || a.team !== s.team) continue;
        if (a.hp >= a.maxHp) continue;
        var hx = a.x - s.x, hy = a.y - s.y;
        if (hx * hx + hy * hy > S.healRadius * S.healRadius) continue;
        targets.push(a);
      }
      var healMul = aoeScale(targets.length);
      for (var m = 0; m < targets.length; m++) {
        targets[m].hp = Math.min(targets[m].maxHp, targets[m].hp + S.healPerSec * healMul);
      }
      if (targets.length) {
        ring(s.x, s.y, s.r, S.healRadius, 0.5, 'rgba(140,224,106,.55)');
        floater(s.x, s.y - s.r - 30, '回春 +' + Math.round(S.healPerSec * healMul), '#8ce06a', 12);
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
  if (!best.boss) best.bindT = V.root;   // BOSS 免疫定身；中毒照常
  best.poisonT = V.poisonTime;
  best.poisonAcc = 1.0;      // 1 秒后第一次掉血
  best.poisonDps = V.poisonDps;
  best.poisonSrc = u;

  ring(best.x, best.y, best.r, 118, 0.45, '#8ce06a');
  floater(best.x, best.y - best.r - 18,
    best.boss ? '免疫定身 · 中毒' : ('捆绑 ' + V.root + 's'), '#9be36f', 13);
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
    if (typeof rebuildRoster === 'function') rebuildRoster();
  }
}

/* ============================================================
   场地收缩：每 5 秒左右各收 30px，最小宽度 SHRINK.minW
   ------------------------------------------------------------
   只改 ARENA.x / ARENA.w；move() 每帧读 ARENA 做边界钳制，
   所以落在新墙外的单位会在下一帧被推回场内并触发撞墙反弹。
   ============================================================ */
/* 开局场地大小随人数自适应：1v1 用更小的场地，避免大半个屏幕空着 */
function pickUnitCount() {
  var n = 0;
  ['A', 'B'].forEach(function (team) {
    var keys = pick[team] || [];
    for (var i = 0; i < keys.length; i++) {
      var c = POOL_BY_KEY[keys[i]];
      if (c) n += c.units.length;
    }
  });
  return n;
}

function arenaStartBox() {
  var n = pickUnitCount();
  var kw = n <= 3 ? 0.78 : (n <= 5 ? 0.9 : 1);
  var kh = n <= 3 ? 0.9 : 1;
  var w = Math.max(SHRINK.minW, Math.round(ARENA_FULL.w * kw));
  var h = Math.round(ARENA_FULL.h * kh);
  return {
    x: ARENA_FULL.x + (ARENA_FULL.w - w) / 2,
    y: ARENA_FULL.y + (ARENA_FULL.h - h) / 2,
    w: w,
    h: h
  };
}

function resetArena() {
  // BOSS 战固定全尺寸舞台（且整局不收缩），给 5 个挑战者足够的走位空间
  var a = bossMode ? ARENA_FULL : arenaStartBox();
  ARENA.x = a.x;
  ARENA.y = a.y;
  ARENA.w = a.w;
  ARENA.h = a.h;
}

// 持续收缩：每帧按 rate * dt 收窄，墙是"慢慢推过来"的，不是跳一下
function updateShrink(dt) {
  if (bossMode) return;   // BOSS 战舞台不收缩（否则 5v1 会被挤成一团）
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
  // 种子不移动，但会被新墙"推"回场内（不改任何状态；只有血量归零才会消失）
  for (var j = seeds.length - 1; j >= 0; j--) {
    var s = seeds[j];
    if (s.x < ARENA.x + s.r) s.x = ARENA.x + s.r;
    else if (s.x > ARENA.x + ARENA.w - s.r) s.x = ARENA.x + ARENA.w - s.r;
  }
}

/* 大狗激光：每 0.1 秒结算一次
   ------------------------------------------------------------
   光束 = 从狗当前位置沿"施放瞬间锁定"的方向射出的线段（长度 laser.len）。
   敌人的圆碰到线段就算被扫到，吃一段伤害；方向不追踪，靠走位躲。 */
function laserStrike(u, L) {
  var ex = u.x + Math.cos(u.st.laserAng) * L.len;
  var ey = u.y + Math.sin(u.st.laserAng) * L.len;
  var hitUnits = [], hitSeeds = [];
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (segDist(v.x, v.y, u.x, u.y, ex, ey) > L.width * 0.5 + v.r) continue;
    hitUnits.push(v);
  }
  for (var j = 0; j < seeds.length; j++) {
    var sd = seeds[j];
    if (sd.team === u.team) continue;
    if (segDist(sd.x, sd.y, u.x, u.y, ex, ey) > L.width * 0.5 + sd.r) continue;
    hitSeeds.push(sd);
  }
  // 多目标衰减：一道光束同时扫到多个目标时，每段伤害不再线性翻倍
  var mul = aoeScale(hitUnits.length + hitSeeds.length);
  for (var k = 0; k < hitUnits.length; k++) hurt(hitUnits[k], L.dmg * mul, u, { dot: 1 });
  for (var q = hitSeeds.length - 1; q >= 0; q--) {
    var s2 = hitSeeds[q];
    hurtSeed(s2, L.dmg * mul, u, { dot: 1 });
    if (s2.hp <= 0) {
      var at = seeds.indexOf(s2);
      if (at >= 0) destroySeed(at, '种子被激光烧毁');
    }
  }
}

function statusText() {
  var parts = [];
  if (bossMode && phase === 'fight') {
    if (!bossMerged) {
      // 合体停顿阶段（bossMergeAct）单独提示，避免读数还在跳
      if (bossMergeAct) parts.push('红青锁血完成 · 停手合体中');
      else {
        // 只有一只锁到 1 血时给出提示：另一只还差多少是这一阶段唯一的博弈点
        var a = null, b = null;
        for (var bi = 0; bi < units.length; bi++) {
          var bu = units[bi];
          if (!bu.alive || bu.team !== 'B') continue;
          if (bu.key === bossConfig().units[0]) a = bu;
          else if (bu.key === bossConfig().units[1]) b = bu;
        }
        var locked = (a && a.hp <= 1.05) && (b && b.hp <= 1.05);
        if (!locked) parts.push('BOSS 锁血：红青都要打到 1 HP 才会合体');
      }
    } else {
      var core = null;
      for (var ci = 0; ci < units.length; ci++) {
        if (units[ci].alive && units[ci].team === 'B' && units[ci].st.mergeFill > 0) core = units[ci];
      }
      if (core) parts.push('紫晶核心血条充能中 · 充能完才会动');
      else parts.push('紫晶核心狂暴中 · 击碎它即胜利');
    }
  }
  if (suddenDeath && phase === 'fight') {
    parts.push('决杀 · 全体每秒 -5% 最大生命（已 ' + Math.floor(t - suddenStart) + 's）');
  }
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    var R = u.st.rage;
    if (!u.alive) continue;
    // 野生狗奶：引导剩余时间 + 剩余打断护盾
    if (u.st.milkT > 0) {
      parts.push(u.name + ' 引导 ' + u.st.milkT.toFixed(1) + 's · 护盾 ' +
        Math.ceil(Math.max(0, u.st.shield)) + '/' + TYPES.milk.shieldMax);
    }
    if (u.ultT > 0) parts.push(u.name + ' 终结技蓄力 ' + u.ultT.toFixed(1) + 's');
    if (TYPES[u.key] && TYPES[u.key].bossLock && u.hp <= 1.05) {
      parts.push(u.name + ' 已锁 1 血 · 停手');
    }
    // 紫晶核心：终末震荡倒计时（最后 nukeWarn 秒开始报数）
    if (u.st.nukeT >= 0 && u.st.nukeT <= (BALANCE.boss.core.nukeWarn || 8)) {
      parts.push('终末震荡 ' + Math.ceil(u.st.nukeT) + 's');
    }
    // 水桶：头顶缺氧值（充满后每秒掉血），状态栏显示当前百分比
    if (u.waterT > 0) {
      parts.push(u.name + ' 缺氧 ' +
        Math.round(clamp(u.waterT / TYPES.bucket.water.wetThreshold, 0, 1) * 100) + '%');
    }
    if (!R) continue;
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
  if (typeof sfxPlay === 'function') sfxPlay('cast');

  // 远程技能声明 noTurn 时只瞄准、不改自身运动方向（方向仍只由撞墙 / 其他技能改变）
  if (!S.noTurn) u.ang = aim;   // 转向
  u.dashT = S.dashTime;        // 冲刺
  u.dashSpeed = S.dashSpeed;
  u.dmgMult = S.dmgMult;
  u.cd = S.cd;

  if (T.onCast) T.onCast(u);
}

/* ============================================================
   终结技：与普通技能完全独立的长冷却大招
   ------------------------------------------------------------
   · 每个物品在 TYPES[key].ultimate 里声明 name / cd / text / windup
   · think() 先判断终结技：CD 好了、有目标 → 0.4s 金色蓄力 → onUlt()
   · onUlt 只负责物品专属效果；通用的「连续突刺」与「瞬发光束」由下面的
     startUltChain / spawnUltBeam 提供
   · 终结技不消耗普通技能 CD；引导 / 定身 / 狂暴会中断蓄力
   ============================================================ */
function startUltChain(u, cfg) {
  u.st.ultChain = {
    left: cfg.count, count: cfg.count,
    time: cfg.dashTime, speed: cfg.dashSpeed, mul: cfg.dmgMult,
    interval: cfg.interval == null ? 0.16 : cfg.interval,
    gap: 0, label: cfg.label || '连击'
  };
}

// 连刺链：每次冲刺结束后间隔 interval 再锁定最近敌人冲一次，直到 count 段打完
function updateUltChains(dt) {
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    var c = u.st && u.st.ultChain;
    if (!c) continue;
    if (!u.alive || u.st.rage || u.st.milkT > 0) {
      u.st.ultChain = null;
      u.dmgMult = 1;
      continue;
    }
    if (u.dashT > 0) continue;          // 正在冲刺：等这一段结束再排下一段
    if (c.left <= 0) { u.st.ultChain = null; u.dmgMult = 1; continue; }
    c.gap -= dt;
    if (c.gap > 0) continue;

    var tgt = nearestEnemy(u);
    if (!tgt) { u.st.ultChain = null; u.dmgMult = 1; continue; }
    u.ang = Math.atan2(tgt.y - u.y, tgt.x - u.x);
    u.dashT = c.time;
    u.dashSpeed = c.speed;
    u.dmgMult = c.mul;
    c.left--;
    c.gap = c.interval;
    ring(u.x, u.y, u.r, u.r + 54, 0.22, '#ffe08a');
    burst(u.x, u.y, 7, '#fff0bd', 260);
    floater(u.x, u.y - u.r - 18,
      c.label + ' ' + (c.count - c.left) + '/' + c.count, '#ffe08a', 12);
  }
}

// 终结技光束：一次性画一条光柱并立即结算沿途敌人与敌方种子（不做持续追踪）
function spawnUltBeam(owner, ang, cfg) {
  var x2 = owner.x + Math.cos(ang) * cfg.len;
  var y2 = owner.y + Math.sin(ang) * cfg.len;
  var color = cfg.color || '#ffcf8a';
  var life = cfg.life || 0.45;
  ultBeams.push({
    x1: owner.x, y1: owner.y, x2: x2, y2: y2,
    life: life, max: life, color: color, width: cfg.width
  });
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === owner.team) continue;
    if (segDist(v.x, v.y, owner.x, owner.y, x2, y2) > cfg.width * 0.5 + v.r) continue;
    hurt(v, cfg.dmg, owner);
    burst(v.x, v.y, 8, color, 200);
  }
  for (var s = seeds.length - 1; s >= 0; s--) {
    var sd = seeds[s];
    if (sd.team === owner.team) continue;
    if (segDist(sd.x, sd.y, owner.x, owner.y, x2, y2) > cfg.width * 0.5 + sd.r) continue;
    hurtSeed(sd, cfg.dmg, owner);
    if (sd.hp <= 0) destroySeed(s, '种子被光束烧毁');
  }
}

function castUltimate(u) {
  var T = TYPES[u.key];
  var U = T.ultimate;
  if (!U) return;
  var aim = u.ultAim;
  /* 能量型终结技：放完清空能量；旧角色仍然重置 CD */
  if (u.energyMax) u.energy = 0; else u.ultCd = U.cd;
  u.ultT = 0;
  u.ultAim = null;
  if (typeof sfxPlay === 'function') sfxPlay('ult');
  ring(u.x, u.y, u.r + 4, u.r + 150, 0.55, '#ffe08a');
  ring(u.x, u.y, u.r + 4, u.r + 92, 0.4, '#fff6d8');
  burst(u.x, u.y, 26, '#ffe9a8', 330);
  floater(u.x, u.y - u.r - 38, '终结技 · ' + U.name, '#ffe08a', 16);
  shake = Math.max(shake, 6);
  hitStop = Math.max(hitStop, 0.03);
  if (T.onUlt) T.onUlt(u, aim);
}

function updateUltCasts(dt) {
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (u.ultT <= 0) continue;
    u.ultT -= dt;
    if (!u.alive || (u.st.rage && !TYPES[u.key].rageCasts) || u.st.milkT > 0 || u.bindT > 0) {
      u.ultT = 0; u.ultAim = null; continue;
    }
    if (u.ultT > 0) continue;
    castUltimate(u);
  }
}

/* ============================================================
   技能施放：CD 好了直接放，不做距离 / 角度 / 反应试探
   ------------------------------------------------------------
   2026-11-16：增加两层「可读性」改动
     · 冲刺型技能贴脸时不放（避免直接穿过敌人）
     · 所有主动技能有 0.16s 蓄力预警，锁定向目标点发射，给观众 0.16s 的反应时间
   ============================================================ */
function castAllowed(u, s) {
  var T = TYPES[u.key];
  var S = T.skill;
  if (S.passiveOnly) return false;
  if (S.dashTime > 0 && s.dist < 55) return false;   // 贴脸时冲刺没有意义，等拉开距离
  if (S.range && s.dist > S.range) return false;
  return true;
}

function think(u, dt) {
  if (!u.alive || u.dashT > 0) return;
  // 狂暴后通常不再施放技能；BOSS 合体核心声明 rageCasts 后仍然会放（紫晶脉冲 / 终结技）
  if (u.st.rage && !TYPES[u.key].rageCasts) return;
  if (u.castT > 0 || u.ultT > 0) return;
  if (u.st.ultChain && u.st.ultChain.left > 0) return;
  if (u.st.milkT > 0) return;   // 引导期间站桩，不施放任何技能
  if (u.st.mergeFill > 0) return;   // 紫晶核心血条充能中：不动、不打
  if (bossMergeAct && (bossMergeAct.a === u || bossMergeAct.b === u)) return;  // 合体前停手
  /* 一阶段锁血：打到 1 HP 的那一只原地停手（不移动也不攻击），等另一只 */
  var BT = TYPES[u.key];
  if (BT && BT.bossLock && u.hp <= (BALANCE.boss.lockHp == null ? 1 : BALANCE.boss.lockHp) + 0.05) {
    if (u.dashT > 0) u.dashT = 0;
    return;
  }
  // 被动型"技能"（冰块的寒冰轨迹）不需要主动施放，由 onTick 持续生效
  if (TYPES[u.key].skill.passiveOnly) return;

  var s = sense(u);
  if (!s.enemy) return;

  var T = TYPES[u.key];

  // 终结技优先：与普通技能 CD 互不影响，有目标且充满就进入金色蓄力
  // 被定身时不开始蓄力，避免蓄力→被中断→下一帧再蓄力的视觉刷屏
  var U = T.ultimate;
  if (U && ultReady(u) && u.bindT <= 0 && !(T.ultBlocked && T.ultBlocked(u))) {
    var uw = U.windup == null ? 0.4 : U.windup;
    u.ultT = Math.max(0.001, uw);
    u.ultCastMax = u.ultT;
    u.ultAim = { x: s.enemy.x, y: s.enemy.y };
    ring(u.x, u.y, u.r, u.r + 70, 0.35, '#ffe08a');
    floater(u.x, u.y - u.r - 26, '终结技蓄力', '#ffe08a', 12);
    return;
  }

  if (u.cd > 0) return;

  // 物品可以声明 canCast(u) 做"能用但暂时不能放"的判定（如：草已有种子时不能再种）
  if (T.canCast && !T.canCast(u)) return;
  if (!castAllowed(u, s)) return;

  var S = T.skill;
  var wind = (S.windup == null ? 0.16 : S.windup);
  if (wind <= 0) {
    cast(u, s.enemy);
    return;
  }
  // 锁定目标当前位置：蓄力期间目标可以走开，这就是"预警"带来的博弈
  u.castT = wind;
  u.castMax = wind;
  u.castAim = { x: s.enemy.x, y: s.enemy.y };
}

/* 蓄力计时：归零时才真正施放（方向点已锁定） */
function updateCasts(dt) {
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (u.castT <= 0) continue;
    u.castT -= dt;
    if (!u.alive || (u.st.rage && !TYPES[u.key].rageCasts)) { u.castT = 0; u.castAim = null; continue; }
    if (u.castT > 0) continue;
    var aim = u.castAim;
    u.castAim = null;
    if (aim) cast(u, aim);
  }
}

/* ============================================================
   匀速直线运动 + 撞墙随机转向
   ============================================================ */
/* 撞墙后按镜面反射，再叠加 ±15° 噪声。
   完全随机转向会让同一阵容的胜负过度依赖运气；镜面反射保留台球感，
   噪声只负责避免每局轨迹完全一样。 */
function wallBounceAngle(u, hx, hy) {
  var a = u.ang;
  if (hx) a = Math.PI - a;
  if (hy) a = -a;
  return a + srand(-0.26, 0.26);
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
      u.ang = wallBounceAngle(u, hx, hy);   // 镜面反射 + 小噪声，方向仍只由撞墙改变
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
        // 无敌抖动 / 野生狗奶引导 / BOSS：原地不动，只推另一方（BOSS 之间正常分离，避免两只叠在一起）
        var aFixed = isShaking(a) || isMilkChannel(a) || (a.boss && !b.boss);
        var bFixed = isShaking(b) || isMilkChannel(b) || (b.boss && !a.boss);
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
        // 等质量弹性碰撞：交换法线方向的速度分量，大小各自保持不变。
        // 引导中的野生狗奶视为"不可推动的桩"，只反弹对方，自己不改朝向。
        if (!isMilkChannel(a)) a.ang = Math.atan2(vay + rel * ny, vax + rel * nx);
        if (!isMilkChannel(b)) b.ang = Math.atan2(vby - rel * ny, vbx - rel * nx);
      }

      var impact = -rel;
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;

      if (impact < BALANCE.impactMin || a.hitCd > 0 || b.hitCd > 0) {
        if (impact > BALANCE.impactMin) burst(mx, my, 2, '#ffd8a8', 120);
        continue;
      }
      a.hitCd = BALANCE.hitCd;
      b.hitCd = BALANCE.hitCd;

      // da 是 a 承受的伤害（乘 b 的攻击力与倍率）；db 同理
      var da = dmgOf(b, impact, a);
      var db = dmgOf(a, impact, b);

      /* 先算伤害再决定表现：弓箭 / 冰块 / 铁砧 / 狗奶的普通撞击伤害恒为 0，
         过去这种「零伤害碰撞」也会放全套震屏 + 顿帧 + 粒子，看着像打中了却不掉血，
         而且双方每 0.34 秒落一次顿帧。只有真的结算出伤害才播打击特效。 */
      if (da + db > 0.01) {
        var col = impact > 320 ? '#fff1c9' : '#ffd8a8';
        ring(mx, my, 4, 34 + impact * 0.08, 0.28, col);
        burst(mx, my, 8, col, 200 + impact * 0.25);
        shake = Math.min(15, shake + impact * 0.02);
        hitStop = Math.max(hitStop, 0.045);
      }

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
  /* BOSS 模式：B 方只统计场上 BOSS 单位。
     合体前是红 3000 + 青 3000，合体后只剩紫晶核心 800 ——
     顶部的 BOSS 血条会随合体"重置"一次，读起来就是「打完一条又来一条」。 */
  if (bossMode && team === 'B') {
    for (var i2 = 0; i2 < units.length; i2++) {
      if (units[i2].team !== 'B') continue;
      cur += Math.max(0, units[i2].hp);
      max += units[i2].maxHp;
    }
    return { cur: cur, max: max };
  }
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

  // BOSS 模式：文案要直接说明「谁死了」——BOSS 战只有两种结局
  if (bossMode) {
    if (winner === 'A') sub = '紫晶核心被击碎 · BOSS 讨伐成功';
    else if (winner === 'B') sub = by === 'time' ? '时间到 · BOSS 仍然站立' : '玩家全员倒下 · BOSS 获胜';
  }

  if (by !== 'time' && A.cur <= 0 && B.cur <= 0) {
    var dA = dealtOf('A'), dB = dealtOf('B');
    winner = dA > dB ? 'A' : (dB > dA ? 'B' : 'draw');
    sub = (by === 'death' ? '决杀 · ' : '') + '同归于尽 · 总伤害 ' + Math.round(dA) + ' : ' + Math.round(dB);
  }

  /* 后台赔率模拟（第 83 条）：胜负已经算完，这里直接返回，
     不走横幅 / 赛事演出 / DOM，保证无渲染模拟不产生任何界面副作用 */
  if (typeof simHeadless !== 'undefined' && simHeadless) return;

  // 赛事模式：先播「放大 + 时缓 + 加分」演出，动画结束后才结算回赛程
  if (typeof tour !== 'undefined' && tour && tour.cur) {
    for (var ti = 0; ti < units.length; ti++) {
      if (units[ti].alive) ring(units[ti].x, units[ti].y, units[ti].r, 220, 0.7, units[ti].glow);
    }
    tourBeginFinishFx(winner);
    return;
  }

  // 手机端单机已不提供押注，这里不再做任何金币结算

  for (var i = 0; i < units.length; i++) {
    if (units[i].alive) ring(units[i].x, units[i].y, units[i].r, 220, 0.7, units[i].glow);
  }

  // 单机 / BOSS：先播一段慢镜头特写，结束后再弹结算横幅与结算页，
  // 避免大招 / 击杀瞬间直接跳出结算。
  endFx = { t: 0, dur: 1.5, focus: endFocusPoint(), winner: winner, sub: sub, by: by };
}

/* 终局特写聚焦点：优先最后阵亡的单位，其次存活方重心，最后场地中心 */
function endFocusPoint() {
  var sx = 0, sy = 0, n = 0, lastFall = null;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) lastFall = u;
    else { sx += u.x; sy += u.y; n++; }
  }
  if (lastFall) return { x: lastFall.x, y: lastFall.y };
  if (n) return { x: sx / n, y: sy / n };
  return { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h / 2 };
}

/* 终局特写演出结束：延迟到这里才出横幅与结算页 */
function endFxFinish() {
  if (!endFx) return;
  var snap = endFx;
  endFx = null;

  var title = snap.winner === 'draw' ? '平局' : (sideName(snap.winner) + ' 胜利');
  el.banner.querySelector('strong').textContent = title;
  el.banner.querySelector('em').textContent = snap.sub + ' · 按 R 再来一局 · Esc 返回主菜单';
  el.banner.classList.add('show');

  if (typeof sfxPlay === 'function') sfxPlay('win');
  if (typeof showResult === 'function') showResult(snap.winner, snap.sub, snap.by);
}

// 决杀阶段：每秒扣除全体存活单位 5% 最大生命，无视护盾与 3 秒无敌抖动
function deathStrike() {
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) continue;
    var loss = u.maxHp * DEATH_DRAIN;
    // BOSS 锁血同样对「决杀」生效：合体前每秒扣血最多扣到 1 HP
    if (TYPES[u.key] && TYPES[u.key].bossLock) {
      loss = Math.min(loss, Math.max(0, u.hp - (BALANCE.boss.lockHp == null ? 1 : BALANCE.boss.lockHp)));
    }
    if (loss <= 0) continue;
    u.hp = Math.max(0, u.hp - loss);
    u.flash = 1;
    floater(u.x + rand(-8, 8), u.y - u.r - 72, '-' + Math.round(loss), '#ff6b5a', 16, { pop: 1 });
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

  // 决杀同样侵蚀种子：每秒扣 5% 最大生命（160 HP 的种子每秒 -8）
  for (var s = seeds.length - 1; s >= 0; s--) {
    var sd = seeds[s];
    var sl = sd.maxHp * DEATH_DRAIN;
    sd.hp -= sl;
    floater(sd.x, sd.y - 14, '-' + Math.round(sl), '#ff8a6b', 13);
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
    if (typeof rebuildRoster === 'function') rebuildRoster();
    var role = POOL_BY_KEY[(pick[team] || [])[lineupIndex[team]]];
    if (role) {
      var ac = ARENA;
      floater(team === 'A' ? ac.x + 90 : ac.x + ac.w - 90, ac.y + ac.h / 2,
        teamLabel(team) + ' 换上 ' + role.name, team === 'A' ? '#ffb4aa' : '#b9cdff', 16);
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

  // 终末震荡镜头只允许在战斗中播放（计时由 50-ui 的 frame() 按真实时间推进）
  if (bossCine && phase !== 'fight') bossCine = null;
  if (typeof bossNukeFx !== 'undefined' && bossNukeFx && phase !== 'fight') bossNukeFx = null;

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
    u.ultCd = Math.max(0, (u.ultCd || 0) - dt);
    u.hitCd = Math.max(0, u.hitCd - dt);
    u.wallCd = Math.max(0, u.wallCd - dt);
    u.flash = Math.max(0, u.flash - dt * 5);
    if (u.slowT > 0) {
      u.slowT = Math.max(0, u.slowT - dt);
      if (u.slowT <= 0) u.slowMul = BALANCE.slowSpeedMul;   // 减速结束后恢复默认系数
    }
    // 捆绑：定身计时（速度由 speedOf 归零，方向不变）
    if (u.bindT > 0) u.bindT = Math.max(0, u.bindT - dt);
    // 虚弱：终末震荡留下的伤害减免计时
    if (u.weakT > 0) u.weakT = Math.max(0, u.weakT - dt);
    // 中毒：每满 1 秒结算一次，伤害走 hurt()（护盾可吸收）
    // 每秒伤害优先读该单位自己的 poisonDps（普攻 / 终结技 / 藤蔓各不相同）
    if (u.poisonT > 0 && u.alive) {
      u.poisonT = Math.max(0, u.poisonT - dt);
      u.poisonAcc -= dt;
      while (u.poisonAcc <= 0 && u.alive) {
        u.poisonAcc += 1.0;
        hurt(u, u.poisonDps || TYPES.grass.vine.poisonDps, u.poisonSrc, { dot: 1 });
      }
      if (u.poisonT <= 0) { u.poisonSrc = null; u.poisonDps = 0; }
    }
    /* 持续伤害汇总：冰面 / 中毒 / 浸水 / 狗奶引导 / 激光段伤都只累加不逐跳表现，
       每满 1 秒把这一秒的合计显示成一条小飘字（不爆粒子、不播音效），
       6v6 同时中多种 DoT 时也不会把特效池打满、挡住血条 */
    if (u.dotT > 0) {
      u.dotT -= dt;
      if (u.dotT <= 0) {
        if (u.dotAmt > 0) floater(u.x, u.y - u.r - 72, '-' + Math.round(u.dotAmt), '#ffb199', 16, { pop: 1 });
        u.dotAmt = 0;
        u.dotT = 0;
      }
    }
    if (u.st.shieldT > 0) {
      u.st.shieldT -= dt;
      if (u.st.shieldT <= 0) u.st.shield = 0;
    }
    // BOSS 锁血提示的冷却（避免每 0.34 秒一次接触刷一屏"锁血"）
    if (u.st.lockFxT > 0) u.st.lockFxT = Math.max(0, u.st.lockFxT - dt);
    if (u.alive) updateRage(u, dt);
  }

  // 物品自己的每帧被动（青金石光环）
  for (var p = 0; p < units.length; p++) {
    var pu = units[p];
    if (!pu.alive) continue;
    var PT = TYPES[pu.key];
    /* 被动回能：新体系角色按 energyRegen 每秒攒能量（旧角色没有这个字段，完全不受影响） */
    if (PT.energyRegen) gainEnergy(pu, PT.energyRegen * dt);
    if (PT.onTick) PT.onTick(pu, dt);
  }

  updateUltCasts(dt); // 终结技蓄力结算
  updateCasts(dt);    // 先结算蓄力，再让 CD 好的单位开始新的蓄力
  for (var a = 0; a < units.length; a++) think(units[a], dt);
  updateUltChains(dt); // 连刺链在移动前启动下一段冲刺
  for (var b = 0; b < units.length; b++) if (units[b].alive) move(units[b], dt);

  updateWaters(dt);   // 水桶力场：拖拽位置 + 浸水百分比伤害（不改 ang）
  collide();
  updateBombs(dt);
  updateAnvilMarks(dt);
  updateArrows(dt);
  updateIcePatches(dt);
  updateSeeds(dt);
  updateVines(dt);
  updateRevive(dt);
  updateShrink(dt);
  updateBossMerge(dt);   // 红青锁血 → 停顿 → 合体 → 核心血条充能（必须在 checkOver 之前）
  // 合体演出的计时器（纯画面层）
  if (bossMergeFx) {
    bossMergeFx.t += dt;
    if (bossMergeFx.t >= bossMergeFx.dur) bossMergeFx = null;
  }
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
  for (i = ultBeams.length - 1; i >= 0; i--) {
    ultBeams[i].life -= dt;
    if (ultBeams[i].life <= 0) ultBeams.splice(i, 1);
  }
  for (i = floaters.length - 1; i >= 0; i--) {
    var f = floaters[i];
    f.life -= dt;
    if (f.life <= 0) { floaters.splice(i, 1); continue; }
    f.y += f.vy * dt;
    f.vy *= Math.exp(-1.6 * dt);
  }
  // 终末震荡大招演出：推进碎片与总时长
  if (typeof bossNukeFx !== 'undefined' && bossNukeFx) {
    bossNukeFx.t += dt;
    for (i = bossNukeFx.shards.length - 1; i >= 0; i--) {
      var sh = bossNukeFx.shards[i];
      sh.life -= dt;
      if (sh.life <= 0) { bossNukeFx.shards.splice(i, 1); continue; }
      sh.vy += 260 * dt;
      sh.vx *= Math.exp(-1.8 * dt);
      sh.vy *= Math.exp(-0.6 * dt);
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.rot += sh.vr * dt;
    }
    if (bossNukeFx.t >= bossNukeFx.dur) bossNukeFx = null;
  }
  shake *= Math.exp(-7 * dt);
  if (shake < 0.05) shake = 0;
}




