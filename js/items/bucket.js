/* 水桶：区域控制 / 持续伤害，无羁绊
   ------------------------------------------------------------
   · 涌泉（主动技能，cd 8s）：在**施放瞬间的位置**放出一滩水，水从圆心向四周
     扩散成一个圆（半径 190px，约 0.9 秒成型），持续 6 秒后再用 2 秒淡出；
     技能 CD 8 秒 = 6 + 2，水面完全退去后才能再放（对应「2 秒后可继续释放」）
   · 水面向圆心产生引力：越靠近圆心拉力越大（边缘 0 → 圆心 90 px/s）；
     拉力只拖拽**位置**，不修改 u.ang —— 离开水面后单位仍按原方向继续直线滑行，
     符合「只有技能冲刺与撞墙才转向」的红线
   · 敌方在水里连续待满 4 秒后，每秒损失 10% 最大生命（走通用 hurt()，
     会被护盾吸收、计入 dealt / taken、可触发死亡与羁绊）
   · 水只对敌方单位生效，不影响己方、不伤害种子
   ------------------------------------------------------------
   水本体是独立数组 waters（见 js/30-sim.js 的 spawnWater / updateWaters），
   绘制见 js/40-render.js 的 drawWaters / drawBucket。 */
'use strict';

TYPES.bucket = {
  key: 'bucket', name: '水桶', role: '区域控制 / 持续伤害',
  r: 28, maxHp: 500, baseSpeed: 200, atk: 1.15,
  body: '#3f86a8', light: '#dff2fb', dark: '#17475c', glow: '#7fd8ff',

  skill: {
    name: '涌泉', cd: 8.0, noTurn: true,
    // 非冲刺型技能：原地放水，不加速、不转向（dashTime 0）
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '每 8 秒在当前位置放出一滩水：半径 220px，约 0.9 秒从中心扩散成型；水持续 6 秒、再用 2 秒淡出，淡出途中仍然有引力与伤害，直到完全消失。水面向圆心产生引力（越靠圆心拉力越大）；敌方头顶出现「缺氧」计量，约 4 秒充满，充满后每秒损失 8% 最大生命；离开水面后缺氧值缓慢回落'
  },
  passive: {
    name: '浸水',
    text: '水是地面力场：只拖拽敌方位置、不改变移动方向；缺氧值离开水面后按 0.35/s 缓慢回落（约 11 秒清空），再次入水会继续累积'
  },

  /* 水参数（唯一可调入口）
     · r            水面最大半径
     · grow         从圆心扩散到最大半径的时间（秒）
     · hold         完整可见的时长（秒）；6 秒后开始淡出（fade）
     · fade         消退淡出时长（秒）——**淡出途中仍然结算引力与伤害**，
                    直到水面完全消失（age >= hold + fade）才停止
     · gravity      圆心处的最大拖拽速度（px/s），随「离圆心距离 / 半径」线性衰减到 0
     · wetThreshold 缺氧值充满需要的时间（秒）；充满后开始掉血
     · oxicDecay    离开水面时缺氧值的回落速度（每秒多少秒进度，0.35 ≈ 11 秒清空）
     · dotPct       充满后每秒扣除的最大生命比例（0.08 = 8%；因淡出途中仍结算，
                    单滩水的总伤害与"6 秒窗口 + 15%/s"基本持平） */
  water: {
    r: 220, grow: 0.9, hold: 6.0, fade: 2.0,
    gravity: 320, wetThreshold: 4.0, oxicDecay: 0.35,
    dotPct: 0.08, dotInterval: 1.0
  },

  createState: function () { return {}; },

  // 技能：只负责生成水面与表现，CD / 方向由 cast() 统一处理
  onCast: function (u) {
    var C = TYPES.bucket.water;
    spawnWater(u, u.x, u.y);
    ring(u.x, u.y, u.r, C.r, 0.5, '#bfeeff');
    burst(u.x, u.y, 16, '#cdefff', 220);
    floater(u.x, u.y - u.r - 20, '涌泉', '#9fe4ff', 13);
  },

  draw: function (u) { drawBucket(u); }
};
