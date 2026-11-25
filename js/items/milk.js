/* 野生狗奶：全域压制 / 领域引导，无羁绊
   ------------------------------------------------------------
   2026-11-22 重做：取消普攻与普通技能，只保留终结技「奶狗领域」。
     · 普攻：无（普通撞击伤害恒为 0）
     · 技能：无（不会主动施放）
     · 终结技（12s CD，无条件发动 / 不依赖能量）
         发动后原地无敌展开「奶狗领域」：
         每秒对在场所有敌人（含敌方召唤物）造成其自身最大生命 7% 的伤害，持续 12 秒；
         自身获得 500 点护盾；护盾被打破时领域立即中断，冷却重新读秒 12 秒。
   ------------------------------------------------------------
   · 引导期间完全不可移动（speedOf 返回 0）、不可被推动（collide 视为固定桩）；
     所有 incoming 伤害先扣 500 点护盾，HP 不掉（= 原地无敌）。
   · 百分比扣血统一走 hurt()：会被护盾吸收、计入 dealt / taken、能触发死亡与羁绊。
   · 冷却在领域结束后才开始读：自然结束或护盾被打空都会把终结技冷却重新读满
     12 秒，不能无缝衔接下一轮。 */
'use strict';

var MILK_ULT = { cd: 12.0, dur: 12.0, pctPerSec: 0.07, shield: 500 };

TYPES.milk = {
  key: 'milk', name: '野生狗奶', role: '全域压制 / 领域',
  r: 26, maxHp: 2000, baseSpeed: 200, atk: 100, def: 90,
  /* 数值已按 2000 HP 口径校准：百分比伤害不再乘 dmgScale */
  calibrated: true,
  /* 保留撞击判定，但 onAttack 恒为 0：贴上去不掉血 */
  impact: true,
  body: '#e6cfa8', light: '#fff4de', dark: '#8a6a44', glow: '#ffe0a0',
  skill: {
    name: '无', cd: MILK_ULT.cd, noTurn: true,
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '没有普通技能：全部机制集中在终结技「奶狗领域」'
  },
  ultimate: {
    name: '奶狗领域', cd: MILK_ULT.cd, windup: 0.35,
    text: '12 秒冷却，无条件发动：原地无敌展开领域，每秒对所有敌人造成其自身 7% 最大生命的伤害，持续 12 秒；' +
      '自身获得 500 点护盾，护盾被打破时领域立即中断并重新读秒 12 秒'
  },
  passive: {
    name: '无',
    text: '无'
  },

  /* 领域参数（唯一可调入口）
     · pctPerSec 每秒扣除目标最大生命的比例（0.07 = 7%）
     · dur       领域持续时间（秒）
     · shield    打断护盾（打空即中断，同时用作护盾条分母） */
  drain: { pctPerSec: MILK_ULT.pctPerSec, dur: MILK_ULT.dur },
  shieldMax: MILK_ULT.shield,

  createState: function () { return { milkT: 0, milkAcc: 1.0, milkInit: false }; },

  /* 没有普通技能：think() 走到 canCast 直接跳过，不会消耗任何 CD；
     终结技在 canCast 之前结算，不受影响。 */
  canCast: function () { return false; },

  // 普攻无：普通撞击伤害恒为 0
  onAttack: function () { return 0; },

  // 终结技：原地展开奶狗领域（冷却在领域结束后才重新读满 12 秒）
  onUlt: function (u) {
    var D = TYPES.milk.drain;
    u.st.milkT = D.dur;
    u.st.milkAcc = 1.0;                    // 之后每满 1 秒再结算一次
    u.st.shield = u.st.advShieldStack ? (u.st.shield || 0) + TYPES.milk.shieldMax : TYPES.milk.shieldMax;    // 守护之靴：护盾叠加
    u.st.shieldT = 0;                      // 不靠时间清空，只被伤害消耗
    u.dashT = 0; u.dashSpeed = 0; u.dmgMult = 1;
    u.trail.length = 0;                    // 站定：清掉移动残影
    u.ultCd = 0;                           // 领域期间不读 CD，结束后才重新计

    ring(u.x, u.y, u.r, u.r + 140, 0.6, '#ffe0a0');
    burst(u.x, u.y, 20, '#fff1cc', 240);
    floater(u.x, u.y - u.r - 22, '奶狗领域', '#ffe9b0', 14);

    // 展开瞬间先结算第一跳：护盾 500 点，通常能撑过数跳
    milkDrain(u, D);
  },

  onTick: function (u, dt) {
    /* 无条件发动：入场后第一次 tick 就把终结技冷却清零。
       普通技能 CD 也清 0，避免冷却环在开局短暂显示一个永远用不掉的技能。 */
    if (!u.st.milkInit) {
      u.st.milkInit = true;
      u.ultCd = 0;
      u.cd = 0;
    }

    var D = TYPES.milk.drain;
    if (u.st.milkT > 0) {
      u.st.milkT -= dt;
      u.st.milkAcc -= dt;
      while (u.st.milkAcc <= 0 && u.st.milkT > 0) {
        u.st.milkAcc += 1.0;       // 每秒结算一次（倍速下可能一次跨多秒）
        milkDrain(u, D);
      }

      if (u.st.milkT <= 0) {       // 12 秒内没人打断：领域自然结束
        u.st.milkT = 0;
        u.st.shield = 0;           // 护盾属于本次领域，结束后一并清空
        u.ultCd = TYPES.milk.ultimate.cd;   // 结束后重算 CD，不能无缝衔接
        ring(u.x, u.y, u.r, u.r + 90, 0.5, '#ffe0a0');
        floater(u.x, u.y - u.r - 22, '领域结束', '#ffe9b0', 13);
      }
      return;   // 引导期间不普攻、不施放其它技能
    }

    // 普攻：无。非引导期间只按普通单位移动。
  },

  draw: function (u) { drawMilk(u); }
};

/* 角色贴图：使用资源目录里的本地 PNG（离线可用，无外链）。
   无头模拟 / 加载失败时 ok=false，绘制函数会退化为纯色剪影。 */
var MILK_SPRITE = { img: null, ok: false };
(function () {
  if (typeof Image === 'undefined') return;
  var im = new Image();
  im.onload = function () { MILK_SPRITE.ok = !!(im.naturalWidth && im.naturalHeight); };
  im.onerror = function () { MILK_SPRITE.ok = false; };
  im.src = 'assets/milk.png';
  MILK_SPRITE.img = im;
})();
