/* ============================================================
   BOSS 共用工具（js/items/boss/shared.js）
   ------------------------------------------------------------
   · 附魔叠层与伤害倍率：红青双子 / 紫晶核心共用
   · 锁血判定：一阶段双子「打到 1 血就停手」
   · drawBossBlock：所有 BOSS 的通用外观（方块 + 棱环 + 王冠）
   每个 BOSS 自己一个文件，只写自己的 TYPES 与技能；这里不出现具体 BOSS。
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
