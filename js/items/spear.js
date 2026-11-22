/* 长矛：突刺 / 持续伤害，无羁绊
   2026-11-22 重做：2000 HP / 100 攻击 / 120 防御，终结技由能量条驱动。
   三个技能槽：
     · 普攻（3s）   向最近敌人中距离突刺，命中 160% 攻击力并回能 15
     · 技能（7s）   分出 3 只长矛分身突刺，每只 120% 攻击力并附加 1 层破伤风
     · 终结技       长矛变大，向随机敌人方向释放地裂：
                    170% 攻击力 + 4 层破伤风 + 立刻结算全部 DoT + 定身 2 秒
   破伤风：每层每秒扣 10% 攻击力，每结算一次消耗 1 层，没有总持续时间。 */
'use strict';

var SPEAR_BASIC = { cd: 3.0, dashTime: 0.32, dashSpeed: 800, pct: 1.6, energy: 15, range: 330 };

var SPEAR_SKILL = {
  cd: 7.0,
  count: 3,        // 分身数量
  len: 320,        // 每只分身的突刺距离
  hitWidth: 58,    // 突刺判定宽度（分身会被画成一条细长的矛影）
  spread: 0.05,    // 三只分身的散开角度（弧度，保持近似平行，保证同一目标能被三只都刺中）
  offset: 16,      // 垂直于突刺方向的出生偏移，避免三只完全重叠
  pct: 1.2,        // 每只 120% 攻击力
  stacks: 1        // 每命中一次叠 1 层破伤风
};

var SPEAR_ULT = {
  pct: 1.7,        // 地裂伤害：170% 攻击力
  len: 760,        // 范围长（基础长度；若随机目标更远则延伸到目标身后 80px，上限 1150）
  width: 88,       // 宽度适中
  stacks: 4,       // 命中者直接叠 4 层破伤风
  bind: 2.0,       // 定身 2 秒（BOSS 免疫控制）
  grow: 0.9        // 长矛变大的持续时间（纯表现，同时是大招可读性提示）
};

/* 破伤风：层数 / 每层伤害来源 / 每秒结算累加器。
   每次结算伤害后消耗 1 层，没有总持续时间。 */
var SPEAR_TET = { pct: 0.10, interval: 1.0 };

TYPES.spear = {
  key: 'spear', name: '长矛', role: '突刺 / 持续伤害',
  r: 30, maxHp: 2000, baseSpeed: 216, atk: 100, def: 120,
  energyMax: 100,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  /* 只有突刺期间才结算撞击伤害（普通撞击为 0） */
  impact: true,
  body: '#b9c4d4', light: '#f4f8ff', dark: '#5b6678', glow: '#cfe0ff',
  basic: SPEAR_BASIC,
  skill: {
    name: '三分身突刺', cd: SPEAR_SKILL.cd,
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '每 7 秒分出 3 只长矛分身向敌人突刺，每只造成 120% 攻击力并附加 1 层破伤风'
  },
  ultimate: {
    name: '地裂',
    text: '能量充满后长矛变大，向随机一名敌人方向释放地裂：造成 170% 攻击力，' +
      '命中者获得 4 层破伤风、立刻结算一次全部持续伤害，并定身 2 秒'
  },
  passive: {
    name: '无', text: '无天赋'
  },
  createState: function () {
    return { basicCd: 1.0, basicPct: 0, basicAtk: false, energyOnHit: false, ultGrow: 0 };
  },
  // 普攻突刺期间按 160% 攻击力结算；普通撞击与技能分身都不走这里
  onAttack: function (u) {
    if (u.dashT > 0 && u.st.basicPct > 0) return u.atk * u.st.basicPct;
    return 0;
  },
  onHit: function (u) {
    if (!u.st.energyOnHit || u.dashT <= 0) return;
    u.st.energyOnHit = false;
    gainEnergy(u, SPEAR_BASIC.energy);
  },
  onCast: function (u) {
    u.st.basicAtk = false;
    spearCastClones(u);
  },
  onUlt: function (u) {
    u.st.basicAtk = false;
    u.st.ultGrow = SPEAR_ULT.grow;
    spearCastFissure(u);
  },
  onTick: function (u, dt) {
    if (u.st.ultGrow > 0) u.st.ultGrow = Math.max(0, u.st.ultGrow - dt);
    // 突刺结束后清掉攻击标记，避免一次无关碰撞继续按 160% 结算
    if (u.dashT <= 0) {
      u.st.basicPct = 0;
      u.st.basicAtk = false;
      u.st.energyOnHit = false;
    }
    if (u.st.rage && u.st.rage.phase === 'shake') return;
    if (u.castT > 0 || u.ultT > 0) return;   // 蓄力期间不插入普攻突刺

    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd > 0) return;
    var e = nearestEnemy(u);
    if (!e) return;
    // 中距离突刺：目标太远时先等它进入突刺距离，避免空放后白等 3 秒
    if (Math.hypot(e.x - u.x, e.y - u.y) > SPEAR_BASIC.range) {
      u.st.basicCd = 0.15;
      return;
    }
    u.st.basicCd += SPEAR_BASIC.cd;
    u.ang = Math.atan2(e.y - u.y, e.x - u.x);
    u.dashT = SPEAR_BASIC.dashTime;
    u.dashSpeed = SPEAR_BASIC.dashSpeed;
    u.dmgMult = 1;
    u.st.basicPct = SPEAR_BASIC.pct;
    u.st.basicAtk = true;      // 本次突刺是普攻：撞击伤害可被「普攻承伤」减伤识别
    u.st.energyOnHit = true;
    ring(u.x, u.y, 8, 52, 0.2, '#dbe6ff');
    burst(u.x, u.y, 5, '#e6efff', 150);
  },
  draw: function (u) { drawSpear(u); }
};

/* ============================================================
   破伤风：叠层型 DoT
   ------------------------------------------------------------
   · 每层每秒扣 10% 施加者攻击力，走 hurt(..., {dot:1})
   · 每结算一次伤害消耗 1 层（不设总持续时间）
   ============================================================ */
function spearApplyTetanus(v, src, n) {
  if (!v || !v.alive || !src || !(n > 0)) return;
  v.tetStacks = (v.tetStacks || 0) + n;
  v.tetAtk = src.atk || 0;
  v.tetSrc = src;
  if (!(v.tetAcc > 0)) v.tetAcc = SPEAR_TET.interval;
}

function updateTetanus(dt) {
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive || !(u.tetStacks > 0)) continue;
    u.tetAcc -= dt;
    while (u.tetAcc <= 0 && u.alive && u.tetStacks > 0) {
      u.tetAcc += SPEAR_TET.interval;
      hurt(u, u.tetStacks * SPEAR_TET.pct * (u.tetAtk || 0), u.tetSrc, { dot: 1 });
      u.tetStacks -= 1;   // 每结算一次伤害降低 1 层
    }
    if (u.tetStacks <= 0) {
      u.tetStacks = 0;
      u.tetSrc = null;
      u.tetAtk = 0;
      u.tetAcc = SPEAR_TET.interval;
    }
  }
}

/* 瞬间结算一次目标身上的全部持续伤害（破伤风 / 灼烧 / 中毒 / 浸水）。
   主动引爆不消耗层数、也不缩短剩余时间：破伤风的层数、灼烧的层数、中毒的剩余秒数全部保留，
   只把「下一次跳伤」提前到现在。走非 dot 口径，需要当帧看到伤害数字。 */
function settleDots(v, src) {
  if (!v || !v.alive) return 0;
  var total = 0;

  if ((v.tetStacks || 0) > 0) {
    var td = v.tetStacks * SPEAR_TET.pct * (v.tetAtk || 0);
    if (td > 0) { hurt(v, td, v.tetSrc || src); total += td; }
    v.tetAcc = SPEAR_TET.interval;
  }
  if ((v.burnStacks || 0) > 0) {
    var bd = v.burnStacks * RED_BURN.pctPerLayer * (v.burnAtk || 0);
    if (bd > 0) { hurt(v, bd, v.burnSrc || src); total += bd; }
    v.burnAcc = RED_BURN.interval;
  }
  if (v.poisonT > 0 && v.poisonDps > 0) {
    hurt(v, v.poisonDps, v.poisonSrc || src);
    v.poisonAcc = 1.0;
    total += v.poisonDps;
  }
  if (v.waterT > 0 && typeof TYPES.bucket !== 'undefined') {
    var W = TYPES.bucket.water;
    if (v.waterT >= W.wetThreshold) {
      var wd = v.maxHp * W.dotPct;
      hurt(v, wd, src, { pct: 1 });
      v.waterAcc = W.dotInterval;
      total += wd;
    }
  }
  if (total > 0) floater(v.x, v.y - v.r - 68, '持续伤害结算', '#ffca8a', 13);
  return total;
}

/* 技能：3 只分身从长矛当前位置向敌人方向散开突刺。
   每一只都是独立的线段判定，命中即 120% + 1 层破伤风；
   在 1v1 里三只会同时命中同一目标（3 层），多人局则可能分别命中不同敌人。 */
function spearCastClones(u) {
  var e = nearestEnemy(u);
  if (!e) return;
  var base = Math.atan2(e.y - u.y, e.x - u.x);
  var C = SPEAR_SKILL;
  var dmg = u.atk * C.pct;
  var mid = (C.count - 1) / 2;

  for (var i = 0; i < C.count; i++) {
    var off = (i - mid) * C.spread;
    var ang = base + off;
    var px = Math.cos(ang + Math.PI / 2), py = Math.sin(ang + Math.PI / 2);
    var sx = u.x + px * (i - mid) * C.offset;
    var sy = u.y + py * (i - mid) * C.offset;
    var ex = sx + Math.cos(ang) * C.len;
    var ey = sy + Math.sin(ang) * C.len;

    ultBeams.push({
      x1: sx, y1: sy, x2: ex, y2: ey,
      life: 0.30, max: 0.30, color: '#dfe9ff', width: 16,
      kind: 'phantom', ang: ang, seed: rand(0, TAU)
    });

    for (var j = 0; j < units.length; j++) {
      var v = units[j];
      if (!v.alive || v.team === u.team) continue;
      if (segDist(v.x, v.y, sx, sy, ex, ey) > C.hitWidth * 0.5 + v.r) continue;
      hurt(v, dmg, u);
      spearApplyTetanus(v, u, C.stacks);
      ring(v.x, v.y, v.r, v.r + 32, 0.22, '#f0a070');
    }
    burst(sx, sy, 5, '#e6efff', 170);
  }

  ring(u.x, u.y, u.r, 126, 0.32, '#dbe6ff');
  burst(u.x, u.y, 12, '#e6efff', 230);
  floater(u.x, u.y - u.r - 20, '三分身突刺', '#e6efff', 12);
}

/* 终结技：随机挑一名敌人，朝它释放一条长地裂。
   命中者：170% 攻击力 → 4 层破伤风 → 立刻结算全部 DoT → 定身 2 秒（BOSS 免疫）。 */
function spearRandomEnemy(u) {
  var list = [];
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (v.st && v.st.locked) continue;   // 锁 1 血的 BOSS 不可被锁定
    list.push(v);
  }
  if (!list.length) return null;
  return list[Math.min(list.length - 1, Math.floor(srand(0, list.length)))];
}

function spearCastFissure(u) {
  var tgt = spearRandomEnemy(u);
  var ang = tgt ? Math.atan2(tgt.y - u.y, tgt.x - u.x) : u.ang;
  var C = SPEAR_ULT;
  var sx = u.x, sy = u.y;
  // 范围长：至少 760px；随机目标更远时延伸到目标身后 80px，避免“锁了目标却差一点没打到”
  var dist = tgt ? Math.hypot(tgt.x - sx, tgt.y - sy) : C.len;
  var len = Math.min(1150, Math.max(C.len, dist + 80));
  var ex = sx + Math.cos(ang) * len;
  var ey = sy + Math.sin(ang) * len;

  ultBeams.push({
    x1: sx, y1: sy, x2: ex, y2: ey,
    life: 0.75, max: 0.75, color: '#ffca8a', width: C.width,
    kind: 'fissure', ang: ang, seed: rand(0, TAU)
  });

  var dmg = u.atk * C.pct;
  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    if (segDist(v.x, v.y, sx, sy, ex, ey) > C.width * 0.5 + v.r) continue;

    hurt(v, dmg, u);
    spearApplyTetanus(v, u, C.stacks);
    if (!v.boss) v.bindT = Math.max(v.bindT || 0, C.bind);
    settleDots(v, u);
    ring(v.x, v.y, v.r, v.r + 54, 0.45, '#ffca8a');
    floater(v.x, v.y - v.r - 30, '破伤风 ×' + C.stacks, '#f0a070', 13);
    floater(v.x, v.y - v.r - 52, v.boss ? '免疫控制' : ('定身 ' + C.bind + 's'), '#cfe0ff', 12);
  }

  ring(u.x, u.y, u.r, u.r + 160, 0.6, '#ffe08a');
  burst(u.x, u.y, 28, '#ffe0a0', 360);
  shake = Math.max(shake, 10);
  hitStop = Math.max(hitStop, 0.05);
}
