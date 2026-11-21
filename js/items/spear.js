/* 长矛：单点爆发，无羁绊
   从 index.html 的 TYPES 字面量中拆出；新增/修改该物品只动这个文件。
   2026-11-22 迁移到新体系：2000 HP / 100 攻击 / 120 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（3s）   短突进 0.16s@720，命中 180%，命中回能 5
     · 技能（5.5s） 贯穿突刺 0.4s@880，命中 340%，释放回能 15
     · 终结技       能量充满后 5 段连刺，每段 200% 攻击力 */
'use strict';

var SPEAR_BASIC = { cd: 3.0, dashTime: 0.16, dashSpeed: 720, pct: 1.8, energy: 5 };
var SPEAR_SKILL = { cd: 5.5, dashTime: 0.40, dashSpeed: 880, pct: 3.4, energy: 15 };
var SPEAR_ULT = { count: 5, dashTime: 0.16, dashSpeed: 1000, pct: 2.0, interval: 0.18 };

TYPES.spear = {
  key: 'spear', name: '长矛', role: '爆发 / 单点',
  r: 30, maxHp: 2000, baseSpeed: 216, atk: 100, def: 120,
  energyMax: 100, energyRegen: 1.8,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  /* 撞击伤害由 onAttack 决定：只有突刺期间才结算 */
  impact: true,
  body: '#b9c4d4', light: '#f4f8ff', dark: '#5b6678', glow: '#cfe0ff',
  basic: SPEAR_BASIC,
  skill: {
    name: '贯穿突刺', cd: SPEAR_SKILL.cd,
    dashSpeed: SPEAR_SKILL.dashSpeed, dashTime: SPEAR_SKILL.dashTime, dmgMult: 1,
    text: '每 5.5 秒高速贯穿突刺 0.4 秒（880 px/s），撞到敌人造成 240% 攻击力（命中回能 15）'
  },
  ultimate: {
    name: '五连贯穿',
    text: '能量充满后连续突刺 5 次，每段重新锁定最近敌人，命中造成 150% 攻击力'
  },
  passive: {
    name: '冲刺减伤',
    text: '冲刺期间承受伤害 ×0.55'
  },
  createState: function () {
    return { basicCd: 1.0, attackPct: 0, hitEnergy: 0, energyOnHit: false };
  },
  // 终结技连刺 150% / 突刺 240%（技能）或 120%（普攻）
  onAttack: function (u) {
    if (u.st.ultChain) return u.atk * SPEAR_ULT.pct;
    if (u.dashT > 0) return u.atk * (u.st.attackPct || SPEAR_BASIC.pct);
    return 0;
  },
  onCast: function (u) {
    u.st.attackPct = SPEAR_SKILL.pct;
    u.st.hitEnergy = SPEAR_SKILL.energy;
    u.st.energyOnHit = true;
    ring(u.x, u.y, u.r, 112, 0.3, '#dbe6ff');
    burst(u.x, u.y, 14, '#e6efff', 230);
    floater(u.x, u.y - u.r - 20, '贯穿突刺', '#e6efff', 12);
  },
  onHit: function (u) {
    if (!u.st.energyOnHit) return;
    u.st.energyOnHit = false;
    gainEnergy(u, u.st.hitEnergy);
  },
  // 终结技：5 段连刺，每段都由 updateUltChains 重新锁定最近敌人
  onUlt: function (u) {
    u.st.attackPct = SPEAR_ULT.pct;
    u.st.hitEnergy = 0;
    u.st.energyOnHit = false;
    startUltChain(u, {
      count: SPEAR_ULT.count, dashTime: SPEAR_ULT.dashTime, dashSpeed: SPEAR_ULT.dashSpeed,
      dmgMult: 1, interval: SPEAR_ULT.interval, label: '贯穿'
    });
    ring(u.x, u.y, u.r, 140, 0.4, '#e6efff');
    burst(u.x, u.y, 16, '#e6efff', 260);
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
  onTick: function (u, dt) {
    // 冲刺结束后清掉回能标记，避免下一次无关碰撞白送能量
    if (u.dashT <= 0 && u.st.energyOnHit) u.st.energyOnHit = false;
    if (u.st.ultChain) return;   // 终结技连刺期间不插入普攻突进

    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    var e = nearestEnemy(u);
    if (!e) return;
    u.st.basicCd = SPEAR_BASIC.cd;
    u.ang = Math.atan2(e.y - u.y, e.x - u.x);
    u.dashT = SPEAR_BASIC.dashTime;
    u.dashSpeed = SPEAR_BASIC.dashSpeed;
    u.dmgMult = 1;
    u.st.attackPct = SPEAR_BASIC.pct;
    u.st.hitEnergy = SPEAR_BASIC.energy;
    u.st.energyOnHit = true;
    ring(u.x, u.y, 8, 52, 0.2, '#dbe6ff');
    burst(u.x, u.y, 5, '#e6efff', 150);
  },
  draw: function (u) { drawSpear(u); }
};
