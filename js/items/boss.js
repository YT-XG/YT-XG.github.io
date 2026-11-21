/* ============================================================
   BOSS 模式专用单位（2026-11-22 重做：红青双子 → 紫晶核心）
   ------------------------------------------------------------
   一阶段：红 / 青两个独立单元，各 4550 HP，锁 1 血、免疫控制
     · 红石：3s 普攻环形 6 炸弹；7s 技能锁定敌人投 10 枚炸弹
     · 青金石：3s 普攻中距离冲刺；5s 技能为随机友军附魔
     · 任一方受到致命伤害时锁 1 血，并且不再被敌人锁定；
       两只都锁 1 血 → 进入二阶段，负面效果全部清除
   二阶段：紫晶核心，5000 HP，速度 +150%
     · 普攻：每 500ms 原地放 1 颗炸弹
     · 普攻（终焉一击后解锁）：3s 向敌人中距离冲刺，命中 100% 攻击力
     · 普攻（终焉一击后解锁）：5s 身周一圈 6 颗炸弹，1 秒后引爆，每颗 60% 攻击力
     · 技能：5s 给自己附魔
     · 终结技：血量首次低于 50% 时蓄力 8 秒，释放终焉一击
       （敌方 70% 最大生命 + 10 秒虚弱，所有伤害 -20%）
   三槽结构与常规物品一致：basic / skill / ultimate。
   数值直接按 2000 HP 口径写死（calibrated）。
   ============================================================ */
'use strict';

/* 附魔：普攻 / 技能伤害按 1 / 2 / 3 层提升 25% / 45% / 70%；防御单层 +10% */
var BOSS_ENCHANT = [0, 0.25, 0.45, 0.70];

function bossBasicMul(u) {
  var n = Math.min(3, (u && u.st && u.st.enchantBasic) || 0);
  return 1 + BOSS_ENCHANT[n];
}
function bossSkillMul(u) {
  var n = Math.min(3, (u && u.st && u.st.enchantSkill) || 0);
  return 1 + BOSS_ENCHANT[n];
}

/* 随机附魔一次：从「未满层」的池子里抽，防御只会有 1 层。
   noSkill = true 时不再抽「技能伤害」（二阶段核心没有可加成的技能）。 */
function bossEnchant(u, noSkill) {
  if (!u || !u.alive) return;
  var st = u.st;
  var pool = [];
  if ((st.enchantBasic || 0) < 3) pool.push(1);
  if (!noSkill && (st.enchantSkill || 0) < 3) pool.push(2);
  if (!st.enchantDef) pool.push(3);
  if (!pool.length) return;

  var pick = pool[Math.floor(rand(0, pool.length))];
  var label;
  if (pick === 1) {
    st.enchantBasic = (st.enchantBasic || 0) + 1;
    label = '附魔 普攻 +' + Math.round(BOSS_ENCHANT[st.enchantBasic] * 100) + '%';
  } else if (pick === 2) {
    st.enchantSkill = (st.enchantSkill || 0) + 1;
    label = '附魔 技能 +' + Math.round(BOSS_ENCHANT[st.enchantSkill] * 100) + '%';
  } else {
    st.enchantDef = 1;
    u.def = Math.round(u.def * 1.1);
    label = '附魔 防御 +10%';
  }
  ring(u.x, u.y, u.r, u.r + 42, 0.45, '#c79bff');
  burst(u.x, u.y, 12, '#d9bcff', 200);
  floater(u.x, u.y - u.r - 18, label, '#c79bff', 13);
}

function bossLocked(u) {
  return !!(u && u.hp <= (BALANCE.boss.lockHp == null ? 1 : BALANCE.boss.lockHp) + 0.05);
}

/* 红色 BOSS：环形炸弹 + 锁定投掷
   ------------------------------------------------------------
   · 普攻（3s）：身周一圈 6 颗炸弹，1 秒后引爆，每颗 80% 攻击力
   · 技能（7s）：锁定敌人连续投 10 枚炸弹
       前 5 枚 60%、中间 4 枚 90%、最后一枚 125% 攻击力（技能伤害）
   · 没有终结技；锁 1 血后停止一切行动且不可被锁定 */
TYPES.bossred = {
  key: 'bossred', name: 'BOSS 红石', role: 'BOSS / 环形轰炸',
  boss: true, bossImmune: true, bossLock: true, calibrated: true,
  r: 34, maxHp: 4550, baseSpeed: 210, atk: 100, def: 80,
  impact: true,
  body: '#c8342b', light: '#ff7a6a', dark: '#6d140e', glow: '#ff5a44',
  basic: { cd: 3.0, count: 6, radius: 74, bombR: 100, fuse: 1.0, dmg: 80 },
  skill: {
    name: '爆裂投掷', cd: 7.0,
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '锁定敌人连续投 10 枚炸弹：前 5 枚 60%、中间 4 枚 90%、最后一枚 125% 攻击力（技能伤害）'
  },
  passive: {
    name: '锁血熔核', text: '受到致命伤害时锁 1 血并停止行动、不可被锁定；两只都锁血后合体'
  },
  createState: function () {
    return { bombCd: 1.0, volleyN: 0, volleyT: 0, volleyTarget: null, enchantBasic: 0, enchantSkill: 0, enchantDef: 0 };
  },
  onAttack: function () { return 0; },
  onCast: function (u) {
    u.st.volleyTarget = nearestEnemy(u);
    u.st.volleyN = 10;
    u.st.volleyT = 0;
    ring(u.x, u.y, u.r, 150, 0.4, '#ff8a5f');
    burst(u.x, u.y, 18, '#ff9a6b', 240);
    floater(u.x, u.y - u.r - 20, '爆裂投掷 · 10 枚', '#ffb08a', 13);
  },
  onTick: function (u, dt) {
    if (bossLocked(u)) return;

    // 技能：10 枚炸弹按 0.12 秒间隔依次砸向锁定的敌人
    if (u.st.volleyN > 0) {
      u.st.volleyT -= dt;
      while (u.st.volleyT <= 0 && u.st.volleyN > 0) {
        u.st.volleyT += 0.12;
        var idx = 10 - u.st.volleyN;
        var tgt = u.st.volleyTarget;
        if (!tgt || !tgt.alive) tgt = nearestEnemy(u);
        var tx = tgt ? tgt.x : u.x, ty = tgt ? tgt.y : u.y;
        var base = idx < 5 ? 60 : (idx < 9 ? 90 : 125);
        spawnBomb(u, tx + rand(-16, 16), ty + rand(-16, 16),
          { fuse: 0.55, radius: 95, dmg: base * bossSkillMul(u) });
        u.st.volleyN--;
      }
    }

    // 普攻：3 秒一圈 6 颗炸弹
    var B = TYPES.bossred.basic;
    u.st.bombCd -= dt;
    if (u.st.bombCd > 0) return;
    u.st.bombCd += B.cd;
    var mul = bossBasicMul(u);
    for (var i = 0; i < B.count; i++) {
      var a = i / B.count * TAU + t * 0.25;
      spawnBomb(u, u.x + Math.cos(a) * B.radius, u.y + Math.sin(a) * B.radius,
        { fuse: B.fuse, radius: B.bombR, dmg: B.dmg * mul });
    }
    ring(u.x, u.y, 8, B.radius + 34, 0.36, '#ffb14d');
  },
  draw: function (u) { drawBossBlock(u); }
};

/* 青色 BOSS：中距离冲撞 + 友军附魔
   ------------------------------------------------------------
   · 普攻（3s）：向敌人中距离冲刺，命中 130% 攻击力（普通攻击）
   · 技能（5s）：为随机一名友军附魔随机效果（普攻 / 技能 / 防御）
   · 没有终结技；锁 1 血后停止一切行动且不可被锁定 */
TYPES.bosslapis = {
  key: 'bosslapis', name: 'BOSS 青金石', role: 'BOSS / 冲撞附魔',
  boss: true, bossImmune: true, bossLock: true, calibrated: true,
  r: 34, maxHp: 4550, baseSpeed: 200, atk: 100, def: 90,
  impact: true,
  body: '#2d5bd6', light: '#7ba2ff', dark: '#152a6b', glow: '#4a7bf0',
  basic: { cd: 3.0, range: 760, minRange: 90, dashTime: 0.32, dashSpeed: 640, pct: 1.3 },
  skill: {
    name: '点石成金', cd: 5.0,
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '为随机一名友军附魔随机效果：普攻 +25/45/70%、技能 +25/45/70%、防御 +10%（防御不叠加）'
  },
  passive: {
    name: '锁血晶壁', text: '受到致命伤害时锁 1 血并停止行动、不可被锁定；两只都锁血后合体'
  },
  createState: function () {
    return { basicCd: 1.0, basicDmg: 0, enchantBasic: 0, enchantSkill: 0, enchantDef: 0 };
  },
  onAttack: function (u) {
    if (bossLocked(u)) return 0;
    return u.dashT > 0 ? (u.st.basicDmg || 0) : 0;
  },
  onHit: function (u) { u.st.basicDmg = 0; },
  onCast: function (u) {
    var pool = [];
    for (var i = 0; i < units.length; i++) {
      if (units[i].alive && units[i].team === u.team) pool.push(units[i]);
    }
    if (!pool.length) return;
    bossEnchant(pool[Math.floor(rand(0, pool.length))]);
  },
  onTick: function (u, dt) {
    if (bossLocked(u)) return;
    if (u.dashT <= 0) u.st.basicDmg = 0;
    var B = TYPES.bosslapis.basic;
    u.st.basicCd -= dt;
    if (u.st.basicCd > 0) return;

    var e = nearestEnemy(u);
    if (!e) { u.st.basicCd = 0.2; return; }
    var d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d < B.minRange || d > B.range) { u.st.basicCd = 0.2; return; }

    u.st.basicCd += B.cd;
    u.ang = Math.atan2(e.y - u.y, e.x - u.x);
    u.dashT = B.dashTime;
    u.dashSpeed = B.dashSpeed;
    u.st.basicDmg = u.atk * B.pct * bossBasicMul(u);
    ring(u.x, u.y, u.r, u.r + 40, 0.3, '#8fb4ff');
  },
  draw: function (u) { drawBossBlock(u); }
};

/* 紫晶核心：红青合体后的最终形态
   ------------------------------------------------------------
   · 合体演出：血条从 1 充到 4300；从这一刻起可以被击倒
   · 天赋：移动速度 +150%（×2.5），可穿透敌方
   · 普攻：每 500ms 在原地放 1 颗炸弹（40 × 普攻附魔）
   · 技能（5s）：给自己附魔随机效果
   · 终结技：生命首次低于 50% 时开始蓄力 8 秒，随后原地停止释放终焉一击：
     敌方每个存活单位扣 70% 最大生命，并获得 10 秒虚弱（所有伤害 -20%） */
TYPES.bosscore = {
  key: 'bosscore', name: '紫晶核心', role: 'BOSS / 合体形态',
  boss: true, bossImmune: true, calibrated: true,
  rageCasts: true,
  r: 46, maxHp: 5000, baseSpeed: 240, atk: 100, def: 120,
  impact: true,
  body: '#7a3fbf', light: '#c79bff', dark: '#3a1668', glow: '#b478ff',
  basic: { cd: 0.5, fuse: 1.0, radius: 105, dmg: 40,
           dashCd: 3.0, dashRange: 760, dashMin: 90, dashTime: 0.32, dashSpeed: 640, dashPct: 1.0,
           ringCd: 5.0, ringCount: 6, ringRadius: 74, ringBombR: 100, ringFuse: 1.0, ringPct: 0.6 },
  skill: {
    name: '自我附魔', cd: 5.0,
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    text: '为自己附魔随机效果：普攻 +25/45/70%、防御 +10%（防御不叠加）'
  },
  ultimate: {
    name: '终焉一击',
    text: '生命首次低于 50% 时蓄力 8 秒，随后敌方各扣 70% 最大生命，并虚弱 10 秒（所有伤害 -20%）'
  },
  passive: {
    name: '合体狂暴',
    text: '移动速度 +150% · 免疫控制 · 锁血后不可被锁定 · 血量低于 50% 开始终焉蓄力'
  },
  rage: {
    speedMul: 2.5,
    speedRampPerSec: 0,
    speedMulCap: 2.5,
    passThrough: true,
    hitCd: 1.0,
    dmgPerSec: 0,
    dmgCap: 0,
    ramp: false,
    status: '移速 +150% · 可穿透敌方 · 0.5 秒投弹 · 终焉后解锁冲撞 / 环形炸弹',
    bomb: { interval: 0.5, intervalRamp: 0, intervalMin: 0.5, fuse: 1.0, radius: 105, dmg: 40 }
  },
  ultBlocked: function () { return true; },   // 终焉一击由血量触发，不走能量/CD 大招
  createState: function () {
    return {
      bombCd: 0.2, basicCd: 0.2, dashCd: 1.0, dashDmg: 0, ringCd: 2.0,
      nukeStarted: false, nukeDone: false, nukeT: -1, nukeWarned: false, nukeCast: 0,
      enchantBasic: 0, enchantSkill: 0, enchantDef: 0
    };
  },
  onAttack: function (u) {
    if (u.st.mergeFill > 0 || u.st.nukeCast > 0) return 0;
    return u.dashT > 0 ? (u.st.dashDmg || 0) : 0;
  },
  onHit: function (u) { u.st.dashDmg = 0; },
  onCast: function (u) {
    bossEnchant(u, true);   // 二阶段只抽普攻 / 防御
    ring(u.x, u.y, u.r, u.r + 50, 0.4, '#c79bff');
  },
  onTick: function (u, dt) {
    if (u.st.appear > 0) u.st.appear = Math.max(0, u.st.appear - dt);

    /* 血条充能：合体登场时只有 1 HP，1.2 秒内涨到 5000（期间免伤、不能移动）。 */
    if (u.st.mergeFill > 0) {
      u.st.mergeFill = Math.max(0, u.st.mergeFill - dt);
      u.hp = Math.min(u.maxHp, u.hp + (u.st.mergeFillRate || 0) * dt);
      if (u.st.mergeFill <= 0) u.hp = u.maxHp;
      return;
    }

    // 终焉一击释放演出：BOSS 原地停止
    if (u.st.nukeCast > 0) {
      u.st.nukeCast = Math.max(0, u.st.nukeCast - dt);
      if (Math.floor((u.st.nukeCast + dt) * 5) !== Math.floor(u.st.nukeCast * 5)) {
        ring(u.x, u.y, u.r + 8, u.r + 110, 0.4, '#c79bff');
      }
      return;
    }

    /* 生命首次低于 50% → 开始 8 秒蓄力（只触发一次）。 */
    if (!u.st.nukeStarted && u.hp <= u.maxHp * 0.5) {
      u.st.nukeStarted = true;
      u.st.nukeT = 8.0;
      u.st.nukeWarned = false;
      if (typeof bossCry === 'function') bossCry('终焉蓄力', '8 秒后释放终焉一击');
      if (typeof sfxPlay === 'function') sfxPlay('cast');
      ring(u.x, u.y, u.r, u.r + 140, 0.7, '#c79bff');
    }

    if (u.st.nukeT >= 0) {
      u.st.nukeT -= dt;
      if (!u.st.nukeWarned && u.st.nukeT <= 8.0) {
        u.st.nukeWarned = true;
      }
      if (u.st.nukeT <= 0) {
        u.st.nukeT = -1;
        u.st.nukeDone = true;   // 终焉一击释放后解锁冲撞与环形炸弹
        u.st.nukeCast = 1.8;
        coreNuke(u);
        return;
      }
    }

    var B = TYPES.bosscore.basic;

    /* 终焉一击释放后才解锁：3 秒冲撞 + 5 秒环形炸弹 */
    if (u.st.nukeDone) {
    // 普攻 ②：3 秒中距离冲撞，命中 100% 攻击力
    if (u.dashT <= 0) u.st.dashDmg = 0;
    u.st.dashCd -= dt;
    if (u.st.dashCd <= 0) {
      var e = nearestEnemy(u);
      if (!e) {
        u.st.dashCd = 0.2;
      } else {
        var d = Math.hypot(e.x - u.x, e.y - u.y);
        if (d < B.dashMin || d > B.dashRange) {
          u.st.dashCd = 0.2;
        } else {
          u.st.dashCd += B.dashCd;
          u.ang = Math.atan2(e.y - u.y, e.x - u.x);
          u.dashT = B.dashTime;
          u.dashSpeed = B.dashSpeed;
          u.st.dashDmg = u.atk * B.dashPct * bossBasicMul(u);
          ring(u.x, u.y, u.r, u.r + 40, 0.3, '#c79bff');
        }
      }
    }

    // 普攻 ③：5 秒身周一圈 6 颗炸弹，1 秒后引爆
    u.st.ringCd -= dt;
    if (u.st.ringCd <= 0) {
      u.st.ringCd += B.ringCd;
      var rm = bossBasicMul(u);
      for (var i = 0; i < B.ringCount; i++) {
        var a = i / B.ringCount * TAU - t * 0.3;
        spawnBomb(u, u.x + Math.cos(a) * B.ringRadius, u.y + Math.sin(a) * B.ringRadius,
          { fuse: B.ringFuse, radius: B.ringBombR, dmg: B.ringPct * u.atk * rm });
      }
      ring(u.x, u.y, 8, B.ringRadius + 34, 0.36, '#c79bff');
    }
    }

    // 普攻 ①：每 500ms 在脚下放一颗炸弹
    u.st.basicCd -= dt;
    if (u.st.basicCd <= 0) {
      u.st.basicCd += B.cd;
      spawnBomb(u, u.x, u.y, { fuse: B.fuse, radius: B.radius, dmg: B.dmg * bossBasicMul(u) });
    }
  },
  onRageStart: function (u) {
    u.st.basicCd = 0.2;
    u.st.dashCd = 1.0;
    u.st.ringCd = 2.0;
  },
  draw: function (u) { drawBossBlock(u); }
};

/* 终焉一击：BOSS 原地停止，所有存活敌方单位 + 敌方种子各扣 pct% 最大生命，
   并附加 10 秒虚弱（所有伤害 -20%）。
   走 hurt(..., {pct:1})，因此不吃 dmgScale / dmgTakeMul；
   同时生成慢动作镜头（先聚焦 BOSS，再拉远到全场）。 */
function coreNuke(u) {
  var C = BALANCE.boss.core;
  var pct = C.nukePct == null ? 0.70 : C.nukePct;
  var weakDur = C.weakDur == null ? 10 : C.weakDur;
  var A = ARENA;

  /* 大招演出状态：白闪 / 多层冲击波 / 光柱 / 飞散碎晶都由渲染层按 t 绘制，
     碎片在此一次性生成，fx() 推进寿命。 */
  var shards = [];
  var shardColors = ['#efe2ff', '#c79bff', '#9a5cff', '#7a3fbf', '#ffffff'];
  for (var sc = 0; sc < 42; sc++) {
    var sa = rand(0, TAU), ss = rand(120, 520);
    shards.push({
      x: u.x, y: u.y,
      vx: Math.cos(sa) * ss, vy: Math.sin(sa) * ss - rand(20, 120),
      rot: rand(0, TAU), vr: rand(-6, 6),
      size: rand(4, 11),
      life: rand(0.7, 1.6), max: 1.6,
      color: shardColors[Math.floor(rand(0, shardColors.length))]
    });
  }
  bossNukeFx = { t: 0, dur: 2.4, x: u.x, y: u.y, shards: shards };

  burst(u.x, u.y, 40, '#d9bcff', 420);
  burst(u.x, u.y, 20, '#ffffff', 300);
  shake = Math.max(shake, 26);
  hitStop = Math.max(hitStop, 0.09);
  if (typeof sfxPlay === 'function') sfxPlay('bomb');
  if (typeof bossCry === 'function') {
    bossCry('终焉一击', 'BOSS 原地停止 · 敌方各扣 ' + Math.round(pct * 100) + '% 最大生命并虚弱 ' + weakDur + ' 秒');
  }

  for (var i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    hurt(v, v.maxHp * pct, u, { pct: 1 });
    v.weakT = Math.max(v.weakT || 0, weakDur);
    v.weakMul = C.weakMul == null ? 0.80 : C.weakMul;
    floater(v.x, v.y - v.r - 12, '-' + Math.round(v.maxHp * pct), '#ff9aa8', 32);
    floater(v.x, v.y - v.r - 40, '虚弱 ' + weakDur + 's', '#c79bff', 16);
    ring(v.x, v.y, v.r, v.r + 52, 0.45, '#c79bff');
    burst(v.x, v.y, 10, '#d9bcff', 220);
  }
  for (var s = seeds.length - 1; s >= 0; s--) {
    if (seeds[s].team === u.team) continue;
    hurtSeed(seeds[s], seeds[s].maxHp * pct, u, { pct: 1 });
  }

  /* 镜头：先定在 BOSS 身上，随后随冲击波逐层拉远到全场；
     2.9 秒内模拟时间 0.3×（见 50-ui 的 frame），形成整段慢动作。 */
  bossCine = { t: 0, dur: 2.9, slow: 0.3, origin: { x: u.x, y: u.y } };
}

/* BOSS 的通用外观：方块的放大版 + 旋转棱环 + 王冠尖角
   （drawBlock 在 40-render.js，运行时才被调用，加载顺序不影响） */
function drawBossBlock(u) {
  var r = u.r, x = u.x, y = u.y;

  // 合体核心的浮现：1.15 秒内从 1.28 倍缩放回正常（与 drawBossMerge 的白闪对齐）
  var ap = (u.st && u.st.appear > 0) ? Math.min(1, u.st.appear / 0.9) : 0;
  if (ap > 0) {
    ctx.save();
    ctx.translate(x, y);
    var sc = 1 + 0.28 * ap;
    ctx.scale(sc, sc);
    ctx.translate(-x, -y);
  }

  // 外层旋转棱环：让 BOSS 在 5 个单位的混战里一眼可辨
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * (u.st.rage ? 0.9 : 0.35) + u.seed);
  ctx.strokeStyle = rgba(u.glow, 0.55);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (var i = 0; i < 4; i++) {
    var a = i / 4 * TAU;
    ctx.lineTo(Math.cos(a) * (r + 9), Math.sin(a) * (r + 9));
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  drawBlock(u);

  // 王冠尖角（3 根）
  ctx.fillStyle = rgba(u.light, 0.9);
  for (var k = -1; k <= 1; k++) {
    var bx = x + k * r * 0.42, by = y - r * 0.92;
    ctx.beginPath();
    ctx.moveTo(bx - 4, by + 6);
    ctx.lineTo(bx, by - 8);
    ctx.lineTo(bx + 4, by + 6);
    ctx.closePath();
    ctx.fill();
  }

  // 合体核心：外圈脉动光环
  if (u.st && u.st.rage) {
    var pk = 0.5 + 0.5 * Math.sin(t * 5 + u.seed);
    ctx.strokeStyle = 'rgba(199,155,255,' + (0.3 + 0.35 * pk).toFixed(3) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 14 + pk * 4, 0, TAU);
    ctx.stroke();
  }

  var st = u.st || {};
  /* 终焉蓄力：最后 8 秒核心向内收紧蓄能，蓄能环收缩 + 内圈白环收拢 + 向上抽微光柱。 */
  var warnW = 8;
  if (st.nukeT >= 0 && st.nukeT <= warnW) {
    var wp2 = 1 - st.nukeT / warnW;
    var pulse = 0.5 + 0.5 * Math.sin(t * 10);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(199,155,255,' + (0.5 + 0.4 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 18 - 10 * wp2, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 + 0.45 * wp2).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 8 - 4 * wp2, 0, TAU);
    ctx.stroke();
    var bg = ctx.createLinearGradient(0, y - r - 46, 0, y - r);
    bg.addColorStop(0, 'rgba(199,155,255,0)');
    bg.addColorStop(1, 'rgba(216,180,255,' + (0.35 + 0.3 * pulse).toFixed(3) + ')');
    ctx.fillStyle = bg;
    ctx.fillRect(x - 6, y - r - 46, 12, 46);
    ctx.restore();
  }

  /* 终焉一击释放演出：核心残留辉光随 nukeCast 消退向外扩散。 */
  if (st.nukeCast > 0) {
    var np = 1 - st.nukeCast / 1.8;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var ng = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * (2.2 + np * 1.6));
    ng.addColorStop(0, 'rgba(255,255,255,' + (0.45 * (1 - np)).toFixed(3) + ')');
    ng.addColorStop(0.5, 'rgba(199,155,255,' + (0.3 * (1 - np)).toFixed(3) + ')');
    ng.addColorStop(1, 'rgba(122,63,191,0)');
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.arc(x, y, r * (2.2 + np * 1.6), 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  if (ap > 0) ctx.restore();
}
