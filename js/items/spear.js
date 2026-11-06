/* 长矛：单点爆发，无羁绊
   从 index.html 的 TYPES 字面量中拆出；新增/修改该物品只动这个文件。 */
'use strict';

TYPES.spear = {
  key: 'spear', name: '长矛', role: '爆发 / 单点',
  r: 30, maxHp: 366, baseSpeed: 216, atk: 1.30,
  body: '#b9c4d4', light: '#f4f8ff', dark: '#5b6678', glow: '#cfe0ff',
  skill: {
    name: '贯穿突刺', cd: 3.4,
    dashSpeed: 880, dashTime: 0.42, dmgMult: 2.1,
    text: '高速突刺（约 370px），撞击倍率 ×2.1'
  },
  passive: {
    name: '冲刺减伤',
    text: '冲刺期间承受伤害 ×0.6'
  },
  createState: function () { return {}; },
  onAttack: function (u, dmg) { return u.dashT > 0 ? dmg : 0; },
  onCast: function (u) {
    ring(u.x, u.y, u.r, 112, 0.3, '#dbe6ff');
    burst(u.x, u.y, 14, '#e6efff', 230);
    floater(u.x, u.y - u.r - 20, '贯穿突刺', '#e6efff', 12);
  },
  onDash: function (u, dt) {
    // 突刺期间允许极小幅度的追踪（仍属技能效果）
    var tgt = nearestEnemy(u);
    if (!tgt) return;
    var aim = Math.atan2(tgt.y - u.y, tgt.x - u.x);
    var diff = angDiff(aim, u.ang);
    u.ang += clamp(diff, -2.6 * dt, 2.6 * dt);
  },
  onDamaged: function (u, dmg) {
    return u.dashT > 0 ? dmg * BALANCE.spearDashDR : dmg;
  },
  draw: function (u) { drawSpear(u); }
};
