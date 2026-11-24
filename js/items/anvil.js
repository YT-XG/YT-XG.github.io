/* 铁砧（Anvil）：延迟爆发 / 区域压制，无羁绊
   ------------------------------------------------------------
   2026-11-24 重做：技能改两段式「砧雨·天陨」，终结技改「陨核·天裁」，
   移除旧的分身机制（TYPES.anvilclone 已删除）。面板不变：
   2000 HP / 100 攻击 / 150 防御，终结技由能量条驱动。
   2026-11-24 机制调整：
   · 终结技改为献祭 30% 最大生命（不再是“一半当前生命”），35% 铸盾（上限 210），
     生命 ≤15% 时禁止施放（保留残血最后一搏，只拦 1 HP 免费放）
   · 第 4 颗小砧补必定身 0.8s，让最后两颗小砧 / 巨砧 / 下一发普攻吃到控制
   · 熔铁领域半径 170→190、落地当帧结算首跳；本体阵亡后仍烧满 5s
   · 领域对 BOSS 改固定伤害（60% 攻击力 / 秒），不再吃百分比减免
   三个技能槽：
     · 普攻（3s）   预判敌人走位生成落点，0.8s 后铁砧砸落：
                    125% 攻击力，30% 概率定身 1.5 秒，命中回能 10
     · 技能（砧雨·天陨） 6 个小铁砧（每 0.22s 一个，各 30% 攻击力）
                    第 4 颗必定身 0.8s，随后 1 个天陨巨砧（135% 攻击力，必定身 1.2s）；
                    合计 315%，释放回能 50；巨砧落点生成后才开始读 8s CD
     · 终结技（陨核·天裁） 献祭 30% 最大生命（献祭量的 35% 铸成 8 秒护盾），
                    召来 3 颗陨铁巨砧（每 0.55s 一颗，各 170% 攻击力，合计 510%）；
                    最后一颗砸落处留下 5 秒「熔铁领域」：
                    圈内敌人减速 45%，每秒灼烧 3% 生命上限（BOSS 改固定伤害）
   落点在生成瞬间锁定坐标（不跟随敌人），延迟结束才砸落：
   · 伤害走 hurt()，因此和箭矢 / 冰面 / 炸弹一样会被护盾吸收
   · 只落下重击，不冲刺、不转向（skill.noTurn），不违反匀速直线运动红线
   · 熔铁领域挂在 u.st.forge 上，由 updateAnvilForges 全局推进；
     本体阵亡后已落地的领域仍烧满；减速只写 slowT / slowMul

   ============================================================
   特效接入点（替换模型 / 加自定义特效时只看这里，不要改动结算）
   ------------------------------------------------------------
   A. 落点预警圆      spawnAnvilMark → 40-render drawAnvilMarks()
                      （外圈虚线 / 时间扇形 / 核心圈 + 汇聚光流 / 核心辉光 / 巨砧环绕光点 / 临落收缩环）
   B. 砧体下坠        anvilMarks 的 t<0.55 → 40-render drawAnvilDrops()
                      （下坠 / 阴影 / 尾迹 + 双层残影 / 微摆 / 临落地能量池 / 天陨彗尾 / 陨铁火舌火星）
   C. 普攻 / 砧雨命中 updateAnvilMarks 的 else 分支（冲击环 + 白闪 + 钢火粒子 + 轻震屏）
   D. 天陨巨砧命中    updateAnvilMarks 的 tier==='giant' 分支（冷钢蓝冲击波 / 金环 / 白闪 / 震屏）
   E. 陨铁巨砧命中    updateAnvilMarks 的 tier==='ult' 分支（外圈冲击波 + 熔金三环 + 白闪 / 三 burst / 强震屏）
   F. 定身            updateAnvilMarks 的 bindChance 分支（双环 + 冰蓝光屑 + “定身”飘字）
   G. 献祭 / 铸甲     anvilJudgment 末尾的 ring / burst / shake（熔金三环 + 火星四溅）
   H. 熔铁领域        updateAnvilMarks 展开时的双环 + 火星 + 飘字；
                      40-render drawForgeZones() 持续光池 / 熔岩气泡 / 涡流 / 符文刻印 / 上升火星；
                      anvilForgeTick 到期收束的双环 + 熄灭火星
   ============================================================ */
'use strict';

var ANVIL_BASIC = {
  cd: 3.0, r: 120, delay: 0.8,
  pct: 1.25, energy: 10,
  bindChance: 0.30, bindTime: 1.5
};

var ANVIL_SKILL = {
  cd: 8.0,
  count: 6, interval: 0.22,   // 第一段：6 连砧雨
  r: 105, delay: 0.7,
  pctEach: 0.30,              // 每个小砧 30% 攻击力（6 × 30% = 180%）
  bindAt: 4, bindTime: 0.8,   // 第 4 颗小砧必定身：给最后两颗 + 巨砧铺垫
  finaleR: 170,               // 第二段：天陨巨砧
  finaleDelay: 1.05,
  finalePct: 1.35,            // 巨砧 135% 攻击力（合计 315%）
  finaleBindTime: 1.2,        // 巨砧命中必定身 1.2s（BOSS 免疫）
  energyGain: 50              // 释放技能回能 50
};

var ANVIL_ULT = {
  hpCostMaxPct: 0.30,  // 献祭 30% 最大生命（固定比例，不再随当前生命缩水）
  shieldPct: 0.35,     // 献祭量的 35% 铸成护盾（600 × 35% = 210）
  shieldTime: 8.0,     // 护盾持续 8s（覆盖陨砧 + 领域窗口）
  meteors: 3,          // 3 颗陨铁巨砧
  interval: 0.55,      // 每 0.55s 锁定一颗
  r: 150, delay: 0.95,
  pct: 1.7,            // 每颗 170% 攻击力（合计 510%）
  zoneR: 190,          // 熔铁领域半径（170 → 190，给减速圈更多滞留空间）
  zoneLife: 5.0,       // 领域持续 5s
  zoneSlowMul: 0.55,   // 圈内敌人移速 ×0.55（BOSS 免疫减速）
  zoneDotPct: 0.03,    // 每秒灼烧 3% 生命上限（多目标按 aoeScale 递减）
  zoneBossPct: 0.60    // BOSS 不吃百分比减免，领域改 60% 攻击力 / 秒固定伤害
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

/* 技能第一段：按固定间隔连续砸落 count 个小铁砧（每下重新预判）。
   第 6 个生成后立刻锁定第二段「天陨巨砧」的落点，此时才开始读 8s CD。 */
function anvilVolleyTick(u, dt) {
  if (!(u.st.volleyN > 0)) return;
  var S = ANVIL_SKILL;
  u.st.volleyT -= dt;
  while (u.st.volleyT <= 0 && u.st.volleyN > 0) {
    u.st.volleyT += S.interval;
    u.st.volleyN--;
    var idx = S.count - u.st.volleyN;   // 1..6：第 4 颗补必定身，给后面几颗铺垫
    var e = nearestEnemy(u);
    if (!e) { u.st.volleyN = 0; break; }
    var p = anvilSpot(e, S.delay);
    spawnAnvilMark(u, p.x, p.y, {
      r: S.r, delay: S.delay,
      dmg: u.atk * S.pctEach,
      skill: 1, tier: 'rain',
      /* FX-F：第 4 颗的定身环 / 飘字在 updateAnvilMarks 结算 */
      bindChance: idx === S.bindAt ? 1.0 : 0,
      bindTime: idx === S.bindAt ? S.bindTime : 0
    });
    ring(p.x, p.y, 6, S.r, 0.3, '#cbd8ea');

    // 最后一个小砧生成 → 追加天陨巨砧（重新预判一次）
    if (u.st.volleyN <= 0) {
      var gp = anvilSpot(e, S.finaleDelay);
      spawnAnvilMark(u, gp.x, gp.y, {
        r: S.finaleR, delay: S.finaleDelay,
        dmg: u.atk * S.finalePct,
        skill: 1, tier: 'giant',
        bindChance: 1.0, bindTime: S.finaleBindTime
      });
      /* FX-D：巨砧落点生成时的预兆双环 / 金屑 / 飘字（落点预警见 drawAnvilMarks） */
      ring(gp.x, gp.y, 10, S.finaleR, 0.45, '#ffd28a');
      ring(gp.x, gp.y, 4, S.finaleR * 0.5, 0.3, '#fff2d4');
      burst(gp.x, gp.y, 10, '#ffd28a', 220);
      floater(gp.x, gp.y - S.finaleR - 8, '天陨巨砧', '#ffd28a', 13);
    }
  }
  /* 巨砧落点生成（或中途无目标）后才写入完整冷却：
     cast() 预置的冷却已在 onCast 里清零。 */
  if (u.st.volleyN <= 0) u.cd = S.cd;
}

/* 终结技：3 颗陨铁巨砧依次锁定敌人预判位；最后一颗附带熔铁领域。
   落点生成后由 updateAnvilMarks 结算，本体中途阵亡时已生成的落点照常砸落，
   但领域需要本体存活才会展开。 */
function anvilMeteorTick(u, dt) {
  if (!(u.st.meteorN > 0)) return;
  var U = ANVIL_ULT;
  u.st.meteorT -= dt;
  while (u.st.meteorT <= 0 && u.st.meteorN > 0) {
    u.st.meteorT += U.interval;
    u.st.meteorN--;
    var e = nearestEnemy(u);
    if (!e) { u.st.meteorN = 0; break; }
    var last = u.st.meteorN <= 0;
    var p = anvilSpot(e, U.delay);
    spawnAnvilMark(u, p.x, p.y, {
      r: U.r, delay: U.delay,
      dmg: u.atk * U.pct,
      ult: 1, tier: 'ult',
      forge: last ? { r: U.zoneR, life: U.zoneLife } : null
    });
    /* FX-E：陨铁巨砧落点生成时的预兆双环 / 火星（命中演出在 updateAnvilMarks） */
    ring(p.x, p.y, 8, U.r, 0.35, '#ffb066');
    ring(p.x, p.y, 4, U.r * 0.5, 0.25, '#fff1cf');
    burst(p.x, p.y, 8, '#ffc06b', 200);
  }
}

/* 熔铁领域：圈内敌人减速（只写 slowT / slowMul，不改 ang），
   每满 1 秒结算一次灼烧（百分比 DoT，多目标按 aoeScale 递减）。
   领域挂在 u.st.forge 上，但由 updateAnvilForges 全局推进：
   本体阵亡后，已经落地的领域仍会烧满 5 秒。
   BOSS 不吃百分比减免，改按 60% 攻击力 / 秒的固定伤害结算。 */
function anvilForgeTick(u, dt) {
  var F = u.st.forge;
  if (!F) return;
  var U = ANVIL_ULT;
  F.t -= dt;
  if (F.t <= 0) {
    u.st.forge = null;
    /* FX-H：领域到期收束（收束双环 + 熄灭火星，可替换为自定义消散模型） */
    ring(F.x, F.y, F.r * 0.7, F.r + 20, 0.4, '#c98a5a');
    ring(F.x, F.y, F.r * 0.4, F.r * 0.9, 0.5, '#ffd9a0');
    burst(F.x, F.y, 14, '#ff9a4d', 200);
    return;
  }
  var victims = [];
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (Math.hypot(v.x - F.x, v.y - F.y) > F.r + v.r * 0.35) continue;
    if (!v.boss) {   // BOSS 免疫减速；灼烧照常结算
      v.slowT = Math.max(v.slowT || 0, 0.3);
      v.slowMul = Math.min(v.slowMul || 1, U.zoneSlowMul);
    }
    victims.push(v);
  }
  F.acc -= dt;
  while (F.acc <= 0) {
    F.acc += 1.0;
    if (!victims.length) continue;
    var mul = aoeScale(victims.length);
    for (var k = 0; k < victims.length; k++) {
      var w = victims[k];
      if (!w.alive) continue;
      if (w.boss) {
        /* BOSS：百分比 ×0.2 后只剩 0.6%/s，太弱；改固定 60% 攻击力 / 秒 */
        hurt(w, u.atk * U.zoneBossPct * mul, u, { ult: 1, dot: 1, periodic: 1 });
      } else {
        hurt(w, w.maxHp * U.zoneDotPct * mul, u, { ult: 1, dot: 1, pct: 1, periodic: 1 });
      }
    }
  }
}

/* 熔铁领域的全局推进：遍历 units（阵亡单位仍保留在数组里），
   所以本体阵亡不会让已落地的领域提前消失，也不需要新增全局数组 / 额外 reset。 */
function updateAnvilForges(dt) {
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.st || !u.st.forge) continue;
    anvilForgeTick(u, dt);
  }
}

/* 每帧节奏：终结技陨砧 → 技能连砸 → 3 秒一次预判落砧
   领域不在这里轮询（由 30-sim 的 updateAnvilForges 全局推进，本体阵亡也继续烧） */
function anvilTick(u, dt) {
  anvilMeteorTick(u, dt);
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

/* 技能释放：开启砧雨 + 天陨巨砧并立刻回能 50。
   cast() 会先把 u.cd 写满 8 秒，这里清零——冷却要等巨砧落点生成才从 0 开始读。 */
function anvilCastVolley(u) {
  u.cd = 0;
  u.st.volleyN = ANVIL_SKILL.count;
  u.st.volleyT = 0;
  gainEnergy(u, ANVIL_SKILL.energyGain);
  ring(u.x, u.y, u.r, 150, 0.4, '#dfe8f7');
  ring(u.x, u.y, u.r * 0.5, 90, 0.3, '#ffffff');
  ring(u.x, u.y, u.r * 0.2, 60, 0.25, '#fff6e0');
  burst(u.x, u.y, 18, '#dfe8f7', 260);
  floater(u.x, u.y - u.r - 20, '砧雨·天陨', '#dfe8f7', 13);
}

/* 终结技「陨核·天裁」：献祭 30% 最大生命，唤来 3 颗陨铁巨砧。
   固定比例代价 → 满血和残血都是同一笔账，不会“越残越便宜”。
   ultBlocked 会拦在 15% 最大生命以下：残血仍可最后一搏（最多把血献到 1），
   但不会再出现 1 HP 免费放的情况。 */
function anvilJudgment(u) {
  var U = ANVIL_ULT;
  var loss = Math.max(0, u.maxHp * U.hpCostMaxPct);
  loss = Math.min(loss, Math.max(0, u.hp - 1));   // 保底 1 HP，避免极端情况直接暴毙
  if (loss > 0) {
    u.hp = Math.max(1, u.hp - loss);
    floater(u.x, u.y - u.r - 26, '-' + Math.round(loss) + ' 生命', '#ff9aa8', 14);
  }
  // 献祭铸甲：消耗量的 35% 转成护盾（走通用护盾通道，可被伤害打掉）
  var guard = Math.round(loss * U.shieldPct);
  if (guard > 0) {
    u.st.shield = Math.max(u.st.shield || 0, guard);
    u.st.shieldT = U.shieldTime;
    floater(u.x, u.y - u.r - 44, '铸甲 +' + guard, '#9cc0ff', 13);
    ring(u.x, u.y, u.r + 4, u.r + 42, 0.35, '#9cc0ff');
  }
  u.st.meteorN = U.meteors;
  u.st.meteorT = 0.15;   // 第一颗稍作停顿，给献祭演出留半拍

  /* FX-G：献祭 / 铸甲的演出接入点（熔金三环 + 火星四溅 + 震屏） */
  // 献祭演出：熔金三环 + 火星四溅（castUltimate 的金环 / 震屏之外再叠一层）
  ring(u.x, u.y, u.r, u.r + 120, 0.5, '#ff9a4d');
  ring(u.x, u.y, u.r * 0.5, u.r + 60, 0.35, '#ffd9a0');
  ring(u.x, u.y, u.r * 0.2, u.r + 90, 0.45, '#fff1cf');
  burst(u.x, u.y, 24, '#ffc06b', 330);
  burst(u.x, u.y, 10, '#ff8f7a', 210);
  burst(u.x, u.y, 12, '#fff1cf', 380);
  shake = Math.max(shake, 5);
}

TYPES.anvil = {
  key: 'anvil', name: '铁砧', role: '延迟爆发 / 区域压制',
  r: 30, maxHp: 2000, baseSpeed: 200, atk: 100, def: 150,
  energyMax: 100, energyRegen: 2.0,
  shieldMax: 210,   // 献祭护盾条分母（2000 × 30% × 35% = 210）
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  impact: true,   // 撞击恒为 0，输出全部来自落点
  body: '#8b98ab', light: '#e8effa', dark: '#3a4453', glow: '#c6d7ee',
  basic: ANVIL_BASIC,
  skill: {
    name: '砧雨·天陨', cd: ANVIL_SKILL.cd, noTurn: true,
    // 非冲刺型技能：不加速、不转向，只标记落点
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '每 0.22 秒预判砸落 1 个小铁砧，共 6 个（各 30% 攻击力，第 4 颗必定身 0.8 秒）；' +
      '随后 1 个天陨巨砧（135% 攻击力，命中必定身 1.2 秒），合计 315%；' +
      '巨砧落点生成后才开始 8 秒冷却；释放回能 50'
  },
  ultimate: {
    name: '陨核·天裁',
    text: '献祭自身最大生命的 30%（生命 ≤15% 时无法施放；献祭量的 35% 铸成护盾，最多 210，持续 8 秒），' +
      '每 0.55 秒召来 1 颗陨铁巨砧轰击敌人预判位，共 3 颗（各 170% 攻击力，合计 510%）；' +
      '最后一颗砸落处留下 5 秒熔铁领域（半径 190）：圈内敌人减速 45%，每秒灼烧 3% 生命上限；' +
      '对 BOSS 改为每秒 60% 攻击力的固定伤害'
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
  createState: function () { return { basicCd: 1.0, volleyN: 0, volleyT: 0, meteorN: 0, meteorT: 0, forge: null }; },
  // 砧雨释放期间 cd 为 0，必须靠 canCast 阻止立刻二次施放
  canCast: function (u) { return !(u.st.volleyN > 0); },
  // 生命 ≤15% 最大生命时不再施放终结技：
  // 保留「残血最后一搏」（可以把血几乎全部献出去），但消掉
  // 「1 HP 时献祭量被 max(1) 吃掉、等于免费放」的边界。
  ultBlocked: function (u) { return u.hp <= u.maxHp * 0.15; },
  // 普通撞击不产生伤害：与弓箭 / 冰块一致
  onAttack: function () { return 0; },
  onCast: function (u) { anvilCastVolley(u); },
  onUlt: function (u) { anvilJudgment(u); },
  onTick: function (u, dt) { anvilTick(u, dt); },
  draw: function (u) { drawAnvil(u); }
};