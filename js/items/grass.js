/* 草：召唤 / 控制，无羁绊
   ------------------------------------------------------------
   · 生花（主动技能，cd 20s）：在当前位置种下一颗种子（160 HP，不会移动、不挡路）
   · 种子是独立实体：有血条、只在血量归零时消失；普通贴身接触不再造成伤害，
     但敌方技能冲刺、箭矢、激光、铁砧落点、炸弹、冰面 DoT、狗奶引导等都能打掉它
   · 种子在场时每秒为 200px 内的友方单位（不含种子自身）回复 8 HP
   · 捆绑（被动自动技，cd 5s）：向 220px 内最近的敌人伸出藤蔓，命中后定身 3 秒，
     并中毒 5 秒、每秒 12 点伤害
   · 复活：草阵亡时，若场上还有自己种的种子，1 秒后在种子处按剩余血量复活（消耗那颗种子）
   ------------------------------------------------------------
   两个技能都不改 u.ang（noTurn / 纯被动），符合"只有技能冲刺与撞墙才转向"的模型。 */
'use strict';

TYPES.grass = {
  key: 'grass', name: '草', role: '召唤 / 控制',
  r: 25, maxHp: 480, baseSpeed: 200, atk: 1.0,
  body: '#5fbf5a', light: '#c8f5b0', dark: '#2f6b2c', glow: '#9be36f',

  skill: {
    name: '生花', cd: 20.0, noTurn: true, dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '每 20 秒在当前位置种下一颗种子：150 HP、不会移动、不挡路；只有血量归零才会消失（贴身接触不掉血，但敌方冲刺 / 箭矢 / 激光 / 铁砧 / 炸弹 / 冰面 / 狗奶引导都能打掉它）。场上已有种子时不能再种，复活 2 次后也不再种；草阵亡时若场上还有自己的种子，就按种子剩余血量在种子处复活'
  },
  ultimate: {
    name: '荆棘乐园', cd: 22.0, noTurn: true,
    text: '全场友军回复 20% 最大生命；同时定身所有敌人 2.5 秒并施加 6 秒中毒（每秒 12）'
  },
  passive: {
    name: '捆绑',
    text: '每 6 秒向 220px 内最近的敌人伸出藤蔓：命中后定身 2.4 秒，并中毒 5 秒、每秒 16 点伤害'
  },

  // 捆绑参数
  vine: { cd: 6.0, range: 220, root: 2.4, poisonTime: 5.0, poisonDps: 16 },
  // 种子参数：healRadius 与铁砧落点半径（200）／捆绑射程（220）同量级，
  // 既能覆盖一小片战斗区、又不至于让草"全场挂机回血"
  seed: { hp: 150, r: 14, healRadius: 200, healPerSec: 8, hitCd: 0.35 },
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

  // 终结技：全场友军回血 + 敌方定身中毒（不改任何人的朝向）
  onUlt: function (u) {
    for (var i = 0; i < units.length; i++) {
      var v = units[i];
      if (!v.alive) continue;
      if (v.team === u.team) {
        var heal = v.maxHp * 0.20;
        v.hp = Math.min(v.maxHp, v.hp + heal);
        floater(v.x, v.y - v.r - 18, '回春 +' + Math.round(heal), '#8ce06a', 12);
        ring(v.x, v.y, v.r, v.r + 42, 0.4, '#9be36f');
      } else {
        v.bindT = Math.max(v.bindT, 2.5);
        v.poisonT = Math.max(v.poisonT, 6.0);
        v.poisonAcc = Math.min(v.poisonAcc, 1.0);
        v.poisonSrc = u;
        ring(v.x, v.y, v.r, v.r + 36, 0.4, '#8ce06a');
      }
    }
    ring(u.x, u.y, u.r, 420, 0.7, '#9be36f');
    burst(u.x, u.y, 30, '#c8f5b0', 320);
    floater(u.x, u.y - u.r - 26, '万木回春', '#c8f5b0', 14);
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


