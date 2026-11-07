/* 铁砧（Anvil）：延迟爆发 / 区域压制，无羁绊
   ------------------------------------------------------------
   技能在敌人「当前位置」锁定一个落点圆，3 秒后砸落：
   · 落点在生成瞬间锁定，不跟随敌人（与既有"方向/位置锁定"机制一致：
     大狗激光锁定角度、红石炸弹落地不动）
   · 伤害走 hurt()，因此和箭矢 / 冰面 / 炸弹一样会被护盾吸收
   · 只落下重击，不冲刺、不转向（skill.noTurn），不违反匀速直线运动红线 */
'use strict';

TYPES.anvil = {
  key: 'anvil', name: '铁砧', role: '延迟爆发 / 区域压制',
  r: 30, maxHp: 420, baseSpeed: 200, atk: 1.0,
  body: '#8b98ab', light: '#e8effa', dark: '#3a4453', glow: '#c6d7ee',
  skill: {
    name: '天降铁砧', cd: 3.0, noTurn: true,
    // 非冲刺型技能：不加速、不转向，只标记落点
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '在敌人当前位置锁定半径 200px 的落点圆，3 秒后铁砧砸落：圆内最近目标 210 伤害（边缘 126），其余目标减半'
  },
  passive: {
    name: '重压',
    text: '普通撞击伤害为 0，输出全部来自落点；伤害走通用 hurt() 结算，可被护盾吸收'
  },
  /* 落点参数（唯一可调入口）
     · markR     预警圆半径
     · delay     预警时长（秒）
     · coreRatio 核心区占半径的比例（内圈全额）
     · dmg       核心区伤害
     · edgeMul   外圈（coreRatio ~ 1.0）伤害系数
     · splashMul 圆内除「最近目标」外的其余敌人只吃这个系数（避免一次砸落同时
                 清掉红青两块，也防止 2v2 / 3v3 里一发清场） */
  anvil: { markR: 200, delay: 3.0, coreRatio: 0.55, dmg: 210, edgeMul: 0.6, splashMul: 0.5 },
  createState: function () { return {}; },
  // 普通撞击不产生伤害：与弓箭 / 冰块一致，所有输出都来自技能
  onAttack: function () { return 0; },
  // 技能在 onCast 里生成落点圆；方向 / CD 由 cast() 统一处理
  onCast: function (u) {
    var e = nearestEnemy(u);
    if (!e) return;
    spawnAnvilMark(u, e.x, e.y);
    ring(e.x, e.y, 8, TYPES.anvil.anvil.markR, 0.5, '#cbd8ea');
    burst(e.x, e.y, 10, '#dfe8f7', 120);
    floater(u.x, u.y - u.r - 20, '天降铁砧', '#dfe8f7', 12);
  },
  draw: function (u) { drawAnvil(u); }
};
