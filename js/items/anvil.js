/* 铁砧（Anvil）：延迟爆发 / 区域压制，无羁绊
   ------------------------------------------------------------
   2026-11-22 重做：2000 HP / 100 攻击 / 150 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（3s）   预判敌人走位生成落点，0.8s 后铁砧砸落：
                    125% 攻击力，30% 概率定身 1.5 秒，命中回能 10
     · 技能（8s）   预判敌人走位，连续砸落 8 个铁砧（每下重新预判）：
                    每个 39.375% 攻击力，合计 315%，释放回能 50
     · 终结技       消耗自身一半当前生命，分裂出 2 个铁砧分身：
                    生命 / 攻击 / 防御 60%，持续 8 秒，会放普攻与技能
   落点在生成瞬间锁定坐标（不跟随敌人），延迟结束才砸落：
   · 伤害走 hurt()，因此和箭矢 / 冰面 / 炸弹一样会被护盾吸收
   · 只落下重击，不冲刺、不转向（skill.noTurn），不违反匀速直线运动红线 */
'use strict';

var ANVIL_BASIC = {
  cd: 3.0, r: 120, delay: 0.8,
  pct: 1.25, energy: 10,
  bindChance: 0.30, bindTime: 1.5
};

var ANVIL_SKILL = {
  cd: 8.0, count: 8, interval: 0.16,
  r: 110, delay: 0.8,
  pctTotal: 3.15,      // 8 个铁砧合计 315% 攻击力
  energyGain: 50       // 释放技能回能 50
};

var ANVIL_ULT = {
  hpCostPct: 0.5,      // 消耗自身当前生命的一半
  cloneCount: 2,       // 分裂成 2 个分身
  cloneHpPct: 0.6,     // 分身生命 60%
  cloneAtkPct: 0.6,    // 分身攻击 60%
  cloneDefPct: 0.6,    // 分身防御 60%
  cloneLife: 8.0       // 分身持续 8 秒
};

/* 落点预判：按目标当前速度提前 delay 秒落点（落点仍然只锁定一次，砸落前不会跟随）。
   不做预判的话，小落点对 200+ 移速的目标几乎必空。 */
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

/* 技能：预判敌人走位后，按固定间隔连续砸落 count 个铁砧。
   每个落点都在生成瞬间重新取一次预判位置（用户指定「每下重新预判」）。 */
function anvilVolleyTick(u, dt) {
  if (!(u.st.volleyN > 0)) return;
  u.st.volleyT -= dt;
  while (u.st.volleyT <= 0 && u.st.volleyN > 0) {
    u.st.volleyT += ANVIL_SKILL.interval;
    u.st.volleyN--;
    var e = nearestEnemy(u);
    if (!e) { u.st.volleyN = 0; break; }
    var p = anvilSpot(e, ANVIL_SKILL.delay);
    spawnAnvilMark(u, p.x, p.y, {
      r: ANVIL_SKILL.r,
      delay: ANVIL_SKILL.delay,
      dmg: u.atk * ANVIL_SKILL.pctTotal / ANVIL_SKILL.count
    });
    ring(p.x, p.y, 6, ANVIL_SKILL.r, 0.3, '#cbd8ea');
  }
}

/* 普攻 / 分身共用的每帧节奏：分身寿命 → 技能连砸 → 3 秒一次预判落砧 */
function anvilTick(u, dt) {
  // 分身寿命：到期直接消散，不触发阵亡羁绊
  if (u.st.lifeT != null) {
    u.st.lifeT -= dt;
    if (u.st.lifeT <= 0) { anvilExpireClone(u); return; }
  }

  anvilVolleyTick(u, dt);

  var B = ANVIL_BASIC;
  u.st.basicCd = Math.max(0, u.st.basicCd - dt);
  if (u.st.basicCd > 0) return;
  var e = nearestEnemy(u);
  if (!e) return;
  u.st.basicCd += B.cd;
  var p = anvilSpot(e, B.delay);
  spawnAnvilMark(u, p.x, p.y, {
    r: B.r, delay: B.delay, dmg: u.atk * B.pct,
    basic: 1, energy: B.energy,
    bindChance: B.bindChance, bindTime: B.bindTime
  });
  ring(p.x, p.y, 6, B.r, 0.3, '#cbd8ea');
}

/* 技能释放：开启 8 连砸并立刻回能 50 */
function anvilCastVolley(u) {
  u.st.volleyN = ANVIL_SKILL.count;
  u.st.volleyT = 0;
  gainEnergy(u, ANVIL_SKILL.energyGain);
  ring(u.x, u.y, u.r, 140, 0.4, '#dfe8f7');
  burst(u.x, u.y, 14, '#dfe8f7', 220);
  floater(u.x, u.y - u.r - 20, '八连铁砧', '#dfe8f7', 12);
}

/* 分身到期：原地碎裂消散（不算阵亡，不触发羁绊 / 死亡音效） */
function anvilExpireClone(u) {
  if (!u.alive) return;
  u.alive = false;
  u.hp = 0;
  if (u.st) u.st.volleyN = 0;
  burst(u.x, u.y, 18, '#c6d7ee', 230);
  ring(u.x, u.y, u.r, u.r + 50, 0.45, '#c6d7ee');
  floater(u.x, u.y - u.r - 14, '分身消散', '#cbd8ea', 12);
}

/* 终结技：消耗一半当前生命，在原地分裂出 2 个削弱版铁砧分身 */
function anvilSplit(u) {
  var U = ANVIL_ULT;
  var loss = Math.max(0, u.hp * U.hpCostPct);
  if (loss > 0) {
    u.hp = Math.max(1, u.hp - loss);
    floater(u.x, u.y - u.r - 26, '-' + Math.round(loss) + ' 生命', '#ff9aa8', 14);
  }

  var A = ARENA;
  for (var i = 0; i < U.cloneCount; i++) {
    var a = u.ang + (i - (U.cloneCount - 1) / 2) * 1.1 + srand(-0.15, 0.15);
    var dist = u.r * 2.1;
    var cx = clamp(u.x + Math.cos(a) * dist, A.x + u.r, A.x + A.w - u.r);
    var cy = clamp(u.y + Math.sin(a) * dist, A.y + u.r, A.y + A.h - u.r);

    var c = addUnit('anvilclone', cx, cy, u.team);
    c.maxHp = Math.max(1, u.maxHp * U.cloneHpPct);
    c.hp = c.maxHp;
    c.atk = Math.max(1, u.atk * U.cloneAtkPct);
    c.def = Math.round((u.def || 0) * U.cloneDefPct);
    c.roleIdx = u.roleIdx;
    /* 分身是临时召唤物：不计入队伍总血条 / 阵容条 / MVP，避免 HUD 出现
       「分子大于分母」的溢出，也避免分身顶掉本体在结算里的位置。 */
    c.isSummon = true;
    c.summoner = u;
    c.st.lifeT = U.cloneLife;
    c.st.basicCd = 0.6 + i * 0.25;
    c.ang = u.ang;

    ring(cx, cy, c.r, c.r + 46, 0.4, '#cbd8ea');
    burst(cx, cy, 12, '#dfe8f7', 200);
  }

  ring(u.x, u.y, u.r, u.r + 90, 0.5, '#e8effa');
  shake = Math.max(shake, 5);
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
    name: '八连铁砧', cd: ANVIL_SKILL.cd, noTurn: true,
    // 非冲刺型技能：不加速、不转向，只标记落点
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '每 8 秒预判敌人走位，连续砸落 8 个铁砧（每下重新预判，各 39.375% 攻击力，合计 315%）；释放回能 50'
  },
  ultimate: {
    name: '铁砧分裂',
    text: '消耗自身一半当前生命，分裂出 2 个铁砧分身（生命 / 攻击 / 防御 60%），持续 8 秒；' +
      '分身会使用普攻与技能，不释放终结技'
  },
  passive: {
    name: '重压',
    text: '普通撞击伤害为 0；普攻为 3 秒一次的预判落砧（125% 攻击力，30% 概率定身 1.5 秒，命中回能 10）'
  },
  /* 落点基础参数（spawnAnvilMark 未传 cfg 时的回退值）
     · markR     预警圆半径
     · delay     预警时长（秒）
     · coreRatio 核心区占半径的比例（内圈全额）
     · dmg       核心区伤害
     · edgeMul   外圈（coreRatio ~ 1.0）伤害系数
     · splashMul 圆内除「最近目标」外的其余敌人只吃这个系数 */
  anvil: { markR: ANVIL_BASIC.r, delay: ANVIL_BASIC.delay, coreRatio: 0.55, dmg: ANVIL_BASIC.pct * 100, edgeMul: 0.6, splashMul: 0.46 },
  createState: function () { return { basicCd: 1.0, volleyN: 0, volleyT: 0 }; },
  // 普通撞击不产生伤害：与弓箭 / 冰块一致
  onAttack: function () { return 0; },
  onCast: function (u) { anvilCastVolley(u); },
  onUlt: function (u) { anvilSplit(u); },
  onTick: function (u, dt) { anvilTick(u, dt); },
  draw: function (u) { drawAnvil(u); }
};

/* 铁砧分身：终结技分裂出来的削弱版，机制与本体一致，但不带终结技 */
TYPES.anvilclone = {
  key: 'anvilclone', name: '铁砧分身', role: '铁砧分身',
  r: 30, maxHp: 1200, baseSpeed: 200, atk: 60, def: 90,
  calibrated: true,
  impact: true,
  body: '#7d8a9d', light: '#cfdcf0', dark: '#333c49', glow: '#a9bcd6',
  basic: ANVIL_BASIC,
  skill: {
    name: '八连铁砧·分身', cd: ANVIL_SKILL.cd, noTurn: true,
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '与本体相同的八连铁砧，但攻击力只有本体的 60%'
  },
  passive: {
    name: '分裂体', text: '由铁砧终结技分裂而来，持续 8 秒后消散；不会释放终结技'
  },
  createState: function () { return { basicCd: 1.0, volleyN: 0, volleyT: 0, lifeT: ANVIL_ULT.cloneLife }; },
  onAttack: function () { return 0; },
  onCast: function (u) { anvilCastVolley(u); },
  onTick: function (u, dt) { anvilTick(u, dt); },
  draw: function (u) { drawAnvil(u); }
};
