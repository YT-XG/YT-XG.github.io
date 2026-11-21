/* 铁砧（Anvil）：延迟爆发 / 区域压制，无羁绊
   ------------------------------------------------------------
   2026-11-22 迁移到新体系：2000 HP / 100 攻击 / 150 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（3s）   敌人脚下小落点：半径 110、延迟 0.9s、150 伤害，回能 5
     · 技能（6s）   大落点：半径 190、延迟 0.9s、300 伤害，回能 12
     · 终结技       4 个落点（每个敌人脚下 + 自身），每个 200
   落点在生成瞬间锁定坐标（不跟随敌人），延迟结束才砸落：
   · 伤害走 hurt()，因此和箭矢 / 冰面 / 炸弹一样会被护盾吸收
   · 只落下重击，不冲刺、不转向（skill.noTurn），不违反匀速直线运动红线 */
'use strict';

var ANVIL_BASIC = { cd: 3.0, r: 110, delay: 0.9, dmg: 150, energy: 5 };
var ANVIL_SKILL = { cd: 6.0, r: 190, delay: 0.9, dmg: 300, energy: 12 };
var ANVIL_ULT = { count: 4, r: 190, delay: 1.1, dmg: 200 };

/* 落点预判：按目标当前速度提前 lead 秒落点（落点仍然只锁定一次，砸落前不会跟随）。
   不做预判的话，110 半径的小落点对 200+ 移速的目标几乎必空。 */
function anvilSpot(e, delay) {
  var sp = speedOf(e);
  var x = e.x + Math.cos(e.ang) * sp * delay;
  var y = e.y + Math.sin(e.ang) * sp * delay;
  var A = ARENA;
  return {
    x: clamp(x, A.x + 30, A.x + A.w - 30),
    y: clamp(y, A.y + 30, A.y + A.h - 30)
  };
}

TYPES.anvil = {
  key: 'anvil', name: '铁砧', role: '延迟爆发 / 区域压制',
  r: 30, maxHp: 2000, baseSpeed: 200, atk: 100, def: 150,
  energyMax: 100, energyRegen: 2.0,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  impact: true,   // 撞击恒为 0，输出全部来自落点
  body: '#8b98ab', light: '#e8effa', dark: '#3a4453', glow: '#c6d7ee',
  basic: ANVIL_BASIC,
  skill: {
    name: '天降铁砧', cd: ANVIL_SKILL.cd, noTurn: true,
    // 非冲刺型技能：不加速、不转向，只标记落点
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '每 6 秒在敌人当前位置锁定半径 190px 的落点圆，0.9 秒后铁砧砸落：圆内最近目标 300 伤害（边缘减伤，其余目标只吃溅射，回能 12）'
  },
  ultimate: {
    name: '铁砧风暴',
    text: '能量充满后在每名敌人脚下与自身位置标记落点（共 4 个），延迟 1.1 秒后依次砸落，每个 200 伤害'
  },
  passive: {
    name: '重压',
    text: '普通撞击伤害为 0，输出全部来自落点；伤害走通用 hurt() 结算，可被护盾吸收'
  },
  /* 落点基础参数（spawnAnvilMark 未传 cfg 时的回退值）
     · markR     预警圆半径
     · delay     预警时长（秒）
     · coreRatio 核心区占半径的比例（内圈全额）
     · dmg       核心区伤害
     · edgeMul   外圈（coreRatio ~ 1.0）伤害系数
     · splashMul 圆内除「最近目标」外的其余敌人只吃这个系数 */
  anvil: { markR: ANVIL_SKILL.r, delay: ANVIL_SKILL.delay, coreRatio: 0.55, dmg: ANVIL_SKILL.dmg, edgeMul: 0.6, splashMul: 0.46 },
  createState: function () { return { basicCd: 1.2 }; },
  // 普通撞击不产生伤害：与弓箭 / 冰块一致
  onAttack: function () { return 0; },
  // 技能在 onCast 里生成落点圆；方向 / CD 由 cast() 统一处理
  onCast: function (u) {
    var e = nearestEnemy(u);
    if (!e) return;
    var p = anvilSpot(e, ANVIL_SKILL.delay);
    spawnAnvilMark(u, p.x, p.y, { r: ANVIL_SKILL.r, delay: ANVIL_SKILL.delay, dmg: ANVIL_SKILL.dmg });
    gainEnergy(u, ANVIL_SKILL.energy);
    ring(p.x, p.y, 8, ANVIL_SKILL.r, 0.5, '#cbd8ea');
    burst(p.x, p.y, 10, '#dfe8f7', 120);
    floater(u.x, u.y - u.r - 20, '天降铁砧', '#dfe8f7', 12);
  },
  // 终结技：每名敌人脚下 + 自身，凑满 4 个落点（位置在生成瞬间锁定）
  onUlt: function (u) {
    var e = nearestEnemy(u);
    if (!e) return;
    var A = ARENA;
    var spots = [];
    for (var i = 0; i < units.length && spots.length < ANVIL_ULT.count - 1; i++) {
      var v = units[i];
      if (!v.alive || v.team === u.team) continue;
      spots.push(anvilSpot(v, ANVIL_ULT.delay));
    }
    spots.push({ x: u.x, y: u.y });
    // 人数不足 4 个时在最近敌人周围补点，保证落点数量
    var k = 0;
    while (spots.length < ANVIL_ULT.count) {
      var a = t * 0.9 + k * TAU / 2;
      k++;
      spots.push({
        x: clamp(e.x + Math.cos(a) * 130, A.x + 40, A.x + A.w - 40),
        y: clamp(e.y + Math.sin(a) * 130, A.y + 40, A.y + A.h - 40)
      });
    }
    for (var s = 0; s < spots.length; s++) {
      spawnAnvilMark(u, spots[s].x, spots[s].y, { r: ANVIL_ULT.r, delay: ANVIL_ULT.delay, dmg: ANVIL_ULT.dmg });
      ring(spots[s].x, spots[s].y, 8, ANVIL_ULT.r, 0.5, '#cbd8ea');
    }
    burst(e.x, e.y, 16, '#dfe8f7', 180);
    shake = Math.max(shake, 4);
  },
  onTick: function (u, dt) {
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    var e = nearestEnemy(u);
    if (!e) return;
    u.st.basicCd = ANVIL_BASIC.cd;
    var p = anvilSpot(e, ANVIL_BASIC.delay);
    spawnAnvilMark(u, p.x, p.y, { r: ANVIL_BASIC.r, delay: ANVIL_BASIC.delay, dmg: ANVIL_BASIC.dmg });
    gainEnergy(u, ANVIL_BASIC.energy);
    ring(p.x, p.y, 6, ANVIL_BASIC.r, 0.3, '#cbd8ea');
  },
  draw: function (u) { drawAnvil(u); }
};
