/* 水桶：区域控制 / 蒸发爆发
   ------------------------------------------------------------
   2026-11-22 重做（用户口述三技能）：
     · 普攻（2s）   水滴攻击：锁定最近敌人，投出一颗水弹，命中造成 70% 攻击力；
                    若目标身上有「灼烧」，额外消耗 1 层灼烧打出「蒸发」——
                    再造成 260% 攻击力伤害（不消耗其它 DoT）
     · 技能（10s）  狂浪：原地生成一滩狂浪（持续 7 秒），浪心产生引力；
                    敌方在浪中每 2 秒叠 1 层「溺水」（上限 5 层），
                    第 7 秒浪中爆炸：170% 攻击力 + 3 层溺水
     · 终结技       大浪淘（能量 100）：领域持续 6 秒，狂浪每秒拍击全场地一次，
                    每次 70% 攻击力；最后一拍立刻结算全场敌人的全部持续伤害
   ------------------------------------------------------------
   · 溺水是层数制 DoT：1~5 层每秒分别造成 15/20/25/30/40% 施放者攻击力，
     每秒结算一次、不消耗层数（离开浪面后依然持续）
   · 狂浪只拖拽敌方位置、不修改 u.ang（符合「只有技能 / 撞墙才转向」的红线）
   · 水只对敌方单位生效，不影响己方、不伤害种子
   ------------------------------------------------------------
   数据：waters[]（30-sim 的 updateWaves）、bucketDrops[]（水滴飞行物） */
'use strict';

var BUCKET_BASIC = {
  cd: 2.0,           // 普攻间隔
  range: 380,        // 水滴锁定距离
  pct: 0.70,         // 水滴本体：70% 攻击力
  evap: 2.60,        // 蒸发：额外 260% 攻击力（消耗 1 层灼烧）
  energy: 16,        // 命中回能 16
  speed: 820         // 水滴飞行速度（px/s，纯表现节奏）
};
var BUCKET_SKILL = { cd: 10.0 };
var BUCKET_ULT = {
  dur: 6.0,          // 领域持续
  interval: 1.0,     // 每秒一拍（共 6 拍，最后一拍在 6s）
  pct: 0.70,         // 每拍 70% 攻击力
  slam: 5.0          // 每拍震屏强度（表现）
};
/* 溺水：层数制 DoT，按层数取档位伤害 */
var BUCKET_DROWN = {
  maxStacks: 5,
  interval: 1.0,     // 每秒结算一次
  stackEvery: 2.0,   // 在浪中每 2 秒叠 1 层
  outGrace: 3.0,     // 离开浪面后的宽限（秒）
  decayEvery: 1.5,   // 宽限结束后每 1.5 秒 -1 层
  pct: [0.15, 0.20, 0.25, 0.30, 0.40]
};

/* 水滴飞行物：形如 {x,y,ang,src,target,life} —— 命中的那一刻才结算伤害 */
var bucketDrops = [];

function bucketDrownPct(stacks) {
  var n = clamp(stacks, 1, BUCKET_DROWN.maxStacks);
  return BUCKET_DROWN.pct[n - 1];
}

/* 叠溺水：层数上限 5，刷新施放者攻击力快照 */
function bucketApplyDrown(v, src, n) {
  if (!v || !v.alive || !src || !(n > 0)) return;
  v.drownStacks = Math.min(BUCKET_DROWN.maxStacks, (v.drownStacks || 0) + n);
  v.drownAtk = src.atk || 0;
  v.drownSrc = src;
  v.drownOutAcc = 0;   // 重新叠层：离浪衰减计时清零
  if (!(v.drownAcc > 0)) v.drownAcc = BUCKET_DROWN.interval;
}

/* 瞬间结算一次溺水（终结技最后一拍用）：不消耗层数，只把下一次跳伤提前 */
function bucketSettleDrown(v, src) {
  if (!v || !v.alive || !(v.drownStacks > 0)) return 0;
  var dmg = (v.drownAtk || 0) * bucketDrownPct(v.drownStacks);
  if (dmg > 0) {
    hurt(v, dmg, v.drownSrc || src, { dot: 1 });
    v.drownAcc = BUCKET_DROWN.interval;
    floater(v.x, v.y - v.r - 16, '溺水结算', '#7fd8ff', 12);
  }
  return dmg;
}

/* 狂浪爆炸：浪中敌方 170% 攻击力 + 3 层溺水（由 30-sim 在 age>=life 时调用） */
function bucketWaveBoom(w) {
  var T = TYPES.bucket;
  var S = T.skill;
  var i;
  var victims = [];
  for (i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === w.team) continue;
    var rad = T.water.r + v.r * 0.35;
    if (Math.hypot(v.x - w.x, v.y - w.y) > rad) continue;
    victims.push(v);
  }
  var mul = aoeScale(victims.length);
  for (i = 0; i < victims.length; i++) {
    var e = victims[i];
    hurt(e, (w.owner && w.owner.atk ? w.owner.atk : 0) * S.boomPct * mul, w.owner, { skill: 1 });
    bucketApplyDrown(e, w.owner, 3);
    ring(e.x, e.y, e.r, e.r + 60, 0.34, '#d8f6ff');
    burst(e.x, e.y, 14, '#cdefff', 300);
  }
  // 表现：巨浪炸开 + 一圈冲击波 + 水柱
  ring(w.x, w.y, 20, T.water.r + 90, 0.55, '#d8f6ff');
  ring(w.x, w.y, 20, T.water.r * 0.55, 0.4, '#ffffff');
  burst(w.x, w.y, 34, '#bfeeff', 420);
  for (i = 0; i < 8; i++) {
    var a = rand(0, TAU), rr = rand(10, T.water.r);
    burst(w.x + Math.cos(a) * rr, w.y + Math.sin(a) * rr, 4, '#e8fbff', 240);
  }
  shake = Math.max(shake, 6.5);
  floater(w.x, w.y - 40, '狂浪爆裂', '#bfeeff', 16);
  if (typeof sfxPlay === 'function') sfxPlay('bomb');
}

/* 水滴命中：70% +（有灼烧时）消耗 1 层打出 260% 蒸发 */
function bucketDropImpact(u, e) {
  var B = TYPES.bucket.basic;
  hurt(e, u.atk * B.pct, u, { basic: 1 });
  gainEnergy(u, B.energy);
  ring(e.x, e.y, e.r, e.r + 26, 0.24, '#9fe4ff');
  burst(e.x, e.y, 7, '#cdefff', 170);

  if ((e.burnStacks || 0) > 0) {
    e.burnStacks -= 1;   // 消耗 1 层灼烧
    if (e.burnStacks <= 0) {
      e.burnStacks = 0; e.burnSrc = null; e.burnAtk = 0;
      e.burnAcc = (typeof RED_BURN !== 'undefined') ? RED_BURN.interval : 1.0;
    }
    hurt(e, u.atk * B.evap, u, { basic: 1 });
    // 蒸发表现：白雾爆开 + 双层冲击环 + 上升蒸汽
    ring(e.x, e.y, e.r * 0.4, e.r + 74, 0.42, '#ffffff');
    ring(e.x, e.y, e.r * 0.4, e.r + 46, 0.3, '#ffd9a0');
    burst(e.x, e.y, 20, '#f4fbff', 330);
    burst(e.x, e.y, 10, '#ffd9a0', 260);
    floater(e.x, e.y - e.r - 30, '蒸发 ×' + B.evap.toFixed(1), '#ffe3b0', 17, { pop: 1 });
    shake = Math.max(shake, 3.2);
    if (typeof sfxPlay === 'function') sfxPlay('hit');
  }
}

/* 水滴飞行：追着目标跑，到达后结算（目标死亡则消失） */
function updateBucketDrops(dt) {
  for (var i = bucketDrops.length - 1; i >= 0; i--) {
    var d = bucketDrops[i];
    var e = d.target;
    if (!d.src || !d.src.alive || !e || !e.alive) { bucketDrops.splice(i, 1); continue; }
    var dx = e.x - d.x, dy = e.y - d.y;
    var dist = Math.hypot(dx, dy);
    var step = BUCKET_BASIC.speed * dt;
    d.ang = Math.atan2(dy, dx);
    if (dist <= e.r + step + 4) {
      bucketDrops.splice(i, 1);
      bucketDropImpact(d.src, e);
      continue;
    }
    d.x += dx / dist * step;
    d.y += dy / dist * step;
    d.trail = d.trail || [];
    d.trail.push({ x: d.x, y: d.y });
    if (d.trail.length > 5) d.trail.shift();
  }
}

/* 大招每一拍：全场地拍击一次 */
function bucketSurfSlam(u) {
  var U = TYPES.bucket.ultimate;
  var i;
  var victims = [];
  for (i = 0; i < units.length; i++) {
    var v = units[i];
    if (!v.alive || v.team === u.team) continue;
    victims.push(v);
  }
  var mul = aoeScale(victims.length);
  for (i = 0; i < victims.length; i++) {
    var e = victims[i];
    hurt(e, u.atk * U.pct * mul, u, { ult: 1 });
    ring(e.x, e.y, e.r, e.r + 54, 0.3, '#cdefff');
    burst(e.x, e.y, 8, '#e8fbff', 220);
  }
  // 全场地拍击表现：从水桶脚下推开的巨环 + 四角水柱
  ring(u.x, u.y, 40, Math.max(ARENA.w, ARENA.h) * 0.9, 0.6, '#d8f6ff');
  for (i = 0; i < 5; i++) {
    var cx = srand(ARENA.x + 40, ARENA.x + ARENA.w - 40);
    var cy = srand(ARENA.y + 40, ARENA.y + ARENA.h - 40);
    burst(cx, cy, 5, '#eaffff', 260);
  }
  u.st.surfPulse = 1.0;
  shake = Math.max(shake, U.slam);
  floater(u.x, u.y - u.r - 54, '狂浪拍击', '#bfeeff', 14);
  if (typeof sfxPlay === 'function') sfxPlay('bomb');
}

TYPES.bucket = {
  key: 'bucket', name: '水桶', role: '区域控制 / 蒸发爆发',
  r: 28, maxHp: 1800, baseSpeed: 200, atk: 100, def: 105,
  energyMax: 100, energyRegen: 0.5,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale */
  calibrated: true,
  impact: true,   // 撞击恒为 0，输出全部来自水滴 / 狂浪 / 大浪淘
  body: '#3f86a8', light: '#dff2fb', dark: '#17475c', glow: '#7fd8ff',
  basic: BUCKET_BASIC,
  skill: {
    name: '狂浪', cd: BUCKET_SKILL.cd, noTurn: true,
    dashTime: 0, dashSpeed: 0, dmgMult: 1,
    boomPct: 1.70,          // 第 7 秒爆炸：170% 攻击力
    boomDrown: 3,           // 并施加 3 层溺水
    text: '每 10 秒在当前位置召出一滩狂浪（持续 7 秒）：浪心引力把敌人拖向圆心，浪中敌方每 2 秒叠 1 层「溺水」（上限 5 层，每秒 15/20/25/30/40% 攻击力）；第 7 秒狂浪爆炸，造成 170% 攻击力并再施加 3 层溺水'
  },
  ultimate: {
    name: '大浪淘',
    dur: BUCKET_ULT.dur, interval: BUCKET_ULT.interval, pct: BUCKET_ULT.pct,
    text: '能量充满后展开 6 秒领域：狂浪每秒拍击全场地一次，每次 70% 攻击力；最后一拍立刻结算全场敌人身上所有持续伤害'
  },
  passive: {
    name: '蒸发',
    text: '水滴命中带灼烧的敌人时消耗 1 层灼烧，额外打出 260% 攻击力的蒸发伤害'
  },

  /* 狂浪参数（唯一可调入口）
     · r            浪面最大半径
     · grow         从圆心扩散到最大半径的时间（秒）
     · life         完整持续时长（秒）；到点立刻爆炸，再留 fade 秒淡出
     · fade         爆炸残影淡出时长（秒）
     · gravity      圆心处的最大拖拽速度（px/s），随离圆心距离线性衰减到 0
     · stackEvery   在浪中每多少秒叠 1 层溺水（见 BUCKET_DROWN） */
  water: {
    r: 230, grow: 0.8, life: 7.0, fade: 0.45, gravity: 300
  },

  createState: function () {
    return { basicCd: 1.0, surfT: 0, surfAcc: 1.0, surfLeft: 0, surfPulse: 0, surfFlash: 0 };
  },

  // 撞击恒为 0
  onAttack: function () { return 0; },

  // 技能：原地生成狂浪（CD / 方向由 cast() 统一处理）
  onCast: function (u) {
    var C = TYPES.bucket.water;
    spawnWave(u, u.x, u.y);
    ring(u.x, u.y, u.r, C.r, 0.5, '#bfeeff');
    burst(u.x, u.y, 20, '#cdefff', 240);
    floater(u.x, u.y - u.r - 22, '狂浪', '#9fe4ff', 14);
    shake = Math.max(shake, 2.5);
  },

  // 终结技：展开「大浪淘」领域
  onUlt: function (u) {
    var U = TYPES.bucket.ultimate;
    u.st.surfT = U.dur;
    u.st.surfAcc = U.interval;   // 1 秒后第一拍，第 6 秒最后一拍
    u.st.surfLeft = Math.round(U.dur / U.interval);
    u.st.surfFlash = 0;
    u.st.surfPulse = 1.0;
    ring(u.x, u.y, u.r, 220, 0.55, '#d8f6ff');
    burst(u.x, u.y, 30, '#eaffff', 360);
    shake = Math.max(shake, 5);
  },

  onTick: function (u, dt) {
    // 普攻：每 2 秒投出一颗水滴
    u.st.basicCd = Math.max(0, u.st.basicCd - dt);
    if (u.st.basicCd <= 0) {
      var e = nearestEnemy(u);
      if (e && !e.st.locked && Math.hypot(e.x - u.x, e.y - u.y) <= BUCKET_BASIC.range + e.r) {
        u.st.basicCd = BUCKET_BASIC.cd;
        u.faceAng = Math.atan2(e.y - u.y, e.x - u.x);
        bucketDrops.push({ x: u.x, y: u.y, ang: u.faceAng, src: u, target: e, trail: [] });
        ring(u.x, u.y, u.r * 0.4, u.r + 10, 0.2, '#bfeeff');
      }
    }

    // 终结技领域计时：每秒一拍，最后一拍结算全场 DoT
    if (u.st.surfPulse > 0) u.st.surfPulse = Math.max(0, u.st.surfPulse - dt * 2.2);
    if (u.st.surfFlash > 0) u.st.surfFlash = Math.max(0, u.st.surfFlash - dt * 1.6);
    if (u.st.surfT <= 0) return;
    u.st.surfT -= dt;
    u.st.surfAcc -= dt;
    if (u.st.surfAcc > 0) return;
    u.st.surfAcc += TYPES.bucket.ultimate.interval;
    u.st.surfLeft -= 1;
    bucketSurfSlam(u);
    if (u.st.surfLeft <= 0) {
      // 最后一拍：立刻结算全场敌人身上所有持续伤害
      u.st.surfT = 0;
      u.st.surfFlash = 1.0;
      var n = 0;
      for (var i = 0; i < units.length; i++) {
        var v = units[i];
        if (!v.alive || v.team === u.team) continue;
        var total = settleDots(v, u);
        if (total > 0) {
          n++;
          ring(v.x, v.y, v.r, v.r + 80, 0.45, '#ffe3b0');
          burst(v.x, v.y, 12, '#ffffff', 300);
        }
      }
      ring(u.x, u.y, 60, Math.max(ARENA.w, ARENA.h), 0.8, '#ffffff');
      burst(u.x, u.y, 36, '#eaffff', 520);
      floater(u.x, u.y - u.r - 62, n > 0 ? '大浪淘 · 全额结算' : '大浪淘 · 终拍', '#ffffff', 18, { pop: 1 });
      shake = Math.max(shake, 8);
      if (typeof sfxPlay === 'function') sfxPlay('ult');
    }
  },

  draw: function (u) { drawBucket(u); }
};
