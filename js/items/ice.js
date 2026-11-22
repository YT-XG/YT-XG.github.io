/* 冰块：控场 / 持续伤害 / 易伤，无羁绊
   2026-11-22 重做：冰锥普攻 + 冰面陷阱 + 寒冷 DoT + 领域易伤。
   三个技能槽：
     · 普攻（3s）   向最近敌人发射冰锥，40% 攻击力，命中回能 10
     · 技能（4s）   原地生成半径 160 的冰面陷阱，持续 5s
     · 终结技       立刻结算一次寒冷 DoT（不结算其他 DoT），再给场上所有敌人施加 8s 脆弱
   天赋：每秒回复 4 点能量。
   寒冷：踩在陷阱上每秒 +1 层（上限 6），每层每秒造成施放者 15% 攻击力伤害；
         离开陷阱后每秒 -1 层，层数归零前伤害继续结算。 */
'use strict';

var ICE_BASIC = { cd: 3.0, pct: 0.40, energy: 10, speed: 700, life: 1.1, hitR: 6 };
var ICE_SKILL = { cd: 4.0 };
var ICE_ULT = { vuln: 0.20, vulnTime: 8.0 };
/* 寒冷：倍率按「效果类型」统一，施加者只提供攻击力 */
var ICE_COLD = { pctPerLayer: 0.15, maxStacks: 6, interval: 1.0, slowMul: 0.7, slowTime: 0.25 };

TYPES.ice = {
  key: 'ice', name: '冰块', role: '控制 / 持续伤害',
  r: 26, maxHp: 2000, baseSpeed: 240, atk: 100, def: 135,
  energyMax: 100, energyRegen: 4.0,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  /* 没有撞击伤害：所有输出来自冰锥与寒冷 DoT */
  impact: false,
  body: '#6fd3e8', light: '#d8f7ff', dark: '#1f6f88', glow: '#9beeff',
  basic: ICE_BASIC,
  skill: {
    name: '冰面陷阱', cd: ICE_SKILL.cd, noTurn: true,
    dashSpeed: 0, dashTime: 0, dmgMult: 1,
    text: '每 4 秒在当前位置生成半径 160 的冰面陷阱，持续 5 秒'
  },
  ultimate: {
    name: '极寒领域',
    text: '立刻结算一次寒冷伤害（不结算其他 DoT），再为场上所有敌人施加 8 秒脆弱：受到所有类型伤害 +20%'
  },
  passive: {
    name: '冰霜天赋',
    text: '每秒回复 4 点能量'
  },
  // 冰面陷阱参数：半径 / 持续时间 / 最后 fade 秒淡出（淡出期间仍生效）
  trap: { r: 160, hold: 5.0, fade: 0.5 },
  createState: function () { return { basicCd: 1.0, domainT: 0 }; },
  onCast: function (u) {
    dropIceTrap(u, u.x, u.y);
    ring(u.x, u.y, u.r, TYPES.ice.trap.r, 0.45, '#bfeeff');
    burst(u.x, u.y, 16, '#c8f6ff', 240);
    floater(u.x, u.y - u.r - 18, '冰面陷阱', '#9beeff', 13);
  },
  // 终结技：先结算寒冷（此时还没有脆弱加成），再给全场敌人挂脆弱
  onUlt: function (u) {
    var i, v;
    u.st.domainT = ICE_ULT.vulnTime;   // 领域持续与脆弱同长，绘制层据此切换场地主题
    for (i = 0; i < units.length; i++) {
      v = units[i];
      if (!v.alive || v.team === u.team || !(v.coldStacks > 0)) continue;
      var atk = v.coldAtk || (v.coldSrc && v.coldSrc.atk) || u.atk;
      hurt(v, v.coldStacks * ICE_COLD.pctPerLayer * atk, v.coldSrc || u, { dot: 1 });
      ring(v.x, v.y, v.r, v.r + 52, 0.4, '#c8f6ff');
    }
    for (i = 0; i < units.length; i++) {
      v = units[i];
      if (!v.alive || v.team === u.team) continue;
      v.vulnT = Math.max(v.vulnT || 0, ICE_ULT.vulnTime);
      v.vulnMul = 1 + ICE_ULT.vuln;   // 多次领域不叠乘，只刷新持续时间
      ring(v.x, v.y, v.r, v.r + 42, 0.45, '#c79bff');
    }
    ring(u.x, u.y, u.r, 560, 0.8, '#d8f7ff');
    burst(u.x, u.y, 30, '#c8f6ff', 340);
    shake = Math.max(shake, 5);
  },
  // 普攻：每 3 秒向最近敌人发射一支冰锥（命中回能由箭矢统一结算）
  onTick: function (u, dt) {
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    if (!nearestEnemy(u)) return;
    u.st.basicCd = ICE_BASIC.cd;
    fireArrow(u, {
      kind: 'iceshard', dmg: u.atk * ICE_BASIC.pct,
      speed: ICE_BASIC.speed, life: ICE_BASIC.life, hitR: ICE_BASIC.hitR,
      color: '#bfeeff', energy: ICE_BASIC.energy, basic: 1
    });
    floater(u.x, u.y - u.r - 20, '冰锥', '#bfeeff', 12);
  },
  draw: function (u) { drawIce(u); }
};
