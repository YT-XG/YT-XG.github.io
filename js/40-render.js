/* ============================================================
   40-render.js —— 全部 Canvas 绘制（只读状态，不改逻辑）
   场地 · 总伤害信息条 · 尾迹 · 各类物品外观 · 箭矢 · 冰面 · 炸弹
   单位合成（血条/护盾条/冷却环）· 粒子与飘字 · render()
   ============================================================ */
'use strict';

/* ============================================================
   渲染
   ============================================================ */
function drawArena() {
  ctx.fillStyle = '#080b11';
  ctx.fillRect(0, 0, W, H);

  var a = ARENA;

  ctx.fillStyle = '#0e1219';
  ctx.fillRect(a.x, a.y, a.w, a.h);

  var g = ctx.createLinearGradient(a.x, 0, a.x + a.w, 0);
  g.addColorStop(0, 'rgba(232,72,63,.085)');
  g.addColorStop(0.5, 'rgba(20,26,38,0)');
  g.addColorStop(1, 'rgba(74,123,240,.085)');
  ctx.fillStyle = g;
  ctx.fillRect(a.x, a.y, a.w, a.h);

  ctx.strokeStyle = 'rgba(255,255,255,.028)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (var x = a.x; x <= a.x + a.w + 1; x += 48) {
    ctx.moveTo(Math.round(x) + 0.5, a.y);
    ctx.lineTo(Math.round(x) + 0.5, a.y + a.h);
  }
  for (var y = a.y; y <= a.y + a.h + 1; y += 48) {
    ctx.moveTo(a.x, Math.round(y) + 0.5);
    ctx.lineTo(a.x + a.w, Math.round(y) + 0.5);
  }
  ctx.stroke();

  ctx.save();
  ctx.setLineDash([5, 12]);
  ctx.strokeStyle = 'rgba(150,170,205,.16)';
  ctx.beginPath();
  ctx.moveTo(a.x + a.w / 2, a.y + 12);
  ctx.lineTo(a.x + a.w / 2, a.y + a.h - 12);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(120,142,182,.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1);

  ctx.strokeStyle = 'rgba(120,142,182,.1)';
  ctx.lineWidth = 6;
  ctx.strokeRect(a.x - 4, a.y - 4, a.w + 8, a.h + 8);
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
    var x = side.team === 'A' ? 8 : W - 8 - PW;
    var y = cy - ph / 2;

    // 3) 卡片底
    ctx.fillStyle = 'rgba(11,15,22,.82)';
    roundRect(x, y, PW, ph, 10);
    ctx.fill();
    ctx.strokeStyle = rgba(side.color, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();

    // 靠场地一侧的竖线，强调这是战斗区之外的信息条
    ctx.fillStyle = rgba(side.color, 0.5);
    ctx.fillRect(side.team === 'A' ? x + PW - 3 : x, y + 12, 3, ph - 24);

    // 4) 标题
    ctx.textAlign = 'center';
    ctx.fillStyle = side.light;
    ctx.font = '600 14px "PingFang SC","Microsoft YaHei",sans-serif';
    var title = teamNames[side.team]
      ? (side.team === 'A' ? '红 ' : '蓝 ') + teamNames[side.team]
      : SIDE_LABEL[side.team];
    ctx.fillText(title, x + PW / 2, y + 15);

    ctx.fillStyle = '#68758b';
    ctx.font = '9.5px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('总伤 ' + Math.round(sumD) + ' · 承伤 ' + Math.round(sumT), x + PW / 2, y + 29);

    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 35);
    ctx.lineTo(x + PW - 10, y + 35);
    ctx.stroke();

    // 5) 排行行
    var bx = x + 8;
    for (var k = 0; k < rows.length; k++) {
      var it = rows[k];
      var ry = y + headH + k * rowH;
      var dPct = sumD > 0 ? it.dealt / sumD : 0;
      var tPct = sumT > 0 ? it.taken / sumT : 0;

      // 名次 + 名字（阵亡的压暗）
      ctx.textAlign = 'left';
      ctx.fillStyle = it.alive ? '#dfe7f4' : '#5d6879';
      ctx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText((k + 1) + ' ' + it.name, bx, ry + 6);

      // 伤害占比条（阵营色）
      ctx.fillStyle = '#1a2231';
      roundRect(bx, ry + 13, barW, 5, 2.5);
      ctx.fill();
      if (dPct > 0) {
        var g = ctx.createLinearGradient(bx, 0, bx + barW, 0);
        g.addColorStop(0, side.color);
        g.addColorStop(1, side.light);
        ctx.fillStyle = g;
        roundRect(bx, ry + 13, Math.max(2, barW * dPct), 5, 2.5);
        ctx.fill();
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = side.light;
      ctx.font = '9.5px ui-monospace,Consolas,monospace';
      ctx.fillText(Math.round(dPct * 100) + '%', bx + innerW, ry + 15.5);

      // 承伤占比条（琥珀色）
      ctx.fillStyle = '#1a2231';
      roundRect(bx, ry + 21, barW, 5, 2.5);
      ctx.fill();
      if (tPct > 0) {
        var g2 = ctx.createLinearGradient(bx, 0, bx + barW, 0);
        g2.addColorStop(0, '#a86a2c');
        g2.addColorStop(1, '#e0a75a');
        ctx.fillStyle = g2;
        roundRect(bx, ry + 21, Math.max(2, barW * tPct), 5, 2.5);
        ctx.fill();
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = '#e0a75a';
      ctx.font = '9.5px ui-monospace,Consolas,monospace';
      ctx.fillText(Math.round(tPct * 100) + '%', bx + innerW, ry + 23.5);
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
  for (var i = 0; i < icePatches.length; i++) {
    var p = icePatches[i];
    var a = clamp(p.life / fade, 0, 1);

    ctx.globalAlpha = 0.40 * a;
    ctx.fillStyle = '#bfefff';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.72, 0, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 0.55 * a;
    ctx.strokeStyle = '#e6fbff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.72, 0, 0, TAU);
    ctx.stroke();

    // 两道冰裂纹，让残留看起来像"冰面"而不是普通圆点
    ctx.globalAlpha = 0.30 * a;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(p.x - p.r * 0.55, p.y);
    ctx.lineTo(p.x + p.r * 0.35, p.y - p.r * 0.16);
    ctx.moveTo(p.x - p.r * 0.10, p.y + p.r * 0.30);
    ctx.lineTo(p.x + p.r * 0.55, p.y + p.r * 0.04);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
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

    // 水体：中心略深、边缘透明
    var g = ctx.createRadialGradient(w.x, w.y, rr * 0.08, w.x, w.y, rr);
    g.addColorStop(0, 'rgba(38,120,168,' + (0.30 * fadeK).toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(86,178,222,' + (0.17 * fadeK).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(140,222,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w.x, w.y, rr, rr * 0.82, 0, 0, TAU);
    ctx.fill();

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

function drawUnit(u) {
  if (!u.alive) return;
  var R = u.st.rage;
  var shaking = !!R && R.phase === 'shake';

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

  // 物品自己的外观
  TYPES[u.key].draw(u);

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

  var bw = 48, bh = 5;
  var bx = u.x - bw / 2, by = u.y - u.r - 20;
  ctx.fillStyle = 'rgba(0,0,0,.65)';
  roundRect(bx - 2, by - 2, bw + 4, bh + 4, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  roundRect(bx, by, bw, bh, 2.5);
  ctx.fill();

  var hpRatio = clamp(u.hp / u.maxHp, 0, 1);
  ctx.fillStyle = u.team === 'A' ? '#ff6a55' : '#7ea6ff';
  roundRect(bx, by, bw * hpRatio, bh, 2.5);
  ctx.fill();

  // 缺氧值（水桶）：血条上方一条细条；充满后变琥珀色并脉动
  if (u.waterT > 0) {
    var ox = TYPES.bucket.water;
    var oxK = clamp(u.waterT / ox.wetThreshold, 0, 1);
    var oy = by - 10, oh = 4;
    var oxFull = oxK >= 1;

    ctx.fillStyle = 'rgba(0,0,0,.65)';
    roundRect(bx - 2, oy - 2, bw + 4, oh + 4, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(127,216,255,.16)';
    roundRect(bx, oy, bw, oh, 2);
    ctx.fill();

    ctx.fillStyle = oxFull
      ? 'rgba(255,176,80,' + (0.6 + 0.4 * Math.abs(Math.sin(t * 8))).toFixed(3) + ')'
      : '#6fd8ff';
    roundRect(bx, oy, bw * oxK, oh, 2);
    ctx.fill();
  }

  // 护盾条：统一画在血条下方（青金石狂暴护盾 / 冰块周期护盾都走这里）
  var smax = TYPES[u.key].shieldMax;
  if (smax && u.st.shield > 0) {
    var sy = by + bh + 2, sh = 3;
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


  // 血条旁的具体数值：默认贴右侧；靠近右边界时改贴左侧，避免被画布裁掉
  var hpTxt = Math.ceil(Math.max(0, u.hp)) + '/' + u.maxHp;
  ctx.font = '600 10px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'left';
  var hpX = bx + bw + 6;
  if (hpX + 42 > W) { hpX = bx - 6; ctx.textAlign = 'right'; }
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,.7)';
  ctx.strokeText(hpTxt, hpX, by + 6);
  ctx.fillStyle = u.team === 'A' ? '#ffb4aa' : '#b9cdff';
  ctx.fillText(hpTxt, hpX, by + 6);
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
    var labelY = by - 6 - (u.waterT > 0 ? 11 : 0);   // 有缺氧条时上移，避免叠字
    ctx.font = '700 10px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(label, u.x, labelY);
    ctx.fillStyle = R.phase === 'shake' ? '#ffe08a' : '#ff9c6b';
    ctx.fillText(label, u.x, labelY);
    ctx.textAlign = 'left';
  }
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
    ctx.globalAlpha = Math.min(1, fa * 1.6);
    ctx.font = '600 ' + f.size + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function render() {
  /* 后台赔率模拟（第 83 条）期间画布上显示的是赛事棋盘，这里停画：
     模拟状态和当前对局无关，绘制只会白白耗掉低端机的帧预算 */
  if (typeof oddsRunning !== 'undefined' && oddsRunning) return;

  ctx.save();
  if (shake > 0.1) {
    ctx.translate(rand(-shake, shake) * 0.6, rand(-shake, shake) * 0.6);
  }
  // 赛事击杀演出：朝击杀点放大
  if (typeof tourFx !== 'undefined' && tourFx && tourFx.zoom > 1.001) {
    var tf = tourFx.focus;
    ctx.translate(tf.x, tf.y);
    ctx.scale(tourFx.zoom, tourFx.zoom);
    ctx.translate(-tf.x, -tf.y);
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
  drawVines();        // 藤蔓压在最上层

  ctx.restore();

  var A = teamHp('A'), B = teamHp('B');
  el.hpA.style.width = (A.max ? (A.cur / A.max) * 100 : 0) + '%';
  el.hpB.style.width = (B.max ? (B.cur / B.max) * 100 : 0) + '%';
  el.timer.textContent = suddenDeath ? '决杀 ' + Math.floor(t - suddenStart) + 's' : Math.ceil(roundTime);
  el.timerLabel.textContent = suddenDeath ? '-5%/s' : 'SEC';
  el.stage.classList.toggle('sudden', suddenDeath && phase === 'fight');
  el.status.textContent = statusText();
}

