/* ============================================================
   30-sim.js —— 一局对战的全部规则
   特效原语 · 伤害与护盾 · 羁绊狂暴与炸弹 · 箭矢 · 冰面
   技能施放与决策 · 匀速直线运动 · 弹性碰撞 · 回合判定 · tick()
   ============================================================ */
'use strict';

var damageTagWarned = false;   // 首条未分类伤害只告警一次，避免刷屏

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
   · 伤害分类（所有实际伤害必须至少携带一种）：
     opt = { basic: 1 }  普攻伤害
     opt = { skill: 1 }  技能伤害
     opt = { ult: 1 }    终结技伤害
     opt = { dot: 1 }    持续伤害
     分类标记回答“伤害从哪来”；同一段伤害可同时是技能 + dot。
   · opt = { pct: 1 }  —— 按最大生命计算的百分比伤害，不乘全局倍率 / 食物攻击
   · opt = { periodic: 1 } —— 周期跳伤（冰面 / 中毒 / 浸水 / 狗奶引导）：
                        不播音效、不爆粒子、不逐跳飘字，改为每满 1 秒汇总一条小飘字
   · opt = { multi: 1 } —— 多段激光（大狗终结技）：每段单独飘字、不合并、不播命中音效
   · 其余（撞击 / 箭矢 / 落点 / 炸弹 / 终结技 / 种子被撞）都走绝对值口径，
     统一乘 BALANCE.dmgScale —— 保证「生命上限整体上调」时所有固定伤害同步放大 */
function hurt(u, amount, src, opt) {
  var pct = !!(opt && opt.pct);
  var dot = !!(opt && opt.dot);
  var periodic = !!(opt && opt.periodic);
  if (amount > 0 && !(opt && (opt.basic || opt.skill || opt.ult || opt.dot)) && !damageTagWarned) {
    damageTagWarned = true;
    if (typeof console !== 'undefined') console.warn('[hurt] 未分类伤害：所有实际伤害必须带 basic / skill / ult / dot');
  }
  /* multi：多段激光的每一段都单独飘字（不合并、不播命中音效），用于大狗终结技 */
  var multi = !!(opt && opt.multi);
  /* 新数值体系（红青组合）标记 calibrated：伤害已按 2000 HP 口径校准，
     不再乘 dmgScale；旧角色没有这个标记，行为完全不变。
     opt.cal：自伤 / 反噬这类没有施放者的伤害，也能声明「已校准」。 */
  var cal = !!(src && TYPES[src.key] && TYPES[src.key].calibrated) || !!(opt && opt.cal);
  /* 虚弱（终末震荡）：出手方 10 秒内普攻 / 技能 / 终结技伤害 -20% */
  if (src && src.weakT > 0) amount *= (src.weakMul || 0.8);
  /* 场地食物：攻击增益只放大非百分比伤害（与 1v1 solo.dmgMul 同口径） */
  if (!pct && src && src.field && src.field.atkT > 0) amount *= src.field.atkMul;
  /* 场地食物：承伤减免对所有伤害类型生效 */
  if (u.field && u.field.takenT > 0) amount *= u.field.takenMul;
  /* 恶劣环境（血月）：全场承伤倍率 */
  if (u.field && u.field.envTakenMul) amount *= u.field.envTakenMul;
  /* 脆弱（冰块终结技）：受到的所有类型伤害 +20%，只刷新时间、不叠乘 */
  if (u.vulnT > 0) amount *= (u.vulnMul || 1.2);
  /* 青金石狂暴天赋：受到的普通攻击伤害按 rage.basicTakenMul 缩放（0.4 = -60%） */
  if (opt && opt.basic && u.st && u.st.rage && u.st.rage.phase === 'rage') {
    var RT = TYPES[u.key];
    if (RT && RT.rage && RT.rage.basicTakenMul != null) amount *= RT.rage.basicTakenMul;
  }
  /* 物品自身的分类承伤减免（咕咕嘎嘎：技能 -10% / 终结技 -20%）。
     只按伤害分类标记生效，普攻与 DoT 不减免；与脆弱的 +20% 是两个独立乘区。
     opt.self（自伤 / 反噬）不吃自己的减免，避免「反噬越打越轻」。 */
  var DTR = TYPES[u.key] && TYPES[u.key].takenReduce;
  if (DTR && opt && !opt.self) {
    if (opt.skill && DTR.skill) amount *= 1 - DTR.skill;
    if (opt.ult && DTR.ult) amount *= 1 - DTR.ult;
  }
  /* 防御减伤：比值式 DEF/(DEF+defK)，边际递减、永远不为负。def=0 的旧角色跳过。 */
  if (u.def > 0) amount *= BALANCE.defK / (BALANCE.defK + u.def);
  // 1v1 单挑修正：按「出手方」缩放全部非百分比伤害（含箭矢 / 激光等固定伤害技能）
  // 百分比伤害（狗奶 / 缺氧 / 决杀）不缩放，避免二次放大
  if (!pct && src && soloMode()) amount *= (BALANCE.solo.dmgMul[src.key] || 1);
  if (pct && src && soloMode()) amount *= (BALANCE.solo.pctMul[src.key] || 1);
  /* BOSS 出手不做额外难度缩放：技能系数就是最终数值。
     仅保留挑战者侧与全局伤害口径，不再存在 BOSS 总出手倍率。 */
  if (!pct && !cal) amount *= BALANCE.dmgScale;
  /* BOSS 硬壳：非百分比伤害再乘一层 dmgTakeMul。
     8 倍血量的 BOSS 如果按常规 DPS 结算，5 个玩家 35 秒就能把它打到合体；
     这一层把 TTK 拉长到 1 分钟左右（百分比伤害不受影响）。 */
  if (!pct && u.boss && BALANCE.boss.dmgTakeMul) amount *= BALANCE.boss.dmgTakeMul;
  /* BOSS 对「百分比伤害」（狗奶领域 / 缺氧 / 决杀）另设一层抗性：
     否则野生狗奶一人每秒 7% 最大生命，两个狗奶几秒就能把 BOSS 打到锁血，
     BOSS 战直接变成"开局 10 秒合体"。这里只压外部百分比伤害，决杀不走这条路径。 */
  if (pct && u.boss && BALANCE.boss.pctTakeMul) amount *= BALANCE.boss.pctTakeMul;
  if (!u.alive || amount <= 0) return;
  /* 合体演出期间的免伤：①两只锁到 1 血后先停顿 0.7 秒（不可打断），
     ②紫晶核心登场后血条从 1 涨到满（mergeFill），充能完才可被击伤。 */
  if (u.st && u.st.mergeFill > 0) return;
  if (u.st && u.st.phaseShift > 0) return;   // 双血 BOSS 转阶段：锁血演出期间免伤
  if (bossMergeAct && (bossMergeAct.a === u || bossMergeAct.b === u)) return;
  if (!periodic && !multi && typeof sfxPlay === 'function') sfxPlay('hit');

  // 野生狗奶：领域期间受击先扣「打断护盾」（500 点）；护盾存在时不掉血，打空立即中断
  if (u.st && u.st.milkT > 0) {
    var absorbed = Math.min(u.st.shield, amount);
    u.st.shield -= absorbed;
    u.taken += absorbed;     // 只记录真正被护盾吸收的部分；超出护盾的溢出不会落到 HP，也不计入承伤
    if (!periodic && !multi) {
      floater(u.x, u.y - u.r - 12, '护盾 ' + Math.ceil(Math.max(0, u.st.shield)), '#93b6ff', 12);
      ring(u.x, u.y, u.r + 4, u.r + 30, 0.2, '#93b6ff');
    }
    if (u.st.shield <= 0.01) { u.st.shield = 0; interruptMilk(u); }
    return;
  }

  // 羁绊狂暴前的 3 秒：原地无敌
  if (u.st.rage && u.st.rage.phase === 'shake') {
    if (!periodic && !multi) floater(u.x, u.y - u.r - 14, '无敌', '#ffe08a', 12);
    return;
  }

  /* 物品自身的「完全吸收」（咕咕嘎嘎：终结技蓄力 / 被控期间）：
     返回 true 表示这一下完全不掉血，吸收量由物品自己记账（不进 u.taken）。 */
  var ABS = TYPES[u.key];
  if (ABS && ABS.onAbsorb && ABS.onAbsorb(u, amount, src, opt)) {
    if (!periodic && !multi) floater(u.x, u.y - u.r - 12, '吸收 ' + Math.round(amount), '#ffd166', 12);
    return;
  }

  // 承伤统计：在被护盾吸收之前记，代表"这个单位实际挨了多少"
  u.taken = (u.taken || 0) + amount;

  if (u.st.shield > 0) {
    var absorbed2 = Math.min(u.st.shield, amount);
    u.st.shield -= absorbed2;
    amount -= absorbed2;
    if (absorbed2 > 0 && !periodic && !multi) floater(u.x, u.y - u.r - 12, '吸收 ' + Math.round(absorbed2), '#93b6ff', 12);
    if (u.st.shield <= 0.01) {
      u.st.shield = 0; u.st.shieldT = 0;
      ring(u.x, u.y, u.r, 128, 0.45, '#8fb4ff');
      burst(u.x, u.y, 14, '#9cc0ff', 220);
    }
  }

  if (amount > 0) {
    var incoming = amount;
    /* BOSS 锁血：合体前的红青双血条不会降到 1 以下（TYPES[key].bossLock）。
       截断后剩余量不再计入承伤，避免锁血阶段把“未实际损失的伤害”也算进去。 */
    if (TYPES[u.key] && TYPES[u.key].bossLock) {
      var lockCap = Math.max(0, (BALANCE.boss.lockHp == null ? 1 : BALANCE.boss.lockHp) - 0);
      var canLose = Math.max(0, u.hp - lockCap);
      if (amount > canLose) {
        amount = canLose;
        u.st.locked = true;   // 锁血后不再被敌人锁定（铁砧等指向性技能会跳过）
        if (!periodic && !multi && !(u.st.lockFxT > 0)) {
          u.st.lockFxT = 0.8;
          ring(u.x, u.y, u.r, u.r + 52, 0.45, '#ffe08a');
          floater(u.x, u.y - u.r - 30, '锁血 ' + lockCap + ' HP', '#ffe08a', 13);
        }
      }
    }
    if (amount <= 0) {
      u.taken = Math.max(0, u.taken - incoming);
      return;
    }

    /* 溢出伤害：伤害统计与飘字都只记录实际扣除的 HP。
       目标只剩 10 HP 时，83.3 点伤害只记 10，不再把 73.3 计入 dealt / taken。 */
    var hpBefore = Math.max(0, u.hp);
    var actualHpLoss = Math.min(amount, hpBefore);
    u.hp -= amount;
    if (src) src.dealt += actualHpLoss;
    u.taken = Math.max(0, u.taken - (incoming - actualHpLoss));

    if (periodic && !multi) {
      // 周期持续伤害不逐跳表现：累加到 dotAmt，由 tick() 每秒合并成一条小飘字
      u.dotAmt = (u.dotAmt || 0) + actualHpLoss;
      if (!(u.dotT > 0)) u.dotT = 1.0;
      if (u.flash < 0.25) u.flash = 0.25;
    } else if (multi) {
      // 多段激光：每一段都单独飘字，位置贴近目标，避免数字飞得太高
      u.flash = Math.max(u.flash, 0.35);
      floater(u.x + rand(-14, 14), u.y - u.r - 34 + rand(-5, 5),
        '-' + Math.round(actualHpLoss), '#ffd166', 16, { pop: 1 });
      burst(u.x, u.y, 4, '#fff4d6', 150);
      shake = Math.min(8, shake + 0.4);   // 每段都有一点震感
    } else {
      u.flash = 1;
      floater(u.x + rand(-9, 9), u.y - u.r - 72, '-' + Math.round(actualHpLoss), '#ffd166', 22, { pop: 1 });
      burst(u.x, u.y, 7, '#ffb199', 170);
    }
  }

  if (u.hp <= 0) {
    /* 双血 BOSS：第一条血打空时先走 onLethal 转阶段（锁 1 血、免伤），不当成死亡。
       返回 true 表示「已接管这次致命伤害」，hurt 不再继续走死亡流程。 */
    var LT = TYPES[u.key];
    if (LT && LT.onLethal && LT.onLethal(u)) return;

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
  // 大狗：死亡立刻收回终结技激光，否则 onTick 不再跑、ultLaserT 永远 > 0，光束会一直挂在场上
  if (u.st && u.st.ultLaserT > 0) u.st.ultLaserT = 0;   // 死亡立刻收回

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
   { fuse, radius, dmg, basic|skill|ult }，可选 { energy, budget } 用于命中回能；
   { touch:1 } 让敌方触碰立即引爆，{ burn:n } 让命中者叠 n 层灼烧 */
function spawnBomb(owner, x, y, cfg) {
  bombs.push({
    x: x, y: y,
    fuse: cfg.fuse, max: cfg.fuse,
    radius: cfg.radius, dmg: cfg.dmg,
    energy: cfg.energy || 0, budget: cfg.budget || null,
    basic: !!cfg.basic, skill: !!cfg.skill, ult: !!cfg.ult,
    touch: !!cfg.touch, burn: cfg.burn || 0,
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
    /* 普攻炸弹 / 声明 touch 的炸弹：敌方触碰立即引爆（引信置 0，本帧结算） */
    if (b.basic || b.touch) {
      for (var c = 0; c < units.length; c++) {
        var cu = units[c];
        if (!cu.alive || cu.team === b.team) continue;
        if (Math.hypot(cu.x - b.x, cu.y - b.y) < cu.r + 12) { b.fuse = 0; break; }
      }
    }
    b.fuse -= dt;
    if (b.fuse > 0) continue;
    bombs.splice(i, 1);
    if (typeof sfxPlay === 'function') sfxPlay('bomb');

    ring(b.x, b.y, 6, b.radius, 0.42, '#ffb14d');
    ring(b.x, b.y, 3, b.radius * 0.55, 0.3, '#fff1c9');
    burst(b.x, b.y, 20, '#ffd166', 300);
    /* 2026-11-22 用户口径：炸弹连续引爆时不再震屏（红石普攻 5 颗 / 0.4s 一轮会晃到看不清），
       只保留冲击环与粒子，命中反馈交给飘字与爆炸圆环。 */
    hitStop = Math.max(hitStop, 0.025);

    var hits = 0;
    var bombOpt = b.basic ? { basic: 1 } : (b.skill ? { skill: 1 } : (b.ult ? { ult: 1 } : null));
    for (var k = 0; k < units.length; k++) {
      var v = units[k];
      if (!v.alive || v.team === b.team) continue;
      if (Math.hypot(v.x - b.x, v.y - b.y) < b.radius + v.r) {
        hurt(v, b.dmg, b.owner, bombOpt);
        /* 命中灼烧：普攻炸弹默认 1 层，BOSS 二阶段炸弹由 burn 显式声明 */
        var burnN = b.burn || (b.basic ? 1 : 0);
        if (burnN > 0 && v.alive) redApplyBurn(v, b.owner, burnN);
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
      hurtSeed(sd, b.dmg, b.owner, bombOpt);
      if (sd.hp <= 0) destroySeed(q, '种子被炸碎');
    }
  }
}

/* ============================================================
   野生狗奶：奶狗领域（百分比扣血 / 护盾打断）
   ------------------------------------------------------------
   · 领域期间自身不可移动（speedOf 返回 0）、HP 无敌（hurt() 只扣护盾）
   · 每秒对「所有敌方单位 + 敌方召唤物（草的种子）」扣 7% 最大生命
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
    hurt(v, v.maxHp * D.pctPerSec * mul, u, { ult: 1, pct: 1, dot: 1, periodic: 1 });
  }
  for (i = seeds.length - 1; i >= 0; i--) {
    var s = seeds[i];
    if (s.team === u.team) continue;
    hurtSeed(s, s.maxHp * D.pctPerSec * mul, u, { ult: 1, pct: 1, dot: 1, periodic: 1 });
    if (s.hp <= 0) destroySeed(i, '种子枯萎');
  }
}

// 护盾（500）打空：领域立即中断，终结技冷却重新读满 12 秒，不会马上再展开
function interruptMilk(u) {
  u.st.milkT = 0;
  u.st.milkAcc = 0;
  u.st.shield = 0;
  u.st.shieldT = 0;
  u.ultCd = TYPES.milk.ultimate.cd;
  ring(u.x, u.y, u.r, u.r + 80, 0.55, '#ff9c6b');
  burst(u.x, u.y, 20, '#ffb4aa', 260);
  floater(u.x, u.y - u.r - 26, '领域破碎', '#ff8f7a', 14);
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
// cfg 可选：{ r, delay, dmg, energy, bindChance, bindTime, tier, forge }
// 普攻 / 技能 / 终结技可以各用一套落点参数
// tier：'' 普攻 | 'rain' 砧雨小砧 | 'giant' 天陨巨砧 | 'ult' 陨铁巨砧（决定砸落特效档位）
// forge：{ r, life } 砸落处展开熔铁领域（写在 owner.st.forge，逻辑见 updateAnvilForges）
function spawnAnvilMark(owner, x, y, cfg) {
  var C = TYPES.anvil.anvil;
  var r = (cfg && cfg.r) || C.markR;
  var delay = (cfg && cfg.delay) || C.delay;
  anvilMarks.push({
    x: x, y: y, r: r,
    t: delay, max: delay,
    dmg: (cfg && cfg.dmg != null) ? cfg.dmg : C.dmg,
    basic: !!(cfg && cfg.basic),
    skill: !!(cfg && cfg.skill),
    ult: !!(cfg && cfg.ult),
    tier: (cfg && cfg.tier) || '',
    forge: (cfg && cfg.forge) || null,
    energy: (cfg && cfg.energy) || 0,
    bindChance: (cfg && cfg.bindChance) || 0,
    bindTime: (cfg && cfg.bindTime) || 0,
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

    // 砸落表现按落点档位分级（不改变任何单位的位置/朝向）
    // 普攻 / 砧雨保持轻震（2026-11-22 用户口径：八连时不再叠到满屏晃）；
    // 天陨巨砧 / 陨铁巨砧是低频重击，允许更强的冲击环、粒子与震屏
    if (m.tier === 'ult') {
      /* FX-E：陨铁巨砧命中（外圈冲击波 + 熔金三环 + 白闪 / 三 burst / 强震屏 / 顿帧） */
      ring(m.x, m.y, 18, m.r * 1.6, 0.75, '#ff9a4d');
      ring(m.x, m.y, 12, m.r * 1.25, 0.6, '#ff9a4d');
      ring(m.x, m.y, 8, m.r * 0.85, 0.45, '#ffd9a0');
      ring(m.x, m.y, 4, m.r * 0.45, 0.28, '#fff6e0');
      ring(m.x, m.y, 2, m.r * 0.25, 0.16, '#ffffff');
      burst(m.x, m.y, 34, '#ffc06b', 420);
      burst(m.x, m.y, 14, '#ff7a3d', 300);
      burst(m.x, m.y, 10, '#fff1cf', 360);
      shake = Math.min(9, shake + 4.5);
      hitStop = Math.max(hitStop, 0.07);
    } else if (m.tier === 'giant') {
      /* FX-D：天陨巨砧命中（冷钢蓝冲击波 / 金环 / 白闪 / 震屏） */
      ring(m.x, m.y, 16, m.r * 1.5, 0.7, '#9fc0ff');
      ring(m.x, m.y, 12, m.r * 1.2, 0.55, '#cfe0ff');
      ring(m.x, m.y, 8, m.r * 0.8, 0.4, '#ffd28a');
      ring(m.x, m.y, 4, m.r * 0.4, 0.26, '#ffffff');
      burst(m.x, m.y, 30, '#e8f2ff', 390);
      burst(m.x, m.y, 10, '#9fc0ff', 260);
      burst(m.x, m.y, 8, '#ffd28a', 240);
      shake = Math.min(8, shake + 3.5);
      hitStop = Math.max(hitStop, 0.05);
    } else {
      /* FX-C：普攻 / 砧雨小砧命中（轻冲击环 + 白闪 + 钢火粒子 + 轻震屏） */
      ring(m.x, m.y, 10, m.r, 0.5, '#cfd9e8');
      ring(m.x, m.y, 5, m.r * 0.6, 0.3, '#ffffff');
      ring(m.x, m.y, 2, m.r * 0.3, 0.18, '#fff6e0');
      burst(m.x, m.y, 26, '#dfe8f4', 330);
      burst(m.x, m.y, 8, '#ffd9a0', 220);
      shake = Math.min(6, shake + 1.6);
      hitStop = Math.max(hitStop, 0.03);
    }

    // 陨铁巨砧附带熔铁领域：落地即展开，之后由 updateAnvilForges 全局推进；
    // 本体阵亡也不会提前消失（acc 从 0 起，落地当帧结算首跳）
    if (m.forge && m.owner && m.owner.st) {
      m.owner.st.forge = {
        x: m.x, y: m.y, r: m.forge.r,
        t: m.forge.life, max: m.forge.life, acc: 0
      };
      /* FX-H：领域展开的登场双环 / 火星 / 飘字（持续视觉见 40-render drawForgeZones） */
      ring(m.x, m.y, 20, m.forge.r, 0.6, '#ffb066');
      ring(m.x, m.y, 8, m.forge.r * 0.55, 0.4, '#ffd9a0');
      burst(m.x, m.y, 16, '#ffc06b', 260);
      floater(m.x, m.y - 44, '熔铁领域', '#ffc46b', 13);
    }

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
    var markOpt = m.basic ? { basic: 1 } : (m.skill ? { skill: 1 } : (m.ult ? { ult: 1 } : null));
    for (var h = 0; h < hits.length; h++) {
      var dmg = markDmg;
      if (hits[h].d > m.r * C.coreRatio) dmg *= C.edgeMul;   // 边缘区减伤
      if (h > 0) dmg *= C.splashMul;                          // 非最近目标只吃溅射
      hurt(hits[h].v, dmg, m.owner, markOpt);
    }

    /* 命中回能：一个落点只结算一次（多目标不翻倍），与红石炸弹的 budget 口径一致 */
    if (hits.length > 0 && m.energy > 0) gainEnergy(m.owner, m.energy);

    /* 普攻定身：30% 概率（用 srand，影响胜负的随机必须可复现）；BOSS 免疫控制 */
    if (hits.length > 0 && m.bindChance > 0 && m.bindTime > 0) {
      for (var hb = 0; hb < hits.length; hb++) {
        var bv = hits[hb].v;
        if (!bv.alive || bv.boss) continue;
        if (srand(0, 1) >= m.bindChance) continue;
        bv.bindT = Math.max(bv.bindT || 0, m.bindTime);
        /* FX-F：定身命中（双环 + 冰蓝光屑 + 飘字；第 4 颗小砧的必定身也走这里） */
        ring(bv.x, bv.y, bv.r, bv.r + 28, 0.3, '#cfe0ff');
        ring(bv.x, bv.y, bv.r * 0.5, bv.r + 14, 0.22, '#ffffff');
        burst(bv.x, bv.y, 8, '#cfe0ff', 180);
        floater(bv.x, bv.y - bv.r - 16, '定身 ' + m.bindTime + 's', '#cfe0ff', 12);
      }
    }

    // 敌方种子永远按"非最近目标"处理：只吃溅射（外圈再乘 edgeMul），不会顶掉单位的全额伤害
    for (var q = seeds.length - 1; q >= 0; q--) {
      var sd = seeds[q];
      if (sd.team === m.team) continue;
      var sdD = Math.hypot(sd.x - m.x, sd.y - m.y);
      if (sdD > m.r + sd.r * 0.5) continue;
      var sdDmg = markDmg * C.splashMul;
      if (sdD > m.r * C.coreRatio) sdDmg *= C.edgeMul;
      hurtSeed(sd, sdDmg, m.owner, markOpt);
      if (sd.hp <= 0) destroySeed(q, '种子被砸碎');
    }
  }
}

/* ============================================================
   箭矢（弓箭专属飞行物）
   ------------------------------------------------------------
   · 直线飞行、不反弹；寿命耗尽或飞出场地即销毁
   · 每支箭命中第一个敌人后消失（单目标）
   · 伤害统一走 hurt()，与护盾 / 无敌抖动 / 死亡流程保持一致
   · 箭种效果（破伤风 / 减速 / 灼烧 / 引爆）在 applyArrowEffects 里结算
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

function fireArrow(u, cfg) {
  var C = cfg || {};
  var speed = C.speed || 640;
  var aim = aimAngle(u, u.x, u.y, speed) + (C.spread || 0);
  u.faceAng = aim;   // 仅用于绘制朝向；移动方向 u.ang 保持不变

  var sx = u.x + Math.cos(aim) * (u.r + 6);
  var sy = u.y + Math.sin(aim) * (u.r + 6);
  arrows.push({
    x: sx, y: sy, px: sx, py: sy,
    ang: aim, speed: speed,
    life: C.life || 0.95, max: C.life || 0.95,
    kind: C.kind || 'normal', color: C.color || '#c9f59b',
    dmg: C.dmg || 0, hitR: C.hitR || 5, big: !!C.big,
    energy: C.energy || 0, budget: C.budget || null,
    basic: !!C.basic, skill: !!C.skill, ult: !!C.ult,
    settle: !!C.settle,
    team: u.team, owner: u, hit: []
  });

  ring(sx, sy, 2, (C.hitR || 5) * 4, 0.16, C.color || '#c9f59b');
  burst(sx, sy, C.big ? 8 : 3, C.color || '#b9e88a', C.big ? 170 : 110);
}

/* 箭种命中效果：破伤风 / 灼烧沿用统一 DoT，蛛丝箭减速，大火箭引爆 */
function applyArrowEffects(v, a) {
  if (!v || !v.alive || !a) return;
  if (a.kind === 'tetanus') {
    spearApplyTetanus(v, a.owner, BOW_ARROW.tetanus.stacks);
  } else if (a.kind === 'fire') {
    redApplyBurn(v, a.owner, BOW_ARROW.fire.stacks);
  } else if (a.kind === 'web') {
    if (!v.boss) v.bindT = Math.max(v.bindT || 0, BOW_ARROW.web.bindTime);   // BOSS 免疫定身
  }
  if (a.settle) settleDots(v, a.owner);
}

/* 箭矢回能：技能的三支箭共用一个预算，避免三发全中时回能翻三倍 */
function arrowEnergy(a) {
  if (!a.energy || !a.owner) return;
  var g = a.energy;
  if (a.budget) {
    if (a.budget.left <= 0) return;
    g = Math.min(g, a.budget.left);
    a.budget.left -= g;
  }
  gainEnergy(a.owner, g);
}

function updateArrows(dt) {
  var A = ARENA;
  var arrowOpt = null;
  for (var i = arrows.length - 1; i >= 0; i--) {
    var a = arrows[i];
    arrowOpt = a.basic ? { basic: 1 } : (a.skill ? { skill: 1 } : (a.ult ? { ult: 1 } : null));
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
      hurt(v, a.dmg, a.owner, arrowOpt);
      arrowEnergy(a);
      applyArrowEffects(v, a);
      ring(v.x, v.y, 3, a.big ? 60 : 26, a.big ? 0.4 : 0.22, a.color);
      burst(v.x, v.y, a.big ? 24 : 4, a.color, a.big ? 340 : 180);
      if (a.big) shake = Math.max(shake, 7);
      a.life = 0; break;   // 单目标：命中第一个敌人后销毁
    }

    // 箭矢也能命中敌方种子（种子是实体）：命中即消失
    if (a.life > 0) {
      for (var q = seeds.length - 1; q >= 0; q--) {
        var sd = seeds[q];
        if (sd.team === a.team) continue;
        if (segDist(sd.x, sd.y, a.px, a.py, a.x, a.y) > sd.r + a.hitR) continue;

        hurtSeed(sd, a.dmg, a.owner, arrowOpt);
        ring(sd.x, sd.y, 3, 24, 0.2, a.color);
        burst(sd.x, sd.y, 4, a.color, 180);
        if (sd.hp <= 0) destroySeed(q, '种子被射落');
        a.life = 0; break;
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
   冰面陷阱：冰块技能在当前位置生成的区域效果
   ------------------------------------------------------------
   · 每块存活 hold 秒，最后 fade 秒线性淡出（淡出期间仍生效）
   · 只对敌方单位生效：减速仍走 slowT / slowMul，不改方向、不推位置
   · 寒冷：站在陷阱里每秒 +1 层（进入瞬间先计 1 层，上限 6）；
     每层每秒造成施放者 15% 攻击力伤害；离开陷阱后每秒 -1 层，
     层数归零前伤害继续结算
   ============================================================ */
function dropIceTrap(owner, x, y) {
  var C = TYPES.ice.trap;
  icePatches.push({
    x: x, y: y, r: C.r,
    life: C.hold,
    team: owner.team, owner: owner
  });
  if (icePatches.length > ICE_PATCH_MAX) {
    icePatches.splice(0, icePatches.length - ICE_PATCH_MAX);
  }
}

function updateIcePatches(dt) {
  var i, j;

  for (i = icePatches.length - 1; i >= 0; i--) {
    icePatches[i].life -= dt;
    if (icePatches[i].life <= 0) icePatches.splice(i, 1);
  }

  for (i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive) continue;

    // 站上任意一块敌方陷阱即生效（重叠多块不叠加层数）
    var onTrap = false, srcPatch = null;
    for (j = 0; j < icePatches.length; j++) {
      var p = icePatches[j];
      if (p.team === v.team) continue;
      var dx = v.x - p.x, dy = v.y - p.y;
      var rr = p.r + v.r * 0.35;
      if (dx * dx + dy * dy <= rr * rr) { onTrap = true; srcPatch = p; break; }
    }

    if (onTrap && !v.boss) {   // BOSS 免疫减速；寒冷伤害照常结算
      v.slowT = Math.max(v.slowT, ICE_COLD.slowTime);
      v.slowMul = Math.min(v.slowMul || 1, ICE_COLD.slowMul);
    }

    // 进入陷阱的那一帧先计一层；离开后按 1 秒节奏衰减层数并继续结算伤害
    if (onTrap && !v.coldOn) v.coldAcc = 0;
    v.coldOn = onTrap;
    if (!onTrap && !(v.coldStacks > 0)) {
      v.coldAcc = ICE_COLD.interval;
      continue;
    }

    v.coldAcc -= dt;
    while (v.coldAcc <= 0 && v.alive) {
      v.coldAcc += ICE_COLD.interval;
      if (onTrap && srcPatch && srcPatch.owner) {
        v.coldStacks = Math.min(ICE_COLD.maxStacks, (v.coldStacks || 0) + 1);
        v.coldSrc = srcPatch.owner;
        v.coldAtk = srcPatch.owner.atk || 0;
      }
      if (v.coldStacks > 0) {
        hurt(v, v.coldStacks * ICE_COLD.pctPerLayer * (v.coldAtk || 0), v.coldSrc, { skill: 1, dot: 1, periodic: 1 });
      }
      if (!onTrap && v.coldStacks > 0) v.coldStacks -= 1;
    }
    if (v.coldStacks <= 0) {
      v.coldStacks = 0;
      v.coldSrc = null;
      v.coldAtk = 0;
      v.coldAcc = ICE_COLD.interval;
    }
  }
}

/* ============================================================
   水桶：狂浪（原地生成 → 7 秒引力 → 第 7 秒爆炸）
   ------------------------------------------------------------
   · 狂浪是**地面力场**：向圆心产生引力，越靠圆心拉力越大；
     每帧只按 g*dt 拖拽敌方**位置**，不修改 u.ang ——
     离开浪面后仍按原方向继续直线滑行，符合"只有技能/撞墙才转向"的红线
   · 敌方在浪中每 stackEvery 秒叠 1 层「溺水」（上限 5 层，层数存在 u.drownStacks）
   · 第 7 秒（age >= life）狂浪爆炸：170% 攻击力 + 3 层溺水，随后 fade 秒淡出残影
   · 溺水每秒结算一次（updateDrowns）：按层数取档位 15/20/25/30/40% 攻击力，
     不消耗层数，离开浪面后仍然持续
   · 伤害走 hurt()：会被护盾吸收、计入 dealt / taken、可触发死亡与羁绊
   · 狂浪只对敌方单位生效；不伤害种子、不推动己方
   ============================================================ */
function spawnWave(owner, x, y) {
  var C = TYPES.bucket.water;
  waters.push({
    x: x, y: y, r: C.r, age: 0, boom: false,
    team: owner.team, owner: owner, phase: rand(0, TAU)
  });
  if (waters.length > WATER_MAX) waters.splice(0, waters.length - WATER_MAX);
}

// 当前可见半径：grow 秒内从 0 扩散到 r；爆炸后只淡出，不缩圈
function waveRadius(w) {
  var C = TYPES.bucket.water;
  var k = clamp(w.age / C.grow, 0, 1);
  return w.r * (1 - (1 - k) * (1 - k));
}

function updateWaves(dt) {
  var C = TYPES.bucket.water;
  var D = BUCKET_DROWN;
  var i, j;

  // 1) 寿命：到 life 立刻爆炸（只炸一次），再由 fade 淡出残影
  for (i = waters.length - 1; i >= 0; i--) {
    var w = waters[i];
    w.age += dt;
    if (!w.boom && w.age >= C.life) {
      w.boom = true;
      if (typeof bucketWaveBoom === 'function') bucketWaveBoom(w);
    }
    if (w.age >= C.life + C.fade) waters.splice(i, 1);
  }

  // 2) 逐个敌方单位：找脚下的敌方浪面（重叠只取最近圆心的一滩） → 引力 + 叠溺水
  for (i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) continue;

    var src = null, bestD = 1e9, rr = 0;
    for (j = 0; j < waters.length; j++) {
      var p = waters[j];
      if (p.team === u.team || p.boom) continue;   // 已爆炸的残影不再有引力 / 叠层
      var rad = waveRadius(p);
      var d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d > rad + u.r * 0.35) continue;
      if (d < bestD) { bestD = d; src = p; rr = rad; }
    }

    if (!src) {
      u.drownInAcc = 0;
      // 离开浪面：先给 outGrace 秒宽限，之后每 decayEvery 秒 -1 层（重新入浪会清零计时）
      if (u.drownStacks > 0) {
        u.drownOutAcc = (u.drownOutAcc || 0) + dt;
        if (u.drownOutAcc >= D.outGrace) {
          u.drownOutAcc = D.outGrace - D.decayEvery;
          u.drownStacks -= 1;
          if (u.drownStacks <= 0) {
            u.drownStacks = 0; u.drownSrc = null; u.drownAtk = 0;
            u.drownAcc = D.interval; u.drownOutAcc = 0;
          }
        }
      }
      continue;
    }
    u.drownOutAcc = 0;

    // 2a) 引力：边缘接近 0，越靠圆心越大。无敌抖动 / 狗奶引导 / BOSS 视为固定桩，不被拖拽
    if (!isShaking(u) && !isMilkChannel(u) && !isDogChannel(u) && !u.boss && bestD > 0.5) {
      var g = C.gravity * Math.max(0, 1 - bestD / Math.max(1, rr));
      if (g > 0) {
        u.x += (src.x - u.x) / bestD * g * dt;
        u.y += (src.y - u.y) / bestD * g * dt;
      }
      u.x = clamp(u.x, ARENA.x + u.r, ARENA.x + ARENA.w - u.r);
      u.y = clamp(u.y, ARENA.y + u.r, ARENA.y + ARENA.h - u.r);
    }

    // 2b) 在浪中每 2 秒叠 1 层溺水（离开浪面时清零，避免"跨浪"白嫖计时）
    u.drownInAcc = (u.drownInAcc || 0) + dt;
    while (u.drownInAcc >= D.stackEvery) {
      u.drownInAcc -= D.stackEvery;
      if ((u.drownStacks || 0) < D.maxStacks) bucketApplyDrown(u, src.owner, 1);
    }
  }
}

/* 溺水 DoT：每秒按层数档位结算一次（不消耗层数） */
function updateDrowns(dt) {
  var D = BUCKET_DROWN;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive || !(u.drownStacks > 0)) continue;
    u.drownAcc -= dt;
    while (u.drownAcc <= 0 && u.alive && u.drownStacks > 0) {
      u.drownAcc += D.interval;
      hurt(u, (u.drownAtk || 0) * bucketDrownPct(u.drownStacks), u.drownSrc, { skill: 1, dot: 1, periodic: 1 });
    }
  }
}


/* ============================================================
   召唤物（草的旧种子）/ 藤蔓视觉 / 在种子上复活
   ------------------------------------------------------------
   2026-11-22：草重做为「捆绑 / 生辉 / 中毒」后不再种植种子，
   下面这套核心机制保留给未来的召唤物；没有 TYPES.grass.seed 时直接跳过。
   · plantSeed   在当前位置种一颗种子（不移动、不挡路）
   · hurtSeed    种子唯一的受击入口：没有护盾 / 无敌，血量归零才消失
   · updateSeeds 只有敌方技能冲刺撞到才算攻击，同时每秒治疗范围内友军
   · queueRevive 单位阵亡时消耗一颗自己的种子，延迟 1s 原地复活
   ============================================================ */

// 种子受伤：统一入口。种子不参与 dealt 排行以外的单位结算，但伤害仍计入攻击方 dealt
// opt 口径与 hurt() 一致：{pct:1} 百分比不缩放；{periodic:1} 合并跳伤不飘字
function hurtSeed(s, amount, src, opt) {
  var cal = !!(src && TYPES[src.key] && TYPES[src.key].calibrated);
  if (!(opt && opt.pct) && !cal) amount *= BALANCE.dmgScale;
  if (!s || s.hp <= 0 || amount <= 0) return;
  if (!(opt && (opt.basic || opt.skill || opt.ult || opt.dot)) && !damageTagWarned) {
    damageTagWarned = true;
    if (typeof console !== 'undefined') console.warn('[hurtSeed] 未分类伤害：所有实际伤害必须带 basic / skill / ult / dot');
  }
  var periodic = !!(opt && opt.periodic);
  var actualHpLoss = Math.min(amount, s.hp);
  s.hp = Math.max(0, s.hp - amount);
  s.flash = 0.22;
  s.lastHit = t;
  if (src && typeof src.dealt === 'number') src.dealt += actualHpLoss;
  if (!periodic) {
    floater(s.x, s.y - s.r - 22, '-' + Math.round(actualHpLoss), '#ffb1a0', 14, { pop: 1 });
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
    healAcc: 1.0, flash: 0, lastHit: -99
  });
  if (seeds.length > SEED_MAX) seeds.shift();

  ring(u.x, u.y, u.r, 96, 0.45, '#c8f5b0');
  burst(u.x, u.y, 14, '#bff5a0', 190);
  floater(u.x, u.y - u.r - 18, '生花 · 种子', '#c8f5b0', 13);
}

function updateSeeds(dt) {
  var S = TYPES.grass.seed;
  if (!S) return;   // 草已不再种种子；没有配置时直接跳过
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
      var seedImpactDmg = dmgOf(v, v.dashSpeed, s);
      hurtSeed(s, seedImpactDmg, v, attackDamageOpt(v, seedImpactDmg));
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
  if (bossMode) return;        // BOSS 战舞台不收缩（否则 5v1 会被挤成一团）
  if (!soloMode()) return;     // 只有 1v1 自动收缩；2v2 / 3v3 / 接力 / 赛事均保持初始场地
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
  // 食物 / 危险区域跟着新墙走，避免 1v1 收缩后食物落在墙外吃不到
  if (typeof foods !== 'undefined') {
    for (var fi = 0; fi < foods.length; fi++) {
      foods[fi].x = clamp(foods[fi].x, ARENA.x + foods[fi].r, ARENA.x + ARENA.w - foods[fi].r);
    }
  }
  if (typeof hazards !== 'undefined') {
    for (var hi = 0; hi < hazards.length; hi++) {
      var hz = hazards[hi];
      if (hz.x - hz.r < ARENA.x) hz.x = ARENA.x + hz.r;
      if (hz.x + hz.r > ARENA.x + ARENA.w) hz.x = ARENA.x + ARENA.w - hz.r;
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
  // L.multi：多段激光逐段飘字；L.slowMul：命中后减速（大狗终结技 -50%）
  // 类型标记与表现分离：dot 表示持续伤害类型，periodic 才表示合并跳伤。
  var hitOpt = L.basic ? { basic: 1 } : (L.ult ? { ult: 1 } : { skill: 1 });
  if (L.multi) hitOpt.multi = 1;
  else { hitOpt.dot = 1; hitOpt.periodic = 1; }
  var seedOpt = L.basic ? { basic: 1 } : (L.ult ? { ult: 1 } : { skill: 1 });
  seedOpt.periodic = 1;
  if (!L.multi) seedOpt.dot = 1;
  for (var k = 0; k < hitUnits.length; k++) {
    var hit = hitUnits[k];
    hurt(hit, L.dmg * mul, u, hitOpt);
    if (L.multi) ring(hit.x, hit.y, 3, 22, 0.16, '#fff4d6');
    if (L.slowMul && hit.alive && !hit.boss) {
      hit.slowT = Math.max(hit.slowT, L.slowTime || 0.6);
      hit.slowMul = Math.min(hit.slowMul || 1, L.slowMul);
    }
  }
  for (var q = hitSeeds.length - 1; q >= 0; q--) {
    var s2 = hitSeeds[q];
    hurtSeed(s2, L.dmg * mul, u, seedOpt);
    if (s2.hp <= 0) {
      var at = seeds.indexOf(s2);
      if (at >= 0) destroySeed(at, '种子被激光烧毁');
    }
  }
  // 返回命中的敌方单位：大狗终结技最后 10 段需要给命中者叠灼烧
  return hitUnits;
}

function statusText() {
  var parts = [];
  if (bossMode && phase === 'fight') {
    if (bossTwoBar()) {
      // 单单位双血 BOSS（雷云巨像）：报当前第几条血 / 转阶段 / 终结技读秒
      var sb = null;
      for (var si = 0; si < units.length; si++) {
        if (units[si].alive && units[si].team === 'B') { sb = units[si]; break; }
      }
      if (sb) {
        if (sb.st.phaseShift > 0) parts.push('风暴降临 · 转阶段 ' + sb.st.phaseShift.toFixed(1) + 's');
        else if (sb.st.ult1) parts.push('万雷归一 · ' + (sb.st.ult1.fired ? '落雷中' : Math.ceil(sb.st.ult1.t) + 's'));
        else if (sb.st.ult2) parts.push('雷神黄昏 · ' + (sb.st.ult2.active ? '脉冲 ' + (sb.st.ult2.total - sb.st.ult2.left) + '/' + sb.st.ult2.total : Math.ceil(sb.st.ult2.t) + 's'));
        else parts.push('雷云巨像 · 第 ' + sb.st.phase + ' 条血' + (sb.st.phase === 2 ? ' · 击破即胜利' : ''));
      }
    } else if (!bossMerged) {
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
  // 场地环境：当前天气 + 剩余时间；局部危险区域只报数量，避免状态栏过长
  if (typeof fieldWeather !== 'undefined' && fieldWeather) {
    parts.push('环境 · ' + fieldWeather.def.name + ' ' + Math.ceil(fieldWeather.life) + 's');
  }
  if (typeof hazards !== 'undefined' && hazards.length) {
    parts.push('危险区 ×' + hazards.length);
  }
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    var R = u.st.rage;
    if (!u.alive) continue;
    // 野生狗奶：领域剩余时间 + 剩余打断护盾
    if (u.st.milkT > 0) {
      parts.push(u.name + ' 领域 ' + u.st.milkT.toFixed(1) + 's · 护盾 ' +
        Math.ceil(Math.max(0, u.st.shield)) + '/' + TYPES.milk.shieldMax);
    }
    if (u.ultT > 0) parts.push(u.name + ' 终结技蓄力 ' + u.ultT.toFixed(1) + 's');
    if (u.st.ultLaserT > 0) {
      parts.push(u.name + ' 终极咆哮 ' + u.st.ultLaserT.toFixed(1) + 's');
    }
    if (u.atkBuffT > 0) {
      parts.push(u.name + ' 攻击 +' + Math.round(u.atkBuffAdd) + ' ' + u.atkBuffT.toFixed(1) + 's');
    }
    if (TYPES[u.key] && TYPES[u.key].bossLock && u.hp <= 1.05) {
      parts.push(u.name + ' 已锁 1 血 · 停手');
    }
    // 紫晶核心：终末震荡倒计时（最后 nukeWarn 秒开始报数）
    if (u.st.nukeT >= 0 && u.st.nukeT <= (BALANCE.boss.core.nukeWarn || 8)) {
      parts.push('终末震荡 ' + Math.ceil(u.st.nukeT) + 's');
    }
    // 水桶：溺水层数（每秒按档位掉血，上限 5 层）
    if (u.drownStacks > 0) {
      parts.push(u.name + ' 溺水 ×' + u.drownStacks +
        '（' + Math.round(bucketDrownPct(u.drownStacks) * 100) + '% 攻击力/秒）');
    }
    if (u.tetStacks > 0) {
      parts.push(u.name + ' 破伤风 ×' + u.tetStacks);
    }
    if (u.burnStacks > 0) {
      parts.push(u.name + ' 灼烧 ×' + u.burnStacks);
    }
    if (u.coldStacks > 0) {
      parts.push(u.name + ' 寒冷 ×' + u.coldStacks);
    }
    if (u.vulnT > 0) {
      parts.push(u.name + ' 脆弱 ' + u.vulnT.toFixed(1) + 's');
    }
    // 食物增益：刚拾取时在状态栏短暂显示名称
    if (u.field && u.field.labelT > 0) {
      parts.push(u.name + ' 食物 · ' + u.field.label);
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
  if (u.st) {
    u.st.basicAtk = false;       // 主动技能不是普攻：清掉撞击伤害的普攻标记
    u.st.attackKind = 'skill';   // 本次冲刺若撞击，伤害归类为技能伤害
  }

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
    if (u.st) u.st.attackKind = 'ult';
    c.left--;
    c.gap = c.interval;
    ring(u.x, u.y, u.r, u.r + 54, 0.22, '#ffe08a');
    burst(u.x, u.y, 7, '#fff0bd', 260);
    floater(u.x, u.y - u.r - 18,
      c.label + ' ' + (c.count - c.left) + '/' + c.count, '#ffe08a', 12);
  }
}

// 一次性光束（当前仅大狗技能「长激光」）：立即结算沿途敌人与敌方种子
function spawnUltBeam(owner, ang, cfg) {
  var x2 = owner.x + Math.cos(ang) * cfg.len;
  var y2 = owner.y + Math.sin(ang) * cfg.len;
  var color = cfg.color || '#ffcf8a';
  var life = cfg.life || 0.45;
  var beamOpt = cfg.basic ? { basic: 1 } : (cfg.ult ? { ult: 1 } : { skill: 1 });
  ultBeams.push({
    x1: owner.x, y1: owner.y, x2: x2, y2: y2,
    life: life, max: life, color: color, width: cfg.width
  });
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === owner.team) continue;
    if (segDist(v.x, v.y, owner.x, owner.y, x2, y2) > cfg.width * 0.5 + v.r) continue;
    hurt(v, cfg.dmg, owner, beamOpt);
    burst(v.x, v.y, 8, color, 200);
  }
  for (var s = seeds.length - 1; s >= 0; s--) {
    var sd = seeds[s];
    if (sd.team === owner.team) continue;
    if (segDist(sd.x, sd.y, owner.x, owner.y, x2, y2) > cfg.width * 0.5 + sd.r) continue;
    hurtSeed(sd, cfg.dmg, owner, beamOpt);
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
  if (u.st) {
    u.st.basicAtk = false;       // 终结技不是普攻：清掉撞击伤害的普攻标记
    u.st.attackKind = 'ult';     // 终结技连撞 / 光束按终结技伤害归类
  }
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
  if (isDogChannel(u)) return;   // 终极咆哮引导中：不普攻、不施放其它技能
  // 狂暴后通常不再施放技能；BOSS 合体核心声明 rageCasts 后仍然会放（紫晶脉冲 / 终结技）
  if (u.st.rage && !TYPES[u.key].rageCasts) return;
  if (u.castT > 0 || u.ultT > 0) return;
  if (u.st.ultChain && u.st.ultChain.left > 0) return;
  if (u.st.milkT > 0) return;   // 引导期间站桩，不施放任何技能
  if (u.st.mergeFill > 0) return;   // 紫晶核心血条充能中：不动、不打
  if (u.st.phaseShift > 0) return;  // 双血 BOSS 转阶段：停手
  if (u.st.actionLock > 0) return;  // 双血 BOSS 终结技引导：停手
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
        // 无敌抖动 / 野生狗奶引导 / 大狗终结技引导 / BOSS：原地不动，只推另一方
        var aFixed = isShaking(a) || isMilkChannel(a) || isDogChannel(a) || isGagaPinned(a) || (a.boss && !b.boss);
        var bFixed = isShaking(b) || isMilkChannel(b) || isDogChannel(b) || isGagaPinned(b) || (b.boss && !a.boss);
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
        if (!isMilkChannel(a) && !isDogChannel(a) && !isGagaPinned(a)) a.ang = Math.atan2(vay + rel * ny, vax + rel * nx);
        if (!isMilkChannel(b) && !isDogChannel(b) && !isGagaPinned(b)) b.ang = Math.atan2(vby - rel * ny, vbx - rel * nx);
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
      // 普通攻击标记：只有本次冲刺是普攻时才带上 basic，供「普攻承伤」类天赋识别
      var oa = attackDamageOpt(b, da);
      var ob = attackDamageOpt(a, db);

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

      hurt(a, da, b, oa);
      hurt(b, db, a, ob);

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
  // 分母 = 全阵容的总生命；分子 = 已在场单位的剩余生命 + 还没上场的单位按满血计。
  // 已在场单位的 maxHp 读实时值（草终结技会永久抬高自身生命上限），不能再读 TYPES 初始值。
  for (var i = 0; i < keys.length; i++) {
    var role = POOL_BY_KEY[keys[i]];
    if (!role) continue;
    var pending = modeKind === 'relay' && i > lineupIndex[team];
    for (var j = 0; j < role.units.length; j++) {
      if (!pending) continue;
      var m = TYPES[role.units[j]].maxHp;
      max += m;
      cur += m;
    }
  }
  for (var k = 0; k < units.length; k++) {
    /* 临时召唤物（铁砧分身）不计入队伍总血条：分母只统计角色池里的单位，
       否则分身会让 cur 超过 max，血条直接溢出。 */
    if (units[k].team !== team || units[k].isSummon) continue;
    cur += Math.max(0, units[k].hp);
    max += Math.max(0, units[k].maxHp);
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

  // 结算时收回所有激光：tick 停了之后计时不再递减，光束会定格在结算画面上
  for (var li = 0; li < units.length; li++) {
    if (units[li].st) units[li].st.ultLaserT = 0;
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
    if (u.st && u.st.phaseShift > 0) continue;   // 双血 BOSS 转阶段演出：不被决杀跳过
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
      // 双血 BOSS：第一条血被决杀打空也走转阶段，不直接判死
      var DT = TYPES[u.key];
      if (DT && DT.onLethal && DT.onLethal(u)) continue;
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
    // 蜂蜜瓶：技能冷却流速加快（只作用于普通技能 CD，不改终结技）
    var cdRate = (u.field && u.field.cdT > 0) ? u.field.cdMul : 1;
    u.cd = Math.max(0, u.cd - dt * cdRate);
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
    // 脆弱：冰块终结技留下的承伤加成计时
    if (u.vulnT > 0) u.vulnT = Math.max(0, u.vulnT - dt);
    // 极寒领域：绘制层读取，与脆弱同长；施放者阵亡后领域仍按剩余时间消退
    if (u.st && u.st.domainT > 0) u.st.domainT = Math.max(0, u.st.domainT - dt);
    // 大狗技能加攻：到期后把临时抬高的攻击力还原
    if (u.atkBuffT > 0) {
      u.atkBuffT = Math.max(0, u.atkBuffT - dt);
      if (u.atkBuffT <= 0) {
        if (u.atkBuffAdd) u.atk -= u.atkBuffAdd;
        u.atkBuffAdd = 0;
      }
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

  updateTetanus(dt);   // 破伤风：每秒结算并消耗 1 层（长矛）
  updateBurns(dt);     // 灼烧：每秒结算并消耗 1 层（红石普攻炸弹）
  updatePoisons(dt);   // 中毒：每秒按层数结算并消耗 1 层（草的捆绑 / 光环）
  if (typeof updateDrowns === 'function') updateDrowns(dt);   // 溺水：每秒按层数档位结算（水桶狂浪）
  updateField(dt);     // 场地环境：食物拾取 / 局部危险区域 / 全场天气

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

  updateWaves(dt);    // 水桶狂浪：浪心引力 + 叠溺水 + 第 7 秒爆炸（不改 ang）
  if (typeof updateBucketDrops === 'function') updateBucketDrops(dt);   // 水滴飞行物
  collide();
  updateBombs(dt);
  updateAnvilMarks(dt);
  if (typeof updateAnvilForges === 'function') updateAnvilForges(dt);   // 熔铁领域：本体阵亡后仍烧满 5s
  updateArrows(dt);
  updateGagaDrops(dt);   // 咕咕嘎嘎的口水（飞行物，见 items/gaga.js）
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
  // 场地落雷：即使对局结束也要把最后一道闪电播完
  for (i = fieldBolts.length - 1; i >= 0; i--) {
    fieldBolts[i].life -= dt;
    if (fieldBolts[i].life <= 0) fieldBolts.splice(i, 1);
  }
  // 雷云巨像专属演出：雷柱 / 连锁电弧寿命递减
  if (typeof stormBolts !== 'undefined') {
    for (i = stormBolts.length - 1; i >= 0; i--) {
      stormBolts[i].life -= dt;
      if (stormBolts[i].life <= 0) stormBolts.splice(i, 1);
    }
    for (i = stormChains.length - 1; i >= 0; i--) {
      stormChains[i].life -= dt;
      if (stormChains[i].life <= 0) stormChains.splice(i, 1);
    }
    if (stormFlash > 0) stormFlash = Math.max(0, stormFlash - dt);
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




