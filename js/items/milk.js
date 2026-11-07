/* 野生狗奶：全域压制 / 引导，无羁绊
   ------------------------------------------------------------
   · 野性哺育（主动技能，cd 8s，从「引导结束 / 被打断」才开始计）
     原地引导 15 秒：引导期间完全不可移动（speedOf 直接返回 0）且免疫伤害；
     场上所有敌方单位与召唤物每秒损失 6.6% 最大生命，15 秒合计 99%。
   · 80 点打断护盾：引导期间任何走 hurt() 的伤害先扣护盾（不掉血），
     护盾打空立即打断，CD 从 0 重新计（= 完整 8 秒），不进入新的引导。
   · 百分比扣血统一走 hurt()：会被护盾吸收、计入 dealt / taken、能触发死亡与羁绊；
     普通撞击伤害恒为 0，输出全部来自引导。
   ------------------------------------------------------------
   不冲刺、不转向（skill.noTurn），引导只是"原地站桩"，符合匀速直线运动红线。 */
'use strict';

TYPES.milk = {
  key: 'milk', name: '野生狗奶', role: '全域压制 / 引导',
  r: 26, maxHp: 360, baseSpeed: 200, atk: 1.0,
  body: '#e6cfa8', light: '#fff4de', dark: '#8a6a44', glow: '#ffe0a0',

  skill: {
    name: '野性哺育', cd: 8.0, noTurn: true,
    // 非冲刺型技能：不加速、不转向，只进入引导状态
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '原地引导 15 秒：自身不可移动、免疫伤害，并显示 80 点打断护盾（受击先扣护盾，打空立即打断）；' +
      '场上所有敌方单位与召唤物每秒损失 6.6% 最大生命（15 秒合计 99%）。引导结束或被打断后才开始计 8 秒冷却'
  },
  passive: {
    name: '野奶之躯',
    text: '普通撞击伤害恒为 0；引导的百分比扣血走 hurt()，可被护盾吸收，并计入造成伤害'
  },

  /* 引导参数（唯一可调入口）
     · pctPerSec 每秒扣除目标最大生命的比例（0.066 = 6.6%，15 秒 = 99%）
     · dur       引导时长（秒）
     · shieldMax 引导期间的打断护盾（打空即打断，同时用作护盾条分母） */
  drain: { pctPerSec: 0.066, dur: 15.0 },
  shieldMax: 80,

  createState: function () { return { milkT: 0, milkAcc: 1.0 }; },

  // 引导期间不再重复施放（think() 不会消耗 CD）
  canCast: function (u) { return !(u.st.milkT > 0); },

  // 普通撞击不产生伤害：与弓箭 / 冰块 / 铁砧一致，所有输出都来自技能
  onAttack: function () { return 0; },

  onCast: function (u) {
    var D = TYPES.milk.drain;
    u.st.milkT = D.dur;
    u.st.milkAcc = 1.0;          // 满 1 秒后第一次扣血
    u.st.shield = TYPES.milk.shieldMax;   // 打断护盾：每次引导重置（当前 80）
    u.st.shieldT = 0;            // 不靠时间清空，只被伤害消耗
    u.cd = 0;                    // 引导结束 / 被打断后才开始计 CD
    u.dashT = 0; u.dashSpeed = 0; u.dmgMult = 1;
    u.trail.length = 0;          // 站定：清掉冲刺残影

    ring(u.x, u.y, u.r, u.r + 96, 0.6, '#ffe0a0');
    burst(u.x, u.y, 18, '#fff1cc', 200);
    floater(u.x, u.y - u.r - 20, '野性哺育', '#ffe9b0', 13);
  },

  onTick: function (u, dt) {
    var D = TYPES.milk.drain;
    if (!(u.st.milkT > 0)) return;

    u.st.milkT -= dt;
    u.st.milkAcc -= dt;
    while (u.st.milkAcc <= 0 && u.st.milkT > 0) {
      u.st.milkAcc += 1.0;       // 每秒结算一次（倍速下可能一次跨多秒）
      milkDrain(u, D);
    }

    if (u.st.milkT <= 0) {       // 正常引导结束
      u.st.milkT = 0;
      u.st.shield = 0;           // 护盾属于本次引导，结束后一并清空
      u.cd = TYPES.milk.skill.cd;
      ring(u.x, u.y, u.r, u.r + 70, 0.5, '#bfe2ff');
      floater(u.x, u.y - u.r - 22, '引导结束', '#bfe2ff', 13);
    }
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
