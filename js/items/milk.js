/* 野生狗奶：全域压制 / 引导，无羁绊
   ------------------------------------------------------------
   2026-11-22 迁移到新体系：2000 HP / 100 攻击 / 90 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（3s）   340 范围内最近敌人 110 伤害，自身回复 2% 最大生命，回能 5
     · 技能（12s）  原地引导 10 秒：每秒抽 3.2% 最大生命、自身每秒额外回能 2、180 点打断护盾
     · 终结技       所有敌人损失 12% 最大生命，自身回复 25% 最大生命
   ------------------------------------------------------------
   · 引导期间完全不可移动（speedOf 直接返回 0），受击先扣 180 点打断护盾，
     护盾打空立即打断，CD 从 0 重新计（= 完整 12 秒），不进入新的引导。
   · 百分比扣血统一走 hurt()：会被护盾吸收、计入 dealt / taken、能触发死亡与羁绊。
   · 撞击是技能：只有引导结束后的「收汁冲撞」（0.55s、撞击 180% 攻击力）才有撞击伤害。
   ------------------------------------------------------------
   技能本身不冲刺、不转向（noTurn）；收汁冲撞只加速、不改朝向。 */
'use strict';

var MILK_BASIC = { cd: 3.0, range: 340, dmg: 110, healPct: 0.02, energy: 5 };
var MILK_SKILL = { cd: 12.0, energyPerSec: 2 };
var MILK_ULT = { dmgPct: 0.12, healPct: 0.25 };
var MILK_DASH = { time: 0.55, speed: 820, pct: 1.8 };

TYPES.milk = {
  key: 'milk', name: '野生狗奶', role: '全域压制 / 引导',
  r: 26, maxHp: 2000, baseSpeed: 200, atk: 100, def: 90,
  energyMax: 100, energyRegen: 1.5,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  /* 撞击是技能：只有在「引导结束的收汁冲撞」冲刺期间才有撞击伤害 */
  impact: true,
  body: '#e6cfa8', light: '#fff4de', dark: '#8a6a44', glow: '#ffe0a0',
  basic: MILK_BASIC,
  skill: {
    name: '野性哺育', cd: MILK_SKILL.cd, noTurn: true,
    // 非冲刺型技能：不加速、不转向，只进入引导状态
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '原地引导 12 秒：自身不可移动、免疫伤害，并显示 180 点打断护盾（受击先扣护盾，打空立即打断）；' +
      '场上所有敌方单位与召唤物每秒损失 3.2% 最大生命，自身每秒额外回能 2。引导结束或被打断后才开始计 12 秒冷却；' +
      '引导结束时会沿当前方向收汁冲撞 0.55 秒（撞击 180% 攻击力）'
  },
  ultimate: {
    name: '野性反哺',
    text: '能量充满后立即抽取所有敌人 15% 最大生命（对种子 50%），并回复自身 25% 最大生命'
  },
  passive: {
    name: '野奶之躯',
    text: '引导期间普通撞击伤害为 0；引导结束时沿当前方向「收汁冲撞」0.55 秒（撞击 180% 攻击力），用来收割被扣到残血的目标'
  },

  /* 引导参数（唯一可调入口）
     · pctPerSec 每秒扣除目标最大生命的比例（0.032 = 3.2%，10 秒 = 32%）
     · dur       引导时长（秒）
     · shieldMax 引导期间的打断护盾（打空即打断，同时用作护盾条分母） */
  drain: { pctPerSec: 0.032, dur: 10.0 },
  shieldMax: 180,

  createState: function () { return { milkT: 0, milkAcc: 1.0, basicCd: 1.4 }; },

  // 引导期间不再重复施放（think() 不会消耗 CD）
  canCast: function (u) { return !(u.st.milkT > 0); },

  // 撞击只在「收汁冲撞」期间生效：其它时候贴上去不掉血
  onAttack: function (u) { return u.dashT > 0 ? u.atk * MILK_DASH.pct : 0; },

  onCast: function (u) {
    var D = TYPES.milk.drain;
    u.st.milkT = D.dur;
    u.st.milkAcc = 1.0;          // 满 1 秒后第一次扣血
    u.st.shield = TYPES.milk.shieldMax;   // 打断护盾：每次引导重置
    u.st.shieldT = 0;            // 不靠时间清空，只被伤害消耗
    u.cd = 0;                    // 引导结束 / 被打断后才开始计 CD
    u.dashT = 0; u.dashSpeed = 0; u.dmgMult = 1;
    u.trail.length = 0;          // 站定：清掉冲刺残影

    ring(u.x, u.y, u.r, u.r + 96, 0.6, '#ffe0a0');
    burst(u.x, u.y, 18, '#fff1cc', 200);
    floater(u.x, u.y - u.r - 20, '野性哺育', '#ffe9b0', 13);
  },

  // 终结技：立即抽取所有敌方单位 / 敌方种子的生命，并回复自身
  onUlt: function (u) {
    var i;
    for (i = 0; i < units.length; i++) {
      var v = units[i];
      if (!v.alive || v.team === u.team) continue;
      hurt(v, v.maxHp * MILK_ULT.dmgPct, u, { pct: 1 });
      ring(v.x, v.y, v.r, v.r + 40, 0.4, '#ffe0a0');
    }
    for (i = seeds.length - 1; i >= 0; i--) {
      var sd = seeds[i];
      if (sd.team === u.team) continue;
      hurtSeed(sd, sd.maxHp * 0.5, u, { pct: 1 });
      if (sd.hp <= 0) destroySeed(i, '种子被汲取');
    }
    var heal = u.maxHp * MILK_ULT.healPct;
    u.hp = Math.min(u.maxHp, u.hp + heal);
    floater(u.x, u.y - u.r - 26, '反哺 +' + Math.round(heal), '#ffe9b0', 14);
    ring(u.x, u.y, u.r, u.r + 110, 0.6, '#ffe0a0');
  },

  onTick: function (u, dt) {
    var D = TYPES.milk.drain;
    if (u.st.milkT > 0) {
      u.st.milkT -= dt;
      u.st.milkAcc -= dt;
      while (u.st.milkAcc <= 0 && u.st.milkT > 0) {
        u.st.milkAcc += 1.0;       // 每秒结算一次（倍速下可能一次跨多秒）
        milkDrain(u, D);
        gainEnergy(u, MILK_SKILL.energyPerSec);   // 引导期间额外回能
      }

      if (u.st.milkT <= 0) {       // 正常引导结束
        u.st.milkT = 0;
        u.st.shield = 0;           // 护盾属于本次引导，结束后一并清空
        u.cd = TYPES.milk.skill.cd;
        // 收汁冲撞：沿当前运动方向冲 0.55 秒，不改朝向（noTurn 红线）
        u.dashT = MILK_DASH.time;
        u.dashSpeed = MILK_DASH.speed;
        u.dmgMult = 1;
        ring(u.x, u.y, u.r, u.r + 70, 0.5, '#bfe2ff');
        floater(u.x, u.y - u.r - 22, '收汁冲撞', '#ffe9b0', 13);
      }
      return;   // 引导期间不普攻
    }

    // 普攻：射程内最近敌人吃 110，自身回复 2% 最大生命
    if (u.dashT > 0) return;
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    var e = nearestEnemy(u);
    if (!e) return;
    if (Math.hypot(e.x - u.x, e.y - u.y) > MILK_BASIC.range + e.r) return;
    u.st.basicCd = MILK_BASIC.cd;
    hurt(e, MILK_BASIC.dmg, u);
    var heal = u.maxHp * MILK_BASIC.healPct;
    u.hp = Math.min(u.maxHp, u.hp + heal);
    gainEnergy(u, MILK_BASIC.energy);
    ring(e.x, e.y, e.r, e.r + 30, 0.28, '#ffe0a0');
    floater(u.x, u.y - u.r - 14, '汲取 +' + Math.round(heal), '#ffe9b0', 11);
  },

  draw: function (u) { drawMilk(u); }
};

/* 角色贴图：使用资源目录里的本地 PNG（离线可用，无外链）。
   无头模拟 / 加载失败时 ok=false，绘制函数会退化为纯色剪影。 */
var MILK_SPRITE = { img: null, ok: false };
(function () {
  if (typeof Image === 'undefined') return;
  var im = new Image();
  im.onload = function () { MILK_SPRITE.ok = !!(im.naturalWidth && im.naturalHeight); };
  im.onerror = function () { MILK_SPRITE.ok = false; };
  im.src = 'assets/milk.png';
  MILK_SPRITE.img = im;
})();
