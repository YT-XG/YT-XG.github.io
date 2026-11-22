/* 青金石块：辅助 / 续航，羁绊伙伴 red
   2026-11-22 重做：2000 HP / 100 攻击 / 120 防御，
   普攻改为 3 秒冲撞，技能改为随机附魔，终结技由能量条驱动。 */
'use strict';

var LAPIS_BASIC = { cd: 3.0, dashTime: 0.28, dashSpeed: 560, pct: 1.4, energy: 5 };
var LAPIS_ULT = { count: 6, dashTime: 0.24, dashSpeed: 600, pct: 1.3, interval: 0.14 };
/* 附魔参数（2026-11-22 改版：4 项效果，只作用于红青两单位） */
var LAPIS_ENCHANT = {
  basicPctLayer: 0.20,   // 1 号：随机红 / 青，普攻伤害 +20%/层，无上限
  hpPctLayer: 0.05,      // 2 号：生命值较低者，生命上限 +5%/层（按基础生命）
  hpMaxLayers: 10,       // 2 号层数上限
  shield: 50,            // 3 号：红青护盾刷新为 50（不叠加）
  energy: 10             // 4 号：随机红 / 青能量 +10
};

/* 附魔作用范围：己方存活的红石块 / 青金石块 */
function lapisDuoUnits(u) {
  var out = [];
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (v.alive && v.team === u.team && (v.key === 'red' || v.key === 'lapis')) out.push(v);
  }
  return out;
}

/* 随机附魔：从「还有效果可生效」的选项里抽，避免抽到已满层的无效项。
   1 随机红/青普攻 +20%/层（无上限）
   2 生命值较低者生命上限 +5%（上限 10 层，同步增加当前生命）
   3 红青护盾刷新为 50
   4 随机红/青能量 +10 */
function lapisApplyEnchant(u) {
  var duo = lapisDuoUnits(u);
  if (!duo.length) return 0;

  var canHp = false, canEnergy = false;
  for (var i = 0; i < duo.length; i++) {
    var v = duo[i];
    if ((v.st.hpBuffLayers || 0) < LAPIS_ENCHANT.hpMaxLayers) canHp = true;
    if (v.energyMax && v.energy < v.energyMax) canEnergy = true;
  }

  var pool = [1, 3];
  if (canHp) pool.push(2);
  if (canEnergy) pool.push(4);

  var choice = pool[Math.floor(rand(0, pool.length)) % pool.length];

  if (choice === 1) {
    var t1 = duo[Math.floor(rand(0, duo.length)) % duo.length];
    t1.st.basicBuffLayers = (t1.st.basicBuffLayers || 0) + 1;
    floater(t1.x, t1.y - t1.r - 20,
      '普攻 +' + Math.round(t1.st.basicBuffLayers * LAPIS_ENCHANT.basicPctLayer * 100) + '%',
      '#ffd166', 12);
    ring(t1.x, t1.y, t1.r, t1.r + 30, 0.3, '#ffd166');
  } else if (choice === 2) {
    var low = null;
    for (var j = 0; j < duo.length; j++) {
      var v2 = duo[j];
      if ((v2.st.hpBuffLayers || 0) >= LAPIS_ENCHANT.hpMaxLayers) continue;
      if (!low || v2.hp < low.hp) low = v2;
    }
    if (low) {
      var base = TYPES[low.key].maxHp || low.maxHp;
      var add = base * LAPIS_ENCHANT.hpPctLayer;
      low.maxHp += add;
      low.hp = Math.min(low.maxHp, low.hp + add);   // 上限与当前生命同步增加
      low.st.hpBuffLayers = (low.st.hpBuffLayers || 0) + 1;
      floater(low.x, low.y - low.r - 20, '生命上限 +5%', '#8ce06a', 12);
      ring(low.x, low.y, low.r, low.r + 34, 0.35, '#8ce06a');
    }
  } else if (choice === 3) {
    for (var k = 0; k < duo.length; k++) {
      var v3 = duo[k];
      v3.st.shield = LAPIS_ENCHANT.shield;   // 刷新为 50，不叠加
      v3.st.shieldT = 0;                     // 不按时间消失，只被伤害打掉
      floater(v3.x, v3.y - v3.r - 20, '护盾 ' + LAPIS_ENCHANT.shield, '#8fb4ff', 11);
      ring(v3.x, v3.y, v3.r, v3.r + 26, 0.28, '#8fb4ff');
    }
  } else {
    var cands = [];
    for (var m = 0; m < duo.length; m++) {
      var v4 = duo[m];
      if (v4.energyMax && v4.energy < v4.energyMax) cands.push(v4);
    }
    var t4 = cands[Math.floor(rand(0, cands.length)) % cands.length];
    gainEnergy(t4, LAPIS_ENCHANT.energy);
    floater(t4.x, t4.y - t4.r - 20, '+' + LAPIS_ENCHANT.energy + ' 能量', '#ffe08a', 12);
    ring(t4.x, t4.y, t4.r, t4.r + 28, 0.28, '#ffe08a');
  }
  return choice;
}

// 普攻伤害倍率：青金石附魔 1 号每层 +20%，无上限
function lapisBasicMul(u) {
  return 1 + LAPIS_ENCHANT.basicPctLayer * (u.st.basicBuffLayers || 0);
}

TYPES.lapis = {
  key: 'lapis', name: '青金石块', role: '辅助 / 续航', bond: 'red',
  r: 24, maxHp: 2000, baseSpeed: 200, atk: 100, def: 120,
  energyMax: 100,
  calibrated: true,   // 伤害已按 2000 HP 口径校准，不乘 dmgScale
  impact: true,
  shieldMax: 50,      // 护盾条分母（附魔 3 号刷新为 50）
  body: '#2d5bd6', light: '#7ba2ff', dark: '#152a6b', glow: '#4a7bf0',
  basic: LAPIS_BASIC,
  skill: {
    name: '附魔折射', cd: 4.0,
    dashTime: 0, dashSpeed: 0, dmgMult: 1, energy: 8,
    text: '每 4 秒随机附魔 1 项（随机红/青普攻 +20%/层，无上限 / 生命值较低者生命上限 +5%，上限 10 层并同步回血 / 红青护盾刷新为 50 / 随机红/青能量 +10），效果显示在单位旁'
  },
  ultimate: {
    name: '折光连撞',
    text: '能量充满后连续冲撞 6 次，每次 130% 攻击力（按普攻伤害结算，吃普攻增伤附魔）'
  },
  passive: {
    name: '折光护盾',
    text: '附魔效果显示在单位旁边，可重复叠加 / 刷新；狂暴后受到的普通攻击伤害减少 60%'
  },
  // 羁绊：红石阵亡后先无敌抖动 3 秒，随后提速 + 附魔提速
  rage: {
    speedMul: 3,
    passThrough: false,   // 狂暴后仍有实体：与敌方碰撞会分离 / 反弹，保证撞击反馈
    skillCd: 3.0,
    basicTakenMul: 0.4,   // 狂暴天赋：受到的普通攻击伤害 ×0.4（-60%）
    status: '移速 ×3 · 有实体 · 附魔 4s → 3s · 普攻承伤 -60%'
  },
  rageCasts: true,
  createState: function () {
    return { basicCd: 1.0, basicAtk: false, energyOnHit: false, basicBuffLayers: 0, hpBuffLayers: 0 };
  },
  // 普攻冲撞 140% / 终结技每段 130%，都吃普攻增伤附魔（每层 +20%）
  onAttack: function (u) {
    if (u.st.ultChain) return u.atk * LAPIS_ULT.pct * lapisBasicMul(u);
    if (u.dashT > 0) return u.atk * LAPIS_BASIC.pct * lapisBasicMul(u);
    return 0;
  },
  onCast: function (u) {
    u.cd = u.st.rage ? TYPES.lapis.rage.skillCd : TYPES.lapis.skill.cd;
    u.st.basicAtk = false;
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
    if (u.dashT <= 0) {
      u.st.energyOnHit = false;
      u.st.basicAtk = false;
    }
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
    u.st.basicAtk = true;      // 本次冲刺是普攻：撞击伤害可被「普攻承伤」减伤识别
    u.st.energyOnHit = true;
    ring(u.x, u.y, 8, 46, 0.2, '#7ba2ff');
    burst(u.x, u.y, 6, '#8fb4ff', 140);
  },
  draw: function (u) { drawBlock(u); }
};
