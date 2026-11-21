/* ============================================================
   BOSS 模式专用单位（2026-11-22 迁移到新数值体系）
   ------------------------------------------------------------
   与常规物品分开定义，不影响 1v1 / 2v2 / 3v3 / 赛事：
   · bossred  / bosslapis  —— 红青双子的 BOSS 版：各 4550 HP、100 攻击、
                                锁 1 血、免疫控制（定身 / 减速 / 牵引都不吃）
     · bosscore             —— 两者同时被打到 1 血时合体成的「紫晶核心」，
                                4300 HP，出生即狂暴：加速 + 投弹 + 撞击叠加
   三槽结构与常规物品一致：basic（普攻）/ skill（技能）/ ultimate（能量终结技）。
   数值直接按 2000 HP 口径写死（calibrated），BALANCE.boss.dmgMul 不再作用于它们。
   ============================================================ */
'use strict';

/* 红色 BOSS：冲锋 + 炸弹雨
   ------------------------------------------------------------
   · 普攻（5s）在脚下投 2 颗炸弹，每颗 90 伤害
   · 撞击只在技能冲刺期间结算，180% 攻击力
   · 终结技「红石陨星」：敌人周围空投 8 颗强化炸弹 */
TYPES.bossred = {
  key: 'bossred', name: 'BOSS 红石', role: 'BOSS / 冲锋压制',
  boss: true, bossImmune: true, bossLock: true, calibrated: true,
  r: 34, maxHp: 4550, baseSpeed: 210, atk: 100, def: 80,
  energyMax: 100, energyRegen: 2.0,
  impact: true,
  body: '#c8342b', light: '#ff7a6a', dark: '#6d140e', glow: '#ff5a44',
  basic: { cd: 5.0, count: 2, dmg: 72 },
  skill: {
    name: '熔岩脉冲', cd: 3.8,
    dashSpeed: 720, dashTime: 0.34, dmgMult: 1.4,
    text: '转向冲刺，撞击 150% 攻击力（BOSS 版更快）'
  },
  ultimate: {
    name: '红石陨星',
    text: '能量充满后在敌人周围空投 8 颗强化炸弹：半径 130px、每颗 100 伤害、1.2 秒引信'
  },
  passive: {
    name: '熔核', text: '冲刺撞击 150% 攻击力；免疫定身 / 减速 / 牵引；血量锁 1 不会被击倒'
  },
  createState: function () { return { bombCd: 1.4, basicCd: 1.4 }; },
  // 撞击只在技能冲刺期间结算（与常规红石同口径；贴身不常驻掉血）
  onAttack: function (u) { return u.dashT > 0 ? u.atk * 1.5 : 0; },
  onCast: function (u) {
    ring(u.x, u.y, 14, 118, 0.34, '#ff6b52');
    burst(u.x, u.y, 20, '#ff7a5f', 280);
    floater(u.x, u.y - u.r - 20, '熔岩脉冲', '#ff9c85', 12);
    shake = Math.max(shake, 4);
  },
  onUlt: function (u) {
    var e = nearestEnemy(u);
    var cx = e ? e.x : u.x, cy = e ? e.y : u.y;
    var A = ARENA;
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * TAU + t * 0.6;
      spawnBomb(u,
        clamp(cx + Math.cos(a) * 100, A.x + 26, A.x + A.w - 26),
        clamp(cy + Math.sin(a) * 100, A.y + 26, A.y + A.h - 26),
        { fuse: 1.2, radius: 130, dmg: 100 });
    }
    ring(cx, cy, 12, 190, 0.55, '#ffb14d');
    burst(cx, cy, 26, '#ffd166', 300);
    shake = Math.max(shake, 6);
  },
  onTick: function (u, dt) {
    // 一阶段锁血：打到 1 HP 后完全停手（不投弹、不动作），等另一只也锁血再合体
    if (u.hp <= (BALANCE.boss.lockHp == null ? 1 : BALANCE.boss.lockHp) + 0.05) return;
    var cfg = TYPES.bossred.basic;
    u.st.bombCd -= dt;
    if (u.st.bombCd > 0) return;
    u.st.bombCd += cfg.cd;
    for (var i = 0; i < cfg.count; i++) {
      var a = srand(0, TAU), d = srand(26, 66);
      spawnBomb(u, u.x + Math.cos(a) * d, u.y + Math.sin(a) * d,
        { fuse: 1.4, radius: 100, dmg: cfg.dmg });
    }
    ring(u.x, u.y, 8, 90, 0.3, '#ffb14d');
  },
  draw: function (u) { drawBossBlock(u); }
};

/* 青色 BOSS：护盾 + 冰霜光环
   ------------------------------------------------------------
   · 普攻（3s）向 340px 内最近敌人射出一枚冰锥，130 伤害
   · 每 6 秒把护盾刷到 150（不叠加、不超时消失，只能被伤害消耗）
   · 170px 内敌人持续减速（免疫控制的 BOSS 自己不吃减速）
   · 终结技「折光爆裂」：420px 范围 300 伤害 + 强减速 + 自身 200 护盾 */
TYPES.bosslapis = {
  key: 'bosslapis', name: 'BOSS 青金石', role: 'BOSS / 护盾控场',
  boss: true, bossImmune: true, bossLock: true, calibrated: true,
  r: 34, maxHp: 4550, baseSpeed: 200, atk: 100, def: 90,
  energyMax: 100, energyRegen: 2.0,
  impact: true,
  shieldMax: 200,
  body: '#2d5bd6', light: '#7ba2ff', dark: '#152a6b', glow: '#4a7bf0',
  basic: { cd: 3.0, range: 340, dmg: 105 },
  skill: {
    name: '晶壁折射', cd: 4.4,
    dashSpeed: 600, dashTime: 0.30, dmgMult: 1.2,
    text: '转向冲刺，撞击 100% 攻击力'
  },
  ultimate: {
    name: '折光爆裂',
    text: '能量充满后 420px 内敌人受到 300 伤害并减速 2.5 秒（×0.4），自身获得 200 护盾'
  },
  passive: {
    name: '冰霜光环', text: '170px 内敌人持续减速（×0.6）；BOSS 自身免疫减速'
  },
  createState: function () { return { shield: 0, shieldT: 0, shieldCd: 5.0, basicCd: 1.0, bombCd: 0 }; },
  onAttack: function (u) { return u.dashT > 0 ? u.atk * 1.0 : 0; },
  onCast: function (u) {
    ring(u.x, u.y, u.r, 140, 0.45, '#6f9bff');
    burst(u.x, u.y, 22, '#8fb4ff', 180);
    floater(u.x, u.y - u.r - 20, '晶壁折射', '#9cc0ff', 12);
  },
  onUlt: function (u) {
    var R = 420, DMG = 250, hits = 0;
    for (var k0 = 0; k0 < units.length; k0++) {
      var v0 = units[k0];
      if (!v0.alive || v0.team === u.team) continue;
      if (Math.hypot(v0.x - u.x, v0.y - u.y) > R + v0.r) continue;
      hits++;
    }
    for (var k = 0; k < units.length; k++) {
      var v = units[k];
      if (!v.alive || v.team === u.team) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) > R + v.r) continue;
      hurt(v, DMG * aoeScale(hits), u);
      v.slowT = Math.max(v.slowT, 2.5);
      v.slowMul = Math.min(v.slowMul || 1, 0.4);
    }
    u.st.shield = Math.max(u.st.shield || 0, 200);
    u.st.shieldT = 0;
    ring(u.x, u.y, u.r, R, 0.7, '#9cc0ff');
    ring(u.x, u.y, u.r, R * 0.6, 0.5, '#dbe8ff');
    burst(u.x, u.y, 34, '#8fb4ff', 380);
    shake = Math.max(shake, 5);
  },
  onTick: function (u, dt) {
    // 一阶段锁血：打到 1 HP 后停手（光环与护盾都停），等另一只也锁血再合体
    if (u.hp <= (BALANCE.boss.lockHp == null ? 1 : BALANCE.boss.lockHp) + 0.05) return;

    // 普攻：3 秒一枚冰锥，打 340px 内最近的敌人
    var B = TYPES.bosslapis.basic;
    u.st.basicCd -= dt;
    if (u.st.basicCd <= 0) {
      var e = nearestEnemy(u);
      if (e && Math.hypot(e.x - u.x, e.y - u.y) < B.range + e.r) {
        u.st.basicCd += B.cd;
        hurt(e, B.dmg, u);
        ring(e.x, e.y, 3, 30, 0.25, '#9cc0ff');
        burst(e.x, e.y, 6, '#8fb4ff', 160);
      } else {
        u.st.basicCd = 0.2;   // 没目标就下一帧再试
      }
    }

    var cfg = BALANCE.boss.lapis;
    for (var k = 0; k < units.length; k++) {
      var v = units[k];
      if (!v.alive || v.team === u.team) continue;
      if (v.boss) continue;   // BOSS 免疫控制
      if (Math.hypot(v.x - u.x, v.y - u.y) < cfg.auraR) {
        v.slowT = Math.max(v.slowT, 0.35);
        v.slowMul = Math.min(v.slowMul || 1, BALANCE.slowSpeedMul);
      }
    }

    u.st.shieldCd -= dt;
    if (u.st.shieldCd > 0) return;
    u.st.shieldCd += cfg.shieldInterval;
    u.st.shield = cfg.shield;
    u.st.shieldT = 0;   // 不按时间清空，只能被伤害打掉
    ring(u.x, u.y, u.r, 118, 0.4, '#8fb4ff');
    burst(u.x, u.y, 10, '#9cc0ff', 180);
    floater(u.x, u.y - u.r - 14, '护盾 ' + cfg.shield, '#9cc0ff', 12);
  },
  draw: function (u) { drawBossBlock(u); }
};

/* 紫晶核心：红青合体后的最终形态（出生即狂暴）
   ------------------------------------------------------------
   · 合体演出：血条从 1 充到 6500；从这一刻起可以被击倒
   · 普攻（3s）：400px 内最近敌人受到 140 伤害
   · 狂暴：移速 ×2.6 起、每秒 +0.11 倍（上限 ×4.0）；可穿透敌方
   · 沿途投炸弹（间隔 0.75s → 最快 0.45s，45 伤害）
   · 撞击伤害随时间叠加（每秒 +15，上限 +150），每次命中后有 1.0s 冷却
   · 每 7 秒放一圈「紫晶冲击」：360px 内敌人 120 伤害
   · 合体后 32 秒还没被打死 → 「终末震荡」：BOSS 原地停止，镜头依次给到每个受击单位，
     敌方每个存活单位（含种子）扣 60% 最大生命，并施加 10 秒虚弱（所有伤害 -20%） */
TYPES.bosscore = {
  key: 'bosscore', name: '紫晶核心', role: 'BOSS / 合体形态',
  boss: true, bossImmune: true, calibrated: true,
  rageCasts: true,   // 狂暴期间仍然施放技能（其它角色的狂暴会停手）
  r: 46, maxHp: 4300, baseSpeed: 240, atk: 100, def: 120,
  energyMax: 100, energyRegen: 2.2,
  impact: true,
  body: '#7a3fbf', light: '#c79bff', dark: '#3a1668', glow: '#b478ff',
  basic: { cd: 3.0, range: 400, dmg: 105 },
  skill: {
    name: '紫晶脉冲', cd: 2.6,
    dashSpeed: 780, dashTime: 0.30, dmgMult: 1.35,
    text: '转向冲刺，撞击 115% 攻击力'
  },
  ultimate: {
    name: '紫晶崩裂',
    text: '能量充满后以自身为中心 460px 爆发 300 伤害（多目标衰减），并空投 6 颗炸弹'
  },
  passive: {
    name: '合体狂暴',
    text: '速度持续提升 · 沿途投弹 · 撞击伤害随时间叠加（每秒 +15，上限 +120，每次命中后 1.0 秒冷却）· 32 秒后原地停止释放终末震荡：全场扣 60% 最大生命并虚弱 10 秒'
  },
  rage: {
    speedMul: 2.6,
    speedRampPerSec: 0.11,
    speedMulCap: 4.0,
    passThrough: true,
    hitCd: 1.0,
    dmgPerSec: 15,
    dmgCap: 120,
    ramp: true,
    status: '移速 ×2.6 起 · 越跑越快 · 可穿透敌方 · 沿途投掷炸弹 · 撞击伤害叠加',
    bomb: { interval: 0.75, intervalRamp: 0.010, intervalMin: 0.45, fuse: 1.3, radius: 105, dmg: 36 }
  },
  ultBlocked: function (u) { return u.st.nukeCast > 0; },
  createState: function () { return { bombCd: 0.2, basicCd: 1.0, rageHitCd: 0, shockCd: 7.0, nukeT: -1, nukeWarned: false, nukeCast: 0 }; },
  // 撞击：狂暴后常驻，按「合体后经过的秒数」叠加附加伤害，命中后有 hitCd 冷却
  onAttack: function (u) {
    if (u.st.nukeCast > 0) return 0;   // 终末震荡演出期间不结算撞击
    var R = u.st.rage;
    if (!R) return u.atk * 1.15;
    if (R.phase === 'shake') return 0;
    if ((u.st.rageHitCd || 0) > 0) return 0;
    u.st.rageHitCd = TYPES.bosscore.rage.hitCd;
    var extra = Math.min(TYPES.bosscore.rage.dmgCap,
      (t - R.since) * TYPES.bosscore.rage.dmgPerSec);
    return u.atk * 1.15 + extra;
  },
  onCast: function (u) {
    ring(u.x, u.y, u.r, 150, 0.36, '#c79bff');
    burst(u.x, u.y, 24, '#d9bcff', 300);
    floater(u.x, u.y - u.r - 22, '紫晶脉冲', '#d9bcff', 13);
    shake = Math.max(shake, 4);
  },
  onUlt: function (u) {
    var R = 460, DMG = 300, hits = 0;
    for (var k0 = 0; k0 < units.length; k0++) {
      var v0 = units[k0];
      if (!v0.alive || v0.team === u.team) continue;
      if (Math.hypot(v0.x - u.x, v0.y - u.y) > R + v0.r) continue;
      hits++;
    }
    for (var k = 0; k < units.length; k++) {
      var v = units[k];
      if (!v.alive || v.team === u.team) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) > R + v.r) continue;
      hurt(v, DMG * aoeScale(hits), u);
      burst(v.x, v.y, 8, '#d9bcff', 220);
    }
    var A = ARENA;
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * TAU + t * 0.5;
      spawnBomb(u,
        clamp(u.x + Math.cos(a) * 130, A.x + 26, A.x + A.w - 26),
        clamp(u.y + Math.sin(a) * 130, A.y + 26, A.y + A.h - 26),
        { fuse: 1.4, radius: 120, dmg: 100 });
    }
    ring(u.x, u.y, u.r, R, 0.75, '#c79bff');
    ring(u.x, u.y, u.r, R * 0.6, 0.55, '#efe2ff');
    burst(u.x, u.y, 36, '#b478ff', 400);
    shake = Math.max(shake, 7);
    hitStop = Math.max(hitStop, 0.03);
  },
  onTick: function (u, dt) {
    // 出场放大动画计时（只影响外观）
    if (u.st.appear > 0) u.st.appear = Math.max(0, u.st.appear - dt);
    /* 血条充能：合体登场时只有 1 HP，1.2 秒内涨到 4300（期间免伤、不能移动）。
       这样玩家能看到「血条从 1 涨到满」的过程，而不是瞬间满血。 */
    if (u.st.mergeFill > 0) {
      u.st.mergeFill = Math.max(0, u.st.mergeFill - dt);
      u.hp = Math.min(u.maxHp, u.hp + (u.st.mergeFillRate || 0) * dt);
      if (u.st.mergeFill <= 0) u.hp = u.maxHp;
    }

    // 终末震荡演出：BOSS 原地停止，只蓄能（速度由 speedOf 归零，攻击全部跳过）
    if (u.st.nukeCast > 0) {
      u.st.nukeCast = Math.max(0, u.st.nukeCast - dt);
      if (Math.floor((u.st.nukeCast + dt) * 5) !== Math.floor(u.st.nukeCast * 5)) {
        ring(u.x, u.y, u.r + 8, u.r + 110, 0.4, '#c79bff');
      }
      return;
    }

    // 狂暴撞击的冷却
    if (u.st.rageHitCd > 0) u.st.rageHitCd = Math.max(0, u.st.rageHitCd - dt);

    // 普攻：3 秒打 400px 内最近的敌人 140
    var BB = TYPES.bosscore.basic;
    u.st.basicCd -= dt;
    if (u.st.basicCd <= 0 && u.st.mergeFill <= 0) {
      var be = nearestEnemy(u);
      if (be && Math.hypot(be.x - u.x, be.y - u.y) < BB.range + be.r) {
        u.st.basicCd += BB.cd;
        hurt(be, BB.dmg, u);
        ring(be.x, be.y, 3, 34, 0.25, '#c79bff');
        burst(be.x, be.y, 8, '#b478ff', 180);
      } else {
        u.st.basicCd = 0.2;
      }
    }

    var R = u.st.rage;
    /* 终末震荡：合体后 nukeDelay 秒还没被打死 → 全屏一震（每局只放一次）。
       充能最后 nukeWarn 秒给一次播报 + 状态栏倒计时，让玩家知道该集火。 */
    if (R && R.phase === 'rage' && u.st.mergeFill <= 0 && u.st.nukeT >= 0) {
      u.st.nukeT -= dt;
      var NC = BALANCE.boss.core;
      if (!u.st.nukeWarned && u.st.nukeT <= (NC.nukeWarn || 8)) {
        u.st.nukeWarned = true;
        if (typeof bossCry === 'function') bossCry('终末震荡充能', '快集火！BOSS 未死将全屏一震');
        if (typeof sfxPlay === 'function') sfxPlay('cast');
        ring(u.x, u.y, u.r, u.r + 120, 0.6, '#ff9a6b');
      }
      if (u.st.nukeT <= 0) {
        u.st.nukeT = -1;
        u.st.nukeCast = 1.8;   // 原地停止 1.8 秒，配合镜头演出
        coreNuke(u);
        return;
      }
    }

    // 沿途投弹（只有狂暴阶段）
    if (R && R.phase === 'rage') {
      var B = TYPES.bosscore.rage.bomb;
      var interval = Math.max(B.intervalMin, B.interval - (t - R.since) * B.intervalRamp);
      u.st.bombCd -= dt;
      if (u.st.bombCd <= 0) {
        u.st.bombCd += interval;
        spawnBomb(u, u.x, u.y, B);
        ring(u.x, u.y, 3, 30, 0.18, '#c79bff');
      }
    }

    // 紫晶冲击：每 7 秒一圈范围伤害（合体后才有）
    if (R) {
      u.st.shockCd -= dt;
      if (u.st.shockCd <= 0) {
        u.st.shockCd += BALANCE.boss.core.shockInterval;
        var RR = BALANCE.boss.core.shockR, DD = BALANCE.boss.core.shockDmg;
        var hits = 0;
        for (var k = 0; k < units.length; k++) {
          var v = units[k];
          if (!v.alive || v.team === u.team) continue;
          if (Math.hypot(v.x - u.x, v.y - u.y) > RR + v.r) continue;
          hits++;
        }
        for (var k2 = 0; k2 < units.length; k2++) {
          var v2 = units[k2];
          if (!v2.alive || v2.team === u.team) continue;
          if (Math.hypot(v2.x - u.x, v2.y - u.y) > RR + v2.r) continue;
          hurt(v2, DD * aoeScale(hits), u);
        }
        ring(u.x, u.y, u.r, RR, 0.55, '#c79bff');
        burst(u.x, u.y, 22, '#b478ff', 300);
        shake = Math.min(15, shake + 3);
      }
    }
  },
  onRageStart: function (u) {
    u.st.bombCd = 0.15;
    u.st.rageHitCd = 0;
    u.st.shockCd = 3.0;
    // 合体即开始为「终末震荡」计时（0 表示已放完 / 不再计时）
    var C = BALANCE.boss.core;
    u.st.nukeT = C.nukeDelay == null ? 24 : C.nukeDelay;
    u.st.nukeWarned = false;
  },
  draw: function (u) { drawBossBlock(u); }
};

/* 终末震荡（全屏一震）：BOSS 原地停止，所有存活敌方单位 + 敌方种子各扣 pct% 最大生命，
   并附加 10 秒虚弱（普攻 / 技能 / 终结技伤害 -20%）。
   走 hurt(..., {pct:1})，因此不吃 dmgScale / dmgTakeMul；
   同时生成 bossCine 镜头队列，渲染层会依次放大每个被命中的单位。 */
function coreNuke(u) {
  var C = BALANCE.boss.core;
  var pct = C.nukePct == null ? 0.60 : C.nukePct;
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
    bossCry('终末震荡', 'BOSS 原地停止 · 敌方各扣 ' + Math.round(pct * 100) + '% 最大生命并虚弱 ' + weakDur + ' 秒');
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
  /* 终末震荡预警蓄能：最后 nukeWarn 秒核心向内收紧蓄能，
     蓄能环收缩 + 内圈白环收拢 + 向上抽微光柱，让玩家提前集火。 */
  var warnW = BALANCE.boss.core.nukeWarn || 8;
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

  /* 终末震荡释放演出：核心残留辉光随 nukeCast 消退向外扩散。 */
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
