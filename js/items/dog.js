/* 大狗：远程压制 / 团队增益，无羁绊
   2026-11-22 重做：
     · 普攻（2s）   向前方发出汪声波，70% 攻击力，命中回能 10
     · 技能（6s / 回能60） 长激光 160% 攻击力，并给攻击力最高的队友 +20 攻击力（3s）
     · 终结技       原地引导 5s 激光，共 50 段：
                     前 20 段每段 5% 攻击力 / 中间 20 段每段 8% / 最后 10 段每段 12%
                     最后一击（第 50 段）改为 20% 攻击力，并施加灼烧
                     最后 10 段每段额外叠 5 层灼烧（受 10 层上限限制）
                     每段单独飘字；命中期间减速 50%
   旧被动「厚皮」保留：受到的撞击伤害 ×0.85。 */
'use strict';

var DOG_BASIC = { cd: 2.0, pct: 0.70, len: 340, half: 0.42, energy: 10 };
var DOG_SKILL = {
  cd: 6.0, energyGain: 60, pct: 1.60,
  buffPct: 0.20, buffTime: 3.0,
  len: 1000, width: 26, life: 0.5
};
var DOG_ULT = {
  dur: 5.0, ticks: 50, interval: 0.1,
  split1: 20, split2: 40,
  pctEarly: 0.05, pctMid: 0.08, pctLate: 0.12,
  finalPct: 0.20,   // 第 50 段：终结一击
  burn: 5, len: 1000, width: 26, trackRate: 1.2,
  slowMul: 0.50, slowTime: 0.60
};

/* 汪声波：向前方扇形范围结算一次伤害（单位 + 敌方种子）
   返回命中的敌方单位数量；只有命中单位才回能（多目标不重复回能） */
function dogBark(u) {
  var foe = nearestEnemy(u);
  if (!foe) return 0;
  var ang = Math.atan2(foe.y - u.y, foe.x - u.x);
  var dmg = u.atk * DOG_BASIC.pct;
  var hits = 0, i;

  for (i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (Math.hypot(v.x - u.x, v.y - u.y) > DOG_BASIC.len + v.r) continue;
    if (Math.abs(angDiff(Math.atan2(v.y - u.y, v.x - u.x), ang)) > DOG_BASIC.half) continue;
    hurt(v, dmg, u, { basic: 1 });
    hits++;
  }
  for (i = seeds.length - 1; i >= 0; i--) {
    var sd = seeds[i];
    if (sd.team === u.team) continue;
    if (Math.hypot(sd.x - u.x, sd.y - u.y) > DOG_BASIC.len + sd.r) continue;
    if (Math.abs(angDiff(Math.atan2(sd.y - u.y, sd.x - u.x), ang)) > DOG_BASIC.half) continue;
    hurtSeed(sd, dmg, u);
    if (sd.hp <= 0) destroySeed(i, '种子被声波震碎');
  }

  // 声波演出：三层扩散弧，复用 ultBeams 数组
  ultBeams.push({
    kind: 'bark', x1: u.x, y1: u.y, ang: ang, half: DOG_BASIC.half,
    len: DOG_BASIC.len, life: 0.3, max: 0.3, color: '#ffcf8a'
  });
  ring(u.x, u.y, u.r, DOG_BASIC.len, 0.28, '#ffcf8a');
  return hits;
}

/* 技能加攻目标：只给队友（不含自己）；1v1 没有队友时不生效 */
function dogBuffTarget(u) {
  var best = null, bestAtk = -1, bestD = 1e9;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team !== u.team || v === u) continue;
    var d = Math.hypot(v.x - u.x, v.y - u.y);
    if (v.atk > bestAtk || (v.atk === bestAtk && d < bestD)) {
      best = v;
      bestAtk = v.atk;
      bestD = d;
    }
  }
  return best;
}

/* 临时加攻：直接抬高 u.atk，由 tick() 在到期时还原。
   同一目标重复获得时先撤掉旧值，只保留最新一次，避免叠乘。 */
function dogApplyAtkBuff(target, add, dur) {
  if (!target || !target.alive || !(add > 0)) return;
  if (target.atkBuffT > 0 && target.atkBuffAdd) target.atk -= target.atkBuffAdd;
  target.atkBuffAdd = add;
  target.atkBuffT = dur;
  target.atk += add;
  ring(target.x, target.y, target.r, target.r + 34, 0.4, '#ffd166');
  floater(target.x, target.y - target.r - 26, '攻击 +' + Math.round(add), '#ffd166', 13);
}

/* 终结技引导：每 0.1 秒结算一段，前/中/后三段使用不同倍率；
   最后 10 段每段额外叠 5 层灼烧。光束缓慢追踪最近敌人，本体保持原地。 */
function dogUltLaserTick(u, dt) {
  var foe = nearestEnemy(u);
  if (foe) {
    var want = Math.atan2(foe.y - u.y, foe.x - u.x);
    var diff = angDiff(want, u.st.ultLaserAng);
    var step = DOG_ULT.trackRate * dt;
    if (diff > step) diff = step;
    else if (diff < -step) diff = -step;
    u.st.ultLaserAng += diff;
  }

  // 用累计时间决定这一帧应该结算到第几段，避免浮点漂移导致少打一段
  u.st.ultHitPulse = Math.max(0, (u.st.ultHitPulse || 0) - dt * 6);
  u.st.ultLaserT = Math.max(0, u.st.ultLaserT - dt);
  u.st.ultLaserElapsed += dt;
  var due = Math.min(DOG_ULT.ticks,
    Math.floor(u.st.ultLaserElapsed / DOG_ULT.interval + 1e-4));
  while (u.st.ultLaserN < due) {
    u.st.ultLaserN++;
    var n = u.st.ultLaserN;
    var pct = n >= DOG_ULT.ticks ? DOG_ULT.finalPct
      : (n <= DOG_ULT.split1 ? DOG_ULT.pctEarly
        : (n <= DOG_ULT.split2 ? DOG_ULT.pctMid : DOG_ULT.pctLate));

    u.st.laserAng = u.st.ultLaserAng;
    var hits = laserStrike(u, {
      len: DOG_ULT.len, width: DOG_ULT.width, dmg: u.atk * pct,
      multi: 1, slowMul: DOG_ULT.slowMul, slowTime: DOG_ULT.slowTime
    });
    if (hits.length) u.st.ultHitPulse = 1;   // 激光随每一段命中闪一下
    if (n > DOG_ULT.split2) {
      for (var i = 0; i < hits.length; i++) redApplyBurn(hits[i], u, DOG_ULT.burn);
    }
    // 最后一击：额外命中环 + 火花 + 轻微震屏，和第 49 段区分开
    if (n >= DOG_ULT.ticks) {
      for (var h = 0; h < hits.length; h++) {
        ring(hits[h].x, hits[h].y, hits[h].r, hits[h].r + 44, 0.38, '#fff4d6');
        burst(hits[h].x, hits[h].y, 10, '#ffcf8a', 230);
      }
      if (hits.length) shake = Math.max(shake, 3);
    }
  }

  if (u.st.ultLaserN >= DOG_ULT.ticks) {
    u.st.ultLaserT = 0;
    ring(u.x, u.y, u.r, u.r + 150, 0.5, '#ffcf8a');
    burst(u.x, u.y, 22, '#ffe0a8', 260);
  }
}

TYPES.dog = {
  key: 'dog', name: '大狗', role: '远程 / 团队增益',
  r: 28, maxHp: 2000, baseSpeed: 205, atk: 100, def: 90,
  energyMax: 100, energyRegen: 2.0,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  /* 没有撞击伤害：输出全部来自声波与激光 */
  impact: false,
  body: '#b5723a', light: '#f2cf9a', dark: '#5a3216', glow: '#ffb765',
  basic: DOG_BASIC,
  skill: {
    name: '长激光', cd: DOG_SKILL.cd, noTurn: true, dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '朝最近敌人发射一束长激光（160% 攻击力），释放回能 60，并为攻击力最高的队友提供 +20 攻击力，持续 3 秒'
  },
  ultimate: {
    name: '终极咆哮',
    text: '原地引导 5 秒激光（50 段，缓慢追踪，逐段飘字）：前 20 段每段 5% / 中间 20 段 8% / 最后 10 段 12% 攻击力；最后一击 20% 攻击力并施加灼烧；命中期间减速 50%'
  },
  passive: {
    name: '厚皮',
    text: '受到的撞击伤害 ×0.85（体型大、皮厚；技能 / DoT 不减免）'
  },
  // 终结技激光的绘制参数（伤害段数在 DOG_ULT 里）
  ultLaser: { dur: DOG_ULT.dur, ticks: DOG_ULT.ticks, len: DOG_ULT.len, width: DOG_ULT.width },

  createState: function () {
    return {
      basicCd: 1.0,
      ultLaserT: 0, ultLaserAng: 0, ultLaserElapsed: 0, ultLaserN: 0, ultHitPulse: 0
    };
  },

  // 6s CD；终结技引导中不再施放普通技能
  canCast: function (u) {
    return !(u.st.ultLaserT > 0);
  },

  onCast: function (u) {
    gainEnergy(u, DOG_SKILL.energyGain);

    var foe = nearestEnemy(u);
    var ang = foe ? Math.atan2(foe.y - u.y, foe.x - u.x) : u.ang;
    spawnUltBeam(u, ang, {
      len: DOG_SKILL.len, width: DOG_SKILL.width,
      dmg: u.atk * DOG_SKILL.pct, color: '#ffcf8a', life: DOG_SKILL.life
    });

    var tgt = dogBuffTarget(u);
    if (tgt) dogApplyAtkBuff(tgt, TYPES.dog.atk * DOG_SKILL.buffPct, DOG_SKILL.buffTime);

    ring(u.x, u.y, u.r, 120, 0.4, '#ffcf8a');
    burst(u.x, u.y, 10, '#ffe0a8', 190);
    floater(u.x, u.y - u.r - 18, '长激光', '#ffcf8a', 13);
  },

  onTick: function (u, dt) {
    // 1) 终结技引导：5 秒激光期间不普攻、不施放其它技能
    if (u.st.ultLaserT > 0) {
      dogUltLaserTick(u, dt);
      return;
    }

    // 2) 普攻：每 2 秒向前方发出汪声波
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    if (!nearestEnemy(u)) return;
    u.st.basicCd = DOG_BASIC.cd;
    var hits = dogBark(u);
    if (hits > 0) gainEnergy(u, DOG_BASIC.energy);
    floater(u.x, u.y - u.r - 16, '汪声波', '#ffcf8a', 11);
  },

  // 厚皮：受到的撞击伤害 ×0.85（只在 dmgOf 的碰撞通道调用）
  onDamaged: function (u, dmg) { return dmg * 0.85; },

  // 终结技：原地引导 5 秒激光，方向缓慢追踪最近敌人
  onUlt: function (u) {
    var foe = nearestEnemy(u);
    u.dashT = 0;
    u.dmgMult = 1;
    u.st.ultLaserAng = foe ? Math.atan2(foe.y - u.y, foe.x - u.x) : u.ang;
    u.st.ultLaserT = DOG_ULT.dur;
    u.st.ultLaserElapsed = 0;
    u.st.ultLaserN = 0;
    u.st.ultHitPulse = 0;
    ring(u.x, u.y, u.r, u.r + 140, 0.5, '#ffcf8a');
    burst(u.x, u.y, 20, '#ffe0a8', 280);
    floater(u.x, u.y - u.r - 26, '终极咆哮', '#ffcf8a', 15);
  },

  draw: function (u) { drawDog(u); }
};
