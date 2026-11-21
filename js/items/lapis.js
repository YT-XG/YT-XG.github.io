/* 青金石块：辅助 / 续航，羁绊伙伴 red
   2026-11-22 重做：2000 HP / 100 攻击 / 120 防御，
   普攻改为 3 秒冲撞，技能改为随机附魔，终结技由能量条驱动。 */
'use strict';

var LAPIS_BASIC = { cd: 3.0, dashTime: 0.28, dashSpeed: 560, pct: 1.4, energy: 5 };
var LAPIS_ULT = { count: 6, dashTime: 0.24, dashSpeed: 600, pct: 1.3, interval: 0.14 };
var LAPIS_ENCHANT_CAP = { atk: 8, hp: 8, shield: 300, speed: 5, selfAtk: 8 };
var LAPIS_ENCHANT_STEP = { atk: 0.10, hp: 80, shield: 100, speed: 0.06, selfAtk: 0.10 };

function lapisFindRed(u) {
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (v.alive && v.team === u.team && v.key === 'red') return v;
  }
  return null;
}

/* 随机附魔：只从「还没到上限」的选项里抽，避免抽到无效项。
   1 红石普攻 +10% / 2 自身生命 +80 / 3 自身护盾 +100 / 4 自身移速 +6% / 5 自身普攻 +10% */
function lapisApplyEnchant(u) {
  var st = u.st;
  var red = lapisFindRed(u);
  var pool = [];
  if (red && (red.st.enchantAtk || 0) < LAPIS_ENCHANT_CAP.atk) pool.push(1);
  if ((st.eHp || 0) < LAPIS_ENCHANT_CAP.hp) pool.push(2);
  if ((st.shield || 0) < LAPIS_ENCHANT_CAP.shield) pool.push(3);
  if ((st.eSpeed || 0) < LAPIS_ENCHANT_CAP.speed) pool.push(4);
  if ((st.eAtk || 0) < LAPIS_ENCHANT_CAP.selfAtk) pool.push(5);
  if (!pool.length) return 0;

  var choice = pool[Math.floor(rand(0, pool.length)) % pool.length];
  st.lastEnchant = choice;
  if (choice === 1) {
    red.st.enchantAtk = (red.st.enchantAtk || 0) + 1;
  } else if (choice === 2) {
    st.eHp = (st.eHp || 0) + 1;
    u.maxHp += LAPIS_ENCHANT_STEP.hp;
    u.hp = Math.min(u.maxHp, u.hp + LAPIS_ENCHANT_STEP.hp);
  } else if (choice === 3) {
    st.shield = Math.min(LAPIS_ENCHANT_CAP.shield, (st.shield || 0) + LAPIS_ENCHANT_STEP.shield);
    st.shieldT = 0;   // 不按时间消失，只被伤害打掉
  } else if (choice === 4) {
    st.eSpeed = (st.eSpeed || 0) + 1;
    st.speedAdd = Math.min(LAPIS_ENCHANT_CAP.speed * LAPIS_ENCHANT_STEP.speed,
      (st.speedAdd || 0) + LAPIS_ENCHANT_STEP.speed);
  } else {
    st.eAtk = (st.eAtk || 0) + 1;
  }
  return choice;
}

function lapisBasicMul(u) {
  return 1 + LAPIS_ENCHANT_STEP.selfAtk * (u.st.eAtk || 0);
}

TYPES.lapis = {
  key: 'lapis', name: '青金石块', role: '辅助 / 续航', bond: 'red',
  r: 24, maxHp: 2000, baseSpeed: 200, atk: 100, def: 120,
  energyMax: 100,
  calibrated: true,   // 伤害已按 2000 HP 口径校准，不乘 dmgScale
  impact: true,
  shieldMax: 300,     // 护盾条分母（附魔 3 号上限）
  body: '#2d5bd6', light: '#7ba2ff', dark: '#152a6b', glow: '#4a7bf0',
  basic: LAPIS_BASIC,
  skill: {
    name: '附魔折射', cd: 5.0,
    dashTime: 0, dashSpeed: 0, dmgMult: 1, energy: 8,
    text: '每 5 秒随机附魔 1 项（红石普攻 +10% / 生命上限 +80 / 护盾 +100 / 移速 +6% / 自身普攻 +10%），可叠加，效果显示在单位旁'
  },
  ultimate: {
    name: '折光连撞',
    text: '能量充满后连续冲撞 6 次，每次 130% 攻击力（按普攻伤害结算，吃自身普攻增伤）'
  },
  passive: {
    name: '折光护盾',
    text: '护盾上限 300；附魔可叠加，效果图标显示在单位旁边'
  },
  // 羁绊：红石阵亡后先无敌抖动 3 秒，随后提速 + 附魔提速
  rage: {
    speedMul: 1.4,
    skillCd: 3.0,
    status: '移速 ×1.4 · 附魔 5s → 3s'
  },
  rageCasts: true,
  createState: function () {
    return { basicCd: 1.0, energyOnHit: false, eHp: 0, eSpeed: 0, eAtk: 0, speedAdd: 0, lastEnchant: 0 };
  },
  // 普攻冲撞 140% / 终结技每段 130%，都吃自身普攻增伤（附魔 5）
  onAttack: function (u) {
    if (u.st.ultChain) return u.atk * LAPIS_ULT.pct * lapisBasicMul(u);
    if (u.dashT > 0) return u.atk * LAPIS_BASIC.pct * lapisBasicMul(u);
    return 0;
  },
  onCast: function (u) {
    u.cd = u.st.rage ? TYPES.lapis.rage.skillCd : TYPES.lapis.skill.cd;
    var n = lapisApplyEnchant(u);
    gainEnergy(u, TYPES.lapis.skill.energy);
    ring(u.x, u.y, u.r, 128, 0.45, '#6f9bff');
    burst(u.x, u.y, 14, '#8fb4ff', 170);
    if (n) floater(u.x, u.y - u.r - 20, '附魔', '#9cc0ff', 12);
  },
  onHit: function (u) {
    if (!u.st.energyOnHit) return;
    u.st.energyOnHit = false;
    gainEnergy(u, LAPIS_BASIC.energy);
  },
  onUlt: function (u) {
    startUltChain(u, {
      count: LAPIS_ULT.count, dashTime: LAPIS_ULT.dashTime,
      dashSpeed: LAPIS_ULT.dashSpeed, dmgMult: 1,
      interval: LAPIS_ULT.interval, label: '折光连撞'
    });
    ring(u.x, u.y, u.r, 160, 0.5, '#9cc0ff');
    burst(u.x, u.y, 24, '#8fb4ff', 320);
  },
  onTick: function (u, dt) {
    // 狂暴前的 3 秒无敌抖动：原地不动也不出手
    if (u.st.rage && u.st.rage.phase === 'shake') return;
    if (u.dashT <= 0 && u.st.energyOnHit) u.st.energyOnHit = false;
    if (u.st.ultChain) return;   // 终结技连撞期间不插入普攻冲刺

    var B = TYPES.lapis.basic;
    u.st.basicCd -= dt;
    if (u.st.basicCd > 0) return;
    var e = nearestEnemy(u);
    if (!e) return;
    u.st.basicCd += B.cd;
    u.ang = Math.atan2(e.y - u.y, e.x - u.x);
    u.dashT = B.dashTime;
    u.dashSpeed = B.dashSpeed;
    u.dmgMult = 1;
    u.st.energyOnHit = true;
    ring(u.x, u.y, 8, 46, 0.2, '#7ba2ff');
    burst(u.x, u.y, 6, '#8fb4ff', 140);
  },
  draw: function (u) { drawBlock(u); }
};
