/* 青金石块：辅助 / 续航，羁绊伙伴 red
   从 index.html 的 TYPES 字面量中拆出；新增/修改该物品只动这个文件。 */
'use strict';

TYPES.lapis = {
  key: 'lapis', name: '青金石块', role: '辅助 / 续航', bond: 'red',
  r: 24, maxHp: 200, baseSpeed: 200, atk: 1.0,
  body: '#2d5bd6', light: '#7ba2ff', dark: '#152a6b', glow: '#4a7bf0',
  skill: {
    name: '附魔折射', cd: 4.4,
    dashSpeed: 560, dashTime: 0.30, dmgMult: 1.15,
    text: '转向冲刺，撞击倍率 ×1.15'
  },
  passive: {
    name: '冰冻光环',
    text: '110px 内敌人持续减速（×0.6）'
  },
  shieldMax: 25,   // 护盾条的分母（狂暴期间每 3 秒刷新 25）
  // 羁绊：红石块阵亡后，青金石原地无敌抖动 3 秒，随后狂暴
  rage: {
    speedMul: 3,
    speedRampPerSec: 0.15,   // 与红石相同的速度递增
    speedMulCap: 6,
    dmgPerSec: 10,
    dmgCap: 100,       // 狂暴撞击的额外伤害上限（每秒 +10，最多累到 +100）
    ramp: true,
    hitCd: 5.0,        // 狂暴撞击的冷却：CD 没好时撞上去不掉血
    shield: { amount: 25, interval: 3.0 },   // 狂暴期间每 3 秒刷新 25 点护盾
    status: '移速 ×3 起 · 越跑越快 · 撞击伤害随秒数增加（每 5 秒一次，上限 +100） · 每 3 秒刷新护盾'
  },
  createState: function () { return { shield: 0, shieldT: 0, shieldCd: 0, rageHitCd: 0 }; },
  // 常规模式只有技能冲刺期间有撞击伤害；狂暴后撞击伤害随时间递增，
  // 但**每次命中后有 5 秒冷却**：CD 没好时撞上去不掉血，避免贴脸无限叠伤
  onAttack: function (u, dmg) {
    var R = u.st.rage;
    if (!R) return u.dashT > 0 ? dmg : 0;
    if (R.phase === 'shake') return 0;
    if ((u.st.rageHitCd || 0) > 0) return 0;
    u.st.rageHitCd = TYPES.lapis.rage.hitCd;
    var extra = Math.min(TYPES.lapis.rage.dmgCap, (t - R.since) * TYPES.lapis.rage.dmgPerSec);
    return dmg + extra;
  },
  onCast: function (u) {
    // 常规模式不再提供护盾（护盾只在狂暴期间周期刷新）
    ring(u.x, u.y, u.r, 128, 0.45, '#6f9bff');
    burst(u.x, u.y, 18, '#8fb4ff', 160);
    floater(u.x, u.y - u.r - 20, '附魔折射', '#9cc0ff', 12);
  },
  onTick: function (u, dt) {
    var cfg = BALANCE.lapisAura;
    for (var k = 0; k < units.length; k++) {
      var v = units[k];
      if (!v.alive || v.team === u.team) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) < cfg.radius) {
        v.slowT = Math.max(v.slowT, cfg.slowTime);
        v.slowMul = Math.min(v.slowMul || 1, BALANCE.slowSpeedMul);
      }
    }

    // 狂暴期间每 3 秒把护盾刷新到 25（不叠加）
    var R = u.st.rage;
    if (!R || R.phase !== 'rage') return;

    // 狂暴撞击的冷却计时（只在狂暴期间走）
    if (u.st.rageHitCd > 0) u.st.rageHitCd = Math.max(0, u.st.rageHitCd - dt);

    var S = TYPES.lapis.rage.shield;
    u.st.shieldCd -= dt;
    if (u.st.shieldCd <= 0) {
      u.st.shieldCd += S.interval;
      u.st.shield = S.amount;
      u.st.shieldT = S.interval;
      ring(u.x, u.y, u.r, 112, 0.4, '#8fb4ff');
      burst(u.x, u.y, 10, '#9cc0ff', 180);
      floater(u.x, u.y - u.r - 14, '护盾 ' + S.amount, '#9cc0ff', 12);
    }
  },
  onRageStart: function (u) {
    u.st.shieldCd = TYPES.lapis.rage.shield.interval;
    u.st.rageHitCd = 0;
    floater(u.x, u.y - u.r - 24, '撞击伤害开始累积', '#ffd166', 12);
  },
  draw: function (u) { drawBlock(u); }
};
