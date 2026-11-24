/* 像素·咕咕嘎嘎：吼叫叠毒 / 原方向旋转 + 口水溅射 / 吸收反震，无羁绊
   ------------------------------------------------------------
   面板：2000 HP · 200 移速 · 100 攻 / 150 防 · r 26 · 无能量 · 无羁绊
   承伤：受到技能伤害 -10%、受到终结技伤害 -20%（普攻与 DoT 不减免）
   · 普攻「hey」（4.0s）  朝最近敌人方向一声吼：前方扇形 210% 攻击力（basic），
                          命中叠 3 层中毒。中毒复用草的通道（每层每秒按
                          「施放者生命上限 0.5%」结算，每结算 1 层消耗 1 层，
                          上限 6 层）。
   · 技能「咕咕」（6.0s）  移速 ×1.8（200 → 360），沿**当前朝向的原方向**旋转 5.0s：
                          · 旋转期间撞击伤害 = 200% 攻击力（撞击属于技能，走
                            onAttack + attackKind='skill'，仍受 0.34s 撞击窗口限制）
                          · 每 0.5s 向四周随机喷 3 滴口水（飞行物，命中造成 80%
                            攻击力，技能伤害）；口水最多 40 滴，寿命 1.1s，出界销毁
                          ⚠ 冷却在**旋转结束之后**才开始读 6 秒（完整周期 11s）。
   · 终结技「嘎嘎」（12.0s）冷却好了就**原地蓄力 5.0s**：
                          · 蓄力期间**完全吸收伤害**（hurt 里走 onAbsorb，不掉血、
                            不进 u.taken），站着当桩
                          · 5s 后把「本次蓄力吸收量 + 被控期间积攒的吸收量」
                            ×120% 一次性反弹给**最近的敌人**（单目标，ult 伤害）
                          · 结算后 **70% 概率**自身反噬：受到「本次蓄力吸收量」
                            的 60%（opt.self，不吃自己的承伤减免，可能打死自己）
                          · 蓄力结束之后才开始读 12 秒冷却
   · 被动「记仇」  被控制（bindT > 0）的瞬间开始完全吸收伤害，直到恢复行动；
                  这段吸收量留到**下一次**终结技，叠加进反弹基数（不参与反噬）。
   ------------------------------------------------------------ */
'use strict';

var GAGA_BASIC = { cd: 4.0, pct: 2.10, len: 260, half: 0.48, poison: 3 };

/* 旋转：沿原方向加速移动（移速 ×1.8），撞击 200% + 口水溅射 80%（每 0.5s 3 滴） */
var GAGA_SPIN = { cd: 6.0, dur: 5.0, impactPct: 2.00, speedMul: 1.80, windup: 0.20 };
var GAGA_DROP = { pct: 0.80, speed: 400, life: 1.1, r: 8, interval: 0.5, count: 3 };
var GAGA_DROP_MAX = 40;

var GAGA_ULT = {
  cd: 12.0,               // 蓄力结束后才开始读 12 秒
  charge: 5.0,            // 原地蓄力 5 秒（期间完全吸收伤害）
  releaseMul: 1.20,       // 反弹：吸收伤害 ×120%
  backfireChance: 0.70,   // 70% 概率反噬
  backfirePct: 0.60       // 反噬：本次蓄力吸收量 ×60%
};

/* 口水（飞行物）：与箭矢 / 水滴同一口径，更新在 30-sim 的 updateGagaDrops()，
   绘制在 40-render 的 drawGagaDrops() */
var gagaDrops = [];

/* 不可移动 / 不可推动：终结技蓄力期间（旋转是移动的） */
function isGagaPinned(u) {
  return !!(u && u.st && u.st.chargeT > 0);
}

/* 普攻「hey」：朝最近敌人方向的扇形吼声，命中叠中毒 */
function gagaHey(u) {
  var foe = nearestEnemy(u);
  if (!foe) return 0;
  var ang = Math.atan2(foe.y - u.y, foe.x - u.x);
  var dmg = u.atk * GAGA_BASIC.pct;
  var hits = 0, i;

  for (i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (Math.hypot(v.x - u.x, v.y - u.y) > GAGA_BASIC.len + v.r) continue;
    if (Math.abs(angDiff(Math.atan2(v.y - u.y, v.x - u.x), ang)) > GAGA_BASIC.half) continue;
    hurt(v, dmg, u, { basic: 1 });
    if (typeof grassApplyPoison === 'function') grassApplyPoison(v, u, GAGA_BASIC.poison);
    hits++;
  }
  for (i = seeds.length - 1; i >= 0; i--) {
    var sd = seeds[i];
    if (sd.team === u.team) continue;
    if (Math.hypot(sd.x - u.x, sd.y - u.y) > GAGA_BASIC.len + sd.r) continue;
    if (Math.abs(angDiff(Math.atan2(sd.y - u.y, sd.x - u.x), ang)) > GAGA_BASIC.half) continue;
    hurtSeed(sd, dmg, u, { basic: 1 });
    if (sd.hp <= 0) destroySeed(i, '种子被吼声震碎');
  }

  // 吼声演出：复用大狗声波的三层扇形弧
  ultBeams.push({
    kind: 'bark', x1: u.x, y1: u.y, ang: ang, half: GAGA_BASIC.half,
    len: GAGA_BASIC.len, life: 0.3, max: 0.3, color: '#ffb066'
  });
  ring(u.x, u.y, u.r, GAGA_BASIC.len, 0.28, '#ffb066');
  return hits;
}

/* 口水溅射：向四周随机方向喷 count 滴（从本体外缘出发） */
function gagaSpit(u) {
  var dmg = u.atk * GAGA_DROP.pct;
  for (var i = 0; i < GAGA_DROP.count; i++) {
    var a = srand(0, TAU);
    gagaDrops.push({
      x: u.x + Math.cos(a) * (u.r + 6),
      y: u.y + Math.sin(a) * (u.r + 6),
      vx: Math.cos(a) * GAGA_DROP.speed,
      vy: Math.sin(a) * GAGA_DROP.speed,
      life: GAGA_DROP.life * srand(0.85, 1.15),
      max: GAGA_DROP.life,
      r: GAGA_DROP.r,
      dmg: dmg,
      team: u.team,
      owner: u,
      spin: srand(0, TAU)
    });
  }
  if (gagaDrops.length > GAGA_DROP_MAX) {
    gagaDrops.splice(0, gagaDrops.length - GAGA_DROP_MAX);
  }
}

/* 口水推进：匀速直线，命中即结算并销毁（与箭矢 / 水滴同一口径） */
function updateGagaDrops(dt) {
  for (var i = gagaDrops.length - 1; i >= 0; i--) {
    var d = gagaDrops[i];
    d.life -= dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.spin += dt * 7;
    if (d.life <= 0 ||
      d.x < ARENA.x - 30 || d.y < ARENA.y - 30 ||
      d.x > ARENA.x + ARENA.w + 30 || d.y > ARENA.y + ARENA.h + 30) {
      gagaDrops.splice(i, 1);
      continue;
    }
    var ownerAlive = d.owner && d.owner.alive;
    var hit = false;
    for (var j = 0; j < units.length; j++) {
      var v = units[j];
      if (!v.alive || v.team === d.team) continue;
      if (Math.hypot(v.x - d.x, v.y - d.y) > v.r + d.r) continue;
      if (ownerAlive) hurt(v, d.dmg, d.owner, { skill: 1 });
      burst(d.x, d.y, 5, '#eaf58f', 150);
      hit = true;
      break;
    }
    if (hit) gagaDrops.splice(i, 1);
  }
}

/* 蓄力结束：吸收总量 ×120% 反弹最近敌人；70% 概率反噬自身 60% 本次吸收量 */
function gagaUltRelease(u) {
  var S = u.st;
  S.chargeT = 0;
  var absorbCharge = S.chargeAcc || 0;        // 本次蓄力吸收（参与反噬）
  var absorbTotal = absorbCharge + (S.controlAcc || 0);   // 加上被控期间攒的
  S.chargeAcc = 0;
  S.controlAcc = 0;

  var amt = absorbTotal * GAGA_ULT.releaseMul;
  var foe = nearestEnemy(u);
  if (foe && amt > 0.5) {
    hurt(foe, amt, u, { ult: 1 });
    ring(foe.x, foe.y, foe.r, foe.r + 64, 0.4, '#ff9a5c');
    ring(foe.x, foe.y, foe.r * 0.5, foe.r + 28, 0.28, '#fff4d6');
    burst(foe.x, foe.y, 14, '#ffd8a8', 280);
    shake = Math.max(shake, 7);
    hitStop = Math.max(hitStop, 0.05);
    floater(foe.x, foe.y - foe.r - 30, '嘎嘎 · 反弹 ' + Math.round(amt), '#ffd166', 16, { pop: 1 });
  } else if (amt > 0.5) {
    // 没有敌人：吸收量白蓄（只播个空放的表现）
    ring(u.x, u.y, u.r, u.r + 80, 0.35, '#ff9a5c');
  }

  // 反噬：只按本次蓄力吸收量算，被动攒的部分不参与
  if (absorbCharge > 0.5 && srand(0, 1) < GAGA_ULT.backfireChance) {
    var back = absorbCharge * GAGA_ULT.backfirePct;
    ring(u.x, u.y, u.r, u.r + 74, 0.4, '#ff5a44');
    burst(u.x, u.y, 12, '#ff6b5a', 240);
    floater(u.x, u.y - u.r - 32, '反噬 ' + Math.round(back), '#ff6b5a', 15);
    hurt(u, back, null, { ult: 1, cal: 1, self: 1 });
  }

  u.ultCd = GAGA_ULT.cd;   // 蓄力结束后才开始读 12 秒
}

TYPES.gaga = {
  key: 'gaga', name: '咕咕嘎嘎', role: '吼叫 / 反震',
  r: 26, maxHp: 2000, baseSpeed: 200, atk: 100, def: 150,
  /* 数值按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  /* 撞击伤害只在旋转期间生效（onAttack 返回 200%），平时恒为 0 */
  impact: true,
  /* 分类承伤减免：技能 -10%、终结技 -20%（普攻 / DoT / 自伤不减免） */
  takenReduce: { skill: 0.10, ult: 0.20 },
  body: '#3a3f4a', light: '#f6f1e6', dark: '#1c1f26', glow: '#ff9a5c',
  basic: GAGA_BASIC,
  skill: {
    name: '咕咕', cd: GAGA_SPIN.cd, noTurn: true,
    dashTime: 0, dashSpeed: 0, dmgMult: 1, windup: GAGA_SPIN.windup,
    text: '移速 ×1.8 沿当前朝向的原方向旋转 5 秒（不改方向）：旋转期间撞击造成 200% 攻击力；同时每 0.5 秒向四周随机喷 3 滴口水，命中造成 80% 攻击力；旋转结束后才开始读 6 秒冷却'
  },
  ultimate: {
    name: '嘎嘎', cd: GAGA_ULT.cd,
    text: '12 秒冷却，冷却好了就原地蓄力 5 秒，蓄力期间完全吸收伤害（不掉血）：5 秒后把吸收总量 ×120% 反弹给最近的敌人，70% 概率自身反噬 60% 本次吸收量；蓄力结束后才开始读 12 秒冷却'
  },
  passive: {
    name: '记仇',
    text: '被控制期间完全吸收伤害，直到恢复行动；这段吸收量叠加到下一次终结技的反弹里（不参与反噬）；受到技能伤害 -10%、终结技伤害 -20%'
  },

  createState: function () {
    return {
      basicCd: 0.6,
      spinT: 0, spinAng: 0, spitT: 0, spinSpeedMul: 0,
      chargeT: 0, chargeAcc: 0, controlAcc: 0
    };
  },

  // 旋转 / 蓄力期间不再施放普通技能
  canCast: function (u) {
    return !(u.st.spinT > 0) && !(u.st.chargeT > 0);
  },

  onCast: function (u) {
    // 旋转结束才读冷却：先把 cast() 写进来的 6s 清掉
    u.cd = 0;
    u.st.spinT = GAGA_SPIN.dur;
    u.st.spinAng = 0;
    u.st.spitT = 0;
    u.st.spinSpeedMul = GAGA_SPIN.speedMul;   // 旋转期间移速 ×1.8（speedOf 读取）
    u.st.attackKind = 'skill';   // 旋转期的撞击伤害按技能归类
    ring(u.x, u.y, u.r, u.r + 96, 0.4, '#ffb066');
    burst(u.x, u.y, 10, '#ffe0a8', 200);
    floater(u.x, u.y - u.r - 18, '咕咕', '#ffb066', 13);
  },

  onTick: function (u, dt) {
    var S = u.st;

    // 1) 终结技蓄力中：期间靠 onAbsorb 完全免伤，5 秒后一次性结算
    if (S.chargeT > 0) {
      S.chargeT = Math.max(0, S.chargeT - dt);
      if (S.chargeT <= 0) gagaUltRelease(u);
      return;
    }

    // 2) 冷却好了就蓄力（旋转中不打断，等旋转结束）
    if (u.ultCd <= 0 && S.spinT <= 0) {
      S.chargeT = GAGA_ULT.charge;
      S.chargeAcc = 0;
      ring(u.x, u.y, u.r, u.r + 120, 0.45, '#ff9a5c');
      floater(u.x, u.y - u.r - 28, '嘎嘎 · 蓄力 5s', '#ffd166', 14);
      if (typeof sfxPlay === 'function') sfxPlay('ult');
      return;
    }

    // 3) 原方向旋转：撞击走 onAttack（200%），口水每 0.5s 喷 3 滴
    if (S.spinT > 0) {
      S.spinT = Math.max(0, S.spinT - dt);
      S.spinAng += dt * 16;   // 加速后转得更快（纯表现）
      S.spitT -= dt;
      if (S.spitT <= 0) {
        S.spitT += GAGA_DROP.interval;
        gagaSpit(u);
      }
      if (S.spinT <= 0) {
        u.cd = GAGA_SPIN.cd;   // 旋转结束才开始读 6 秒
        u.st.attackKind = null;
        u.st.spinSpeedMul = 0;   // 加速结束，移速回到 200
        ring(u.x, u.y, u.r, u.r + 70, 0.35, '#ffb066');
        floater(u.x, u.y - u.r - 18, '咕咕结束 · 冷却 6s', '#ffd8a8', 12);
      }
      return;
    }

    // 4) 普攻「hey」：4 秒一次
    S.basicCd = Math.max(0, S.basicCd - dt);
    if (S.basicCd > 0) return;
    if (!nearestEnemy(u)) return;
    S.basicCd = GAGA_BASIC.cd;
    var hits = gagaHey(u);
    if (hits < 1) floater(u.x, u.y - u.r - 16, 'hey…', '#ffd8a8', 11);
  },

  /* 撞击伤害：只有旋转期间才有（200% 攻击力），其余时刻恒为 0。
     走 dmgOf 的 onAttack 通道，符合「撞击伤害属于技能」的红线。 */
  onAttack: function (u) {
    if (u.st.spinT > 0) {
      u.st.attackKind = 'skill';
      return u.atk * GAGA_SPIN.impactPct;
    }
    return 0;
  },

  /* 完全吸收：终结技蓄力期间吃到的所有伤害都进「本次蓄力」，
     被控期间吃到的所有伤害都进「留到下次终结技」；两者都不掉血。
     自伤 / 反噬（opt.self）不吸收，否则反噬永远打不到自己。 */
  onAbsorb: function (u, amount, src, opt) {
    if (!(amount > 0)) return false;
    if (opt && opt.self) return false;
    if (u.st.chargeT > 0) { u.st.chargeAcc += amount; return true; }
    if (u.bindT > 0) { u.st.controlAcc += amount; return true; }
    return false;
  },

  // 终结技不由 think() 主动施放：蓄力与结算都在 onTick 里
  ultBlocked: function () { return true; },

  draw: function (u) { drawGaga(u); }
};

/* 角色贴图：assets/gaga.png（像素版，本地资源，离线可用）。
   无头模拟 / 加载失败时 ok=false，绘制退化为纯色剪影。 */
var GAGA_SPRITE = { img: null, ok: false };
(function () {
  if (typeof Image === 'undefined') return;
  var im = new Image();
  im.onload = function () { GAGA_SPRITE.ok = !!(im.naturalWidth && im.naturalHeight); };
  im.onerror = function () { GAGA_SPRITE.ok = false; };
  im.src = 'assets/gaga.png';
  GAGA_SPRITE.img = im;
})();
