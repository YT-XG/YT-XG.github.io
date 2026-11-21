/* ============================================================
   40-render.js —— 全部 Canvas 绘制（只读状态，不改逻辑）
   场地 · 总伤害信息条 · 尾迹 · 各类物品外观 · 箭矢 · 冰面 · 炸弹
   单位合成（血条/护盾条/冷却环）· 粒子与飘字 · render()
   ============================================================ */
'use strict';

/* ============================================================
   渲染
   ============================================================ */
/* 离屏小贴图缓存
   ------------------------------------------------------------
   单位光晕 / 深色底盘 / 水面 每帧都要用，但它们的渐变只跟「半径 / 阵营」有关，
   跟位置无关。预渲染成小 canvas 后每帧只 drawImage，避免几十个
   createRadialGradient / createLinearGradient 反复分配。 */
var RENDER_SPRITE = {};

function makeSprite(key, size, paint) {
  var c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  paint(c.getContext('2d'), size);
  RENDER_SPRITE[key] = c;
  return c;
}

// 阵营光晕：固定 128×128，绘制时缩放到单位直径
function teamGlowSprite(team) {
  var key = 'glow.' + team;
  var s = RENDER_SPRITE[key];
  if (s) return s;
  return makeSprite(key, 128, function (g, S) {
    var rg = g.createRadialGradient(S / 2, S / 2, S * 0.17, S / 2, S / 2, S / 2);
    rg.addColorStop(0, team === 'A' ? 'rgba(232,72,63,.30)' : 'rgba(74,123,240,.32)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, TAU);
    g.fill();
  });
}

// 深色圆牌底盘：按半径缓存（2× 分辨率，避免缩放后发虚）
function tokenBaseSprite(r) {
  var key = 'base.' + r;
  var s = RENDER_SPRITE[key];
  if (s) return s;
  var S = Math.max(8, Math.ceil(r * 2 * 2));
  return makeSprite(key, S, function (g, size) {
    var k = size / 2;
    var bg = g.createLinearGradient(k, k - r * 2, k, k + r * 2);
    bg.addColorStop(0, '#1d2634');
    bg.addColorStop(1, '#0d1219');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(k, k, r * 2, 0, TAU);
    g.fill();
  });
}

// 水面：固定 256×256 径向渐变，绘制时按当前半径缩放并用 globalAlpha 淡出
function waterSprite() {
  if (RENDER_SPRITE.water) return RENDER_SPRITE.water;
  return makeSprite('water', 256, function (g, S) {
    var rg = g.createRadialGradient(S / 2, S / 2, S * 0.04, S / 2, S / 2, S / 2);
    rg.addColorStop(0, 'rgba(38,120,168,.30)');
    rg.addColorStop(0.55, 'rgba(86,178,222,.17)');
    rg.addColorStop(1, 'rgba(140,222,255,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, TAU);
    g.fill();
  });
}

function drawArena() {
  // 场外底色 + 两侧阵营余光（余光只留在场地外，避免和网格打架）
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, W, H);

  var a = ARENA;

  var out = ctx.createLinearGradient(0, 0, W, 0);
  out.addColorStop(0, 'rgba(255,75,58,.10)');
  out.addColorStop(.16, 'rgba(255,75,58,0)');
  out.addColorStop(.84, 'rgba(77,125,255,0)');
  out.addColorStop(1, 'rgba(77,125,255,.10)');
  ctx.fillStyle = out;
  ctx.fillRect(0, 0, W, H);

  // 场地底色：上亮下暗，让单位像站在一块有厚度的台面
  var bg = ctx.createLinearGradient(0, a.y, 0, a.y + a.h);
  bg.addColorStop(0, '#0d131c');
  bg.addColorStop(.45, '#0a0f17');
  bg.addColorStop(1, '#080c13');
  ctx.fillStyle = bg;
  ctx.fillRect(a.x, a.y, a.w, a.h);

  // 左右阵营环境光
  var lg = ctx.createLinearGradient(a.x, 0, a.x + a.w, 0);
  lg.addColorStop(0, 'rgba(255,75,58,.13)');
  lg.addColorStop(.26, 'rgba(255,75,58,.015)');
  lg.addColorStop(.5, 'rgba(0,0,0,0)');
  lg.addColorStop(.74, 'rgba(77,125,255,.02)');
  lg.addColorStop(1, 'rgba(77,125,255,.15)');
  ctx.fillStyle = lg;
  ctx.fillRect(a.x, a.y, a.w, a.h);

  // 中心顶光
  var cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  var rg = ctx.createRadialGradient(cx, a.y + a.h * .42, 20, cx, a.y + a.h * .42, Math.max(a.w, a.h) * .55);
  rg.addColorStop(0, 'rgba(120,160,235,.075)');
  rg.addColorStop(1, 'rgba(120,160,235,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(a.x, a.y, a.w, a.h);

  // 网格：细格 32 / 大格 96，裁剪在场地内
  ctx.save();
  ctx.beginPath();
  ctx.rect(a.x, a.y, a.w, a.h);
  ctx.clip();

  var gx, gy, px, py;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(126,158,206,.05)';
  ctx.beginPath();
  for (gx = a.x; gx <= a.x + a.w + 1; gx += 32) {
    px = Math.round(gx) + 0.5;
    ctx.moveTo(px, a.y);
    ctx.lineTo(px, a.y + a.h);
  }
  for (gy = a.y; gy <= a.y + a.h + 1; gy += 32) {
    py = Math.round(gy) + 0.5;
    ctx.moveTo(a.x, py);
    ctx.lineTo(a.x + a.w, py);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(140,175,225,.085)';
  ctx.beginPath();
  for (gx = a.x; gx <= a.x + a.w + 1; gx += 96) {
    px = Math.round(gx) + 0.5;
    ctx.moveTo(px, a.y);
    ctx.lineTo(px, a.y + a.h);
  }
  for (gy = a.y; gy <= a.y + a.h + 1; gy += 96) {
    py = Math.round(gy) + 0.5;
    ctx.moveTo(a.x, py);
    ctx.lineTo(a.x + a.w, py);
  }
  ctx.stroke();

  // 中央刻度盘：低调的“竞技场”标识
  var cr = Math.min(a.w, a.h) * .17;
  ctx.strokeStyle = 'rgba(150,180,230,.09)';
  ctx.beginPath();
  ctx.arc(cx, cy, cr, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.arc(cx, cy, cr * .55, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  for (var tk = 0; tk < 12; tk++) {
    var tka = tk * TAU / 12;
    var r1 = cr * 1.06, r2 = cr * 1.14;
    ctx.strokeStyle = tk % 3 === 0 ? 'rgba(255,255,255,.12)' : 'rgba(150,180,230,.06)';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(tka) * r1, cy + Math.sin(tka) * r1);
    ctx.lineTo(cx + Math.cos(tka) * r2, cy + Math.sin(tka) * r2);
    ctx.stroke();
  }
  ctx.restore();

  // 中线：稀疏虚线，断开处正好让中央刻度盘呼吸
  ctx.save();
  ctx.setLineDash([6, 14]);
  ctx.strokeStyle = 'rgba(160,185,225,.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(cx) + 0.5, a.y + 14);
  ctx.lineTo(Math.round(cx) + 0.5, a.y + a.h - 14);
  ctx.stroke();
  ctx.restore();

  // 暗角（画在角标与边框之前，避免把边缘压没）
  var vg = ctx.createRadialGradient(cx, cy, Math.min(a.w, a.h) * .35, cx, cy, Math.max(a.w, a.h) * .72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.30)');
  ctx.fillStyle = vg;
  ctx.fillRect(a.x, a.y, a.w, a.h);

  // 四角 L 形角标
  var cl = 16;
  var corners = [[a.x, a.y, 1, 1], [a.x + a.w, a.y, -1, 1], [a.x, a.y + a.h, 1, -1], [a.x + a.w, a.y + a.h, -1, -1]];
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 1.5;
  for (var ci = 0; ci < 4; ci++) {
    var c = corners[ci];
    ctx.beginPath();
    ctx.moveTo(c[0] + c[2] * 2, c[1] + c[3] * cl);
    ctx.lineTo(c[0] + c[2] * 2, c[1] + c[3] * 2);
    ctx.lineTo(c[0] + c[2] * cl, c[1] + c[3] * 2);
    ctx.stroke();
  }

  // 外框：左红右蓝，中间过渡
  var eg = ctx.createLinearGradient(a.x, 0, a.x + a.w, 0);
  eg.addColorStop(0, 'rgba(255,90,70,.5)');
  eg.addColorStop(.3, 'rgba(150,175,215,.22)');
  eg.addColorStop(.7, 'rgba(150,175,215,.22)');
  eg.addColorStop(1, 'rgba(90,140,255,.55)');
  ctx.strokeStyle = eg;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1);

  ctx.strokeStyle = 'rgba(120,160,235,.06)';
  ctx.lineWidth = 7;
  ctx.strokeRect(a.x - 3.5, a.y - 3.5, a.w + 7, a.h + 7);
}

/* ============================================================
   两侧「总伤害」信息条
   ------------------------------------------------------------
   场地收窄后左右各留出 136px，这里在留白中央画一块窄卡片：
   · 数字 = 该方已造成伤害总和，每帧从 dealtOf() 实时读取
   · 血条 = 该方伤害占「双方合计伤害」的比例，两条共用同一分母，
            左侧条与右侧条的长度之和恒为满格
   ============================================================ */
/* 左右两侧的信息条：按「组内排行」显示每个单位的伤害占比与承伤占比
   ------------------------------------------------------------
   · 每方一张卡，卡片固定在画布边缘（不随场地收缩移动）
   · 卡片内按「造成的伤害」降序排名；每行两条细条：
       上条 = 伤害占比（阵营色）、下条 = 承伤占比（琥珀色）
   · 已阵亡的单位仍然列出（灰掉名字），方便看谁贡献多少
   ============================================================ */
/* 左右两侧的信息条：按「组内排行」显示每个角色的伤害占比与承伤占比
   ------------------------------------------------------------
   · 每方一张卡，卡片固定在画布边缘（不随场地收缩移动）
   · 同名的单位（例如草复活后重新生成的单位）会合并成一行
   · 按「造成的伤害」降序排名；每行两条细条：
       上条 = 伤害占比（阵营色）、下条 = 承伤占比（琥珀色）
   · 已阵亡的角色仍然列出（名字压暗），方便看谁贡献多少
   ============================================================ */
/* 左右两侧的信息条：按「组内排行」显示每个角色的伤害占比与承伤占比
   ------------------------------------------------------------
   · 每方一张卡，卡片固定在画布边缘（不随场地收缩移动）
   · 同名的单位（例如草复活后重新生成的单位）会合并成一行
   · 按「造成的伤害」降序排名；每行两条细条：
       上条 = 伤害占比（阵营色）、下条 = 承伤占比（琥珀色）
   · 已阵亡的角色仍然列出（名字压暗），方便看谁贡献多少
   ============================================================ */
function drawDamagePanels() {
  var PW = 118;                 // 卡片宽度
  var innerW = PW - 16;         // 内容宽度（左右各 8 内边距）
  var barW = 66;                // 细条长度，右侧留出百分比的位置
  var rowH = 34;
  var headH = 38;
  var cy = ARENA.y + ARENA.h / 2;

  var teams = [
    { team: 'A', color: '#e8483f', light: '#ffb4aa' },
    { team: 'B', color: '#4a7bf0', light: '#b9cdff' }
  ];

  ctx.textBaseline = 'middle';

  for (var s = 0; s < teams.length; s++) {
    var side = teams[s];

    // 1) 按名字合并该方全部单位（含已阵亡的；草复活会生成新单位，这里合回一行）
    var rows = [], byName = {};
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.team !== side.team) continue;
      var r = byName[u.name];
      if (!r) {
        r = byName[u.name] = { name: u.name, dealt: 0, taken: 0, alive: false };
        rows.push(r);
      }
      r.dealt += u.dealt || 0;
      r.taken += u.taken || 0;
      if (u.alive) r.alive = true;
    }
    if (!rows.length) continue;

    var sumD = 0, sumT = 0;
    for (var m = 0; m < rows.length; m++) { sumD += rows[m].dealt; sumT += rows[m].taken; }

    // 2) 排名：伤害降序，其次承伤降序
    rows.sort(function (a, b) {
      if (b.dealt !== a.dealt) return b.dealt - a.dealt;
      return b.taken - a.taken;
    });

    var ph = headH + rows.length * rowH + 8;
    // 信息条贴着当前场地左右边缘，场地随人数缩小时不会漂到很远
    var x = side.team === 'A'
      ? Math.max(8, ARENA.x - PW - 8)
      : Math.min(W - 8 - PW, ARENA.x + ARENA.w + 8);
    var y = cy - ph / 2;

    // 3) 卡片底
    ctx.fillStyle = 'rgba(7,10,15,.9)';
    roundRect(x, y, PW, ph, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 顶边色条：让左右两张卡一眼能分清阵营
    ctx.fillStyle = rgba(side.color, 0.8);
    ctx.fillRect(x + 1, y + 1, PW - 2, 2);

    // 靠场地一侧的竖线，强调这是战斗区之外的信息条
    ctx.fillStyle = rgba(side.color, 0.5);
    ctx.fillRect(side.team === 'A' ? x + PW - 3 : x, y + 12, 3, ph - 24);

    // 4) 标题
    ctx.textAlign = 'center';
    ctx.fillStyle = side.light;
    ctx.font = '600 13px "PingFang SC","Microsoft YaHei",sans-serif';
    var title = teamNames[side.team]
      ? (side.team === 'A' ? '红 ' : '蓝 ') + teamNames[side.team]
      : SIDE_LABEL[side.team];
    ctx.fillText(title, x + PW / 2, y + 16);

    ctx.fillStyle = '#6d7a90';
    ctx.font = '9.5px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('总伤 ' + Math.round(sumD) + ' · 承伤 ' + Math.round(sumT), x + PW / 2, y + 30);

    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 35);
    ctx.lineTo(x + PW - 10, y + 35);
    ctx.stroke();

    // 5) 排行行：名字与百分比分两轮画，避免每一行都切换一次 ctx.font
    var bx = x + 8;
    ctx.textAlign = 'left';
    ctx.font = '10.5px "PingFang SC","Microsoft YaHei",sans-serif';
    for (var k = 0; k < rows.length; k++) {
      var it = rows[k];
      var ry = y + headH + k * rowH;
      ctx.fillStyle = it.alive ? '#dfe7f4' : '#5d6879';
      ctx.fillText((k + 1) + ' ' + it.name, bx, ry + 6);
    }

    ctx.textAlign = 'right';
    ctx.font = '9.5px "Chakra Petch",ui-monospace,Consolas,monospace';
    for (var k2 = 0; k2 < rows.length; k2++) {
      var it2 = rows[k2];
      var ry2 = y + headH + k2 * rowH;
      var dPct = sumD > 0 ? it2.dealt / sumD : 0;
      var tPct = sumT > 0 ? it2.taken / sumT : 0;

      // 伤害占比条（阵营色）
      ctx.fillStyle = '#151c28';
      roundRect(bx, ry2 + 13, barW, 6, 1.5);
      ctx.fill();
      if (dPct > 0) {
        // 细条只有 6px 高，渐变看不出差别；用纯色避免每帧创建几十个渐变对象
        ctx.fillStyle = side.color;
        roundRect(bx, ry2 + 13, Math.max(2, barW * dPct), 6, 1.5);
        ctx.fill();
      }
      ctx.fillStyle = side.light;
      ctx.fillText(Math.round(dPct * 100) + '%', bx + innerW, ry2 + 16);

      // 承伤占比条（琥珀色）
      ctx.fillStyle = '#151c28';
      roundRect(bx, ry2 + 22, barW, 6, 1.5);
      ctx.fill();
      if (tPct > 0) {
        ctx.fillStyle = '#c98a45';
        roundRect(bx, ry2 + 22, Math.max(2, barW * tPct), 6, 1.5);
        ctx.fill();
      }
      ctx.fillStyle = '#e0a75a';
      ctx.fillText(Math.round(tPct * 100) + '%', bx + innerW, ry2 + 25);
    }
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}


function drawTrail(u) {
  if (!u.alive) return;

  if (u.dashT > 0) {
    var n = u.trail.length;
    for (var i = 0; i < n; i += 1) {
      var p = u.trail[i];
      var k = 1 - i / n;
      ctx.globalAlpha = k * k * 0.3;
      ctx.fillStyle = u.glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, u.r * k * 0.9, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }

  // 直线滑行时的速度尾迹
  var sp = speedOf(u);
  var len = Math.min(88, sp * 0.36);
  var tx = u.x - Math.cos(u.ang) * (u.r + len);
  var ty = u.y - Math.sin(u.ang) * (u.r + len);
  var lg = ctx.createLinearGradient(u.x, u.y, tx, ty);
  lg.addColorStop(0, rgba(u.glow, 0.42));
  lg.addColorStop(0.55, rgba(u.glow, 0.14));
  lg.addColorStop(1, rgba(u.glow, 0));
  ctx.strokeStyle = lg;
  ctx.lineWidth = u.r * 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(u.x, u.y);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawBlock(u) {
  var r = u.r, x = u.x, y = u.y;

  var gl = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.3);
  gl.addColorStop(0, rgba(u.glow, 0.28));
  gl.addColorStop(1, rgba(u.glow, 0));
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.3, 0, TAU);
  ctx.fill();

  var body = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  body.addColorStop(0, u.light);
  body.addColorStop(0.45, u.body);
  body.addColorStop(1, u.dark);
  roundRect(x - r, y - r, r * 2, r * 2, r * 0.24);
  ctx.fillStyle = body;
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba('#000000', 0.35);
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = rgba('#000000', 0.55);
  for (var i = 0; i < 5; i++) {
    var ang = u.seed + i * 2.399;
    var rad = (i % 3) * r * 0.28;
    var sx = x + Math.cos(ang) * rad;
    var sy = y + Math.sin(ang) * rad;
    ctx.fillRect(sx - 2.5, sy - 2.5, 5, 5);
  }
  ctx.restore();

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#ffffff';
  roundRect(x - r * 0.72, y - r * 0.72, r * 0.72, r * 0.34, r * 0.1);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// 冰块外观：半透明蓝色方块 + 冰晶切面高光
function drawIce(u) {
  var r = u.r, x = u.x, y = u.y;

  var gl = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.4);
  gl.addColorStop(0, rgba(u.glow, 0.34));
  gl.addColorStop(1, rgba(u.glow, 0));
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, TAU);
  ctx.fill();

  var body = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  body.addColorStop(0, u.light);
  body.addColorStop(0.45, u.body);
  body.addColorStop(1, u.dark);
  roundRect(x - r, y - r, r * 2, r * 2, r * 0.2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba('#ffffff', 0.42);   // 冰棱高光边
  ctx.stroke();

  // 两块切面高光，与红石/青金石的方块外观区分
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.62, y - r * 0.30);
  ctx.lineTo(x - r * 0.12, y - r * 0.72);
  ctx.lineTo(x - r * 0.20, y - r * 0.10);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + r * 0.60, y + r * 0.10);
  ctx.lineTo(x + r * 0.72, y + r * 0.62);
  ctx.lineTo(x + r * 0.22, y + r * 0.46);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* 水桶外观：方块剪影底座 + 木桶（梯形桶身 / 桶箍 / 桶口水面 / 提手） */
function drawBucket(u) {
  var r = u.r, x = u.x, y = u.y;

  var gl = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.4);
  gl.addColorStop(0, rgba(u.glow, 0.32));
  gl.addColorStop(1, rgba(u.glow, 0));
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, TAU);
  ctx.fill();

  // 方块底座（与其它物品保持一致的方块剪影）
  var body = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  body.addColorStop(0, u.light);
  body.addColorStop(0.45, u.body);
  body.addColorStop(1, u.dark);
  roundRect(x - r, y - r, r * 2, r * 2, r * 0.24);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.stroke();

  // 木桶：上宽下窄的梯形桶身
  var topY = y - r * 0.56, botY = y + r * 0.66;
  var topW = r * 0.84, botW = r * 0.64;
  var wood = ctx.createLinearGradient(x - topW, 0, x + topW, 0);
  wood.addColorStop(0, '#2b657e');
  wood.addColorStop(0.42, '#4d95b4');
  wood.addColorStop(1, '#173f53');
  ctx.beginPath();
  ctx.moveTo(x - topW, topY);
  ctx.lineTo(x + topW, topY);
  ctx.lineTo(x + botW, botY);
  ctx.lineTo(x - botW, botY);
  ctx.closePath();
  ctx.fillStyle = wood;
  ctx.fill();
  ctx.strokeStyle = 'rgba(8,26,36,.7)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 桶箍（两道浅钢色横带）
  ctx.strokeStyle = '#a9c6d6';
  ctx.lineWidth = 2.2;
  var by1 = topY + r * 0.34, by2 = topY + r * 0.78;
  var bw1 = topW - (topW - botW) * (r * 0.34) / (botY - topY);
  var bw2 = topW - (topW - botW) * (r * 0.78) / (botY - topY);
  ctx.beginPath();
  ctx.moveTo(x - bw1, by1); ctx.lineTo(x + bw1, by1);
  ctx.moveTo(x - bw2, by2); ctx.lineTo(x + bw2, by2);
  ctx.stroke();

  // 桶口：深色内壁 + 晃动的水面
  ctx.beginPath();
  ctx.ellipse(x, topY, topW, r * 0.24, 0, 0, TAU);
  ctx.fillStyle = '#0f3244';
  ctx.fill();
  ctx.strokeStyle = 'rgba(190,235,255,.55)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(x, topY + Math.sin(t * 3 + u.seed) * 1.2, topW * 0.84, r * 0.18, 0, 0, TAU);
  ctx.fillStyle = 'rgba(127,216,255,.85)';
  ctx.fill();
  ctx.fillStyle = 'rgba(230,252,255,.5)';
  ctx.beginPath();
  ctx.ellipse(x - topW * 0.22, topY - r * 0.03, topW * 0.24, r * 0.06, 0, 0, TAU);
  ctx.fill();

  // 提手
  ctx.strokeStyle = 'rgba(196,222,236,.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, topY, topW * 1.02, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
}

function drawSpear(u) {
  var r = u.r;

  var gl = ctx.createRadialGradient(u.x, u.y, r * 0.3, u.x, u.y, r * 2.6);
  gl.addColorStop(0, rgba(u.glow, 0.24));
  gl.addColorStop(1, rgba(u.glow, 0));
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(u.x, u.y, r * 2.6, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(u.x, u.y);
  ctx.rotate(u.ang);

  var shaftLen = 96;
  var shaftH = 6;

  var wood = ctx.createLinearGradient(0, -shaftH, 0, shaftH);
  wood.addColorStop(0, '#9b7b56');
  wood.addColorStop(0.5, '#6d5439');
  wood.addColorStop(1, '#4a3827');
  roundRect(-shaftLen * 0.62, -shaftH / 2, shaftLen * 1.24, shaftH, shaftH / 2);
  ctx.fillStyle = wood;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(shaftLen * 0.74, 0);
  ctx.lineTo(shaftLen * 0.34, -13);
  ctx.lineTo(shaftLen * 0.45, 0);
  ctx.lineTo(shaftLen * 0.34, 13);
  ctx.closePath();
  var metal = ctx.createLinearGradient(shaftLen * 0.34, 0, shaftLen * 0.76, 0);
  metal.addColorStop(0, '#8b97a9');
  metal.addColorStop(1, '#f6faff');
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  roundRect(-shaftLen * 0.66, -8, 10, 16, 4);
  ctx.fillStyle = '#8d99ab';
  ctx.fill();

  roundRect(-14, -shaftH, 26, shaftH * 2, 4);
  ctx.fillStyle = '#2c3546';
  ctx.fill();

  ctx.restore();
}

function drawBow(u) {
  var r = u.r, x = u.x, y = u.y;

  var gl = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.3);
  gl.addColorStop(0, rgba(u.glow, 0.28));
  gl.addColorStop(1, rgba(u.glow, 0));
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.3, 0, TAU);
  ctx.fill();

  var body = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  body.addColorStop(0, u.light);
  body.addColorStop(0.45, u.body);
  body.addColorStop(1, u.dark);
  roundRect(x - r, y - r, r * 2, r * 2, r * 0.3);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba('#000000', 0.35);
  ctx.stroke();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(u.faceAng === undefined ? u.ang : u.faceAng);

  // 弓臂朝瞄准方向（仅绘制；移动方向不变）
  ctx.strokeStyle = '#d09a5c';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(r * 0.55, 0, r * 0.95, -1.15, 1.15);
  ctx.stroke();

  var ex = r * 0.55 + Math.cos(1.15) * r * 0.95;
  var ey = Math.sin(1.15) * r * 0.95;
  ctx.strokeStyle = 'rgba(240,245,230,.75)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(ex, -ey);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  // 搭在弦上的箭
  ctx.strokeStyle = '#eef8dc';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(r * 0.2, 0);
  ctx.lineTo(r * 1.35, 0);
  ctx.stroke();
  ctx.fillStyle = '#d9f2b8';
  ctx.beginPath();
  ctx.moveTo(r * 1.55, 0);
  ctx.lineTo(r * 1.15, -3.4);
  ctx.lineTo(r * 1.15, 3.4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
  ctx.lineCap = 'butt';
}

function drawArrows() {
  for (var i = 0; i < arrows.length; i++) {
    var a = arrows[i];
    var len = a.power ? 28 : 22;

    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.ang);

    if (a.power) {
      var g = ctx.createRadialGradient(0, 0, 1, 0, 0, 20);
      g.addColorStop(0, 'rgba(255,209,102,.45)');
      g.addColorStop(1, 'rgba(255,209,102,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, TAU);
      ctx.fill();
    }

    // 尾迹
    ctx.strokeStyle = a.power ? 'rgba(255,209,102,.55)' : 'rgba(185,232,138,.45)';
    ctx.lineWidth = a.power ? 2.4 : 1.6;
    ctx.beginPath();
    ctx.moveTo(-len * 1.8, 0);
    ctx.lineTo(-len * 0.45, 0);
    ctx.stroke();

    // 箭杆
    ctx.strokeStyle = a.power ? '#ffe9a8' : '#e4f5c9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-len * 0.5, 0);
    ctx.lineTo(len * 0.42, 0);
    ctx.stroke();

    // 箭头
    ctx.fillStyle = a.power ? '#ffd166' : '#d9f2b8';
    ctx.beginPath();
    ctx.moveTo(len * 0.72, 0);
    ctx.lineTo(len * 0.24, -4);
    ctx.lineTo(len * 0.24, 4);
    ctx.closePath();
    ctx.fill();

    // 尾羽
    ctx.strokeStyle = a.power ? '#ffb14d' : '#8fc45e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-len * 0.5, 0);
    ctx.lineTo(-len * 0.7, -3.5);
    ctx.moveTo(-len * 0.5, 0);
    ctx.lineTo(-len * 0.7, 3.5);
    ctx.stroke();

    ctx.restore();
  }
}

// 冰面残留：贴地椭圆；前 5 秒完全可见，最后 1 秒线性淡出
function drawIcePatches() {
  var fade = TYPES.ice.iceTrail.fade;
  // 冰面贴着墙生成时会画到战斗区外，盖住两侧伤害条；统一裁到场地内
  ctx.save();
  ctx.beginPath();
  ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
  ctx.clip();
  // 大量冰面时降级：只画"空心冰盘"，省掉裂纹（绘制量降到 1/4）
  var heavy = icePatches.length > 48;
  for (var i = 0; i < icePatches.length; i++) {
    var p = icePatches[i];
    var a = clamp(p.life / fade, 0, 1);
    var rx = p.r * 0.88, ry = p.r * 0.62;

    // 冰面彼此大幅重叠（r56、间距 24），实心填充叠几层就是一条不透明白管子，
    // 把网格和单位都糊掉。改成极淡的蓝色冰带：只有刚踩出来的几片有亮边，
    // 老冰面只剩一层薄色，重叠处像水面反光而不是一坨白。
    ctx.globalAlpha = 0.13 * a;
    ctx.fillStyle = '#8fdcf8';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
    ctx.fill();

    var fresh = p.life > fade - 0.7;   // 刚留下的一片才描亮边
    if (fresh) {
      ctx.globalAlpha = (0.30 * a) * ((p.life - (fade - 0.7)) / 0.7);
      ctx.strokeStyle = '#e6fbff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
      ctx.stroke();
    }
    if (heavy) continue;

    // 两道冰裂纹，让残留看起来像"冰面"而不是普通圆点
    ctx.globalAlpha = 0.16 * a;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(p.x - p.r * 0.5, p.y);
    ctx.lineTo(p.x + p.r * 0.3, p.y - p.r * 0.12);
    ctx.moveTo(p.x - p.r * 0.08, p.y + p.r * 0.22);
    ctx.lineTo(p.x + p.r * 0.45, p.y + p.r * 0.03);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* 水桶的水面：贴地椭圆（水体 + 扩散波纹 + 中心漩涡）
   ------------------------------------------------------------
   · grow 秒内从圆心扩散到最大半径；hold 之后用 fade 秒线性淡出
   · 只做表现，引力与浸水伤害由 js/30-sim.js 的 updateWaters() 结算 */
function drawWaters() {
  var C = TYPES.bucket.water;
  // 裁剪到场地内：水面半径 220，贴墙施放时会超出战斗区，不能盖住两侧的伤害信息条
  ctx.save();
  ctx.beginPath();
  ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
  ctx.clip();
  for (var i = 0; i < waters.length; i++) {
    var w = waters[i];
    var rr = waterRadius(w);
    if (rr < 2) continue;
    var fadeK = w.age <= C.hold ? 1 : clamp(1 - (w.age - C.hold) / C.fade, 0, 1);

    // 水体：中心略深、边缘透明（离屏贴图，按当前半径缩放 + 整体淡出）
    ctx.globalAlpha = fadeK;
    ctx.drawImage(waterSprite(), w.x - rr, w.y - rr * 0.82, rr * 2, rr * 1.64);
    ctx.globalAlpha = 1;

    // 扩散波纹：3 圈错相位，持续从圆心向外推（"水从中间往四周散开"）
    for (var k = 0; k < 3; k++) {
      var ph = (t * 0.42 + k / 3 + w.phase / TAU) % 1;
      var rad = rr * (0.16 + 0.84 * ph);
      ctx.globalAlpha = (1 - ph) * 0.5 * fadeK;
      ctx.strokeStyle = '#d9f5ff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(w.x, w.y, rad, rad * 0.82, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 外圈边界
    ctx.strokeStyle = 'rgba(168,234,255,' + (0.5 * fadeK).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w.x, w.y, rr, rr * 0.82, 0, 0, TAU);
    ctx.stroke();

    // 中心漩涡：三段弧缓慢旋转，提示这里有引力
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.strokeStyle = 'rgba(226,250,255,' + (0.38 * fadeK).toFixed(3) + ')';
    ctx.lineWidth = 2;
    var spin = t * 1.1 + w.phase;
    for (var s = 0; s < 3; s++) {
      var a0 = spin + s * TAU / 3;
      ctx.beginPath();
      ctx.arc(0, 0, rr * (0.2 + s * 0.12), a0, a0 + 1.0);
      ctx.stroke();
    }
    ctx.restore();

    // 圆心高光
    ctx.globalAlpha = 0.35 * fadeK;
    ctx.fillStyle = '#eafcff';
    ctx.beginPath();
    ctx.arc(w.x, w.y, Math.max(2, rr * 0.06), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* 铁砧的落点预警圆：贴地层（在单位之下）
   ------------------------------------------------------------
   · 外圈虚线 = 判定边界（核心区再画一圈细实线）
   · 剩余时间用一圈顺时针扇形表示；最后 0.6 秒转红并加亮
   ============================================================ */
function drawAnvilMarks() {
  for (var i = 0; i < anvilMarks.length; i++) {
    var m = anvilMarks[i];
    var k = 1 - m.t / m.max;                 // 0 → 1 预警进度
    var urgent = m.t < 0.6;
    var tint = urgent ? '#ff8f7a' : (m.team === 'A' ? '#ffb4aa' : '#b9cdff');

    // 地面底色：脉动填充，越接近落地越明显
    var g = ctx.createRadialGradient(m.x, m.y, m.r * 0.2, m.x, m.y, m.r);
    g.addColorStop(0, rgba(tint, 0.16 + 0.10 * k));
    g.addColorStop(1, rgba(tint, 0.02));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, TAU);
    ctx.fill();

    // 外圈虚线（判定边界）
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -t * 46;
    ctx.strokeStyle = rgba(tint, 0.55 + 0.25 * k);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // 核心区细圈（全额伤害范围）
    ctx.strokeStyle = rgba(tint, 0.30);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r * TYPES.anvil.anvil.coreRatio, 0, TAU);
    ctx.stroke();

    // 剩余时间扇形：从 12 点顺时针收缩
    ctx.strokeStyle = rgba(tint, 0.85);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r - 2, -Math.PI / 2, -Math.PI / 2 + TAU * (m.t / m.max));
    ctx.stroke();

    // 十字准星
    ctx.strokeStyle = rgba(tint, 0.5);
    ctx.lineWidth = 1.5;
    var cr = m.r * 0.34;
    ctx.beginPath();
    ctx.moveTo(m.x - cr, m.y); ctx.lineTo(m.x + cr, m.y);
    ctx.moveTo(m.x, m.y - cr); ctx.lineTo(m.x, m.y + cr);
    ctx.stroke();
  }
}

/* 落下的铁砧：只在最后 0.55 秒出现，画在单位之上
   ------------------------------------------------------------
   从上往下压近，同时地面阴影变大；落地瞬间由 updateAnvilMarks 生成冲击特效 */
function drawAnvilDrops() {
  for (var i = 0; i < anvilMarks.length; i++) {
    var m = anvilMarks[i];
    if (m.t > 0.55) continue;
    var p = m.t / 0.55;                      // 1 → 0（越接近 0 越低）
    var dropY = m.y - 22 - p * 240;
    var sc = 1 + p * 0.2;

    // 地面阴影
    ctx.globalAlpha = 0.22 + 0.2 * (1 - p);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(m.x, m.y + 6, 34 * (1.4 - p * 0.4), 12 * (1.4 - p * 0.4), 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 下坠速度线
    ctx.globalAlpha = 0.5 * (1 - p);
    ctx.strokeStyle = '#dfe8f4';
    ctx.lineWidth = 2;
    for (var s = -1; s <= 1; s++) {
      ctx.beginPath();
      ctx.moveTo(m.x + s * 14, dropY - 26);
      ctx.lineTo(m.x + s * 14, dropY - 66 - p * 40);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 铁砧本体（简化的三段剪影）
    ctx.save();
    ctx.translate(m.x, dropY);
    ctx.scale(sc, sc);
    ctx.fillStyle = '#e6edf8';
    ctx.strokeStyle = 'rgba(20,26,36,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-38, -30); ctx.lineTo(38, -30);
    ctx.lineTo(32, -12); ctx.lineTo(-32, -12);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillRect(-13, -12, 26, 32);
    ctx.strokeRect(-13, -12, 26, 32);
    ctx.beginPath();
    ctx.moveTo(-30, 20); ctx.lineTo(30, 20);
    ctx.lineTo(36, 34); ctx.lineTo(-36, 34);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

/* 草的种子：贴地的小芽 + 常驻血条 + 阵营小环 + 治疗光环范围 */
function drawSeeds() {
  var S = TYPES.grass.seed;
  for (var i = 0; i < seeds.length; i++) {
    var s = seeds[i];
    var ph = s.phase;
    var sway = Math.sin(t * 2.2 + ph) * 2.2;

    // 治疗光环范围（淡虚线圆，提示 200px 回血区间）
    ctx.save();
    ctx.strokeStyle = 'rgba(140,224,106,' + (0.10 + 0.05 * Math.sin(t * 2 + ph)).toFixed(3) + ')';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -t * 14;
    ctx.beginPath();
    ctx.arc(s.x, s.y, S.healRadius, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // 地面光晕
    var g = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, s.r * 2.4);
    g.addColorStop(0, 'rgba(150,235,120,.20)');
    g.addColorStop(1, 'rgba(150,235,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 2.4, 0, TAU);
    ctx.fill();

    // 土壤
    ctx.fillStyle = 'rgba(40,60,34,.85)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + s.r * 0.55, s.r * 1.05, s.r * 0.42, 0, 0, TAU);
    ctx.fill();

    // 茎
    ctx.strokeStyle = '#6fcf5a';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y + s.r * 0.5);
    ctx.quadraticCurveTo(s.x + sway * 0.6, s.y - s.r * 0.2, s.x + sway, s.y - s.r);
    ctx.stroke();

    // 两片叶子
    ctx.fillStyle = '#8ce06a';
    for (var k = -1; k <= 1; k += 2) {
      var lx = s.x + sway * 0.7 + k * 4;
      var ly = s.y - s.r * 0.55;
      ctx.beginPath();
      ctx.ellipse(lx + k * 3, ly, 5.5, 3, k * 0.6, 0, TAU);
      ctx.fill();
    }

    // 阵营小环
    ctx.strokeStyle = s.team === 'A' ? 'rgba(232,72,63,.45)' : 'rgba(74,123,240,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y + s.r * 0.55, s.r * 1.15, 0, Math.PI, false);
    ctx.stroke();

    // 受击闪白（种子被技能 / 箭矢 / 激光 / 冰面等打中时）
    if (s.flash > 0) {
      ctx.globalAlpha = Math.min(1, s.flash / 0.22) * 0.8;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y - s.r * 0.3, s.r * 1.12, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 血条：常驻显示（种子是有独立血条的实体），低血变橙 / 红
    var bw = 34, bh = 4;
    var bx = s.x - bw / 2, by = s.y - s.r - 16;
    var ratio = Math.max(0, s.hp / s.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    roundRect(bx - 1, by - 1, bw + 2, bh + 2, 2);
    ctx.fillStyle = ratio > 0.5 ? '#7fd45f' : (ratio > 0.25 ? '#e0b23c' : '#e05a4a');
    roundRect(bx, by, bw * ratio, bh, 2);
  }
}

/* 藤蔓：从草甩向目标的二次贝塞尔曲线，命中时更粗更亮 */
function drawVines() {
  for (var i = 0; i < vines.length; i++) {
    var v = vines[i];
    var k = Math.max(0, v.life / v.max);
    ctx.globalAlpha = Math.min(1, k * 1.7);
    ctx.strokeStyle = v.hit ? '#8ce06a' : '#5f8f4a';
    ctx.lineWidth = v.hit ? 4 : 2;
    ctx.lineCap = 'round';

    var dx = v.x2 - v.x1, dy = v.y2 - v.y1;
    var len = Math.hypot(dx, dy) || 1;
    var bow = Math.min(46, len * 0.2);
    var cx = (v.x1 + v.x2) / 2 - (dy / len) * bow;
    var cy = (v.y1 + v.y2) / 2 + (dx / len) * bow;

    ctx.beginPath();
    ctx.moveTo(v.x1, v.y1);
    ctx.quadraticCurveTo(cx, cy, v.x2, v.y2);
    ctx.stroke();

    // 叶片
    if (v.hit) {
      ctx.fillStyle = '#a8ec8a';
      for (var j = 1; j <= 3; j++) {
        var tt = j / 4;
        var px = (1 - tt) * (1 - tt) * v.x1 + 2 * (1 - tt) * tt * cx + tt * tt * v.x2;
        var py = (1 - tt) * (1 - tt) * v.y1 + 2 * (1 - tt) * tt * cy + tt * tt * v.y2;
        ctx.beginPath();
        ctx.ellipse(px, py, 4, 2.4, tt * 3 + v.life * 4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

/* 草本体：圆角方块底座 + 三片会摆的叶子 */
function drawGrass(u) {
  var r = u.r, x = u.x, y = u.y;

  var gl = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.2);
  gl.addColorStop(0, rgba(u.glow, 0.26));
  gl.addColorStop(1, rgba(u.glow, 0));
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.2, 0, TAU);
  ctx.fill();

  // 叶子（画在方块后面，会轻微摇摆）
  ctx.lineCap = 'round';
  for (var i = 0; i < 3; i++) {
    var base = -Math.PI / 2 + (i - 1) * 0.62;
    var sw = Math.sin(t * 2 + u.seed + i * 1.1) * 0.12;
    var a = base + sw;
    var L = r * (1.35 - Math.abs(i - 1) * 0.22);
    var ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
    var mx = x + Math.cos(a) * L * 0.55, my = y + Math.sin(a) * L * 0.55;
    ctx.strokeStyle = i === 1 ? u.light : '#7fd45f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();
  }

  // 方块底座
  var body = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  body.addColorStop(0, u.light);
  body.addColorStop(0.45, u.body);
  body.addColorStop(1, u.dark);
  roundRect(x - r, y - r * 0.9, r * 2, r * 1.8, r * 0.28);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.stroke();

  // 高光
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#ffffff';
  roundRect(x - r * 0.7, y - r * 0.66, r * 0.7, r * 0.3, r * 0.1);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* 大狗：棕黄色的胖方块 + 两只三角耳 + 口鼻 */
function drawDog(u) {
  var r = u.r, x = u.x, y = u.y;

  var gl = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.2);
  gl.addColorStop(0, rgba(u.glow, 0.26));
  gl.addColorStop(1, rgba(u.glow, 0));
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.2, 0, TAU);
  ctx.fill();

  // 耳朵
  ctx.fillStyle = u.dark;
  for (var k = -1; k <= 1; k += 2) {
    ctx.beginPath();
    ctx.moveTo(x + k * r * 0.64, y - r * 0.62);
    ctx.lineTo(x + k * r * 0.98, y - r * 1.3);
    ctx.lineTo(x + k * r * 0.22, y - r * 0.84);
    ctx.closePath();
    ctx.fill();
  }

  // 身体
  var body = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  body.addColorStop(0, u.light);
  body.addColorStop(0.45, u.body);
  body.addColorStop(1, u.dark);
  roundRect(x - r, y - r * 0.82, r * 2, r * 1.72, r * 0.42);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.stroke();

  // 口鼻
  ctx.fillStyle = u.light;
  roundRect(x - r * 0.52, y + r * 0.12, r * 1.04, r * 0.62, r * 0.3);
  ctx.fill();
  ctx.fillStyle = 'rgba(60,30,10,.85)';
  ctx.beginPath();
  ctx.arc(x, y + r * 0.32, r * 0.15, 0, TAU);
  ctx.fill();

  // 眼睛
  ctx.fillStyle = 'rgba(30,16,6,.9)';
  for (var e = -1; e <= 1; e += 2) {
    ctx.beginPath();
    ctx.arc(x + e * r * 0.42, y - r * 0.3, r * 0.1, 0, TAU);
    ctx.fill();
  }

  // 高光
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ffffff';
  roundRect(x - r * 0.7, y - r * 0.6, r * 0.62, r * 0.26, r * 0.1);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* 铁砧：深铁灰方块 + 铁砧剪影（顶面宽、腰部收、底座宽） */
function drawAnvil(u) {
  var r = u.r, x = u.x, y = u.y;

  var gl = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.4);
  gl.addColorStop(0, rgba(u.glow, 0.3));
  gl.addColorStop(1, rgba(u.glow, 0));
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, TAU);
  ctx.fill();

  var body = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  body.addColorStop(0, u.light);
  body.addColorStop(0.45, u.body);
  body.addColorStop(1, u.dark);
  roundRect(x - r, y - r, r * 2, r * 2, r * 0.22);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba('#000000', 0.38);
  ctx.stroke();

  // 铁砧剪影：顶面 / 腰 / 底座（浅钢色，压深描边）
  ctx.fillStyle = '#dbe5f4';
  ctx.strokeStyle = 'rgba(24,30,40,.55)';
  ctx.lineWidth = 1.2;
  // 顶面
  ctx.beginPath();
  ctx.moveTo(x - r * 0.78, y - r * 0.52);
  ctx.lineTo(x + r * 0.78, y - r * 0.52);
  ctx.lineTo(x + r * 0.68, y - r * 0.30);
  ctx.lineTo(x - r * 0.68, y - r * 0.30);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 腰
  roundRect(x - r * 0.24, y - r * 0.30, r * 0.48, r * 0.58, r * 0.08);
  ctx.fill();
  ctx.stroke();
  // 底座
  ctx.beginPath();
  ctx.moveTo(x - r * 0.60, y + r * 0.28);
  ctx.lineTo(x + r * 0.60, y + r * 0.28);
  ctx.lineTo(x + r * 0.72, y + r * 0.52);
  ctx.lineTo(x - r * 0.72, y + r * 0.52);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#ffffff';
  roundRect(x - r * 0.7, y - r * 0.7, r * 0.62, r * 0.26, r * 0.1);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* 野生狗奶：使用本地贴图 assets/milk.png（MILK_SPRITE）绘制本体
   ------------------------------------------------------------
   · 贴图按单位半径等比适配，朝左时水平翻转
   · 引导期间额外画：金色脉动光环 + 旋转虚线 + 上升的奶滴，
     让"原地站桩 / 无敌"在画面上能一眼看出来
   · 贴图加载失败时退化为纯色剪影兜底 */
function drawMilk(u) {
  var r = u.r, x = u.x, y = u.y;
  var ch = u.st && u.st.milkT > 0;

  var gl = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.3);
  gl.addColorStop(0, rgba(u.glow, 0.26));
  gl.addColorStop(1, rgba(u.glow, 0));
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.3, 0, TAU);
  ctx.fill();

  // 引导光环：金色脉动圈 + 慢速旋转虚线
  if (ch) {
    var pulse = 0.55 + 0.45 * Math.sin(t * 7);
    ctx.strokeStyle = 'rgba(255,224,160,' + (0.35 + 0.4 * pulse) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 9 + pulse * 3, 0, TAU);
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([4, 10]);
    ctx.lineDashOffset = -t * 40;
    ctx.strokeStyle = 'rgba(255,244,214,.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 20, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // 上升奶滴
    ctx.fillStyle = 'rgba(255,250,235,.75)';
    for (var d = 0; d < 3; d++) {
      var ph = (t * 0.9 + d / 3) % 1;
      ctx.globalAlpha = 0.7 * (1 - ph);
      ctx.beginPath();
      ctx.arc(x + Math.sin(t * 2 + d * 2.1) * r * 0.5, y - r - ph * 26, 2.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 本体贴图（本地资源）：按高度等比适配；朝左时水平翻转
  if (MILK_SPRITE.ok) {
    var im = MILK_SPRITE.img;
    var iw = im.naturalWidth, ih = im.naturalHeight;
    var maxH = r * 2.9, maxW = r * 3.1;
    var sc = maxH / ih;
    if (iw * sc > maxW) sc = maxW / iw;
    var dw = iw * sc, dh = ih * sc;
    ctx.save();
    ctx.translate(x, y + r * 0.22);
    if (Math.cos(u.ang) < 0) ctx.scale(-1, 1);
    ctx.drawImage(im, -dw / 2, -dh * 0.82, dw, dh);
    ctx.restore();
  } else {
    // 贴图未就绪 / 加载失败：纯色剪影兜底（不使用原来的占位美术）
    ctx.fillStyle = u.body;
    roundRect(x - r, y - r * 0.9, r * 2, r * 1.8, r * 0.42);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,64,38,.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/* 野生狗奶的「全域流失」连线：从引导者拉向每个敌人 / 敌方种子
   ------------------------------------------------------------
   只做视觉提示（虚线 + 目标身上的红环），不改变任何单位的位置与朝向 */
function drawMilkLinks() {
  var i, j;
  for (i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive || !u.st || !(u.st.milkT > 0)) continue;
    var pulse = 0.4 + 0.24 * Math.sin(t * 4 + u.seed);

    ctx.save();
    ctx.setLineDash([7, 10]);
    ctx.lineDashOffset = -t * 54;
    for (j = 0; j < units.length; j++) {
      var v = units[j];
      if (!v.alive || v.team === u.team) continue;
      ctx.strokeStyle = 'rgba(255,143,122,' + (pulse + 0.18) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      ctx.lineTo(v.x, v.y);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,143,122,' + (0.14 + 0.12 * Math.sin(t * 5 + v.seed)) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(v.x, v.y, v.r + 7, 0, TAU);
      ctx.stroke();
    }
    // 敌方召唤物（草的种子）：更细的一条
    ctx.strokeStyle = 'rgba(255,176,140,' + (pulse + 0.1) + ')';
    ctx.lineWidth = 1.2;
    for (j = 0; j < seeds.length; j++) {
      var s = seeds[j];
      if (s.team === u.team) continue;
      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* 大狗激光：三段叠加（光晕 / 中层 / 白热芯）+ 枪口闪光 + 命中亮点 */
function drawLasers() {
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u || !u.alive || !u.st || !(u.st.laserT > 0)) continue;
    var T = TYPES[u.key];
    if (!T || !T.laser) continue;

    var L = T.laser;
    var ex = u.x + Math.cos(u.st.laserAng) * L.len;
    var ey = u.y + Math.sin(u.st.laserAng) * L.len;

    // 淡入 0.2s / 淡出 0.35s
    var age = L.dur - u.st.laserT;
    var a = Math.min(1, age / 0.2, u.st.laserT / 0.35);
    if (a <= 0) continue;
    var pulse = 0.78 + 0.22 * Math.sin(t * 34);

    ctx.save();
    ctx.lineCap = 'round';

    ctx.globalAlpha = 0.18 * a * pulse;
    ctx.strokeStyle = '#ff9d3c';
    ctx.lineWidth = L.width * 1.9;
    ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(ex, ey); ctx.stroke();

    ctx.globalAlpha = 0.55 * a;
    ctx.strokeStyle = '#ffc46b';
    ctx.lineWidth = L.width * 0.55;
    ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(ex, ey); ctx.stroke();

    ctx.globalAlpha = 0.95 * a;
    ctx.strokeStyle = '#fff4d6';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();

    // 枪口闪光
    ctx.save();
    ctx.globalAlpha = a;
    var g = ctx.createRadialGradient(u.x, u.y, 2, u.x, u.y, u.r * 1.8);
    g.addColorStop(0, 'rgba(255,244,214,.95)');
    g.addColorStop(1, 'rgba(255,157,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r * 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 被扫到的敌人：打一个高亮点，代替每段粒子（避免 40 段刷屏）
    for (var j = 0; j < units.length; j++) {
      var v = units[j];
      if (!v.alive || v.team === u.team) continue;
      if (segDist(v.x, v.y, u.x, u.y, ex, ey) > L.width * 0.5 + v.r) continue;
      ctx.globalAlpha = 0.85 * a * pulse;
      ctx.fillStyle = '#fff6dc';
      ctx.beginPath();
      ctx.arc(v.x, v.y, v.r * 0.55, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

/* 终结技瞬发光束（大狗三重咆哮等）：短寿命三层光柱 */
function drawUltBeams() {
  for (var i = 0; i < ultBeams.length; i++) {
    var b = ultBeams[i];
    var k = clamp(b.life / b.max, 0, 1);
    var a = Math.min(1, k * 1.6);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.22 * a;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.width * 1.8;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.globalAlpha = 0.7 * a;
    ctx.lineWidth = b.width * 0.5;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.globalAlpha = 0.95 * a;
    ctx.strokeStyle = '#fff9e6';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.restore();
  }
}

/* 战斗内的单位外观：把 45-icons.js 的图标做成「圆牌」，
   和菜单 / 手机端保持同一套形象（第 97 条） */
function drawTokenUnit(u, img) {
  var r = u.r;

  // 队伍色光晕（替代各角色原来的 glow，红蓝一眼可分）：离屏贴图，避免每帧建渐变
  var gr = r * 2.1;
  ctx.drawImage(teamGlowSprite(u.team), u.x - gr, u.y - gr, gr * 2, gr * 2);

  // 底盘：同样是缓存的离屏贴图
  ctx.drawImage(tokenBaseSprite(r), u.x - r, u.y - r, r * 2, r * 2);
  ctx.beginPath();
  ctx.arc(u.x, u.y, r, 0, TAU);
  ctx.strokeStyle = u.team === 'A' ? 'rgba(255,120,100,.55)' : 'rgba(120,160,255,.6)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 图标（SVG 自带留白，画 2r 刚好填满圆牌）
  var s = r * 2;
  ctx.drawImage(img, u.x - s / 2, u.y - s / 2, s, s);
}

/* 血条上方的「状态细条」统一画法：冰冻值 / 缺氧值共用同一套底框、轨迹、圆角与左端标记，
   只靠颜色 + 标记形状区分（冰=四角霜花，水=水滴点），避免第三条细条各自一套观感。 */
function drawOverBar(bx, bw, y, k, col, fullCol, kind) {
  var h = 4;
  ctx.fillStyle = 'rgba(0,0,0,.7)';
  roundRect(bx - 3, y - 2, bw + 6, h + 4, 3);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,.10)';
  roundRect(bx, y, bw, h, 2);
  ctx.fill();

  var kk = clamp(k, 0, 1);
  ctx.fillStyle = kk >= 0.999 ? fullCol : col;
  if (kk > 0) {
    roundRect(bx, y, bw * kk, h, 2);
    ctx.fill();
  }

  // 左端标记：霜花 / 水滴，形状差异在 4px 条上比颜色更可靠
  ctx.fillStyle = kk >= 0.999 ? fullCol : col;
  var mx = bx - 5, my = y + h / 2;
  if (kind === 'ice') {
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(mx - 2.4, my); ctx.lineTo(mx + 2.4, my);
    ctx.moveTo(mx, my - 2.4); ctx.lineTo(mx, my + 2.4);
    ctx.strokeStyle = kk >= 0.999 ? fullCol : col;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(mx, my, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawUnit(u) {
  if (!u.alive) return;
  var R = u.st.rage;
  var shaking = !!R && R.phase === 'shake';

  // 技能蓄力预警：锁定方向画一条虚线，末端是落点圈
  if (u.castT > 0 && u.castAim) {
    var prog = u.castMax > 0 ? clamp(1 - u.castT / u.castMax, 0, 1) : 1;
    var line = u.team === 'A' ? '232,72,63' : '74,123,240';
    ctx.save();
    ctx.strokeStyle = 'rgba(' + line + ',' + (0.25 + prog * 0.45).toFixed(3) + ')';
    ctx.lineWidth = 1.5 + prog;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(u.x + Math.cos(u.ang) * (u.r + 4), u.y + Math.sin(u.ang) * (u.r + 4));
    ctx.lineTo(u.castAim.x, u.castAim.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(u.castAim.x, u.castAim.y, 8 + prog * 8, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // 终结技蓄力：金色虚线锁定目标 + 双层收束圈（比普通技能更醒目）
  if (u.ultT > 0 && u.ultAim) {
    var uProg = u.ultCastMax > 0 ? clamp(1 - u.ultT / u.ultCastMax, 0, 1) : 1;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,214,122,' + (0.3 + 0.55 * uProg).toFixed(3) + ')';
    ctx.lineWidth = 2 + 2 * uProg;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(u.x, u.y);
    ctx.lineTo(u.ultAim.x, u.ultAim.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(u.ultAim.x, u.ultAim.y, 18 + 36 * uProg, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r + 8 + 20 * uProg, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  if (shaking) {
    ctx.save();
    ctx.translate(rand(-2.5, 2.5), rand(-2.5, 2.5));
  }

  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(u.x, u.y + u.r * 0.95, u.r * 1.0, u.r * 0.36, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 物品自己的外观：优先用与菜单同一套的矢量图标（第 97 条）
  var ico = (typeof iconImage === 'function') ? iconImage(u.key) : null;
  if (ico && ico.complete && ico.naturalWidth) drawTokenUnit(u, ico);
  else TYPES[u.key].draw(u);

  if (shaking) ctx.restore();

  // 阵营环：即使双方选同一物品，也能一眼分清红/蓝方
  ctx.strokeStyle = u.team === 'A' ? 'rgba(232,72,63,.55)' : 'rgba(74,123,240,.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(u.x, u.y, u.r + 4.5, 0, TAU);
  ctx.stroke();

  if (u.slowT > 0) {
    ctx.strokeStyle = 'rgba(140,190,255,.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r + 6, 0, TAU);
    ctx.stroke();
  }

  // 水桶浸水：蓝色水环；累计满 4 秒后加一圈琥珀色告警脉动（提示即将/正在掉血）
  if (u.waterT > 0) {
    var wk = TYPES.bucket.water;
    var wetK = clamp(u.waterT / wk.wetThreshold, 0, 1);
    ctx.strokeStyle = 'rgba(127,216,255,' + (0.3 + 0.4 * wetK).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r + 7, 0, TAU);
    ctx.stroke();
    if (wetK >= 1) {
      ctx.strokeStyle = 'rgba(255,196,107,' + (0.45 + 0.35 * Math.sin(t * 8)).toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.r + 10, 0, TAU);
      ctx.stroke();
    }
  }

  // 被捆绑：绿色虚线环
  if (u.bindT > 0) {
    ctx.strokeStyle = 'rgba(140,224,106,.9)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r + 8, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 中毒：周围冒绿泡
  if (u.poisonT > 0) {
    ctx.fillStyle = 'rgba(150,235,120,.55)';
    for (var pz = 0; pz < 3; pz++) {
      var pa = t * 1.6 + pz * 2.1 + u.seed;
      var pr = u.r + 4 + Math.sin(t * 2 + pz) * 5;
      ctx.beginPath();
      ctx.arc(u.x + Math.cos(pa) * pr, u.y + Math.sin(pa) * pr, 2.6, 0, TAU);
      ctx.fill();
    }
  }

  if (u.st.shield > 0) {
    var k = 0.55 + 0.45 * Math.sin(t * 8);
    ctx.strokeStyle = 'rgba(150,185,255,' + (0.35 + 0.3 * k) + ')';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r + 11, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,160,255,.10)';
    ctx.fill();
  }

  if (u.flash > 0) {
    ctx.globalAlpha = u.flash * 0.55;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r * 1.02, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* 头顶十字血牌（仿方块风格）：整个十字就是血槽
     ------------------------------------------------------------
     ① 硬直角十字外框（石质浅灰）+ 1px 暗边，缩到再小也能从草皮/水面上认出来；
     ② 深色内腔 = 空血区域；
     ③ 血量按比例从十字底部向上填充，掉血时液面「自上而下回落」：
        高血几乎填满十字，半血时液面正好切在横臂中线，低血只剩最下一小格色块；
        填充色恒按阵营（红方红 / 蓝方蓝），不随血量改色；
     ④ 数字压在十字中央，白字黑描边，压在色块或空腔上都读得清。
     填充用两条矩形子路径 + clip 裁成十字，颜色不会溢出到十字外。 */
  var bw = 60, bh = 8;                       // 状态细条 / 护盾条沿用 bw、by 定位
  var bx = u.x - bw / 2, by = u.y - u.r - 46;
  var hpRatio = clamp(u.hp / u.maxHp, 0, 1);

  var bcx = u.x, bcy = by + bh / 2 + 16;
  var armH = 24, armW = 28, spanX = 78, spanY = 66;
  var plateL = bcx - spanX / 2;
  var plateT = bcy - spanY / 2, plateB = bcy + spanY / 2;
  var vL = bcx - armW / 2;
  var hT = bcy - armH / 2;

  // ① 轮廓投影：1px 暗边，保证在浅色地面 / 水面上也能分清十字边缘
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(vL - 3, plateT - 3, armW + 6, spanY + 6);
  ctx.fillRect(plateL - 3, hT - 3, spanX + 6, armH + 6);

  // ② 石质外框：十字轮廓外扩 2px（硬直角，保持方块风格）
  ctx.fillStyle = '#b7b7ae';
  ctx.fillRect(vL - 2, plateT - 2, armW + 4, spanY + 4);
  ctx.fillRect(plateL - 2, hT - 2, spanX + 4, armH + 4);

  // ③ 内腔：空血区域的深色血槽（上浅下深，做出凹槽感）
  var caveG = ctx.createLinearGradient(0, plateT, 0, plateB);
  caveG.addColorStop(0, '#1c1c1c');
  caveG.addColorStop(0.62, '#101010');
  caveG.addColorStop(1, '#090909');
  ctx.fillStyle = caveG;
  ctx.fillRect(vL, plateT, armW, spanY);
  ctx.fillRect(plateL, hT, spanX, armH);

  // ④ 血量填充：裁剪到十字形状，从底部向上长；掉血 = 液面自上而下回落
  if (hpRatio > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(vL, plateT, armW, spanY);
    ctx.rect(plateL, hT, spanX, armH);
    ctx.clip();

    var fillH = spanY * hpRatio;
    var fillTop = plateB - fillH;
    var lowHp = hpRatio <= 0.25;
    // 填充色恒按阵营：红方永远红、蓝方永远蓝（不随血量改色；低血只让液面亮边呼吸）
    var isBlue = u.team === 'B';
    var fg = ctx.createLinearGradient(0, fillTop, 0, plateB);
    fg.addColorStop(0, isBlue ? '#8fb0ff' : '#ff6a52');
    fg.addColorStop(0.55, isBlue ? '#3f6dff' : '#e8352b');
    fg.addColorStop(1, isBlue ? '#2140b8' : '#a81a12');
    ctx.fillStyle = fg;
    ctx.fillRect(plateL, fillTop, spanX, fillH);

    // 液面亮边：就是这一眼的"血量刻度"，低血时呼吸闪烁
    var lvl = lowHp ? (0.45 + 0.55 * Math.abs(Math.sin(t * 6))) : 0.85;
    ctx.fillStyle = 'rgba(255,214,196,' + lvl.toFixed(3) + ')';
    ctx.fillRect(plateL, fillTop, spanX, Math.min(2, fillH));
    ctx.restore();
  }

  /* 血条上方两条状态细条按统一栈位排：冰冻值最贴近血牌（最影响近战判断），
     缺氧值在它上面；两者同时存在时间距 7px，不会互相压字。stackTop 供狂暴文字让位。 */
  var stackTop = bcy - spanY / 2 - 6;
  if (u.iceTick > 0.004) {
    drawOverBar(bx, bw, stackTop, u.iceTick, '#8ce0ff', '#ffffff', 'ice');
    stackTop -= 7;
  }
  if (u.waterT > 0) {
    var ox = TYPES.bucket.water;
    drawOverBar(bx, bw, stackTop, u.waterT / ox.wetThreshold,
      '#6fd8ff', '#ffb050', 'water');
    stackTop -= 7;
  }

  // 护盾条：统一画在血条下方（青金石狂暴护盾 / 冰块周期护盾都走这里）
  var smax = TYPES[u.key].shieldMax;
  if (smax && u.st.shield > 0) {
    var sy = by + bh + 58, sh = 3;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    roundRect(bx - 2, sy - 1, bw + 4, sh + 2, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,160,255,.22)';
    roundRect(bx, sy, bw, sh, 1.5);
    ctx.fill();
    ctx.fillStyle = '#8fc4ff';
    roundRect(bx, sy, bw * clamp(u.st.shield / smax, 0, 1), sh, 1.5);
    ctx.fill();
  }


  // 血牌数字：只显当前血量，大号粗体压在十字中央（横臂作衬底）
  // 四位数（BOSS / 高 HP 角色）按宽度做横向压缩，保证不越出横臂；高度不变，仍然读得清
  var hpTxt = String(Math.ceil(Math.max(0, u.hp)));
  var hpMaxW = spanX - 10;
  ctx.font = '700 24px "Chakra Petch",ui-monospace,Consolas,monospace';
  var hpW = ctx.measureText(hpTxt).width;
  var hpSqueeze = hpW > hpMaxW ? hpMaxW / hpW : 1;
  ctx.save();
  if (hpSqueeze < 1) {
    ctx.translate(bcx, 0);
    ctx.scale(hpSqueeze, 1);
    ctx.translate(-bcx, 0);
  }
  ctx.textAlign = 'center';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,.8)';
  ctx.strokeText(hpTxt, bcx, bcy + 8);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(hpTxt, bcx, bcy + 8);
  ctx.restore();
  ctx.textAlign = 'left';

  var cr = u.r + 16;
  if (u.st && u.st.milkT > 0) {
    // 引导进度环：金色，从 12 点顺时针填满（引导期间 CD 为 0，不能画成"就绪"）
    var dur = TYPES.milk.drain.dur;
    var cp = clamp(1 - u.st.milkT / dur, 0, 1);
    ctx.strokeStyle = 'rgba(255,224,160,.14)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(u.x, u.y, cr, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,224,160,.9)';
    ctx.beginPath();
    ctx.arc(u.x, u.y, cr, -Math.PI / 2, -Math.PI / 2 + TAU * cp);
    ctx.stroke();
  } else if (u.cd > 0) {
    var total = TYPES[u.key].skill.cd;
    var prog = clamp(1 - u.cd / total, 0, 1);
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(u.x, u.y, cr, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = rgba(u.glow, 0.85);
    ctx.beginPath();
    ctx.arc(u.x, u.y, cr, -Math.PI / 2, -Math.PI / 2 + TAU * prog);
    ctx.stroke();
  } else {
    var pulse = 0.55 + 0.45 * Math.sin(t * 6);
    ctx.strokeStyle = rgba(u.glow, 0.25 + 0.35 * pulse);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(u.x, u.y, cr + pulse * 2, 0, TAU);
    ctx.stroke();
  }

  // 终结技充能环：普通技能环外侧再套一圈金色；充满后呼吸闪烁
  var UT = TYPES[u.key] && TYPES[u.key].ultimate;
  if (UT) {
    var ur = cr + 6;
    var ready = u.energyMax ? u.energy >= u.energyMax : (u.ultCd || 0) <= 0;
    var uk = u.energyMax ? clamp(u.energy / u.energyMax, 0, 1) : clamp(1 - (u.ultCd || 0) / UT.cd, 0, 1);
    ctx.strokeStyle = 'rgba(255,214,122,.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(u.x, u.y, ur, 0, TAU);
    ctx.stroke();
    if (!ready) {
      ctx.strokeStyle = 'rgba(255,214,122,.55)';
      ctx.beginPath();
      ctx.arc(u.x, u.y, ur, -Math.PI / 2, -Math.PI / 2 + TAU * uk);
      ctx.stroke();
    } else {
      var uPulse = 0.5 + 0.5 * Math.sin(t * 7 + u.seed);
      ctx.strokeStyle = 'rgba(255,224,138,' + (0.55 + 0.4 * uPulse).toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(u.x, u.y, ur + uPulse * 1.5, 0, TAU);
      ctx.stroke();
    }
  }

  // 羁绊狂暴状态：外圈光环 + 头顶文字
  if (R) {
    var aura = R.phase === 'shake'
      ? 'rgba(255,225,120,' + (0.35 + 0.3 * Math.abs(Math.sin(t * 18))) + ')'
      : 'rgba(255,150,90,' + (0.35 + 0.25 * Math.sin(t * 6)) + ')';
    ctx.strokeStyle = aura;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r + 8, 0, TAU);
    ctx.stroke();

    var label = R.phase === 'shake' ? '无敌抖动' : '狂暴';
    // 让位给血条上方的状态细条：有几条就把文字抬高几层，避免互相压字
    var labelY = Math.min(by - 6, stackTop - 2);
    ctx.font = '700 11px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(label, u.x, labelY);
    ctx.fillStyle = R.phase === 'shake' ? '#ffe08a' : '#ff9c6b';
    ctx.fillText(label, u.x, labelY);
    ctx.textAlign = 'left';
  }
}

/* 单位状态挂件：把附魔 / 护盾 / 控制效果画在单位旁边
   ------------------------------------------------------------
   青金石的 5 种附魔是可叠加的隐性收益，这里统一做成小胶囊：
     攻 +30%   红石普攻增伤（青金石 1 号附魔）
     攻 +20%   青金石自身普攻增伤（5 号）
     血 +240   生命上限（2 号）
     速 +18%   移速（4 号）
     盾 200    护盾（3 号 / 冰块周期护盾）
     缓/缚/毒  减速 / 定身 / 中毒
   挂在单位右侧（贴近右边界时自动翻到左侧），最多 6 条。 */
function drawUnitStatus(u) {
  if (!u || !u.alive) return;
  // 虚弱：紫晶核心终末震荡留下的紫色虚线环
  if (u.weakT > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(199,155,255,' + (0.35 + 0.25 * Math.sin(t * 8)) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r + 7, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  var st = u.st || {};
  var rows = [];
  if (st.enchantAtk > 0) rows.push(['攻', '+' + Math.round(st.enchantAtk * 10) + '%', '#ffd166']);
  if (st.enchantBasic > 0) rows.push(['攻', '+' + [0, 25, 45, 70][Math.min(3, st.enchantBasic)] + '%', '#ffd166']);
  if (st.eAtk > 0) rows.push(['攻', '+' + Math.round(st.eAtk * 10) + '%', '#ffc46b']);
  if (st.enchantSkill > 0) rows.push(['技', '+' + [0, 25, 45, 70][Math.min(3, st.enchantSkill)] + '%', '#ffb27a']);
  if (st.enchantDef) rows.push(['防', '+10%', '#9fd0ff']);
  if (st.eHp > 0) rows.push(['血', '+' + (st.eHp * 80), '#8fe08a']);
  if (st.eSpeed > 0) rows.push(['速', '+' + Math.round(st.eSpeed * 6) + '%', '#8ce0ff']);
  var smax = TYPES[u.key] && TYPES[u.key].shieldMax;
  if (smax && st.shield > 0) rows.push(['盾', String(Math.round(st.shield)), '#8fc4ff']);
  if (u.slowT > 0) rows.push(['缓', '减速', '#8cbaff']);
  if (u.weakT > 0) rows.push(['弱', '伤害 -20%', '#c79bff']);
  if (u.bindT > 0) rows.push(['缚', '定身', '#a6e27a']);
  if (u.poisonT > 0) rows.push(['毒', '中毒', '#96eb78']);
  if (!rows.length) return;
  if (rows.length > 6) rows.length = 6;

  ctx.save();
  ctx.font = '600 10.5px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textBaseline = 'middle';
  var CH = 17, GAP = 3, PAD = 6, ICO = 12, maxW = 0;
  for (var i = 0; i < rows.length; i++) {
    var tw = ctx.measureText(rows[i][1]).width;
    rows[i].w = ICO + PAD * 2 + 3 + tw;
    if (rows[i].w > maxW) maxW = rows[i].w;
  }
  var h = rows.length * CH + (rows.length - 1) * GAP;
  var right = u.x + u.r + 12 + maxW < W - 4;
  var x = right ? u.x + u.r + 12 : u.x - u.r - 12 - maxW;
  var y0 = clamp(Math.max(u.y - h / 2, u.y - u.r + 4), 6, H - h - 6);

  for (var j = 0; j < rows.length; j++) {
    var row = rows[j], y = y0 + j * (CH + GAP);
    ctx.fillStyle = 'rgba(8,8,10,.66)';
    roundRect(x, y, maxW, CH, 4);
    ctx.fill();
    ctx.strokeStyle = rgba(row[2], 0.5);
    ctx.lineWidth = 1;
    roundRect(x + 0.5, y + 0.5, maxW - 1, CH - 1, 4);
    ctx.stroke();

    ctx.fillStyle = row[2];
    ctx.beginPath();
    ctx.arc(x + PAD + ICO / 2 - 1, y + CH / 2, 5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#131316';
    ctx.textAlign = 'center';
    ctx.fillText(row[0], x + PAD + ICO / 2 - 1, y + CH / 2 + 0.5);

    ctx.fillStyle = '#f4f4f6';
    ctx.textAlign = 'left';
    ctx.fillText(row[1], x + PAD + ICO + 2, y + CH / 2 + 0.5);
  }
  ctx.restore();
}

function drawBombs() {
  for (var i = 0; i < bombs.length; i++) {
    var b = bombs[i];
    var k = 1 - b.fuse / b.max;
    var blink = 0.5 + 0.5 * Math.sin(t * (10 + k * 16) + b.spin);

    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 7, 10, 4, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,140,80,' + (0.12 + 0.35 * k) + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 13 + k * 6, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = '#1b1f27';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#3c4557';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath();
    ctx.arc(b.x - 2.5, b.y - 2.5, 2.2, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,' + Math.round(150 + 70 * blink) + ',80,' + (0.55 + 0.45 * blink) + ')';
    ctx.beginPath();
    ctx.arc(b.x + 5, b.y - 9, 2.4 + 1.4 * blink, 0, TAU);
    ctx.fill();
  }
}

function drawFx() {
  var i;
  for (i = 0; i < rings.length; i++) {
    var r = rings[i];
    var k = 1 - r.life / r.max;
    var rad = r.r0 + (r.r1 - r.r0) * k;
    ctx.globalAlpha = (1 - k) * 0.7;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 2.5 * (1 - k) + 0.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, rad, 0, TAU);
    ctx.stroke();
  }

  for (i = 0; i < particles.length; i++) {
    var p = particles[i];
    var a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  for (i = 0; i < floaters.length; i++) {
    var f = floaters[i];
    var fa = clamp(f.life / f.max, 0, 1);
    /* 同一时机的多条飘字（6v6 的 DoT 汇总、连锁溅射）原来会完全叠在一起；
       按「已有飘字里位置相近的个数」逐层上抬 11px，只影响绘制、不动数据。 */
    var lift = 0;
    for (var q = 0; q < i; q++) {
      var g = floaters[q];
      if (Math.abs(g.x - f.x) < 36 && Math.abs(g.y - f.y) < 18) lift++;
    }
    var fy2 = f.y - Math.min(4, lift) * 11;
    /* 伤害数字（f.pop）：入场 0.1s 从 0.55 弹到 1.2、再回落 1.0，
       描边按字号加粗 + 填充带同色辉光，满屏飘字里一眼能认出是掉血 */
    var pop = 1;
    if (f.pop) {
      var age = f.max - f.life;
      if (age < 0.1) pop = 0.55 + (age / 0.1) * 0.65;
      else if (age < 0.22) pop = 1.2 - ((age - 0.1) / 0.12) * 0.2;
    }
    ctx.globalAlpha = Math.min(1, fa * 1.6);
    ctx.font = (f.pop ? '800 ' : '600 ') + f.size + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = f.pop ? Math.max(3, f.size * 0.22) : 3;
    ctx.strokeStyle = f.pop ? 'rgba(0,0,0,.72)' : 'rgba(0,0,0,.55)';
    ctx.save();
    ctx.translate(f.x, fy2);
    if (pop !== 1) ctx.scale(pop, pop);
    ctx.strokeText(f.text, 0, 0);
    ctx.fillStyle = f.color;
    if (f.pop) {
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 10;
    }
    ctx.fillText(f.text, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

/* HUD 文本/血条不需要每帧写 DOM：每帧写 textContent 会触发样式重算，
   在低端机上就是肉眼可见的掉帧。统一按 ~10Hz 刷新，画面里的数值仍然实时。 */
var hudFrame = 0;
var hudLast = { a: '', b: '', timer: '', label: '', status: '' };

function syncHud() {
  var A = teamHp('A'), B = teamHp('B');
  var aw = (A.max ? (A.cur / A.max) * 100 : 0).toFixed(1) + '%';
  var bw = (B.max ? (B.cur / B.max) * 100 : 0).toFixed(1) + '%';
  if (aw !== hudLast.a) { el.hpA.style.width = aw; hudLast.a = aw; }
  if (bw !== hudLast.b) { el.hpB.style.width = bw; hudLast.b = bw; }

  var timer = suddenDeath ? '决杀 ' + Math.floor(t - suddenStart) + 's' : String(Math.ceil(roundTime));
  var label = suddenDeath ? '-5%/s' : 'SEC';
  if (timer !== hudLast.timer) { el.timer.textContent = timer; hudLast.timer = timer; }
  if (label !== hudLast.label) { el.timerLabel.textContent = label; hudLast.label = label; }

  el.stage.classList.toggle('sudden', suddenDeath && phase === 'fight');

  var st = statusText();
  if (st !== hudLast.status) { el.status.textContent = st; hudLast.status = st; }
  if (typeof updateRoster === 'function') updateRoster(true);
}

/* 菜单 / 选人 / 结算期只在「需要时」重画一帧
   ------------------------------------------------------------
   这些阶段画面被全屏 DOM 覆盖层挡住（或只是静态战场背景），逐帧重绘纯属浪费：
   一张全屏渐变 + 33 条网格线 + 两侧伤害条在手机上就是持续耗电。
   markRenderDirty() 由切页 / 重开 / 画布尺寸变化 / 结算飘字调用。 */
var renderDirty = true;
var renderHadFx = false;
function markRenderDirty() { renderDirty = true; }

function render() {
  /* 后台赔率模拟（第 83 条）期间画布上显示的是赛事棋盘，这里停画：
     模拟状态和当前对局无关，绘制只会白白耗掉低端机的帧预算 */
  if (typeof oddsRunning !== 'undefined' && oddsRunning) return;

  var hasFx = !!(particles.length || rings.length || floaters.length || ultBeams.length ||
    (typeof bossMergeFx !== 'undefined' && bossMergeFx));
  /* 非战斗阶段：只有在「脏」、还有特效 / 赛事击杀演出在播、或特效刚刚播完
     需要补一帧干净画面时才画（否则最后一帧会残留半空中的粒子）。
     结算横幅出现时死亡粒子与扩散环还没播完，这里让它们继续动完再停。 */
  if (phase !== 'fight' && !renderDirty && !hasFx && !renderHadFx &&
      !(typeof tourFx !== 'undefined' && tourFx && tourFx.zoom > 1.001) &&
      !(typeof endFx !== 'undefined' && endFx)) return;
  renderDirty = false;
  renderHadFx = hasFx;

  ctx.save();
  if (shake > 0.1) {
    ctx.translate(rand(-shake, shake) * 0.6, rand(-shake, shake) * 0.6);
  }
  // 命中顿帧的视觉表现：极短的中心放大，不影响模拟时间
  if (hitStop > 0.001) {
    var iz = 1 + hitStop * 1.2;
    ctx.translate(W / 2, H / 2);
    ctx.scale(iz, iz);
    ctx.translate(-W / 2, -H / 2);
  }
  // 赛事击杀演出：朝击杀点放大
  if (typeof tourFx !== 'undefined' && tourFx && tourFx.zoom > 1.001) {
    var tf = tourFx.focus;
    ctx.translate(tf.x, tf.y);
    ctx.scale(tourFx.zoom, tourFx.zoom);
    ctx.translate(-tf.x, -tf.y);
  }
  // 终局特写：聚焦倒下 / 存活方，缓入放大、结尾缓出
  if (typeof endFx !== 'undefined' && endFx) {
    var ef = endFx;
    var efIn = Math.min(1, ef.t / 0.35);
    var efOut = Math.min(1, Math.max(0, (ef.dur - ef.t) / 0.35));
    var efZoom = 1 + 0.35 * efIn * efOut;
    ctx.translate(ef.focus.x, ef.focus.y);
    ctx.scale(efZoom, efZoom);
    ctx.translate(-ef.focus.x, -ef.focus.y);
  }
  /* 终末震荡演出：先聚焦 BOSS，随冲击波扩散逐渐拉远到全场。
     0～0.3s 定在 BOSS 身上（1.55×）；0.3～2.0s 平滑拉远到 0.82×并回到场地中心；
     2.0～2.5s 保持全景；最后 0.4s 回到 1×。模拟时间在 50-ui 同步降到 0.3×。 */
  if (typeof bossCine !== 'undefined' && bossCine) {
    var bc = bossCine;
    var acx = ARENA.x + ARENA.w / 2, acy = ARENA.y + ARENA.h / 2;
    var ox = bc.origin.x, oy = bc.origin.y;
    var fx = acx, fy = acy, bz = 1;
    if (bc.t < 0.3) {
      bz = 1.55; fx = ox; fy = oy;
    } else if (bc.t < 2.0) {
      var bp = (bc.t - 0.3) / 1.7;
      bp = bp * bp * (3 - 2 * bp);
      bz = 1.55 + (0.82 - 1.55) * bp;
      fx = ox + (acx - ox) * bp;
      fy = oy + (acy - oy) * bp;
    } else if (bc.t < 2.5) {
      bz = 0.82; fx = acx; fy = acy;
    } else {
      var bq = Math.min(1, (bc.t - 2.5) / 0.4);
      bq = bq * bq * (3 - 2 * bq);
      bz = 0.82 + 0.18 * bq; fx = acx; fy = acy;
    }
    ctx.translate(acx, acy);
    ctx.scale(bz, bz);
    ctx.translate(-fx, -fy);
  }

  drawArena();
  drawDamagePanels();  // 场地左右留白里的「总伤害」信息条（每帧实时读取）
  drawIcePatches();   // 贴地层：在场地之上、单位与尾迹之下
  drawWaters();       // 水桶的水面（贴地，压在单位之下）
  drawSeeds();        // 草的种子也贴地
  drawAnvilMarks();   // 铁砧落点预警圆（贴地）

  for (var i = 0; i < units.length; i++) drawTrail(units[i]);
  drawBombs();
  drawFx();
  drawArrows();
  drawMilkLinks();    // 野生狗奶引导时的全域流失连线（贴地，压在单位之下）

  var sorted = units.slice().sort(function (a, b) { return a.y - b.y; });
  for (var j = 0; j < sorted.length; j++) drawUnit(sorted[j]);

  drawAnvilDrops();   // 落下的铁砧压在单位之上
  drawLasers();       // 大狗激光（压在单位之上）
  drawUltBeams();     // 终结技瞬发光束（大狗三重咆哮等）
  drawVines();        // 藤蔓压在最上层
  drawBossCharge();   // 合体前的停顿蓄能 + 核心血条充能
  drawBossMerge();    // BOSS 合体演出（残影 / 白闪 / 紫环，最上层）
  drawBossNuke();     // 终末震荡大招演出（白闪 / 冲击波 / 光柱 / 碎晶，最上层）

  // 状态挂件：附魔 / 护盾 / 控制效果，画在所有战斗元素之上
  for (var si = 0; si < sorted.length; si++) drawUnitStatus(sorted[si]);

  ctx.restore();

  hudFrame++;
  if ((hudFrame % 6) === 0) syncHud();
  if (typeof updatePortraitCamera === 'function' && (hudFrame % 2) === 0) updatePortraitCamera();
}


/* ============================================================
   BOSS 合体演出（第 98 条）
   ------------------------------------------------------------
   1.15 秒的四段：残影收束 → 光带汇聚 → 白闪 → 紫环炸开
   纯画面层，不影响模拟；核心当帧进场（st.appear 从 0.9 递减到 0）
   ============================================================ */
/* 合体前后两段"过程感"的画面：
   ① 停顿蓄能（bossMergeAct）：两只身上各套一圈光环，中点长出一颗紫色能量球，中间连能量丝
   ② 血条充能（核心 st.mergeFill > 0）：核心外圈画一圈随进度收拢的紫环 + 上升的血气柱
   纯画面层，不改任何模拟状态。 */
function drawBossCharge() {
  if (typeof bossMode === 'undefined' || !bossMode) return;

  // ① 停顿 + 靠拢
  if (typeof bossMergeAct !== 'undefined' && bossMergeAct) {
    var m = bossMergeAct;
    var p = m.dur > 0 ? Math.min(1, m.t / m.dur) : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var pair = [
      { c: '#ff8a70', u: m.a },
      { c: '#8fb4ff', u: m.b }
    ];
    for (var i = 0; i < pair.length; i++) {
      var pu = pair[i].u;
      if (!pu) continue;
      var pulse = 0.5 + 0.5 * Math.sin(t * 12 + i * 3.14);
      ctx.globalAlpha = 0.28 + 0.42 * (1 - p) + 0.12 * pulse;
      ctx.strokeStyle = pair[i].c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.r + 10 + 16 * pulse, 0, TAU);
      ctx.stroke();
      // 从本体拉向中点的能量丝
      ctx.globalAlpha = 0.25 + 0.5 * p;
      ctx.lineWidth = 1 + 4 * p;
      ctx.beginPath();
      ctx.moveTo(pu.x, pu.y);
      ctx.lineTo(m.mx, m.my);
      ctx.stroke();
    }
    // 中点蓄能球：随停顿逐渐变大、变亮
    var rr = 12 + 54 * p;
    var g = ctx.createRadialGradient(m.mx, m.my, 0, m.mx, m.my, rr);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.55 + 0.35 * p).toFixed(3) + ')');
    g.addColorStop(0.45, 'rgba(199,155,255,' + (0.35 + 0.4 * p).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(122,63,191,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(m.mx, m.my, rr, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  // ② 核心血条充能：外圈紫环随血量比例收拢 + 上升光柱
  for (var k = 0; k < units.length; k++) {
    var u2 = units[k];
    if (!u2.alive || !u2.st || !(u2.st.mergeFill > 0)) continue;
    var prog = u2.maxHp > 0 ? u2.hp / u2.maxHp : 1;
    var pulse2 = 0.5 + 0.5 * Math.sin(t * 16);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 + 0.35 * pulse2;
    ctx.strokeStyle = '#c79bff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(u2.x, u2.y, u2.r + 26 - 20 * prog, 0, TAU);
    ctx.stroke();
    // 进度弧（顺时针长满）
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(u2.x, u2.y, u2.r + 14, -Math.PI / 2, -Math.PI / 2 + TAU * prog);
    ctx.stroke();
    // 血气柱：从脚下升到头顶
    var gg = ctx.createLinearGradient(0, u2.y + u2.r, 0, u2.y - u2.r - 40);
    gg.addColorStop(0, 'rgba(180,120,255,0.55)');
    gg.addColorStop(1, 'rgba(180,120,255,0)');
    ctx.globalAlpha = 0.5 * prog + 0.15;
    ctx.fillStyle = gg;
    ctx.fillRect(u2.x - 8, u2.y - u2.r - 40, 16, u2.r * 2 + 40);
    ctx.restore();
  }
}

function drawBossMerge() {
  if (typeof bossMergeFx === 'undefined' || !bossMergeFx) return;
  var f = bossMergeFx;
  var p = Math.max(0, Math.min(1, f.t / f.dur));
  var x = f.x, y = f.y;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 1) 残影收束：两块方块从原位置滑向中点并旋转缩小（easeOutCubic）
  var q = Math.min(1, p / 0.45);
  var e = 1 - Math.pow(1 - q, 3);
  var ids = [
    { ox: f.ax, oy: f.ay, fill: '#e8483f', edge: '#ffd0c6' },
    { ox: f.bx, oy: f.by, fill: '#4a7bf0', edge: '#cfe0ff' }
  ];
  for (var i = 0; i < ids.length; i++) {
    var o = ids[i];
    var bx = o.ox + (x - o.ox) * e;
    var by = o.oy + (y - o.oy) * e;
    var s = (1 - e) * 30 + 8;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(e * 5 + i * 0.7);
    ctx.globalAlpha = 0.45 + 0.55 * (1 - e);
    ctx.fillStyle = o.fill;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeStyle = o.edge;
    ctx.lineWidth = 2;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }

  // 2) 光带：从两只原位置拉向中点，越到后面越粗
  if (p < 0.55) {
    var k = 1 - p / 0.55;
    for (var j = 0; j < ids.length; j++) {
      var o2 = ids[j];
      ctx.globalAlpha = 0.25 + 0.5 * k;
      ctx.strokeStyle = j ? '#8fb4ff' : '#ff8a70';
      ctx.lineWidth = 2 + 8 * k;
      ctx.beginPath();
      ctx.moveTo(o2.ox, o2.oy);
      ctx.lineTo(o2.ox + (x - o2.ox) * e, o2.oy + (y - o2.oy) * e);
      ctx.stroke();
    }
  }

  // 3) 白闪：p 0.32 ~ 0.62 之间最强
  if (p > 0.30 && p < 0.64) {
    var fl = 1 - Math.abs((p - 0.47) / 0.17);
    fl = Math.max(0, fl);
    var g = ctx.createRadialGradient(x, y, 0, x, y, 300);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.9 * fl).toFixed(3) + ')');
    g.addColorStop(0.4, 'rgba(216,180,255,' + (0.55 * fl).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(120,60,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 300, 0, TAU);
    ctx.fill();
  }

  // 4) 三圈紫环依次炸开
  var waves = [
    { at: 0.20, color: '#ffffff', w: 9 },
    { at: 0.40, color: '#c79bff', w: 7 },
    { at: 0.62, color: '#9a5cff', w: 5 }
  ];
  for (var w = 0; w < waves.length; w++) {
    var wv = waves[w];
    if (p < wv.at) continue;
    var rp = (p - wv.at) / (1 - wv.at);
    ctx.globalAlpha = Math.max(0, 1 - rp);
    ctx.strokeStyle = wv.color;
    ctx.lineWidth = wv.w * (1 - rp) + 2;
    ctx.beginPath();
    ctx.arc(x, y, 18 + rp * 280, 0, TAU);
    ctx.stroke();
  }

  ctx.restore();
}

/* ============================================================
   终末震荡大招演出（紫晶核心 · 一次性全屏震）
   ------------------------------------------------------------
   纯表现层：bossNukeFx 由 coreNuke() 初始化、fx() 推进寿命。
   分段：白闪 → 中心爆光 → 多层冲击波 → 冲天光柱 → 放射裂纹 → 飞散碎晶 → 标题。
   与 bossCine 慢动作镜头叠加，伤害 / 判定在 coreNuke 当帧已结算。
   ============================================================ */
function drawBossNuke() {
  if (typeof bossNukeFx === 'undefined' || !bossNukeFx) return;
  var f = bossNukeFx;
  var x = f.x, y = f.y;
  var A = ARENA;
  var acx = A.x + A.w / 2, acy = A.y + A.h / 2;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  /* 1) 全屏白闪：核心处径向白紫爆光，0.18s 内快速回落 */
  var flash = Math.max(0, 1 - f.t / 0.18);
  if (flash > 0) {
    var fg = ctx.createRadialGradient(x, y, 0, x, y, Math.max(A.w, A.h) * 0.7);
    fg.addColorStop(0, 'rgba(255,255,255,' + (0.85 * flash).toFixed(3) + ')');
    fg.addColorStop(0.35, 'rgba(216,180,255,' + (0.45 * flash).toFixed(3) + ')');
    fg.addColorStop(1, 'rgba(120,60,220,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(A.x, A.y, A.w, A.h);
  }

  /* 2) 中心爆光球：0.5s 内由小扩到大并淡出 */
  var coreP = Math.min(1, f.t / 0.5);
  if (coreP < 1) {
    var cr = 24 + 150 * coreP;
    var ca = 0.9 * (1 - coreP);
    var cg = ctx.createRadialGradient(x, y, 0, x, y, cr);
    cg.addColorStop(0, 'rgba(255,255,255,' + ca.toFixed(3) + ')');
    cg.addColorStop(0.4, 'rgba(199,155,255,' + (ca * 0.7).toFixed(3) + ')');
    cg.addColorStop(1, 'rgba(122,63,191,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, cr, 0, TAU);
    ctx.fill();
  }

  /* 3) 多层冲击波：半透明能量盘 + 描边环，逐层延迟外扩 */
  var waves = [
    { at: 0.00, max: 760, color: '#ffffff', w: 10, fill: '230,212,255' },
    { at: 0.08, max: 700, color: '#c79bff', w: 8,  fill: '154,92,255' },
    { at: 0.18, max: 560, color: '#9a5cff', w: 6,  fill: '122,63,191' },
    { at: 0.30, max: 420, color: '#e6d4ff', w: 5,  fill: '199,155,255' }
  ];
  for (var w = 0; w < waves.length; w++) {
    var wv = waves[w];
    if (f.t < wv.at) continue;
    var wp = Math.min(1, (f.t - wv.at) / 0.7);
    var we = 1 - Math.pow(1 - wp, 3);
    var rad = 24 + (wv.max - 24) * we;
    var wa = Math.max(0, 1 - wp);
    ctx.globalAlpha = wa * 0.16;
    ctx.fillStyle = 'rgba(' + wv.fill + ',1)';
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = wa;
    ctx.strokeStyle = wv.color;
    ctx.lineWidth = wv.w * (1 - wp) + 1.5;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* 4) 冲天光柱：0.8s 内先扩后收，向上贯穿场地，向下留短柱 */
  if (f.t < 0.8) {
    var lp = f.t / 0.8;
    var lw = 26 + 70 * Math.sin(Math.min(1, lp) * Math.PI);
    var lh = A.h * 0.9;
    var lg = ctx.createLinearGradient(x, y - lh, x, y + 20);
    lg.addColorStop(0, 'rgba(199,155,255,0)');
    lg.addColorStop(0.5, 'rgba(216,180,255,' + (0.5 * (1 - lp)).toFixed(3) + ')');
    lg.addColorStop(1, 'rgba(255,255,255,' + (0.7 * (1 - lp)).toFixed(3) + ')');
    ctx.fillStyle = lg;
    ctx.fillRect(x - lw / 2, y - lh, lw, lh);
    var lg2 = ctx.createLinearGradient(x, y - 20, x, y + 90);
    lg2.addColorStop(0, 'rgba(255,255,255,' + (0.5 * (1 - lp)).toFixed(3) + ')');
    lg2.addColorStop(1, 'rgba(154,92,255,0)');
    ctx.fillStyle = lg2;
    ctx.fillRect(x - lw / 3, y - 20, lw * 2 / 3, 110);
  }

  /* 5) 放射裂纹：0.6s 内 12 条折线从中心向外生长 */
  if (f.t < 0.6) {
    var cp = f.t / 0.6;
    ctx.globalAlpha = Math.max(0, 1 - cp) * 0.55;
    ctx.strokeStyle = '#e6d4ff';
    ctx.lineWidth = 1.6;
    for (var ci = 0; ci < 12; ci++) {
      var ca2 = ci / 12 * TAU + 0.26;
      var clen = 120 + 260 * cp;
      var mx = x + Math.cos(ca2 + 0.08) * clen * 0.55;
      var my = y + Math.sin(ca2 + 0.08) * clen * 0.55;
      var ex = x + Math.cos(ca2) * clen;
      var ey = y + Math.sin(ca2) * clen;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ca2) * 20, y + Math.sin(ca2) * 20);
      ctx.lineTo(mx, my);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* 6) 飞散紫晶碎块：旋转菱形，带重力与阻尼，随寿命淡出 */
  for (var sh = 0; sh < f.shards.length; sh++) {
    var s = f.shards[sh];
    var sa2 = clamp(s.life / s.max, 0, 1);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.globalAlpha = sa2;
    ctx.fillStyle = s.color;
    var sz = s.size;
    ctx.beginPath();
    ctx.moveTo(0, -sz);
    ctx.lineTo(sz * 0.7, 0);
    ctx.lineTo(0, sz);
    ctx.lineTo(-sz * 0.7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'source-over';

  /* 7) 标题大字：辉光描边，先放大淡入、后淡出 */
  var tp = (f.t - 0.12) / 1.2;
  if (tp > 0 && tp < 1) {
    var ta = tp < 0.2 ? tp / 0.2 : 1 - Math.max(0, (tp - 0.6) / 0.4);
    var ts = 1.25 - 0.25 * Math.min(1, tp / 0.2);
    ctx.save();
    ctx.globalAlpha = clamp(ta, 0, 1);
    ctx.translate(acx, acy - 20);
    ctx.scale(ts, ts);
    ctx.textAlign = 'center';
    ctx.font = '700 34px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.shadowColor = 'rgba(199,155,255,0.9)';
    ctx.shadowBlur = 22;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(58,22,104,0.8)';
    ctx.strokeText('终末震荡', 0, 0);
    ctx.fillStyle = '#ffe9ff';
    ctx.fillText('终末震荡', 0, 0);
    ctx.shadowBlur = 0;
    ctx.font = '500 14px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(230,212,255,0.9)';
    ctx.fillText('全场生命震颤 · 敌方陷入虚弱', 0, 26);
    ctx.restore();
  }

  ctx.restore();
}
