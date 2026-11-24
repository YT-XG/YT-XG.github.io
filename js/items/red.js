/* 红石块：莽夫 / 先手，羁绊伙伴 lapis
   2026-11-22 重做：2000 HP / 100 攻击 / 100 防御，
   普攻改为身周环形炸弹，技能为长距突进，终结技由能量条驱动。 */
'use strict';

var RED_BASIC = {
  cd: 3.0,          // 普攻间隔（狂暴后读 rage.basicCd）
  count: 5,         // 身周一圈炸弹数
  ring: 70,         // 炸弹生成半径
  radius: 95,       // 爆炸半径（贴脸命中更稳，避免炸弹只是"地上装饰"）
  fuse: 3.0,        // 引信：落地 3 秒后爆炸；敌方触碰会立刻引爆
  pct: 0.35,        // 每颗 35% 攻击力
  energy: 3,        // 每命中 1 个敌人回 3 能量
  energyCap: 6      // 每次普攻最多回 6 点（5 颗全中也不超额）
};

/* 灼烧：普攻炸弹爆炸给命中者叠 1 层，最高 10 层。
   每层每秒造成 5% 红石攻击力伤害；每结算一次伤害消耗 1 层。 */
var RED_BURN = { pctPerLayer: 0.05, maxStacks: 10, interval: 1.0 };

function redApplyBurn(v, src, n) {
  if (!v || !v.alive || !src || !(n > 0)) return;
  v.burnStacks = Math.min(RED_BURN.maxStacks, (v.burnStacks || 0) + n);
  v.burnAtk = src.atk || 0;
  v.burnSrc = src;
  if (!(v.burnAcc > 0)) v.burnAcc = RED_BURN.interval;
}

function updateBurns(dt) {
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive || !(u.burnStacks > 0)) continue;
    u.burnAcc -= dt;
    while (u.burnAcc <= 0 && u.alive && u.burnStacks > 0) {
      u.burnAcc += RED_BURN.interval;
      hurt(u, u.burnStacks * RED_BURN.pctPerLayer * (u.burnAtk || 0), u.burnSrc, { dot: 1, periodic: 1 });
      u.burnStacks -= 1;   // 每结算一次伤害降低 1 层
    }
    if (u.burnStacks <= 0) {
      u.burnStacks = 0;
      u.burnSrc = null;
      u.burnAtk = 0;
      u.burnAcc = RED_BURN.interval;
    }
  }
}

TYPES.red = {
  key: 'red', name: '红石块', role: '莽夫 / 先手', bond: 'lapis',
  r: 24, maxHp: 2000, baseSpeed: 210, atk: 100, def: 100,
  energyMax: 100,
  /* 数值已按 2000 HP 口径校准：伤害不再乘 dmgScale（旧角色没有这个标记） */
  calibrated: true,
  /* 保留撞击判定，但伤害由 onAttack 改写：只有突进期间才结算 */
  impact: true,
  shieldMax: 50,      // 护盾条分母（青金石附魔 3 号刷新为 50）
  body: '#c8342b', light: '#ff7a6a', dark: '#6d140e', glow: '#ff5a44',
  basic: RED_BASIC,
  skill: {
    name: '红石突进', cd: 8.0,
    dashSpeed: 640, dashTime: 0.35, dmgMult: 1,
    pct: 1.8, energy: 18,
    text: '每 8 秒长距离突进，撞到敌人造成 180% 攻击力伤害（技能伤害，命中回能 18）'
  },
  ultimate: {
    name: '锁敌轰炸',
    text: '能量充满后锁定一名敌人，4 秒内落下 20 发炸弹：前 10 发各 35% / 11-19 发各 55% / 末发 250% 攻击力',
    bomb: { count: 20, interval: 0.2, fuse: 0.3, radius: 70, pct: 0.35, pctLate: 0.55, last: 20, pctLast: 2.5 }
  },
  passive: {
    name: '炸弹回收',
    text: '普攻炸弹命中回能，每轮普攻最多回 6 点，避免 5 颗全中时充能翻倍'
  },
  // 羁绊：青金石阵亡后先无敌抖动 3 秒，随后提速 + 普攻提速
  rage: {
    speedMul: 3,
    passThrough: true,   // 狂暴后穿透敌方：只跳过分离 / 反弹，伤害照常结算
    basicCd: 1.2,
    skillCd: 6.0,
    status: '移速 ×3 · 可穿透敌方 · 普攻 3s → 1.2s · 突进 8s → 6s'
  },
  rageCasts: true,
  createState: function () {
    return { bombCd: 1.2, energyOnHit: false, bombRain: null, basicBuffLayers: 0, hpBuffLayers: 0 };
  },
  // 只有突进期间按 180% 攻击力结算；平时碰撞伤害为 0
  onAttack: function (u) {
    return u.dashT > 0 ? u.atk * TYPES.red.skill.pct : 0;
  },
  onCast: function (u) {
    u.cd = u.st.rage ? TYPES.red.rage.skillCd : TYPES.red.skill.cd;
    u.st.energyOnHit = true;
    ring(u.x, u.y, 12, 96, 0.34, '#ff6b52');
    burst(u.x, u.y, 16, '#ff7a5f', 250);
    floater(u.x, u.y - u.r - 20, '红石突进', '#ff9c85', 12);
    shake = Math.max(shake, 3.5);
  },
  onHit: function (u) {
    if (!u.st.energyOnHit) return;
    u.st.energyOnHit = false;
    gainEnergy(u, TYPES.red.skill.energy);
  },
  // 终结技：锁定一名对手，持续向目标空投炸弹
  onUlt: function (u) {
    u.st.bombRain = { target: nearestEnemy(u), left: TYPES.red.ultimate.bomb.count, n: 0, gap: 0 };
    var e = u.st.bombRain.target;
    if (e) ring(e.x, e.y, 30, 170, 0.55, '#ffb14d');
    ring(u.x, u.y, u.r, 150, 0.45, '#ffb14d');
    burst(u.x, u.y, 22, '#ffd166', 280);
  },
  onTick: function (u, dt) {
    // 狂暴前的 3 秒无敌抖动：原地不动也不出手
    if (u.st.rage && u.st.rage.phase === 'shake') return;
    // 冲刺结束后清掉回能标记，避免下一次无关碰撞白送能量
    if (u.dashT <= 0 && u.st.energyOnHit) u.st.energyOnHit = false;

    // 普攻：每 3 秒（狂暴 1.2 秒）在身周放一圈炸弹
    var B = TYPES.red.basic;
    var interval = u.st.rage ? TYPES.red.rage.basicCd : B.cd;
    u.st.bombCd -= dt;
    if (u.st.bombCd <= 0) {
      u.st.bombCd += interval;
      var budget = { left: B.energyCap };
      // 青金石附魔 1 号：普攻伤害 +20%/层，无上限
      var dmg = u.atk * B.pct * (1 + 0.20 * (u.st.basicBuffLayers || 0));
      for (var i = 0; i < B.count; i++) {
        var a = i / B.count * TAU + t * 0.4;
        spawnBomb(u, u.x + Math.cos(a) * B.ring, u.y + Math.sin(a) * B.ring, {
          fuse: B.fuse, radius: B.radius, dmg: dmg, energy: B.energy, budget: budget, basic: 1
        });
      }
      ring(u.x, u.y, 12, B.ring, 0.22, '#ffb14d');
      burst(u.x, u.y, 6, '#ffd166', 120);
    }

    // 终结技：持续向锁定的目标投弹
    var R = u.st.bombRain;
    if (!R || R.left <= 0) return;
    if (!R.target || !R.target.alive) R.target = nearestEnemy(u);
    R.gap -= dt;
    if (R.gap > 0) return;
    var C = TYPES.red.ultimate.bomb;
    R.gap += C.interval;
    R.n += 1;
    R.left -= 1;
    if (!R.target) return;
    var pct = R.n >= C.last ? C.pctLast : (R.n > 10 ? C.pctLate : C.pct);
    spawnBomb(u, R.target.x + rand(-28, 28), R.target.y + rand(-28, 28), {
      fuse: C.fuse, radius: C.radius, dmg: u.atk * pct, ult: 1
    });
  },
  onRageStart: function (u) {
    u.st.bombCd = Math.min(u.st.bombCd, 0.3);
    ring(u.x, u.y, u.r, 150, 0.4, '#ffb14d');
    burst(u.x, u.y, 12, '#ffd166', 220);
    floater(u.x, u.y - u.r - 24, '狂暴 · 投弹提速', '#ffd166', 12);
  },
  draw: function (u) { drawBlock(u); }
};
