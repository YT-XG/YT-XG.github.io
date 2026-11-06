/* 冰块：控场 / 续航，无羁绊
   从 index.html 的 TYPES 字面量中拆出；新增/修改该物品只动这个文件。 */
'use strict';

TYPES.ice = {
  key: 'ice', name: '冰块', role: '控制 / 续航',
  // 基础移速 300 → 240：比长矛的 216 仍快约 11%，但比原来慢 20%（明显放缓，仍能追近战）。
  // 落冰按"每 30px 一块（或最多 0.14s 一块）"执行，240 px/s 下 30px 仅需 0.125s，
  // 仍由距离触发、轨迹连续（冰面半径 48 ≫ 间距 30），不会出现断档。
  r: 26, maxHp: 420, baseSpeed: 240, atk: 1.0,
  body: '#6fd3e8', light: '#d8f7ff', dark: '#1f6f88', glow: '#9beeff',
  // 主动技能：沿"当前运动方向"突刺，noTurn 保证不改 ang（不追踪敌人）
  skill: {
    name: '冰霜突进', cd: 5.0, noTurn: true,
    dashSpeed: 900, dashTime: 0.3, dmgMult: 1,
    text: '每 5 秒沿当前运动方向突刺 0.3 秒（900 px/s，约 270px），不改变移动方向'
  },
  passive: {
    name: '冰霜侵蚀',
    text: '敌人踩上冰面时移速 ×0.55，并在冰面上每秒受到 15 点伤害；自身 HP 低于 50% 时每 5 秒刷新 10 点护盾'
  },
  shieldMax: 10,   // 护盾条的分母（残血时每 5 秒刷新 10，护盾不叠加、不超时消失）
  // 冰面参数：半径 / 落点间距 / 存活(hold) + 淡出(fade) / 减速与持续伤害节奏
  iceTrail: {
    r: 48, spacing: 30, interval: 0.14,
    hold: 5.0, fade: 1.0,
    // slowMul 是冰块专属的减速系数（比青金石光环的 0.6 更强），只作用于踩冰的敌人
    dot: 15, dotInterval: 1.0, slowTime: 0.25, slowMul: 0.55
  },
  createState: function () {
    return { shield: 0, shieldT: 0, shieldCd: 5, iceCd: 0, lastX: 0, lastY: 0 };
  },
  // 常规模式普通撞击伤害为 0：伤害只来自冰面
  onAttack: function () { return 0; },
  onCast: function (u) {
    // 只做表现：突进本身由 cast() 统一设置 dashT / dashSpeed，方向不变
    ring(u.x, u.y, u.r, 148, 0.38, '#9beeff');
    burst(u.x, u.y, 16, '#c8f6ff', 260);
    floater(u.x, u.y - u.r - 18, '冰霜突进', '#9beeff', 13);
  },
  onTick: function (u, dt) {
    var C = TYPES.ice.iceTrail;

    // 1) 残血护盾：只在 HP < 50% 最大生命时才推进 5 秒刷新计时；
    //    HP 回到 50% 以上就暂停（计时保留，重新跌破半血后继续倒数）。
    //    刷新是覆盖为 shieldMax（不叠加）；不设置 shieldT，所以不会被时间清空，
    //    只能由 hurt() 吸收伤害时消耗（见 hurt()）。
    if (u.hp < u.maxHp * 0.5) {
      u.st.shieldCd -= dt;
      if (u.st.shieldCd <= 0) {
        u.st.shieldCd += 5.0;
        u.st.shield = TYPES.ice.shieldMax;
        ring(u.x, u.y, u.r, 112, 0.4, '#9beeff');
        burst(u.x, u.y, 10, '#bff4ff', 150);
        floater(u.x, u.y - u.r - 14, '护盾 ' + TYPES.ice.shieldMax, '#9beeff', 12);
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
  },
  draw: function (u) { drawIce(u); }
};
