/* ============================================================
   25-field.js —— 场地环境：随机食物 / 局部恶劣区域 / 全场天气
   ------------------------------------------------------------
   这一层只做「环境」，不接管任何单位的移动方向：
     · 食物：随机刷新在场地内，单位走上去自动拾取，提供多种增益
     · 局部环境：岩浆池 / 毒沼 / 霜冻区 / 雷区 / 泥沼 / 荆棘地
       只影响半径内的单位，减速 / 持续伤害 / 引力都只改位置或速度大小，
       绝不改 u.ang（与水面 / 冰面的处理一致）
     · 全场天气：沙尘暴 / 雷暴 / 酷暑 / 寒潮 / 毒雾 / 血月 / 强风
       对全场单位施加 debuff，每局随机切换
   所有随机数都走 srand()，因此同一比赛种子会复现同一套环境。
   ============================================================ */
'use strict';

var FIELD = {
  foodMax: 5,
  foodFirst: [3.0, 5.0],      // 开局第一份食物
  foodGap: [7.0, 11.0],       // 之后每次刷新间隔
  foodLife: 22,               // 食物在场上的存活时间
  hazardMax: 3,
  hazardFirst: [8.0, 12.0],
  hazardGap: [14.0, 20.0],
  weatherFirst: [10.0, 14.0],
  weatherGap: [18.0, 26.0],   // 一次天气结束后的晴天间隔
  weatherLife: [14.0, 20.0],
  maxEnvDps: 0.05,            // 环境持续伤害的合计上限（每秒 5% 最大生命）
  strikeRadius: 70            // 雷暴落雷半径
};

/* ============================================================
   食物：全部为增益，拾取后立即生效
   ------------------------------------------------------------
   heal / shield 按目标生命上限计算；atk / spd / cd / taken 是倍率；
   regen 是每秒回复生命上限的比例。同名效果取最强值并刷新时长。
   ============================================================ */
var FOOD_DEFS = {
  steak: {
    name: '烤牛肉', color: '#c96a3a', glow: '#ffb28a',
    text: '回复 9% 生命 · 攻击 +15% 8s', heal: 0.09, atk: 1.15, atkDur: 8
  },
  apple: {
    name: '金苹果', color: '#e7b941', glow: '#ffe08a',
    text: '回复 4% 生命 · 护盾 12% 生命上限', heal: 0.04, shield: 0.12
  },
  pie: {
    name: '南瓜派', color: '#d9852f', glow: '#ffc46b',
    text: '移速 +30% 8s', spd: 1.30, spdDur: 8
  },
  honey: {
    name: '蜂蜜瓶', color: '#d9a520', glow: '#ffe58a',
    text: '技能冷却 -35% 8s', cd: 0.65, cdDur: 8
  },
  cake: {
    name: '蛋糕', color: '#e8d7c6', glow: '#fff3e4',
    text: '护盾 18% 生命上限 · 回复 3% 生命', heal: 0.03, shield: 0.18
  },
  power: {
    name: '力量药水', color: '#c33b4a', glow: '#ff7c8e',
    text: '攻击 +30% 8s', atk: 1.30, atkDur: 8
  },
  swift: {
    name: '迅捷药水', color: '#3bb6c9', glow: '#8fe8f5',
    text: '移速 +45% 6s', spd: 1.45, spdDur: 6
  },
  resist: {
    name: '抗性药水', color: '#4a6fd0', glow: '#9cb6ff',
    text: '受到伤害 -25% 8s', taken: 0.75, takenDur: 8
  },
  regen: {
    name: '再生药水', color: '#4aa85f', glow: '#9be36f',
    text: '每秒回复 0.75% 生命 6s', regen: 0.0075, regenDur: 6
  },
  godapple: {
    name: '附魔金苹果', color: '#b58bff', glow: '#e1ccff',
    text: '回复 10% · 攻击 +15% · 受伤 -20% 10s',
    heal: 0.10, atk: 1.15, atkDur: 10, taken: 0.80, takenDur: 10
  }
};

// 抽卡池：普通食物权重更高，附魔金苹果只出现一次
var FOOD_DECK = [
  'steak', 'steak', 'apple', 'pie', 'pie', 'honey', 'cake',
  'power', 'swift', 'resist', 'regen', 'godapple'
];

/* ============================================================
   全场天气
   ------------------------------------------------------------
   dps    —— 每秒流失的最大生命比例（走 hurt 的百分比口径）
   slow   —— 全场移速倍率
   takenMul —— 全场承伤倍率
   strikeEvery / strikePct —— 定期随机落雷
   gale   —— 沿固定方向的持续推力（只改位置，不改 ang）
   ============================================================ */
var WEATHER_DEFS = {
  sandstorm: {
    name: '沙尘暴', color: '#d8b06a',
    text: '全场移速 -15%，每秒流失 0.5% 生命', slow: 0.85, dps: 0.005
  },
  thunder: {
    name: '雷暴', color: '#8fb4ff',
    text: '每 1.6 秒随机落雷', strikeEvery: 1.6, strikePct: 0.05
  },
  heat: {
    name: '酷暑', color: '#ff8a4a',
    text: '全场移速 -5%，每秒流失 0.8% 生命', slow: 0.95, dps: 0.008
  },
  cold: {
    name: '寒潮', color: '#9fdcff',
    text: '全场移速 -25%，每秒流失 0.35% 生命', slow: 0.75, dps: 0.0035
  },
  toxic: {
    name: '毒雾', color: '#8fdc6a',
    text: '全场移速 -10%，每秒流失 0.6% 生命', slow: 0.90, dps: 0.006
  },
  blood: {
    name: '血月', color: '#ff6a86',
    text: '全场受到伤害 +15%', takenMul: 1.15
  },
  gale: {
    name: '强风', color: '#b4d2ff',
    text: '全场被强风持续推动', gale: 95
  }
};
var WEATHER_KEYS = ['sandstorm', 'thunder', 'heat', 'cold', 'toxic', 'blood', 'gale'];

/* ============================================================
   局部恶劣区域
   ------------------------------------------------------------
   只影响区域内的单位；减速 / 引力对 bossImmune 无效，伤害照常。
   ============================================================ */
var HAZARD_DEFS = {
  lava: {
    name: '岩浆池', color: '#ff6b3a', r: [64, 88], life: [12, 16],
    slow: 0.80, dps: 0.012
  },
  poison: {
    name: '毒沼', color: '#7fbf4a', r: [80, 110], life: [12, 16],
    slow: 0.90, dps: 0.007
  },
  frost: {
    name: '霜冻区', color: '#8fd8ff', r: [80, 110], life: [12, 16],
    slow: 0.65
  },
  thunder: {
    name: '雷区', color: '#8aa8ff', r: [80, 110], life: [10, 14],
    strikeEvery: 1.5, strikePct: 0.06
  },
  mire: {
    name: '泥沼', color: '#9a7a4a', r: [76, 100], life: [10, 14],
    slow: 0.50, pull: 80
  },
  bramble: {
    name: '荆棘地', color: '#c96a8a', r: [70, 96], life: [10, 14],
    slow: 0.85, dps: 0.009
  }
};
var HAZARD_KEYS = ['lava', 'poison', 'frost', 'thunder', 'mire', 'bramble'];

/* ---------------- 运行时状态 ---------------- */
var foods = [];
var hazards = [];
var fieldBolts = [];          // 落雷视觉：{x,y,r,life,max,seed}
var fieldWeather = null;      // {key,def,life,max,dir,strikeT}
var fieldTimers = { food: 0, hazard: 0, weather: 0 };
var lastWeatherKey = '';

/* 新一局清空环境；随机计时全部走 srand，保证可复现 */
function resetField() {
  foods = [];
  hazards = [];
  fieldBolts = [];
  fieldWeather = null;
  lastWeatherKey = '';
  // 整个对象换新：赛事赔率模拟的 snapshot / restore 依赖「旧对象不被就地改写」
  fieldTimers = {
    food: srand(FIELD.foodFirst[0], FIELD.foodFirst[1]),
    hazard: srand(FIELD.hazardFirst[0], FIELD.hazardFirst[1]),
    weather: srand(FIELD.weatherFirst[0], FIELD.weatherFirst[1])
  };
}

/* 在场地内找一个不压住单位 / 其他环境物的点 */
function fieldSpot(r) {
  var A = ARENA, m = 44, i, k;
  for (k = 0; k < 24; k++) {
    var x = srand(A.x + m, A.x + A.w - m);
    var y = srand(A.y + m, A.y + A.h - m);
    var ok = true;
    for (i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.alive) continue;
      if (Math.hypot(u.x - x, u.y - y) < u.r + r + 34) { ok = false; break; }
    }
    if (ok) {
      for (i = 0; i < foods.length; i++) {
        if (Math.hypot(foods[i].x - x, foods[i].y - y) < foods[i].r + r + 58) { ok = false; break; }
      }
    }
    if (ok) {
      for (i = 0; i < hazards.length; i++) {
        if (Math.hypot(hazards[i].x - x, hazards[i].y - y) < hazards[i].r + r + 38) { ok = false; break; }
      }
    }
    if (ok) return { x: x, y: y };
  }
  return {
    x: srand(A.x + m, A.x + A.w - m),
    y: srand(A.y + m, A.y + A.h - m)
  };
}

function fieldSpawnFood() {
  var key = FOOD_DECK[Math.floor(srand(0, FOOD_DECK.length))];
  var F = FOOD_DEFS[key];
  var p = fieldSpot(15);
  foods.push({
    key: key, def: F, x: p.x, y: p.y, r: 15,
    life: FIELD.foodLife, max: FIELD.foodLife, phase: rand(0, TAU)   // 纯视觉，不消耗模拟随机流
  });
  ring(p.x, p.y, 4, 26, 0.4, F.glow);
}

function fieldSpawnHazard() {
  var key = HAZARD_KEYS[Math.floor(srand(0, HAZARD_KEYS.length))];
  var D = HAZARD_DEFS[key];
  var r = srand(D.r[0], D.r[1]);
  var p = fieldSpot(r);
  var life = srand(D.life[0], D.life[1]);
  hazards.push({
    key: key, def: D, x: p.x, y: p.y, r: r,
    life: life, max: life, phase: rand(0, TAU),
    strikeT: D.strikeEvery || 0
  });
  ring(p.x, p.y, r * 0.25, r, 0.55, D.color);
  floater(p.x, p.y - r - 10, '危险区域 · ' + D.name, D.color, 14);
}

function fieldStartWeather() {
  var key = WEATHER_KEYS[Math.floor(srand(0, WEATHER_KEYS.length))];
  // 避免连续两次同一个天气；只有两个以上可选时才强制换
  if (key === lastWeatherKey && WEATHER_KEYS.length > 1) {
    key = WEATHER_KEYS[(WEATHER_KEYS.indexOf(key) + 1 + Math.floor(srand(0, WEATHER_KEYS.length - 1))) % WEATHER_KEYS.length];
  }
  var D = WEATHER_DEFS[key];
  var life = srand(FIELD.weatherLife[0], FIELD.weatherLife[1]);
  fieldWeather = {
    key: key, def: D, life: life, max: life,
    dir: srand(0, TAU), strikeT: D.strikeEvery || 0
  };
  lastWeatherKey = key;
  var A = ARENA, cx = A.x + A.w / 2, cy = A.y + A.h / 2;
  ring(cx, cy, 30, Math.min(A.w, A.h) * 0.7, 0.9, D.color);
  floater(cx, cy - 24, '环境 · ' + D.name, D.color, 20);
  floater(cx, cy + 2, D.text, '#dfe7f5', 12);
}

/* 随机挑一个存活单位（雷暴 / 雷区选落点用） */
function fieldRandomAlive() {
  var pool = [];
  for (var i = 0; i < units.length; i++) if (units[i].alive) pool.push(units[i]);
  if (!pool.length) return null;
  return pool[Math.floor(srand(0, pool.length))];
}

/* 落雷：区域内所有单位吃百分比伤害；环境伤害不归属任何一方 */
function fieldStrike(x, y, r, pct) {
  fieldBolts.push({
    x: x, y: y, r: r, life: 0.35, max: 0.35,
    seed: rand(0, 1000)
  });
  ring(x, y, 6, r, 0.32, '#dbe8ff');
  burst(x, y, 10, '#dbe8ff', 260);
  shake = Math.max(shake, 3);
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) continue;
    if (Math.hypot(u.x - x, u.y - y) > r + u.r) continue;
    hurt(u, u.maxHp * pct, null, { pct: 1 });
  }
}

/* 环境减速：单独一条通道，避免覆盖技能减速的 slowMul */
function fieldEnvSlow(u, mul) {
  if (!(mul < 1)) return;
  u.field.envSlowT = Math.max(u.field.envSlowT, 0.16);
  u.field.envSlowMul = Math.min(u.field.envSlowMul || 1, mul);
}

/* 食物拾取：回复 / 护盾立即生效；攻击 / 移速 / 冷却 / 减伤 / 再生写入 u.field */
function fieldApplyFood(u, f) {
  var F = f.def;
  if (F.heal) {
    var heal = u.maxHp * F.heal;
    if (u.hp < u.maxHp) {
      var before = u.hp;
      u.hp = Math.min(u.maxHp, u.hp + heal);
      floater(u.x, u.y - u.r - 44, '+' + Math.round(u.hp - before), '#9be36f', 14);
    }
  }
  if (F.shield) {
    // 只抬高护盾值，不改 shieldT：青金石等临时护盾的到期规则仍由原机制管理
    u.st.shield = Math.max(u.st.shield || 0, u.maxHp * F.shield);
  }
  if (F.atk) {
    u.field.atkMul = Math.max(u.field.atkMul || 1, F.atk);
    u.field.atkT = Math.max(u.field.atkT || 0, F.atkDur);
  }
  if (F.spd) {
    u.field.spdMul = Math.max(u.field.spdMul || 1, F.spd);
    u.field.spdT = Math.max(u.field.spdT || 0, F.spdDur);
  }
  if (F.cd) {
    u.field.cdMul = Math.min(u.field.cdMul || 1, F.cd);
    u.field.cdT = Math.max(u.field.cdT || 0, F.cdDur);
  }
  if (F.taken) {
    u.field.takenMul = Math.min(u.field.takenMul || 1, F.taken);
    u.field.takenT = Math.max(u.field.takenT || 0, F.takenDur);
  }
  if (F.regen) {
    u.field.regen = Math.max(u.field.regen || 0, F.regen);
    u.field.regenT = Math.max(u.field.regenT || 0, F.regenDur);
  }
  u.field.label = F.name;
  u.field.labelT = 2.6;
  ring(u.x, u.y, u.r, u.r + 34, 0.4, F.glow);
  burst(u.x, u.y, 10, F.glow, 210);
  floater(u.x, u.y - u.r - 22, '食物 · ' + F.name, F.glow, 13);
  floater(u.x, u.y - u.r - 42, F.text, '#ffffff', 10);
  if (typeof sfxPlay === 'function') sfxPlay('cast');
}

/* 食物增益倒计时与再生 */
function fieldTickFood(u, dt) {
  var F = u.field;
  if (!F) return;
  if (F.atkT > 0) {
    F.atkT -= dt;
    if (F.atkT <= 0) { F.atkT = 0; F.atkMul = 1; }
  }
  if (F.spdT > 0) {
    F.spdT -= dt;
    if (F.spdT <= 0) { F.spdT = 0; F.spdMul = 1; }
  }
  if (F.cdT > 0) {
    F.cdT -= dt;
    if (F.cdT <= 0) { F.cdT = 0; F.cdMul = 1; }
  }
  if (F.takenT > 0) {
    F.takenT -= dt;
    if (F.takenT <= 0) { F.takenT = 0; F.takenMul = 1; }
  }
  if (F.regenT > 0) {
    F.regenT -= dt;
    if (u.hp < u.maxHp) {
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * F.regen * dt);
    }
    if (F.regenT <= 0) { F.regenT = 0; F.regen = 0; }
  }
  if (F.labelT > 0) F.labelT = Math.max(0, F.labelT - dt);
}

/* 全场天气：每个存活单位都吃同样的 debuff */
function fieldApplyWeather(dt) {
  var W = fieldWeather.def;
  var A = ARENA;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) continue;
    if (W.slow && !u.bossImmune) fieldEnvSlow(u, W.slow);
    if (W.dps) u.field.envDps += W.dps;
    if (W.takenMul) u.field.envTakenMul = Math.max(u.field.envTakenMul, W.takenMul);
    if (W.gale && !u.bossImmune) {
      u.x = clamp(u.x + Math.cos(fieldWeather.dir) * W.gale * dt, A.x + u.r, A.x + A.w - u.r);
      u.y = clamp(u.y + Math.sin(fieldWeather.dir) * W.gale * dt, A.y + u.r, A.y + A.h - u.r);
    }
  }
}

/* 局部区域：只对半径内的单位生效 */
function fieldApplyHazard(h, dt) {
  var D = h.def;
  var A = ARENA;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) continue;
    var dx = h.x - u.x, dy = h.y - u.y;
    if (Math.hypot(dx, dy) > h.r + u.r) continue;
    if (D.slow && !u.bossImmune) fieldEnvSlow(u, D.slow);
    if (D.dps) u.field.envDps += D.dps;
    if (D.pull && !u.bossImmune) {
      var d = Math.hypot(dx, dy) || 0.001;
      u.x = clamp(u.x + dx / d * D.pull * dt, A.x + u.r, A.x + A.w - u.r);
      u.y = clamp(u.y + dy / d * D.pull * dt, A.y + u.r, A.y + A.h - u.r);
    }
  }
}

/* 每帧入口：刷新计时、拾取、区域 / 天气效果、环境 DoT 结算 */
function updateField(dt) {
  var i, u;

  /* 1) 食物 */
  fieldTimers.food -= dt;
  if (fieldTimers.food <= 0) {
    if (foods.length < FIELD.foodMax) fieldSpawnFood();
    fieldTimers.food = srand(FIELD.foodGap[0], FIELD.foodGap[1]);
  }
  for (i = foods.length - 1; i >= 0; i--) {
    var f = foods[i];
    f.life -= dt;
    if (f.life <= 0) { foods.splice(i, 1); continue; }
    for (var j = 0; j < units.length; j++) {
      var eater = units[j];
      if (!eater.alive) continue;
      if (Math.hypot(eater.x - f.x, eater.y - f.y) > eater.r + f.r + 4) continue;
      fieldApplyFood(eater, f);
      foods.splice(i, 1);
      break;
    }
  }

  /* 2) 局部区域 */
  fieldTimers.hazard -= dt;
  if (fieldTimers.hazard <= 0) {
    if (hazards.length < FIELD.hazardMax) fieldSpawnHazard();
    fieldTimers.hazard = srand(FIELD.hazardGap[0], FIELD.hazardGap[1]);
  }
  for (i = hazards.length - 1; i >= 0; i--) {
    var h = hazards[i];
    h.life -= dt;
    if (h.life <= 0) { hazards.splice(i, 1); continue; }
    if (h.def.strikeEvery) {
      h.strikeT -= dt;
      if (h.strikeT <= 0) {
        h.strikeT += h.def.strikeEvery;
        fieldStrike(h.x, h.y, h.r, h.def.strikePct);
      }
    }
  }

  /* 3) 全场天气 */
  fieldTimers.weather -= dt;
  if (!fieldWeather && fieldTimers.weather <= 0) fieldStartWeather();
  if (fieldWeather) {
    fieldWeather.life -= dt;
    var W = fieldWeather.def;
    if (W.strikeEvery) {
      fieldWeather.strikeT -= dt;
      if (fieldWeather.strikeT <= 0) {
        fieldWeather.strikeT += W.strikeEvery;
        var tgt = fieldRandomAlive();
        if (tgt) {
          fieldStrike(
            tgt.x + srand(-42, 42),
            tgt.y + srand(-42, 42),
            FIELD.strikeRadius, W.strikePct);
        }
      }
    }
    if (fieldWeather.life <= 0) {
      var A = ARENA;
      floater(A.x + A.w / 2, A.y + A.h / 2 - 20, '天气转晴', '#dfe7f5', 16);
      fieldWeather = null;
      fieldTimers.weather = srand(FIELD.weatherGap[0], FIELD.weatherGap[1]);
    }
  }

  /* 4) 逐单位重置环境值 + 食物倒计时 */
  for (i = 0; i < units.length; i++) {
    u = units[i];
    if (!u.alive) continue;
    u.field.envDps = 0;
    u.field.envTakenMul = 1;
    if (u.field.envSlowT > 0) {
      u.field.envSlowT -= dt;
      if (u.field.envSlowT <= 0) {
        u.field.envSlowT = 0;
        u.field.envSlowMul = 1;
      }
    } else {
      u.field.envSlowMul = 1;
    }
    fieldTickFood(u, dt);
  }

  /* 5) 天气 / 局部区域（写入 envDps / 减速 / 推力） */
  if (fieldWeather) fieldApplyWeather(dt);
  for (i = 0; i < hazards.length; i++) fieldApplyHazard(hazards[i], dt);

  /* 6) 环境持续伤害：每秒合并结算一次，且有合计上限 */
  for (i = 0; i < units.length; i++) {
    u = units[i];
    if (!u.alive) continue;
    if (u.field.envDps > 0) {
      u.field.envAcc -= dt;
      var guard = 0;
      while (u.field.envAcc <= 0 && guard++ < 4 && u.alive) {
        u.field.envAcc += 1.0;
        hurt(u, u.maxHp * Math.min(FIELD.maxEnvDps, u.field.envDps), null, { pct: 1, dot: 1 });
      }
    } else {
      u.field.envAcc = 1.0;
    }
  }
}

/* ============================================================
   绘制：贴地层（天气底色 + 局部区域 + 食物）
   ------------------------------------------------------------
   全部画在单位之下；落雷由 drawFieldSky 画在单位之上。
   ============================================================ */
function drawFieldGround() {
  if (fieldWeather) drawFieldWeatherTint();
  for (var i = 0; i < hazards.length; i++) drawFieldHazard(hazards[i]);
  for (var k = 0; k < foods.length; k++) drawFieldFood(foods[k]);
}

function drawFieldWeatherTint() {
  var a = ARENA;
  var W = fieldWeather.def;
  var age = fieldWeather.max - fieldWeather.life;
  var fade = Math.min(1, age / 0.8, fieldWeather.life / 0.8);
  var i, g, x, y;

  ctx.save();
  ctx.beginPath();
  ctx.rect(a.x, a.y, a.w, a.h);
  ctx.clip();

  if (fieldWeather.key === 'sandstorm') {
    ctx.fillStyle = 'rgba(210,170,100,' + (0.055 * fade).toFixed(3) + ')';
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.strokeStyle = 'rgba(232,204,150,' + (0.16 * fade).toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i < 18; i++) {
      y = a.y + ((i * 41 + t * 240) % a.h);
      x = a.x + ((i * 137 + t * 420) % a.w);
      ctx.moveTo(x, y);
      ctx.lineTo(x + 46, y + 12);
    }
    ctx.stroke();
  } else if (fieldWeather.key === 'thunder') {
    ctx.fillStyle = 'rgba(48,72,128,' + (0.10 * fade).toFixed(3) + ')';
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.strokeStyle = 'rgba(150,185,255,' + (0.14 * fade).toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i < 22; i++) {
      x = a.x + ((i * 83 + t * 90) % a.w);
      y = a.y + ((i * 47 + t * 520) % a.h);
      ctx.moveTo(x, y);
      ctx.lineTo(x - 7, y + 22);
    }
    ctx.stroke();
  } else if (fieldWeather.key === 'heat') {
    g = ctx.createLinearGradient(0, a.y + a.h, 0, a.y);
    g.addColorStop(0, 'rgba(255,112,56,' + (0.13 * fade).toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(255,150,80,' + (0.045 * fade).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,180,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.strokeStyle = 'rgba(255,196,140,' + (0.12 * fade).toFixed(3) + ')';
    ctx.beginPath();
    for (i = 0; i < 12; i++) {
      x = a.x + (i + 0.5) / 12 * a.w;
      y = a.y + a.h - ((t * 70 + i * 43) % a.h);
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 7, y - 14, x, y - 28);
    }
    ctx.stroke();
  } else if (fieldWeather.key === 'cold') {
    ctx.fillStyle = 'rgba(120,190,235,' + (0.09 * fade).toFixed(3) + ')';
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.fillStyle = 'rgba(225,248,255,' + (0.42 * fade).toFixed(3) + ')';
    for (i = 0; i < 46; i++) {
      x = a.x + ((i * 89 + Math.sin(t * 0.7 + i) * 18) % a.w + a.w) % a.w;
      y = a.y + ((i * 61 + t * 48) % a.h);
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, TAU);
      ctx.fill();
    }
  } else if (fieldWeather.key === 'toxic') {
    ctx.fillStyle = 'rgba(96,180,80,' + (0.085 * fade).toFixed(3) + ')';
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.strokeStyle = 'rgba(170,240,130,' + (0.18 * fade).toFixed(3) + ')';
    for (i = 0; i < 16; i++) {
      x = a.x + ((i * 113 + Math.sin(t * 0.8 + i * 1.7) * 28) % a.w + a.w) % a.w;
      y = a.y + a.h - ((t * 30 + i * 67) % a.h);
      ctx.beginPath();
      ctx.arc(x, y, 2.2 + (i % 3), 0, TAU);
      ctx.stroke();
    }
  } else if (fieldWeather.key === 'blood') {
    g = ctx.createRadialGradient(a.x + a.w / 2, a.y + a.h / 2, Math.min(a.w, a.h) * 0.22,
      a.x + a.w / 2, a.y + a.h / 2, Math.max(a.w, a.h) * 0.62);
    g.addColorStop(0, 'rgba(150,20,40,0)');
    g.addColorStop(1, 'rgba(190,20,48,' + (0.22 * fade).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(a.x, a.y, a.w, a.h);
  } else if (fieldWeather.key === 'gale') {
    ctx.fillStyle = 'rgba(150,190,255,' + (0.055 * fade).toFixed(3) + ')';
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.strokeStyle = 'rgba(205,225,255,' + (0.20 * fade).toFixed(3) + ')';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (i = 0; i < 14; i++) {
      y = a.y + (i + 0.5) / 14 * a.h;
      x = a.x + ((t * 360 + i * 151) % (a.w + 120)) - 60;
      ctx.moveTo(x, y);
      ctx.lineTo(x + 54, y);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawFieldHazard(h) {
  var D = h.def;
  var age = h.max - h.life;
  var fade = Math.min(1, age / 0.5, h.life / 0.5);
  var x = h.x, y = h.y, r = h.r, i;

  ctx.save();
  ctx.globalAlpha = fade;

  var g = ctx.createRadialGradient(x, y, r * 0.08, x, y, r);
  g.addColorStop(0, rgba(D.color, 0.26));
  g.addColorStop(0.6, rgba(D.color, 0.13));
  g.addColorStop(1, rgba(D.color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = rgba(D.color, 0.65);
  ctx.lineWidth = 1.6;
  ctx.setLineDash([7, 7]);
  ctx.lineDashOffset = -t * 24;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  if (h.key === 'lava') {
    ctx.strokeStyle = rgba('#ffb27a', 0.6);
    ctx.lineWidth = 1.4;
    for (i = 0; i < 3; i++) {
      var rr = r * (0.28 + i * 0.24);
      ctx.beginPath();
      for (var k = 0; k <= 20; k++) {
        var a = k / 20 * TAU;
        var wob = 1 + Math.sin(a * 5 + t * 2.2 + i) * 0.09;
        var px = x + Math.cos(a) * rr * wob;
        var py = y + Math.sin(a) * rr * wob;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  } else if (h.key === 'poison') {
    ctx.strokeStyle = rgba('#b8f58a', 0.5);
    ctx.lineWidth = 1.3;
    for (i = 0; i < 9; i++) {
      var pa = i / 9 * TAU + h.phase + t * 0.18;
      var pr = r * (0.25 + (i % 3) * 0.22);
      var bx = x + Math.cos(pa) * pr;
      var by = y + Math.sin(pa) * pr + Math.sin(t * 1.6 + i) * 3;
      ctx.beginPath();
      ctx.arc(bx, by, 3 + (i % 3), 0, TAU);
      ctx.stroke();
    }
  } else if (h.key === 'frost') {
    ctx.strokeStyle = rgba('#d9f5ff', 0.55);
    ctx.lineWidth = 1.3;
    for (i = 0; i < 6; i++) {
      var fa = i / 6 * TAU + t * 0.08;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(fa) * r * 0.22, y + Math.sin(fa) * r * 0.22);
      ctx.lineTo(x + Math.cos(fa) * r * 0.82, y + Math.sin(fa) * r * 0.82);
      ctx.moveTo(x + Math.cos(fa + 2.4) * r * 0.45, y + Math.sin(fa + 2.4) * r * 0.45);
      ctx.lineTo(x + Math.cos(fa + 2.9) * r * 0.66, y + Math.sin(fa + 2.9) * r * 0.66);
      ctx.stroke();
    }
  } else if (h.key === 'thunder') {
    ctx.strokeStyle = rgba('#dbe8ff', 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.5, y - r * 0.5);
    ctx.lineTo(x - r * 0.12, y - r * 0.1);
    ctx.lineTo(x - r * 0.3, y + r * 0.12);
    ctx.lineTo(x + r * 0.28, y + r * 0.46);
    ctx.stroke();
  } else if (h.key === 'mire') {
    ctx.strokeStyle = rgba('#d8bd92', 0.5);
    ctx.lineWidth = 1.4;
    for (i = 0; i < 3; i++) {
      var sa = t * 0.5 + i * 1.9 + h.phase;
      ctx.beginPath();
      ctx.arc(x, y, r * (0.3 + i * 0.22), sa, sa + 1.8);
      ctx.stroke();
    }
  } else if (h.key === 'bramble') {
    ctx.strokeStyle = rgba('#ffc0d4', 0.55);
    ctx.lineWidth = 1.4;
    for (i = 0; i < 10; i++) {
      var ba = i / 10 * TAU + h.phase;
      var br = r * (0.55 + (i % 2) * 0.18);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ba) * br, y + Math.sin(ba) * br);
      ctx.lineTo(x + Math.cos(ba + 0.16) * (br + 11), y + Math.sin(ba + 0.16) * (br + 11));
      ctx.stroke();
    }
  }

  // 区域名：放在圆的下缘，避免挡住中间的单位
  ctx.font = '600 10.5px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  var tw = ctx.measureText(D.name).width;
  ctx.fillStyle = 'rgba(8,8,10,.58)';
  roundRect(x - tw / 2 - 7, y + r - 13, tw + 14, 16, 4);
  ctx.fill();
  ctx.fillStyle = D.color;
  ctx.fillText(D.name, x, y + r - 4.5);

  ctx.restore();
}

function drawFieldFood(f) {
  var F = f.def;
  var bob = Math.sin(t * 3 + f.phase) * 3;
  var x = f.x, y = f.y + bob;
  var left = f.life / f.max;

  ctx.save();

  // 地面投影
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(f.x, f.y + 13, 15, 6, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 方块本体
  ctx.fillStyle = F.color;
  roundRect(x - 13, y - 13, 26, 26, 7);
  ctx.fill();
  ctx.strokeStyle = rgba(F.glow, 0.95);
  ctx.lineWidth = 2;
  roundRect(x - 13, y - 13, 26, 26, 7);
  ctx.stroke();

  // 高光
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  roundRect(x - 8, y - 9, 16, 7, 3);
  ctx.fill();

  // 首字标识
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 13px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(F.name.charAt(0), x, y + 1.5);

  // 存活倒计时环
  ctx.strokeStyle = rgba(F.glow, 0.6);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(left, 0, 1));
  ctx.stroke();

  // 名称
  ctx.font = '600 10px "PingFang SC","Microsoft YaHei",sans-serif';
  var tw = ctx.measureText(F.name).width;
  ctx.fillStyle = 'rgba(8,8,10,.58)';
  roundRect(x - tw / 2 - 6, y + 20, tw + 12, 15, 4);
  ctx.fill();
  ctx.fillStyle = F.glow;
  ctx.fillText(F.name, x, y + 28);

  ctx.restore();
}

/* 落雷：画在单位之上，先闪一下再收掉 */
function drawFieldSky() {
  if (!fieldBolts.length) return;
  var i;
  for (i = 0; i < fieldBolts.length; i++) {
    var b = fieldBolts[i];
    var k = clamp(b.life / b.max, 0, 1);
    var top = ARENA.y;
    var x1 = b.x + Math.sin(b.seed) * 26;
    var x2 = b.x - Math.sin(b.seed * 1.7) * 18;

    ctx.save();
    ctx.globalAlpha = k;
    ctx.strokeStyle = 'rgba(225,240,255,.92)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x1, top);
    ctx.lineTo(x1 + 12, top + (b.y - top) * 0.34);
    ctx.lineTo(x2, top + (b.y - top) * 0.62);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(160,200,255,.55)';
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.fillStyle = 'rgba(235,245,255,' + (0.25 * k).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * (1.1 - 0.2 * k), 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/* 食物增益状态行：供 40-render 的 drawUnitStatus 读取 */
function fieldBuffRows(u) {
  var F = u.field, rows = [];
  if (!F) return rows;
  if (F.atkT > 0) rows.push(['攻', '食物 +' + Math.round((F.atkMul - 1) * 100) + '%', '#ffd166']);
  if (F.spdT > 0) rows.push(['速', '食物 +' + Math.round((F.spdMul - 1) * 100) + '%', '#8fe6ff']);
  if (F.takenT > 0) rows.push(['减', '受伤 -' + Math.round((1 - F.takenMul) * 100) + '%', '#9fd0ff']);
  if (F.cdT > 0) rows.push(['冷', '技能 -' + Math.round((1 - F.cdMul) * 100) + '%', '#ffe08a']);
  if (F.regenT > 0) rows.push(['愈', '再生 ' + (F.regen * 100).toFixed(2) + '%/s', '#9be36f']);
  return rows;
}

function fieldHasBuff(u) {
  var F = u && u.field;
  return !!(F && (F.atkT > 0 || F.spdT > 0 || F.takenT > 0 || F.cdT > 0 || F.regenT > 0));
}
