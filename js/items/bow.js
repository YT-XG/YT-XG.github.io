/* 弓箭：远程消耗，无羁绊
   从 index.html 的 TYPES 字面量中拆出；新增/修改该物品只动这个文件。
   2026-11-22 迁移到新体系：2000 HP / 100 攻击 / 80 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（2.2s） 自动射箭，每第 3 发为强化箭（普通 95 / 强化 150），每箭回能 4
     · 技能（6s）   三连速射：3 发普通箭（±0.18 rad，每发 110），回能 12
     · 终结技       9 发扇形穿透箭，每发 80 */
'use strict';

var BOW_BASIC = { cd: 2.2, energy: 4 };
var BOW_SKILL = { cd: 6.0, dmg: 110, spread: 0.18, energy: 12 };
var BOW_ULT = { count: 9, dmg: 80, spread: 0.115, speed: 820, life: 1.05, hitR: 5 };

TYPES.bow = {
  key: 'bow', name: '弓箭', role: '远程 / 持续',
  r: 22, maxHp: 2000, baseSpeed: 280, atk: 100, def: 80,
  energyMax: 100, energyRegen: 2.2,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  impact: true,   // 撞击恒为 0（onAttack 返回 0），伤害全部来自箭矢
  body: '#5f8f4a', light: '#b9df9a', dark: '#2e4626', glow: '#a4e86b',
  // 技能只负责瞄准射击，不冲刺、不转向
  basic: BOW_BASIC,
  skill: {
    name: '连珠箭', cd: BOW_SKILL.cd, noTurn: true,
    dashSpeed: 0, dashTime: 0, dmgMult: 1,
    text: '每 6 秒三连速射：向最近敌人方向 ±0.18 rad 射出 3 发普通箭，每发 110 伤害（回能 12）'
  },
  ultimate: {
    name: '万箭齐发',
    text: '能量充满后扇形射出 9 支穿透箭（±0.46 rad），每支 80 伤害'
  },
  passive: {
    name: '强化箭',
    text: '每第 3 支箭强化：箭速 880（普通 640）、可穿透、伤害 150（普通 95）'
  },
  // 箭矢参数：普通箭命中即消失；强化箭对每个敌人只结算一次并继续飞行
  arrow: {
    normal: { speed: 640, dmg: 95, life: 0.95, hitR: 5 },
    power: { speed: 880, dmg: 150, life: 0.95, hitR: 6 },
    cycle: 3, powerAt: 2
  },
  createState: function () { return { shots: 0, basicCd: 1.2 }; },
  // 常规模式普通撞击伤害为 0，所有伤害只来自箭
  onAttack: function () { return 0; },
  onCast: function (u) {
    // 三连速射：中间一发直射，左右各偏 0.18 rad
    fireArrow(u, false, { dmg: BOW_SKILL.dmg, spread: -BOW_SKILL.spread });
    fireArrow(u, false, { dmg: BOW_SKILL.dmg });
    fireArrow(u, false, { dmg: BOW_SKILL.dmg, spread: BOW_SKILL.spread });
    gainEnergy(u, BOW_SKILL.energy);
    floater(u.x, u.y - u.r - 20, '连珠箭', '#c9f59b', 12);
  },
  // 终结技：以敌人方向为中心扇形齐射 9 支穿透箭
  onUlt: function (u) {
    for (var i = -(BOW_ULT.count - 1) / 2; i <= (BOW_ULT.count - 1) / 2; i++) {
      fireArrow(u, true, {
        spread: i * BOW_ULT.spread,
        speed: BOW_ULT.speed, dmg: BOW_ULT.dmg, life: BOW_ULT.life, hitR: BOW_ULT.hitR
      });
    }
    ring(u.x, u.y, u.r, u.r + 80, 0.4, '#ffe08a');
    burst(u.x, u.y, 16, '#e8ffc0', 240);
  },
  onTick: function (u, dt) {
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    if (!nearestEnemy(u)) return;
    var C = TYPES.bow.arrow;
    u.st.basicCd = BOW_BASIC.cd;
    var power = u.st.shots === C.powerAt;
    u.st.shots = (u.st.shots + 1) % C.cycle;
    fireArrow(u, power);
    gainEnergy(u, BOW_BASIC.energy);
    floater(u.x, u.y - u.r - 20, power ? '强化箭' : '射击',
      power ? '#ffd166' : '#c9f59b', 12);
  },
  draw: function (u) { drawBow(u); }
};
