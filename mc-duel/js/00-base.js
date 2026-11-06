/* ============================================================
   00-base.js —— 画布引用、场地常量、全局数值 BALANCE
   ------------------------------------------------------------
   加载顺序：00-base → items/* → items/pool → 10-core → 20-menu
             → 30-sim → 40-render → 50-ui
   本文件只定义常量与 canvas 引用，不产生任何副作用（除取 DOM 元素）。
   ============================================================ */
'use strict';

/* ============================================================
   运动模型
   ------------------------------------------------------------
   所有单位「匀速直线」运动：
     · 平时以各自的 baseSpeed 沿固定角度滑行，不做任何转向 / 加速
     · 撞到墙壁 → 镜面反射，速度大小不变
     · 释放技能 → 重新瞄准并进入短暂冲刺，冲刺结束回到常速
     · 与敌方相撞 → 弹性碰撞，交换法线分量后各自继续直线前进
   ============================================================ */

var cv = document.getElementById('cv');
var ctx = cv.getContext('2d');
// 逻辑分辨率：所有绘制坐标都基于 1290×600，与 DOM/CSS 缩放无关
var W = 1290, H = 600;

/* 按「实际显示像素」放大 canvas 后备存储，再整体缩放坐标系
   ------------------------------------------------------------
   canvas 的 CSS 尺寸会随窗口放大（例如 1290 → 1550），如果后备存储还是 1290，
   浏览器就把整张位图拉大，里面的字必然糊。这里让 backing store = 显示尺寸 × DPR，
   于是 1 个 canvas 像素 = 1 个设备像素，文字才是锐的。
   注意：改 cv.width/height 会重置 ctx 的全部状态，所以每次都要重新 setTransform。 */
function fitCanvas() {
  var rect = cv.getBoundingClientRect();
  var cssW = rect.width || 0;
  if (cssW < 40) return;                       // 还没布局好（或隐藏），保持原样
  var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  var bw = Math.round(cssW * dpr);
  var bh = Math.round(bw * H / W);
  if (cv.width === bw && cv.height === bh) return;
  cv.width = bw;
  cv.height = bh;
  ctx.setTransform(bw / W, 0, 0, bh / H, 0, 0);
}
fitCanvas();
window.addEventListener('resize', fitCanvas);
var TAU = Math.PI * 2;

// 场地布局（改这里就能调整整体尺寸，画布宽高与 CSS 比例要同步）
var ARENA_PAD_X = 132;   // 左右各 132 = 14 外边距 + 104 信息条 + 14 内边距
var ARENA_PAD_TOP = 76;  // 上方留给 HUD 血条
var ARENA_PAD_BOTTOM = 56;
var ARENA_FULL = { x: ARENA_PAD_X, y: ARENA_PAD_TOP, w: W - ARENA_PAD_X * 2, h: H - ARENA_PAD_TOP - ARENA_PAD_BOTTOM };
// 对局中会持续收缩的场地：x/w 每帧被读，收缩只改这两个字段
var ARENA = { x: ARENA_FULL.x, y: ARENA_FULL.y, w: ARENA_FULL.w, h: ARENA_FULL.h };
// 场地收缩：持续均匀收窄（12 px/s，左右各 6），宽度下限 420px（到下限后停止）
var SHRINK = { rate: 12, minW: 420 };

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function rand(a, b) { return a + Math.random() * (b - a); }
function rgba(hex, a) {
  var n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function angDiff(a, b) {
  var d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
function roundRect(x, y, w, h, r) {
  var k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/* ============================================================
   数值配置（唯一可调入口）
   ------------------------------------------------------------
   分三层，避免"改一个数字要翻三个函数"：
     · BALANCE —— 与具体单位无关的公式常量、全局规则
     · TYPES   —— 每个物品的完整定义：外观、血量、速度、技能、被动
     · 派生量   —— 当前速度 / 单次撞击伤害等，一律由函数实时算，
                  不写死在配置里（见 speedOf / sense / dmgOf）

   新增物品时只需要：
     1. 在 TYPES 里加一项（数值 + 钩子）
     2. 在 POOL 里加一个角色，把 key 写进单位的 units 数组（主页面会自动生成卡片）
   ============================================================ */
var BALANCE = {
  // 撞击伤害公式：dmg = (dmgBase + min(impact, impactCap) * dmgPerImpact) * 攻击方 atk * 攻击方 dmgMult
  impactMin: 30,          // 撞击速度低于此值不结算伤害（px/s）
  impactCap: 620,         // 撞击速度截断上限（px/s），防止冲刺对撞秒杀
  dmgBase: 2.2,           // 伤害基数
  dmgPerImpact: 0.05,     // 每 1 px/s 撞击速度换算的伤害
  hitCd: 0.34,            // 同一单位两次伤害结算的最小间隔（s）
  slowSpeedMul: 0.6,      // 被减速时的速度系数
  spearDashDR: 0.6,       // 长矛冲刺期间承受伤害的系数
  bondShake: 3.0,         // 羁绊：一方阵亡后，幸存者原地无敌抖动的时长（s）
  redSplash: { dmg: 9, radius: 96 },          // 红石被动：撞击时对周围敌人溅射
  lapisAura: { radius: 110, slowTime: 0.35 }  // 青金石被动：光环内敌人减速
};

/* 每个物品一个独立对象：
     · 通用字段（r / maxHp / baseSpeed / atk / 配色 / skill / passive）
     · createState() —— 该物品自己的运行时状态（挂在 u.st 上）
     · onCast(u)     —— 技能专属效果（通用转向/冲刺由 cast() 统一处理）
     · onTick(u,dt)  —— 每帧被动（青金石光环）
     · onHit(u,victim) —— 撞击命中后的被动（红石溅射）
     · onDamaged(u,dmg) —— 承受伤害修正（长矛冲刺减伤）
     · onDash(u,dt)  —— 冲刺期间的技能效果（长矛微调朝向）
     · draw(u)       —— 该物品的绘制方式
   没有用到的钩子不写，调用处会安全跳过。 */

// 物品表：由 js/items/*.js 逐条挂载（TYPES.red = {...}），这里只留空壳
var TYPES = {};

