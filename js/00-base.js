/* ============================================================
   00-base.js —— 画布引用、场地常量、全局数值 BALANCE
   ------------------------------------------------------------
   加载顺序：00-base → items/* → items/pool → 10-core → 20-menu
             → 30-sim → 40-render → 50-ui
   本文件只定义常量与 canvas 引用，不产生任何副作用（除取 DOM 元素）。
   ============================================================ */
'use strict';

/* 界面显示用版本号：桌面首页与手机首页共用同一个常量 */
var APP_VERSION = 'v26.11.253';

/* ============================================================
   运动模型
   ------------------------------------------------------------
   所有单位「匀速直线」运动：
     · 平时以各自的 baseSpeed 沿固定角度滑行，不做任何转向 / 加速
     · 撞到墙壁 → 随机取一个朝场内的角度（wallBounceAngle），速度大小不变
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
   注意：改 cv.width/height 会重置 ctx 的全部状态，所以每次都要重新 setTransform。
   性能：DPR 封顶 2，并给后备存储设 3.2M 像素预算 —— 3 倍屏继续用 3 会让像素量翻倍，
   而大窗口（1920×1080 下 canvas 可到 1880 CSS 宽）在 DPR 2 时接近 6.6M 像素，
   渐变 / 文字的光栅化成本会明显拖慢低端机。 */
var MAX_DPR = 2;
var MAX_CANVAS_PIXELS = 3200000;
function fitCanvas() {
  var rect = cv.getBoundingClientRect();
  var cssW = rect.width || 0;
  if (cssW < 40) return;                       // 还没布局好（或隐藏），保持原样
  var basePixels = cssW * (cssW * H / W);
  var budgetDpr = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, basePixels));
  var dpr = Math.max(1, Math.min(MAX_DPR, budgetDpr, window.devicePixelRatio || 1));
  var bw = Math.round(cssW * dpr);
  var bh = Math.round(bw * H / W);
  if (cv.width === bw && cv.height === bh) return;
  cv.width = bw;
  cv.height = bh;
  ctx.setTransform(bw / W, 0, 0, bh / H, 0, 0);
  // 改 cv.width/height 会清空整张位图：菜单期画面是静止的（见 40-render 的 renderDirty），
  // 必须补画一帧，否则会留下白屏
  if (typeof markRenderDirty === 'function') markRenderDirty();
}
fitCanvas();
window.addEventListener('resize', fitCanvas);
var TAU = Math.PI * 2;

// 场地布局（改这里就能调整整体尺寸，画布宽高与 CSS 比例要同步）
var ARENA_PAD_X = 132;   // 左右各 132 = 14 外边距 + 104 信息条 + 14 内边距
var ARENA_PAD_TOP = 96;  // 上方留给 HUD 血条 + 阵容条
var ARENA_PAD_BOTTOM = 56;
var ARENA_FULL = { x: ARENA_PAD_X, y: ARENA_PAD_TOP, w: W - ARENA_PAD_X * 2, h: H - ARENA_PAD_TOP - ARENA_PAD_BOTTOM };
// 对局中会持续收缩的场地：x/w 每帧被读，收缩只改这两个字段
var ARENA = { x: ARENA_FULL.x, y: ARENA_FULL.y, w: ARENA_FULL.w, h: ARENA_FULL.h };
// 场地收缩：持续均匀收窄（12 px/s，左右各 6），宽度下限 420px（到下限后停止）
var SHRINK = { rate: 12, minW: 420 };

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function rand(a, b) { return a + Math.random() * (b - a); }

/* ============================================================
   可复现随机 + 固定步长
   ------------------------------------------------------------
   · 只有「影响胜负」的逻辑用 srand()；粒子/震屏等纯视觉仍用 rand()
   · seedSim(seed) 后，同一串调用顺序会得到同一串随机数
   · SIM_DT 固定为 1/60，帧率与倍速不再改变模拟步长
   ============================================================ */
var SIM_DT = 1 / 60;
var matchSeed = 0;
var simRng = null;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedSim(seed) {
  matchSeed = ((seed >>> 0) || 1) >>> 0;
  simRng = mulberry32(matchSeed);
  return matchSeed;
}

function srand(a, b) {
  return a + (simRng ? simRng() : Math.random()) * (b - a);
}

/* 字符串 → 32 位种子（每日挑战 / 幽灵码用） */
function hashSeed(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
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
  /* 固定伤害全局倍率（唯一口径）
     ------------------------------------------------------------
     生命上限整体调整（如本轮全体 ×1.6）必须同步作用于「绝对值伤害」，
     否则固定伤害角色会被相对削弱，而百分比机制（狗奶领域 7%/s、水桶 8%/s、
     决杀 5%/s）自动跟随生命上限、被动变强。
     实现位置：hurt() / hurtSeed() —— 默认所有伤害都乘这个系数；
     传 {pct:true} 的百分比伤害（凡按最大生命计算，来源或目标均可）不乘，避免二次放大。
     改生命上限时只改这一个常数，不用再翻 9 个物品文件。 */
  dmgScale: 1.6,
  // 撞击伤害公式：dmg = (dmgBase + min(impact, impactCap) * dmgPerImpact) * 攻击方 atk * 攻击方 dmgMult
  impactMin: 30,          // 撞击速度低于此值不结算伤害（px/s）
  impactCap: 620,         // 撞击速度截断上限（px/s），防止冲刺对撞秒杀
  dmgBase: 2.2,           // 伤害基数
  dmgPerImpact: 0.05,     // 每 1 px/s 撞击速度换算的伤害
  hitCd: 0.34,            // 同一单位两次伤害结算的最小间隔（s）
  /* 防御常数：减伤 = DEF / (DEF + defK)，比值式永远为正、边际递减。
     def=0 的旧角色完全不受影响；红青组合按 100 / 120 防御参与计算。 */
  defK: 400,
  slowSpeedMul: 0.6,      // 被减速时的速度系数
  spearDashDR: 0.55,      // 长矛冲刺期间承受伤害的系数
  /* 多目标收益衰减（2026-11-21 平衡重构）
     ------------------------------------------------------------
     同一次范围效果（水面 DoT / 冰面 DoT / 狗奶领域 / 大狗激光 / 种子治疗）
     命中 N 个目标时，每个目标只吃 aoeFalloff^(N-1)。
       N=1 → 100%（1v1 / 单目标完全保持原值）
       N=2 → 72% 每人（合计 144%，而不是 200%）
       N=3 → 52% 每人（合计 156%）
     目的：范围效果不再随人数线性翻倍，2v2 / 3v3 里单点角色才有生存空间。 */
  aoeFalloff: 0.72,
  /* 1v1 单挑修正表（2026-11-21 平衡重构）
     ------------------------------------------------------------
     只在「双方阵容长度都是 1」时生效，2v2 / 3v3 完全不读这张表。
     原因：1v1 与 2v2 的最优数值天然相反 ——
       · 单体爆发角色（长矛 / 弓箭 / 大狗）在单挑里全部伤害集中在一个目标上，过于高效；
       · AoE / 续航角色（草 / 冰块 / 狗奶）在单挑里没有队友可配合，机制大半失效。
     hpMul 只乘 maxHp（在 addUnit 里），dmgMul 只乘撞击伤害（在 dmgOf 里），
     两者都不影响百分比 DoT 与技能固定伤害的口径。 */
  solo: {
    hpMul: {},
    dmgMul: {},
    pctMul: {}
  },
  /* BOSS 模式（5v1，2026-11-21 第 98 条）
     ------------------------------------------------------------
     这一整块只在 BOSS 模式被读取（10-core 的 bossMode），常规对局完全不读。
     设计约定：**挑战者（玩家方）不新增任何数值修正，BOSS 出手也不做整体缩放**；
     对局难度由 BOSS 血条与各技能自身系数决定。
       · duration  —— BOSS 战专用时长（主菜单的 1/2/3/5 分钟档位不作用于该模式）
       · dmgTakeMul / pctTakeMul —— BOSS 承伤的两个总开关
       · redBomb / lapis / core —— BOSS 各自的周期技能参数
     单位血量（红青各 4550、紫晶核心 5000）写在 js/items/boss/duo.js 的 TYPES 里。 */
  boss: {
    duration: 300,        // BOSS 战专用时长（主菜单的分钟档位不作用于该模式）
    lockHp: 1,            // 红青锁血线
    /* 下面两个倍率只作用在 BOSS 承伤上，挑战者完全沿用常规数值：
       · dmgTakeMul —— BOSS 受到的固定伤害倍率（拉长 TTK）
       · pctTakeMul —— BOSS 受到的百分比伤害倍率（防止百分比机制绕过 BOSS 血量）
       BOSS 出手没有总倍率，技能系数即最终伤害。 */
    dmgTakeMul: 0.79,
    pctTakeMul: 0.20,
    redBomb: { interval: 5.0, count: 2, fuse: 1.4, radius: 100, dmg: 90 },
    lapis: { auraR: 170, shield: 150, shieldInterval: 6.0 },
    /* core：紫晶核心（二阶段）
       · shockR / shockDmg / shockInterval —— 每 7 秒一圈「紫晶冲击」
       · nukeDelay —— 合体后多少秒还没被打死就放「终末震荡」（一次性全屏震）
       · nukePct   —— 终末震荡对每个存活敌方单位扣的最大生命比例（百分比伤害）
       · nukeWarn  —— 释放前的播报 / 状态栏倒计时窗口（s） */
    core: { shockR: 360, shockDmg: 95, shockInterval: 7.0, nukeDelay: 32, nukePct: 0.70, nukeWarn: 8,
            weakDur: 10, weakMul: 0.80 },
    /* 合体演出（纯表现 + 免伤窗口，不影响平衡）：
       · mergePause —— 两只锁到 1 血后原地「停手」的时长（s）：只亮环、不动
       · mergeSlide —— 停手结束后两只滑向中点的时长（s）
       · mergeFill  —— 紫晶核心登场后血条从 1 涨到满（5000）的时长（s），期间免伤且不动 */
    mergePause: 0.55,
    mergeSlide: 0.45,
    mergeFill: 1.2
  },
  bondShake: 3.0,         // 羁绊：一方阵亡后，幸存者原地无敌抖动的时长（s）
  redSplash: { dmg: 4, radius: 96 },          // 红石被动：撞击时对周围敌人溅射
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

