/* 水桶：区域控制 / 持续伤害，无羁绊
   ------------------------------------------------------------
   2026-11-22 迁移到新体系：2000 HP / 100 攻击 / 105 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（3s）   320 范围内最近敌人 110 伤害，回能 5
     · 技能（8s）   涌泉：在当前位置放出一滩水（半径 220），回能 12
     · 终结技       每名敌人脚下各放一滩水 + 300 直接伤害，自身脚下也放一滩
   ------------------------------------------------------------
   · 水从圆心扩散成圆（约 0.9 秒成型），持续 6 秒后再用 2 秒淡出；
     淡出途中仍然有引力与伤害，直到完全消失
   · 水面向圆心产生引力，只拖拽位置、不修改 u.ang（离开水面后仍按原方向滑行）
   · 敌人在水里待满 4 秒后缺氧，每秒损失 6% 最大生命（走通用 hurt()）
   · 水只对敌方单位生效，不影响己方、不伤害种子 */
'use strict';

var BUCKET_BASIC = { cd: 3.0, range: 320, dmg: 110, energy: 5 };
var BUCKET_SKILL = { cd: 8.0, energy: 12 };
var BUCKET_ULT = { dmg: 300 };

TYPES.bucket = {
  key: 'bucket', name: '水桶', role: '区域控制 / 持续伤害',
  r: 28, maxHp: 2000, baseSpeed: 200, atk: 100, def: 105,
  energyMax: 100, energyRegen: 2.0,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  impact: true,   // 撞击恒为 0，输出全部来自普攻与水
  body: '#3f86a8', light: '#dff2fb', dark: '#17475c', glow: '#7fd8ff',
  basic: BUCKET_BASIC,
  skill: {
    name: '涌泉', cd: BUCKET_SKILL.cd, noTurn: true,
    // 非冲刺型技能：原地放水，不加速、不转向（dashTime 0）
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '每 8 秒在当前位置放出一滩水：半径 220px，约 0.9 秒从中心扩散成型；水持续 6 秒、再用 2 秒淡出，淡出途中仍然有引力与伤害。水面向圆心产生引力；敌方约 4 秒充满「缺氧」，之后每秒损失 6% 最大生命（回能 12）'
  },
  ultimate: {
    name: '洪流',
    text: '能量充满后在每名敌人脚下造成 300 伤害并各召出一滩水，同时在自身脚下召出一滩水'
  },
  passive: {
    name: '浸水',
    text: '水是地面力场：只拖拽敌方位置、不改变移动方向；缺氧值离开水面后按 0.35/s 缓慢回落（约 11 秒清空），再次入水会继续累积'
  },

  /* 水参数（唯一可调入口）
     · r            水面最大半径
     · grow         从圆心扩散到最大半径的时间（秒）
     · hold         完整可见的时长（秒）；6 秒后开始淡出（fade）
     · fade         消退淡出时长（秒）——淡出途中仍然结算引力与伤害
     · gravity      圆心处的最大拖拽速度（px/s），随离圆心距离线性衰减到 0
     · wetThreshold 缺氧值充满需要的时间（秒）
     · oxicDecay    离开水面时缺氧值的回落速度
     · dotPct       充满后每秒扣除的最大生命比例 */
  water: {
    r: 220, grow: 0.9, hold: 6.0, fade: 2.0,
    gravity: 180, wetThreshold: 4.0, oxicDecay: 0.35,
    dotPct: 0.06, dotInterval: 1.0
  },

  createState: function () { return { basicCd: 1.0 }; },

  // 撞击恒为 0
  onAttack: function () { return 0; },

  // 技能：只负责生成水面与表现，CD / 方向由 cast() 统一处理
  onCast: function (u) {
    var C = TYPES.bucket.water;
    spawnWater(u, u.x, u.y);
    gainEnergy(u, BUCKET_SKILL.energy);
    ring(u.x, u.y, u.r, C.r, 0.5, '#bfeeff');
    burst(u.x, u.y, 16, '#cdefff', 220);
    floater(u.x, u.y - u.r - 20, '涌泉', '#9fe4ff', 13);
  },

  // 终结技：每名敌人脚下 300 伤害 + 水，自身位置也放一滩（水面数量有 WATER_MAX 上限）
  onUlt: function (u) {
    for (var i = 0; i < units.length; i++) {
      var v = units[i];
      if (!v.alive || v.team === u.team) continue;
      hurt(v, BUCKET_ULT.dmg, u);
      spawnWater(u, v.x, v.y);
      ring(v.x, v.y, 12, TYPES.bucket.water.r, 0.55, '#bfeeff');
    }
    spawnWater(u, u.x, u.y);
    ring(u.x, u.y, 12, TYPES.bucket.water.r, 0.55, '#bfeeff');
    burst(u.x, u.y, 26, '#cdefff', 300);
    shake = Math.max(shake, 3.5);
  },

  onTick: function (u, dt) {
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    var e = nearestEnemy(u);
    if (!e) return;
    if (Math.hypot(e.x - u.x, e.y - u.y) > BUCKET_BASIC.range + e.r) return;
    u.st.basicCd = BUCKET_BASIC.cd;
    hurt(e, BUCKET_BASIC.dmg, u, { basic: 1 });
    gainEnergy(u, BUCKET_BASIC.energy);
    ring(e.x, e.y, e.r, e.r + 28, 0.26, '#9fe4ff');
    burst(e.x, e.y, 5, '#cdefff', 150);
  },

  draw: function (u) { drawBucket(u); }
};
