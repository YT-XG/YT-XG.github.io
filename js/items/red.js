/* 红石块：莽夫 / 先手，羁绊伙伴 lapis
   从 index.html 的 TYPES 字面量中拆出；新增/修改该物品只动这个文件。 */
'use strict';

TYPES.red = {
  key: 'red', name: '红石块', role: '莽夫 / 先手', bond: 'lapis',
  r: 24, maxHp: 320, baseSpeed: 200, atk: 1.0,
  /* 撞击是技能：只有红石脉冲（冲刺）期间才按撞击强度结算伤害 */
  impact: true,
  body: '#c8342b', light: '#ff7a6a', dark: '#6d140e', glow: '#ff5a44',
  skill: {
    name: '红石脉冲', cd: 3.6,
    dashSpeed: 650, dashTime: 0.36, dmgMult: 1.7,
    text: '转向冲刺，撞击倍率 ×1.7'
  },
  ultimate: {
    name: '红石陨星', cd: 16.0,
    text: '在敌人周围空投 6 颗强化炸弹：半径 120px、每颗 70 伤害、1.3 秒引信'
  },
  passive: {
    name: '红石溅射',
    text: '技能冲刺撞击时对 96px 内敌人（含目标）造成 9 点溅射'
  },
  // 羁绊：青金石阵亡后，红石块原地无敌抖动 3 秒，随后狂暴
  rage: {
    speedMul: 3,
    speedRampPerSec: 0.15,   // 狂暴后每秒额外 +0.15 倍基础速度
    speedMulCap: 6,          // 移速倍率上限
    passThrough: true,       // 狂暴期间可穿透敌方
    status: '移速 ×3 起 · 越跑越快 · 可穿透敌方 · 沿途投掷炸弹',
    bomb: {
      interval: 0.4,          // 初始投弹间隔
      intervalRamp: 0.02,     // 每秒缩短的间隔
      intervalMin: 0.20,      // 最短投弹间隔
      fuse: 2.0, radius: 100, dmg: 20
    }
  },
  createState: function () { return { bombCd: 0 }; },
  // 常规模式只有技能冲刺期间有撞击伤害；狂暴后撞击伤害为 0（只靠炸弹）
  onAttack: function (u, dmg) {
    if (u.st.rage) return 0;
    return u.dashT > 0 ? dmg : 0;
  },
  onCast: function (u) {
    ring(u.x, u.y, 12, 96, 0.34, '#ff6b52');
    burst(u.x, u.y, 16, '#ff7a5f', 250);
    floater(u.x, u.y - u.r - 20, '红石脉冲', '#ff9c85', 12);
    shake = Math.max(shake, 3.5);
  },
  // 终结技：围绕敌人空投一圈强化炸弹（落点固定，不跟随）
  onUlt: function (u) {
    var e = nearestEnemy(u);
    var cx = e ? e.x : u.x, cy = e ? e.y : u.y;
    var A = ARENA;
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * TAU + t * 0.7;
      bombs.push({
        x: clamp(cx + Math.cos(a) * 92, A.x + 26, A.x + A.w - 26),
        y: clamp(cy + Math.sin(a) * 92, A.y + 26, A.y + A.h - 26),
        fuse: 1.3, max: 1.3,
        radius: 120, dmg: 70,
        team: u.team, owner: u, spin: rand(0, TAU)
      });
    }
    ring(cx, cy, 12, 170, 0.55, '#ffb14d');
    burst(cx, cy, 22, '#ffd166', 280);
    shake = Math.max(shake, 5);
  },
  onHit: function (u) {
    if (u.st.rage || u.dashT <= 0) return;   // 常规模式只有技能冲刺撞击才触发；狂暴后改为炸弹
    var cfg = BALANCE.redSplash;
    for (var k = 0; k < units.length; k++) {
      var v = units[k];
      if (!v.alive || v.team === u.team) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) < cfg.radius) hurt(v, cfg.dmg, u);
    }
  },
  onTick: function (u, dt) {
    var R = u.st.rage;
    if (!R || R.phase !== 'rage') return;
    var B = TYPES.red.rage.bomb;
    var interval = Math.max(B.intervalMin, B.interval - (t - R.since) * B.intervalRamp);
    u.st.bombCd -= dt;
    if (u.st.bombCd <= 0) {
      u.st.bombCd += interval;
      dropBomb(u);
    }
  },
  onRageStart: function (u) {
    u.st.bombCd = 0.18;
    ring(u.x, u.y, u.r, 150, 0.4, '#ffb14d');
    burst(u.x, u.y, 12, '#ffd166', 220);
    floater(u.x, u.y - u.r - 24, '开始投掷炸弹', '#ffd166', 12);
  },
  draw: function (u) { drawBlock(u); }
};
