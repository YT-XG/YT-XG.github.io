/* 弓箭：远程消耗 / 持续伤害，无羁绊
   2026-11-22 重构：三箭轮转的普攻 + 三箭齐发的技能 + 大火箭终结技。
   三个技能槽：
     · 普攻（2s）   依次射出破伤风之箭 / 蛛丝之箭 / 火箭，命中回能 10
     · 技能（7s）   同时射出三种箭，全部命中合计回能 30
     · 终结技       大火箭 180% 攻击力，并立刻结算一次目标身上全部 DoT（不消耗层数）
   破伤风 / 灼烧沿用长矛、红石的叠层 DoT：倍率按「效果类型」统一，施加者只提供攻击力。 */
'use strict';

var BOW_BASIC = { cd: 2.0, energy: 10 };

var BOW_SKILL = { cd: 7.0, energy: 30, spread: 0.03 };

/* 三种箭：伤害全部是「攻击力百分比」，破伤风 / 灼烧层数走统一 DoT */
var BOW_ARROW = {
  tetanus: {
    kind: 'tetanus', name: '破伤风之箭', pct: 0.70,
    speed: 700, life: 1.0, hitR: 5, color: '#f0a070', stacks: 2
  },
  web: {
    kind: 'web', name: '蛛丝之箭', pct: 0.50,
    speed: 680, life: 1.0, hitR: 6, color: '#cfe6ff', bindTime: 2.0
  },
  fire: {
    kind: 'fire', name: '火箭', pct: 1.00,
    speed: 760, life: 1.0, hitR: 5, color: '#ff9a5f', stacks: 1
  }
};

var BOW_ULT = { pct: 1.8, speed: 720, life: 1.2, hitR: 12 };

TYPES.bow = {
  key: 'bow', name: '弓箭', role: '远程 / 持续伤害',
  r: 22, maxHp: 2000, baseSpeed: 280, atk: 100, def: 80,
  /* 能量只来自命中，不再有被动回能 */
  energyMax: 100,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  impact: true,   // 撞击恒为 0（onAttack 返回 0），伤害全部来自箭矢
  body: '#5f8f4a', light: '#b9df9a', dark: '#2e4626', glow: '#a4e86b',
  // 技能只负责瞄准射击，不冲刺、不转向
  basic: BOW_BASIC,
  skill: {
    name: '三箭齐发', cd: BOW_SKILL.cd, noTurn: true,
    dashSpeed: 0, dashTime: 0, dmgMult: 1,
    text: '每 7 秒同时向目标射出破伤风之箭 / 蛛丝之箭 / 火箭，三种效果同时结算（全部命中合计回能 30）'
  },
  ultimate: {
    name: '大火箭',
    text: '能量充满后射出大火箭：180% 攻击力，并立刻结算一次目标身上的持续伤害（不消耗层数）'
  },
  passive: {
    name: '三箭轮转',
    text: '普攻每 2 秒依次射出：破伤风之箭（70% + 2 层破伤风）/ 蛛丝之箭（50% + 定身 2s）/ 火箭（100% + 1 层灼烧）'
  },
  arrow: BOW_ARROW,
  createState: function () { return { shots: 0, basicCd: 1.0 }; },
  // 常规模式普通撞击伤害为 0，所有伤害只来自箭
  onAttack: function () { return 0; },
  // 技能：三种箭同时射向目标（角度只做极小的视觉散开）
  onCast: function (u) {
    var order = ['tetanus', 'web', 'fire'];
    var budget = { left: BOW_SKILL.energy };
    for (var i = 0; i < order.length; i++) {
      bowShoot(u, BOW_ARROW[order[i]], {
        energy: BOW_SKILL.energy, budget: budget,
        spread: (i - 1) * BOW_SKILL.spread
      });
    }
    floater(u.x, u.y - u.r - 20, '三箭齐发', '#c9f59b', 12);
  },
  // 终结技：大火箭，命中后立刻引爆目标身上的 DoT（不扣层数）
  onUlt: function (u) {
    bowShoot(u, {
      kind: 'rocket', name: '大火箭', pct: BOW_ULT.pct,
      speed: BOW_ULT.speed, life: BOW_ULT.life, hitR: BOW_ULT.hitR,
      color: '#ff8a4d'
    }, { settle: true, big: true });
    ring(u.x, u.y, u.r, u.r + 80, 0.4, '#ff9a5f');
    burst(u.x, u.y, 16, '#ffb066', 240);
  },
  onTick: function (u, dt) {
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    if (!nearestEnemy(u)) return;
    u.st.basicCd = BOW_BASIC.cd;
    var order = ['tetanus', 'web', 'fire'];
    var C = BOW_ARROW[order[u.st.shots % order.length]];
    u.st.shots = (u.st.shots + 1) % order.length;
    bowShoot(u, C, { energy: BOW_BASIC.energy, basic: 1 });
    floater(u.x, u.y - u.r - 20, C.name, C.color, 12);
  },
  draw: function (u) { drawBow(u); }
};

/* 按箭种配置发一支箭：伤害 = 攻击力 × pct */
function bowShoot(u, C, opts) {
  var o = opts || {};
  fireArrow(u, {
    kind: C.kind, dmg: u.atk * C.pct,
    speed: C.speed, life: C.life, hitR: C.hitR, color: C.color,
    energy: o.energy || 0, budget: o.budget || null,
    settle: !!o.settle, big: !!o.big, basic: o.basic ? 1 : 0,
    spread: o.spread || 0
  });
}






