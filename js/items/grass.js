/* 草：召唤 / 控制，无羁绊
   ------------------------------------------------------------
   2026-11-22 迁移到新体系：2000 HP / 100 攻击 / 100 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（3s）   320 范围内最近敌人 110 伤害 + 3 秒中毒 6/s，回能 5
     · 技能（12s）  生花：在当前位置种下种子（150 HP），回能 10
     · 终结技       全体敌人 350 直接伤害 + 5 秒中毒 20/s + 1.5 秒禁锢
   被动「捆绑」保留：每 6 秒向 220px 内最近的敌人伸藤蔓（定身 + 中毒）。
   种子治疗 8/s → 20/s；种子仍是独立实体，草阵亡可在种子上复活（最多 2 次）。
   ------------------------------------------------------------
   所有技能都不改 u.ang（noTurn / 纯被动），符合"只有技能冲刺与撞墙才转向"的模型。 */
'use strict';

var GRASS_BASIC = { cd: 3.0, range: 320, dmg: 130, poisonTime: 3.0, poisonDps: 8, energy: 5 };
var GRASS_SKILL = { cd: 12.0, energy: 10 };
var GRASS_ULT = { dmg: 450, poisonTime: 5.0, poisonDps: 24, bind: 1.5 };

TYPES.grass = {
  key: 'grass', name: '草', role: '召唤 / 控制',
  r: 25, maxHp: 2000, baseSpeed: 200, atk: 100, def: 100,
  energyMax: 100, energyRegen: 2.0,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  impact: true,   // 撞击恒为 0，输出来自普攻 / 中毒 / 终结技
  body: '#5fbf5a', light: '#c8f5b0', dark: '#2f6b2c', glow: '#9be36f',
  basic: GRASS_BASIC,
  skill: {
    name: '生花', cd: GRASS_SKILL.cd, noTurn: true, dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '每 12 秒在当前位置种下一颗种子：150 HP、不会移动、不挡路；每秒为 200px 内友军回复 20 HP。场上已有种子时不能再种，复活 2 次后也不再种（回能 10）'
  },
  ultimate: {
    name: '荆棘乐园',
    text: '能量充满后对全体敌人造成 350 直接伤害，并施加 5 秒中毒（每秒 20）与 1.5 秒禁锢'
  },
  passive: {
    name: '捆绑',
    text: '每 6 秒向 220px 内最近的敌人伸出藤蔓：命中后定身 2.4 秒，并中毒 5 秒、每秒 16 点伤害'
  },

  // 捆绑参数
  vine: { cd: 6.0, range: 220, root: 2.4, poisonTime: 5.0, poisonDps: 16 },
  // 种子参数：healRadius 与铁砧落点半径同量级，既能覆盖一小片战斗区、又不至于全场挂机回血
  seed: { hp: 150, r: 14, healRadius: 200, healPerSec: 20, hitCd: 0.35 },
  revivesAtSeed: true,   // 死亡时尝试在种子上复活（见 30-sim.js 的 queueRevive）
  maxRevives: 2,         // 最多靠种子复活 2 次，之后就是真死

  // 场上已经有自己的种子 / 复活次数已用尽 → 生花不可用（CD 不会被浪费）
  canCast: function (u) {
    if ((u.revives || 0) >= (TYPES.grass.maxRevives || 0)) return false;
    for (var i = 0; i < seeds.length; i++) if (seeds[i].team === u.team) return false;
    return true;
  },

  createState: function () {
    // 开局 1.5 秒后才有第一次捆绑，避免刚出生就无脑捆
    return { vineCd: 1.5, basicCd: 1.0 };
  },

  // 撞击恒为 0
  onAttack: function () { return 0; },

  onCast: function (u) {
    plantSeed(u, TYPES.grass.seed);
    gainEnergy(u, GRASS_SKILL.energy);
  },

  // 终结技：全体敌人直接伤害 + 中毒 + 禁锢（不改任何人的朝向）
  onUlt: function (u) {
    for (var i = 0; i < units.length; i++) {
      var v = units[i];
      if (!v.alive || v.team === u.team) continue;
      hurt(v, GRASS_ULT.dmg, u);
      if (!v.boss) v.bindT = Math.max(v.bindT, GRASS_ULT.bind);   // BOSS 免疫定身（中毒照常）
      v.poisonT = Math.max(v.poisonT, GRASS_ULT.poisonTime);
      v.poisonAcc = Math.min(v.poisonAcc, 1.0);
      v.poisonDps = GRASS_ULT.poisonDps;
      v.poisonSrc = u;
      ring(v.x, v.y, v.r, v.r + 36, 0.4, '#8ce06a');
    }
    ring(u.x, u.y, u.r, 420, 0.7, '#9be36f');
    burst(u.x, u.y, 30, '#c8f5b0', 320);
    floater(u.x, u.y - u.r - 26, '荆棘乐园', '#c8f5b0', 14);
  },

  onTick: function (u, dt) {
    // 1) 被动捆绑
    var V = TYPES.grass.vine;
    u.st.vineCd -= dt;
    if (u.st.vineCd <= 0) {
      u.st.vineCd += V.cd;
      tryVine(u, V);
    }

    // 2) 普攻：射程内最近敌人吃 110 + 3 秒中毒
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    var e = nearestEnemy(u);
    if (!e) return;
    if (Math.hypot(e.x - u.x, e.y - u.y) > GRASS_BASIC.range + e.r) return;
    u.st.basicCd = GRASS_BASIC.cd;
    hurt(e, GRASS_BASIC.dmg, u, { basic: 1 });
    e.poisonT = Math.max(e.poisonT, GRASS_BASIC.poisonTime);
    e.poisonAcc = Math.min(e.poisonAcc, 1.0);
    e.poisonDps = GRASS_BASIC.poisonDps;
    e.poisonSrc = u;
    gainEnergy(u, GRASS_BASIC.energy);
    ring(e.x, e.y, e.r, e.r + 34, 0.3, '#8ce06a');
    burst(e.x, e.y, 6, '#c8f5b0', 160);
    floater(e.x, e.y - e.r - 16, '缠绕', '#9be36f', 11);
  },

  draw: function (u) { drawGrass(u); }
};
