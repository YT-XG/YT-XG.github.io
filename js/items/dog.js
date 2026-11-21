/* 大狗：远程压制，无羁绊
   ------------------------------------------------------------
   2026-11-22 迁移到新体系：2000 HP / 100 攻击 / 90 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（3s）   短激光：长 560 / 宽 16 / 130 伤害（0.16 秒演出），回能 6
     · 技能（7s）   咆哮激光：方向锁定并缓慢跟踪，持续 4 秒、40 跳、每跳 9，释放回能 15
     · 终结技       三道激光同时扫射（角度略偏），每道 180
   激光伤害走通用的 laserStrike（每跳一段 DoT），命中多目标时有 aoeFalloff 衰减。
   ------------------------------------------------------------
   光束以 1.2 rad/s 缓慢转向最近敌人（只改光束角度、不改本体 ang），可被侧向走位甩开。 */
'use strict';

var DOG_BASIC = { cd: 3.0, len: 560, width: 16, dmg: 150, dur: 0.16, energy: 6 };
var DOG_SKILL = { cd: 7.0, energy: 15 };
var DOG_ULT = { count: 3, spread: 0.32, dmg: 240, len: 960, width: 26, life: 0.42 };

/* 一次性光束：先往 u.st.laserAng 写入本次角度再结算，演出复用 ultBeams（短寿命光柱） */
function dogBeam(u, ang, len, width, dmg, life, color) {
  var ex = u.x + Math.cos(ang) * len;
  var ey = u.y + Math.sin(ang) * len;
  ultBeams.push({
    x1: u.x, y1: u.y, x2: ex, y2: ey,
    life: life, max: life, color: color, width: width
  });
  var keep = u.st.laserAng;
  u.st.laserAng = ang;
  laserStrike(u, { len: len, width: width, dmg: dmg });
  u.st.laserAng = keep;
}

TYPES.dog = {
  key: 'dog', name: '大狗', role: '远程 / 压制',
  r: 28, maxHp: 2000, baseSpeed: 205, atk: 100, def: 90,
  energyMax: 100, energyRegen: 2.0,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  impact: true,   // 撞击恒为 0，输出全部来自激光
  body: '#b5723a', light: '#f2cf9a', dark: '#5a3216', glow: '#ffb765',
  basic: DOG_BASIC,
  skill: {
    name: '咆哮激光', cd: DOG_SKILL.cd, noTurn: true, dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '朝最近敌人射出一道超长激光：方向锁定，持续 4 秒、每 0.1 秒一段（9 伤害/段，共 40 段 ≈ 360）；激光放完才开始计 7 秒冷却（回能 15）'
  },
  ultimate: {
    name: '三重咆哮',
    text: '能量充满后瞬间朝敌人方向射出三道贯穿光束（±0.32 rad），每道 180 伤害'
  },
  passive: {
    name: '厚皮',
    text: '受到的伤害 ×0.85（体型大、皮厚），靠激光在远距离持续压制'
  },
  // 激光参数：持续 / 段数 / 每段伤害 / 长度 / 判定宽度
  laser: { dur: 4.0, ticks: 40, dmg: 11, len: 900, width: 20, trackRate: 1.2 },

  createState: function () { return { laserT: 0, laserAng: 0, laserTick: 0, basicCd: 1.6 }; },

  // 激光没放完之前不再施放（CD 也不会被消耗）
  canCast: function (u) { return !(u.st.laserT > 0); },

  // 撞击恒为 0
  onAttack: function () { return 0; },

  onCast: function (u) {
    var L = TYPES.dog.laser;
    var foe = nearestEnemy(u);
    // 方向锁定在施放瞬间：之后敌人怎么跑，光束都不会跟着转
    u.st.laserAng = foe ? Math.atan2(foe.y - u.y, foe.x - u.x) : u.ang;
    u.st.laserT = L.dur;
    u.st.laserTick = L.dur / L.ticks;   // 第一段在 0.1 秒后
    u.cd = 0;                            // 冷却等激光放完再开始走
    gainEnergy(u, DOG_SKILL.energy);
    ring(u.x, u.y, u.r, 118, 0.4, '#ffb765');
    floater(u.x, u.y - u.r - 18, '咆哮激光', '#ffcf8a', 13);
  },

  onTick: function (u, dt) {
    // 1) 普攻：每 3 秒一道短激光（一次性结算）
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd <= 0) {
      var be = nearestEnemy(u);
      if (be) {
        u.st.basicCd = DOG_BASIC.cd;
        var bAng = Math.atan2(be.y - u.y, be.x - u.x);
        dogBeam(u, bAng, DOG_BASIC.len, DOG_BASIC.width, DOG_BASIC.dmg, DOG_BASIC.dur, '#ffcf8a');
        gainEnergy(u, DOG_BASIC.energy);
        floater(u.x, u.y - u.r - 16, '激光', '#ffcf8a', 11);
      }
    }

    // 2) 技能：持续激光，每 0.1 秒结算一段
    var L = TYPES.dog.laser;
    if (!(u.st.laserT > 0)) return;

    var foe = nearestEnemy(u);
    if (foe) {
      var want = Math.atan2(foe.y - u.y, foe.x - u.x);
      var diff = angDiff(want, u.st.laserAng);
      var step = L.trackRate * dt;
      if (diff > step) diff = step;
      else if (diff < -step) diff = -step;
      u.st.laserAng += diff;
    }

    u.st.laserT -= dt;
    u.st.laserTick -= dt;
    while (u.st.laserTick <= 0 && u.st.laserT > 0) {
      u.st.laserTick += L.dur / L.ticks;
      laserStrike(u, L);
    }

    if (u.st.laserT <= 0) {
      u.st.laserT = 0;
      u.cd = TYPES.dog.skill.cd;   // 激光结束 → 从这里开始算 7 秒
      burst(u.x, u.y, 12, '#ffcf8a', 180);
    }
  },

  // 厚皮：受到的伤害 ×0.85
  onDamaged: function (u, dmg) { return dmg * 0.85; },

  // 终结技：三道瞬发光束（不等同于持续激光，不占用 laserT）
  onUlt: function (u) {
    var foe = nearestEnemy(u);
    var base = foe ? Math.atan2(foe.y - u.y, foe.x - u.x) : u.ang;
    for (var i = -1; i <= 1; i++) {
      dogBeam(u, base + i * DOG_ULT.spread, DOG_ULT.len, DOG_ULT.width, DOG_ULT.dmg, DOG_ULT.life, '#ffcf8a');
    }
    ring(u.x, u.y, u.r, u.r + 120, 0.4, '#ffcf8a');
    burst(u.x, u.y, 18, '#ffe0a8', 260);
  },

  draw: function (u) { drawDog(u); }
};
