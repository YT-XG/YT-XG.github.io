/* 冰块：控场 / 续航，无羁绊
   从 index.html 的 TYPES 字面量中拆出；新增/修改该物品只动这个文件。
   2026-11-22 迁移到新体系：2000 HP / 100 攻击 / 135 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（3s）   自身 150 半径寒冰脉冲：90 伤害 + 1.5s 减速，每命中 1 人回能 3（单次封顶 6）
     · 技能（5s）   0.3s@900 突进，命中 160%，落点留下冰面，释放回能 12
     · 终结技       420 半径内冻结 2.2s + 300 伤害 + 自身 120 护盾
   被动仍是「移动落冰」+「残血刷新护盾」。 */
'use strict';

var ICE_BASIC = { cd: 3.0, radius: 150, dmg: 90, slow: 1.5, energy: 3, energyCap: 6 };
var ICE_SKILL = { cd: 5.0, dashTime: 0.30, dashSpeed: 900, pct: 1.6, energy: 12 };
var ICE_ULT = { radius: 420, freeze: 2.0, dmg: 220, shield: 120 };

TYPES.ice = {
  key: 'ice', name: '冰块', role: '控制 / 续航',
  r: 26, maxHp: 2000, baseSpeed: 240, atk: 100, def: 135,
  energyMax: 100, energyRegen: 2.0,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  impact: true,   // 只有突进期间有撞击伤害（onAttack），平时碰撞为 0
  body: '#6fd3e8', light: '#d8f7ff', dark: '#1f6f88', glow: '#9beeff',
  basic: ICE_BASIC,
  // 主动技能：朝最近敌人突刺 0.3 秒，命中 160% 攻击力
  skill: {
    name: '冰霜突进', cd: ICE_SKILL.cd,
    dashSpeed: ICE_SKILL.dashSpeed, dashTime: ICE_SKILL.dashTime, dmgMult: 1,
    text: '每 5 秒突刺 0.3 秒（900 px/s），撞到敌人造成 160% 攻击力并留下冰面（回能 12）'
  },
  ultimate: {
    name: '极寒领域',
    text: '能量充满后冻结 420px 内所有敌人 2.2 秒、造成 300 伤害，并给自身 120 点护盾'
  },
  passive: {
    name: '冰霜侵蚀',
    text: '敌人踩上冰面时移速 ×0.55，并在冰面上每秒受到 45 点伤害；自身 HP 低于 50% 时每 5 秒刷新 90 点护盾（上限 120）'
  },
  shieldMax: 120,   // 护盾条分母
  shieldAdd: 90,    // 残血被动每次刷新的护盾值
  // 冰面参数：半径 / 落点间距 / 存活(hold) + 淡出(fade) / 减速与持续伤害节奏
  iceTrail: {
    r: 54, spacing: 24, interval: 0.12,
    hold: 5.0, fade: 1.0,
    // slowMul 是冰块专属的减速系数（比青金石光环的 0.6 更强），只作用于踩冰的敌人
    dot: 45, dotInterval: 1.0, slowTime: 0.25, slowMul: 0.55
  },
  createState: function () {
    return { shield: 0, shieldT: 0, shieldCd: 5, iceCd: 0, lastX: 0, lastY: 0, basicCd: 1.4 };
  },
  // 只有突进期间按 160% 攻击力结算；平时碰撞伤害为 0
  onAttack: function (u) {
    return u.dashT > 0 ? u.atk * ICE_SKILL.pct : 0;
  },
  onCast: function (u) {
    // 突进本身由 cast() 统一设置 dashT / dashSpeed；这里补表现与落冰
    gainEnergy(u, ICE_SKILL.energy);
    dropIcePatch(u, u.x, u.y);
    ring(u.x, u.y, u.r, 148, 0.38, '#9beeff');
    burst(u.x, u.y, 16, '#c8f6ff', 260);
    floater(u.x, u.y - u.r - 18, '冰霜突进', '#9beeff', 13);
  },
  // 终结技：范围冻结 + 伤害 + 自身护盾（不改朝向，仍沿原方向滑行）
  onUlt: function (u) {
    var R = ICE_ULT.radius;
    for (var i = 0; i < units.length; i++) {
      var v = units[i];
      if (!v.alive || v.team === u.team) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) > R + v.r) continue;
      hurt(v, ICE_ULT.dmg, u);
      if (!v.boss) v.bindT = Math.max(v.bindT, ICE_ULT.freeze);   // 定身：speedOf 归零（BOSS 免疫）
      ring(v.x, v.y, v.r, v.r + 46, 0.4, '#c8f6ff');
    }
    u.st.shield = Math.min(TYPES.ice.shieldMax, (u.st.shield || 0) + ICE_ULT.shield);
    u.st.shieldT = 0;   // 不按时间消失，只被伤害打掉
    ring(u.x, u.y, u.r, R, 0.75, '#d8f7ff');
    burst(u.x, u.y, 32, '#c8f6ff', 360);
    shake = Math.max(shake, 4);
  },
  onTick: function (u, dt) {
    var C = TYPES.ice.iceTrail;

    // 1) 残血护盾：HP < 50% 时每 5 秒刷新 90 点（上限 120，不叠加、不过期）
    if (u.hp < u.maxHp * 0.5) {
      u.st.shieldCd -= dt;
      if (u.st.shieldCd <= 0) {
        u.st.shieldCd += 5.0;
        u.st.shield = Math.min(TYPES.ice.shieldMax, (u.st.shield || 0) + TYPES.ice.shieldAdd);
        ring(u.x, u.y, u.r, 112, 0.4, '#9beeff');
        burst(u.x, u.y, 10, '#bff4ff', 150);
        floater(u.x, u.y - u.r - 14, '护盾 ' + Math.round(u.st.shield), '#9beeff', 12);
      }
    }

    // 2) 按移动距离落冰：走到 spacing 或计时到 interval 就补一块，保证轨迹连续
    u.st.iceCd -= dt;
    var moved = Math.hypot(u.x - u.st.lastX, u.y - u.st.lastY);
    if (moved >= C.spacing || u.st.iceCd <= 0) {
      u.st.iceCd = C.interval;
      u.st.lastX = u.x; u.st.lastY = u.y;
      dropIcePatch(u, u.x, u.y);
    }

    // 3) 普攻：每 3 秒一次身周寒冰脉冲（伤害 + 短减速，命中回能，单次封顶）
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    var B = TYPES.ice.basic;
    var hits = 0;
    for (var i = 0; i < units.length; i++) {
      var v = units[i];
      if (!v.alive || v.team === u.team) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) > B.radius + v.r) continue;
      hurt(v, B.dmg, u);
      if (!v.boss) {
        v.slowT = Math.max(v.slowT, B.slow);
        v.slowMul = Math.min(v.slowMul || 1, C.slowMul);
      }
      hits++;
    }
    if (!hits) return;   // 没人吃到就等下一轮再放，避免空放脉冲刷屏
    u.st.basicCd = B.cd;
    gainEnergy(u, Math.min(B.energyCap, B.energy * hits));
    ring(u.x, u.y, u.r, B.radius, 0.32, '#bfeeff');
    burst(u.x, u.y, 12, '#c8f6ff', 210);
  },
  draw: function (u) { drawIce(u); }
};
