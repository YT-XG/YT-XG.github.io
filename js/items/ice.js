/* 冰块：控场 / 续航，无羁绊
   从 index.html 的 TYPES 字面量中拆出；新增/修改该物品只动这个文件。 */
'use strict';

TYPES.ice = {
  key: 'ice', name: '冰块', role: '控制 / 续航',
  // 基础移速 300 → 240：比长矛的 216 仍快约 11%，但比原来慢 20%（明显放缓，仍能追近战）。
  // 落冰按"每 30px 一块（或最多 0.14s 一块）"执行，240 px/s 下 30px 仅需 0.125s，
  // 仍由距离触发、轨迹连续（冰面半径 48 ≫ 间距 30），不会出现断档。
  r: 26, maxHp: 660, baseSpeed: 240, atk: 1.0,
  body: '#6fd3e8', light: '#d8f7ff', dark: '#1f6f88', glow: '#9beeff',
  // 主动技能：沿"当前运动方向"突刺，noTurn 保证不改 ang（不追踪敌人）
  skill: {
    name: '冰霜突进', cd: 5.0, noTurn: true,
    dashSpeed: 900, dashTime: 0.3, dmgMult: 1,
    text: '每 5 秒沿当前运动方向突刺 0.3 秒（900 px/s，约 270px），不改变移动方向'
  },
  ultimate: {
    name: '极寒领域', cd: 20.0, noTurn: true,
    text: '冻结 400px 内所有敌人 2.2 秒并造成 45 伤害，同时在自身周围铺开一圈冰面'
  },
  passive: {
    name: '冰霜侵蚀',
    text: '敌人踩上冰面时移速 ×0.55，并在冰面上每秒受到 32 点伤害；自身 HP 低于 50% 时每 5 秒刷新 16 点护盾'
  },
  shieldMax: 16,   // 护盾条的分母（残血时每 5 秒刷新 16，护盾不叠加、不超时消失）
  // 冰面参数：半径 / 落点间距 / 存活(hold) + 淡出(fade) / 减速与持续伤害节奏
  iceTrail: {
    r: 56, spacing: 24, interval: 0.12,
    hold: 5.0, fade: 1.0,
    // slowMul 是冰块专属的减速系数（比青金石光环的 0.6 更强），只作用于踩冰的敌人
    dot: 32, dotInterval: 1.0, slowTime: 0.25, slowMul: 0.55
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
  // 终结技：范围冻结 + 一圈冰面（不改朝向，仍沿原方向滑行）
  onUlt: function (u) {
    var R = 400;
    for (var i = 0; i < units.length; i++) {
      var v = units[i];
      if (!v.alive || v.team === u.team) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) > R + v.r) continue;
      hurt(v, 45, u);
      v.bindT = Math.max(v.bindT, 2.2);   // 定身：speedOf 归零，方向不变
      ring(v.x, v.y, v.r, v.r + 46, 0.4, '#c8f6ff');
    }
    for (var k = 0; k < 12; k++) {
      var a = k / 12 * TAU;
      dropIcePatch(u, u.x + Math.cos(a) * 150, u.y + Math.sin(a) * 150);
    }
    ring(u.x, u.y, u.r, R, 0.75, '#d8f7ff');
    burst(u.x, u.y, 32, '#c8f6ff', 360);
    shake = Math.max(shake, 4);
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
