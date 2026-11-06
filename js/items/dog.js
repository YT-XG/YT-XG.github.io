/* 大狗：远程压制，无羁绊
   ------------------------------------------------------------
   · 咆哮激光（cd 7s，但**冷却从激光结束才开始计**）
     朝最近的敌人射出一道超长激光：方向在施放瞬间锁定，持续 4 秒；
     每 0.1 秒结算一段（每段 3 伤害，共 40 段），被光束扫到的敌人都吃伤害。
   · 大狗本体继续按自己的方向滑行，激光只是挂在身上的光束，不改 ang（noTurn）。
   ------------------------------------------------------------
   光束不追踪：敌人靠走位侧向躲开，符合"台球式直线运动"的模型。 */
'use strict';

TYPES.dog = {
  key: 'dog', name: '大狗', role: '远程 / 压制',
  r: 28, maxHp: 340, baseSpeed: 205, atk: 1.0,
  body: '#b5723a', light: '#f2cf9a', dark: '#5a3216', glow: '#ffb765',

  skill: {
    name: '咆哮激光', cd: 7.0, noTurn: true, dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '朝最近敌人射出一道超长激光：方向锁定，持续 4 秒、每 0.1 秒一段（3 伤害/段，共 40 段）；激光放完才开始计 7 秒冷却'
  },
  passive: {
    name: '厚皮',
    text: '受到的伤害 ×0.85（体型大、皮厚），靠激光在远距离持续压制'
  },
  // 激光参数：持续 / 段数 / 每段伤害 / 长度 / 判定宽度
  laser: { dur: 4.0, ticks: 40, dmg: 3, len: 900, width: 18, trackRate: 1.2 },

  createState: function () { return { laserT: 0, laserAng: 0, laserTick: 0 }; },

  // 激光没放完之前不再施放（CD 也不会被消耗）
  canCast: function (u) { return !(u.st.laserT > 0); },

  onCast: function (u) {
    var L = TYPES.dog.laser;
    var foe = nearestEnemy(u);
    // 方向锁定在施放瞬间：之后敌人怎么跑，光束都不会跟着转
    u.st.laserAng = foe ? Math.atan2(foe.y - u.y, foe.x - u.x) : u.ang;
    u.st.laserT = L.dur;
    u.st.laserTick = L.dur / L.ticks;   // 第一段在 0.1 秒后
    u.cd = 0;                            // 冷却等激光放完再开始走
    ring(u.x, u.y, u.r, 118, 0.4, '#ffb765');
    floater(u.x, u.y - u.r - 18, '咆哮激光', '#ffcf8a', 13);
  },

  onTick: function (u, dt) {
    var L = TYPES.dog.laser;
    if (!(u.st.laserT > 0)) return;

    // 光束以有限转速跟随最近的敌人（2.4 rad/s ≈ 137°/s）：
    // 高速横切的目标能甩开一部分，慢速/贴脸目标基本全程被照。
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

  draw: function (u) { drawDog(u); }
};
