/* 草：治疗光环 / 中毒叠层，无羁绊
   ------------------------------------------------------------
   2026-11-22 重做：2500 HP / 100 攻击 / 100 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（3s）   320 范围内最近敌人「捆绑」：造成施放者生命上限 8% 的伤害，
                    并叠 1 层中毒，命中回能 5
     · 技能（8s / 释放回能 20） 在身边生成一圈光芒，持续 4 秒：
                    每秒为 200px 内友军（不含自己）回复 2% 生命上限，并给范围内敌人叠 1 层中毒
     · 终结技       先为我方全体回复 5% 生命上限，再让自身生命上限永久 +250
                    （= 基础生命 2500 的 10%，可无限叠加）
   ------------------------------------------------------------
   中毒是层数制 DoT：每层每秒造成「施放者生命上限 0.5%」的伤害，
   每秒结算一次并消耗 1 层（与红石灼烧 / 长矛破伤风同一节奏）。
   与所有 hurt() 伤害一样，中毒会先被目标防御减伤，再吃虚弱 / 脆弱 / BOSS 承伤倍率。
   捆绑只做伤害 + 中毒，不附带定身——用户需求里没有给控制时长。
   技能不冲刺、不转向（noTurn）；普通撞击伤害为 0。 */
'use strict';

var GRASS_BASIC = { cd: 3.0, range: 320, dmgPct: 0.08, poison: 1, energy: 5 };
var GRASS_SKILL = {
  cd: 8.0, energyGain: 20, dur: 4.0,
  radius: 200, healPct: 0.02, poisonPerSec: 1
};
var GRASS_ULT = { healPct: 0.05, hpGainPct: 0.10 };
/* 中毒：每层每秒按施放者生命上限的 0.5% 结算，结算后消耗 1 层 */
var GRASS_POISON = { pctPerStack: 0.005, interval: 1.0 };

/* 叠中毒层数：记录施放者生命上限快照（与红石灼烧记录 burnAtk 同理），
   草的终结技提高上限后，新叠的层数会同步变强；旧层数保留叠层时的数值。 */
function grassApplyPoison(v, src, n) {
  if (!v || !v.alive || !src || !(n > 0)) return;
  v.poisonStacks = (v.poisonStacks || 0) + n;
  v.poisonMhp = src.maxHp || 0;
  v.poisonSrc = src;
  if (!(v.poisonAcc > 0)) v.poisonAcc = GRASS_POISON.interval;
}

/* 每秒结算：当前层数 × 0.5% 施放者生命上限，然后消耗 1 层 */
function updatePoisons(dt) {
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive || !(u.poisonStacks > 0)) continue;
    u.poisonAcc -= dt;
    while (u.poisonAcc <= 0 && u.alive && u.poisonStacks > 0) {
      u.poisonAcc += GRASS_POISON.interval;
      hurt(u, u.poisonStacks * GRASS_POISON.pctPerStack * (u.poisonMhp || 0),
        u.poisonSrc, { dot: 1 });
      u.poisonStacks -= 1;
    }
    if (u.poisonStacks <= 0) {
      u.poisonStacks = 0;
      u.poisonSrc = null;
      u.poisonMhp = 0;
      u.poisonAcc = GRASS_POISON.interval;
    }
  }
}

/* 光环每秒脉冲：范围内友军（不含自己）回血、敌人叠中毒 */
function grassAuraPulse(u) {
  var S = GRASS_SKILL;
  var healed = 0, poisoned = 0, i;

  for (i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team !== u.team || v === u) continue;   // 只治疗队友，不治疗自己
    if (Math.hypot(v.x - u.x, v.y - u.y) > S.radius + v.r) continue;
    var heal = v.maxHp * S.healPct;
    if (v.hp >= v.maxHp) continue;
    v.hp = Math.min(v.maxHp, v.hp + heal);
    healed++;
  }
  for (i = 0; i < units.length; i++) {
    var e = units[i];
    if (!e.alive || e.team === u.team) continue;
    if (Math.hypot(e.x - u.x, e.y - u.y) > S.radius + e.r) continue;
    grassApplyPoison(e, u, S.poisonPerSec);
    poisoned++;
  }

  ring(u.x, u.y, u.r, S.radius, 0.45, 'rgba(155,227,111,.75)');
  if (healed) floater(u.x, u.y - u.r - 30, '回春 ' + healed, '#9be36f', 12);
  if (poisoned) burst(u.x, u.y, 5, '#c8f5b0', 150);
}

/* 捆绑：射程内最近敌人吃「施放者生命上限 8%」并叠 1 层中毒 */
function grassBind(u) {
  var e = nearestEnemy(u);
  if (!e) return false;
  if (Math.hypot(e.x - u.x, e.y - u.y) > GRASS_BASIC.range + e.r) return false;

  hurt(e, u.maxHp * GRASS_BASIC.dmgPct, u, { basic: 1 });
  grassApplyPoison(e, u, GRASS_BASIC.poison);

  vines.push({ x1: u.x, y1: u.y, x2: e.x, y2: e.y, life: 0.45, max: 0.45, hit: true });
  ring(e.x, e.y, e.r, e.r + 34, 0.3, '#8ce06a');
  burst(e.x, e.y, 6, '#c8f5b0', 160);
  floater(e.x, e.y - e.r - 16, '捆绑', '#9be36f', 11);
  return true;
}

TYPES.grass = {
  key: 'grass', name: '草', role: '治疗 / 中毒',
  r: 25, maxHp: 2500, baseSpeed: 200, atk: 100, def: 100,
  energyMax: 100, energyRegen: 2.0,
  /* 数值已按 2500 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  /* 没有撞击伤害：输出全部来自捆绑 / 中毒 / 光环 */
  impact: false,
  body: '#5fbf5a', light: '#c8f5b0', dark: '#2f6b2c', glow: '#9be36f',
  basic: GRASS_BASIC,
  skill: {
    name: '生辉', cd: GRASS_SKILL.cd, noTurn: true, dashTime: 0, dashSpeed: 0, dmgMult: 1,
    radius: GRASS_SKILL.radius,
    text: '在身边生成一圈光芒（半径 200），持续 4 秒：每秒为范围内友军（不含自己）回复 2% 生命上限，' +
      '并给范围内敌人叠加 1 层中毒；冷却 8 秒，释放回能 20'
  },
  ultimate: {
    name: '万物生长',
    text: '先为我方全体回复 5% 生命上限，再让自身生命上限永久提高 250（基础生命 2500 的 10%，可无限叠加）'
  },
  passive: {
    name: '缠绕',
    text: '普攻命中回复 5 能量；捆绑本身不附带定身'
  },

  // 光环参数（供渲染读取）
  aura: { radius: GRASS_SKILL.radius, dur: GRASS_SKILL.dur },

  createState: function () {
    return { basicCd: 1.0, auraT: 0, auraAcc: 1.0, hpGain: 0 };
  },

  onCast: function (u) {
    gainEnergy(u, GRASS_SKILL.energyGain);
    u.st.auraT = GRASS_SKILL.dur;
    u.st.auraAcc = 1.0;   // 满 1 秒后第一次脉冲
    ring(u.x, u.y, u.r, u.r + 90, 0.5, '#c8f5b0');
    burst(u.x, u.y, 14, '#d8ffbf', 200);
    floater(u.x, u.y - u.r - 20, '生辉', '#c8f5b0', 13);
  },

  onTick: function (u, dt) {
    // 1) 光环：持续 4 秒，每秒脉冲一次（最后一帧也结算，保证正好 4 次）
    if (u.st.auraT > 0) {
      u.st.auraT = Math.max(0, u.st.auraT - dt);
      u.st.auraAcc -= dt;
      while (u.st.auraAcc <= 1e-6) {   // 容忍浮点误差，保证 4 秒正好 4 次脉冲
        u.st.auraAcc += 1.0;
        grassAuraPulse(u);
      }
    }

    // 2) 普攻：每 3 秒捆绑射程内最近敌人
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    if (!nearestEnemy(u)) return;
    u.st.basicCd = GRASS_BASIC.cd;
    if (grassBind(u)) gainEnergy(u, GRASS_BASIC.energy);
  },

  // 终结技：先全体回血，再永久提高自身生命上限（当前生命不补）
  onUlt: function (u) {
    var i;
    for (i = 0; i < units.length; i++) {
      var v = units[i];
      if (!v.alive || v.team !== u.team) continue;
      var heal = v.maxHp * GRASS_ULT.healPct;
      v.hp = Math.min(v.maxHp, v.hp + heal);
      ring(v.x, v.y, v.r, v.r + 30, 0.4, '#9be36f');
      floater(v.x, v.y - v.r - 18, '回春 +' + Math.round(heal), '#c8f5b0', 12);
    }

    var add = TYPES.grass.maxHp * GRASS_ULT.hpGainPct;
    u.maxHp += add;
    u.st.hpGain = (u.st.hpGain || 0) + add;
    ring(u.x, u.y, u.r, u.r + 60, 0.5, '#c8f5b0');
    burst(u.x, u.y, 16, '#d8ffbf', 230);
    floater(u.x, u.y - u.r - 28, '生命上限 +' + Math.round(add), '#9be36f', 14);
  },

  draw: function (u) { drawGrass(u); }
};
