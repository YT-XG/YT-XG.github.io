/* 弓箭：远程消耗，无羁绊
   从 index.html 的 TYPES 字面量中拆出；新增/修改该物品只动这个文件。 */
'use strict';

TYPES.bow = {
  key: 'bow', name: '弓箭', role: '远程 / 持续',
  r: 22, maxHp: 360, baseSpeed: 280, atk: 1.0,
  body: '#5f8f4a', light: '#b9df9a', dark: '#2e4626', glow: '#a4e86b',
  // 技能只负责"瞄准 + 射击"，不冲刺；cd 就是发射间隔
  // 移速 320 → 280（2026-11-6 第 60 条：远程不该同时拥有全场最高移速）
  skill: {
    name: '连珠箭', cd: 3.0, noTurn: true,
    dashSpeed: 0, dashTime: 0, dmgMult: 1,
    text: '每 3 秒瞄准最近敌人射出一箭；每 2 支普通箭后下一支为强化箭'
  },
  passive: {
    name: '强化箭',
    text: '每第 3 支箭强化：箭速 880（普通 640）、可穿透、伤害 66（普通 48）'
  },
  // 箭矢参数：普通箭命中即消失；强化箭对每个敌人只结算一次并继续飞行
  arrow: {
    normal: { speed: 640, dmg: 48, life: 0.95, hitR: 4 },
    power: { speed: 880, dmg: 66, life: 0.95, hitR: 5 },
    cycle: 3, powerAt: 2
  },
  createState: function () { return { shots: 0 }; },
  // 常规模式普通撞击伤害为 0，所有伤害只来自箭
  onAttack: function () { return 0; },
  onCast: function (u) {
    var C = TYPES.bow.arrow;
    var power = u.st.shots === C.powerAt;
    u.st.shots = (u.st.shots + 1) % C.cycle;
    fireArrow(u, power);
    floater(u.x, u.y - u.r - 20, power ? '强化箭' : '连珠箭',
      power ? '#ffd166' : '#c9f59b', 12);
  },
  draw: function (u) { drawBow(u); }
};
