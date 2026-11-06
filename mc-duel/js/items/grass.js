/* 草：召唤 / 控制，无羁绊
   ------------------------------------------------------------
   · 生花（主动技能，cd 8s）：在当前位置种下一颗种子（100 HP，不会移动、不挡路；
     敌方撞上去会打掉它）
   · 捆绑（被动自动技，cd 5s）：向 320px 内最近的敌人伸出藤蔓，命中后定身 3 秒，
     并中毒 5 秒、每秒 20 点伤害
   · 复活：草阵亡时，若场上还有自己种的种子，1 秒后在种子处满血复活（消耗那颗种子）
   ------------------------------------------------------------
   两个技能都不改 u.ang（noTurn / 纯被动），符合"只有技能冲刺与撞墙才转向"的模型。 */
'use strict';

TYPES.grass = {
  key: 'grass', name: '草', role: '召唤 / 控制',
  r: 25, maxHp: 300, baseSpeed: 200, atk: 1.0,
  body: '#5fbf5a', light: '#c8f5b0', dark: '#2f6b2c', glow: '#9be36f',

  skill: {
    name: '生花', cd: 20.0, noTurn: true, dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '每 20 秒在当前位置种下一颗种子（100 HP、不会移动）；场上已有种子时不能再种，复活 2 次后也不再种；草阵亡时若场上还有自己的种子，就按种子剩余血量在种子处复活'
  },
  passive: {
    name: '捆绑',
    text: '每 5 秒向 220px 内最近的敌人伸出藤蔓：命中后定身 3 秒，并中毒 5 秒、每秒 12 点伤害'
  },

  // 捆绑参数
  vine: { cd: 5.0, range: 220, root: 3.0, poisonTime: 5.0, poisonDps: 12 },
  // 种子参数
  seed: { hp: 100, r: 14 },
  revivesAtSeed: true,   // 死亡时尝试在种子上复活（见 30-sim.js 的 queueRevive）
  maxRevives: 2,         // 最多靠种子复活 2 次，之后就是真死

  // 场上已经有自己的种子 / 复活次数已用尽 → 生花不可用
  // （CD 不会被浪费：种子一消失就能立刻种；复活用尽后永久不再种）
  canCast: function (u) {
    if ((u.revives || 0) >= (TYPES.grass.maxRevives || 0)) return false;
    for (var i = 0; i < seeds.length; i++) if (seeds[i].team === u.team) return false;
    return true;
  },

  createState: function () {
    // 开局 1.5 秒后才有第一次捆绑，避免刚出生就无脑捆
    return { vineCd: 1.5 };
  },

  // 常规碰撞伤害照常（atk 1.0），伤害主要来自捆绑的中毒
  onCast: function (u) {
    plantSeed(u, TYPES.grass.seed);
  },

  onTick: function (u, dt) {
    var V = TYPES.grass.vine;
    u.st.vineCd -= dt;
    if (u.st.vineCd <= 0) {
      u.st.vineCd += V.cd;
      tryVine(u, V);
    }
  },

  draw: function (u) { drawGrass(u); }
};


