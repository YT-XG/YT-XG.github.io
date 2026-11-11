/* ============================================================
   45-icons.js —— 角色 / 物品图标（内联 SVG）
   ------------------------------------------------------------
   · 手机端的「物品图鉴 / 阵容格 / 对战卡 / 角色池」统一用这里的矢量图标，
     不再用「一块纯色方块」代替（第 95 条：纯色图标不好辨认）
   · 纯文本内联 SVG：不新增图片文件、不引用外链，离线双击也能用
   · 只有「野生狗奶」继续用 assets/milk.png（用户提供的贴图）
   · viewBox 统一 0 0 48 48，`width/height:100%` 由 .mi-ico 控制尺寸
   ============================================================ */
'use strict';

var ICON_SVG = {
  /* 红石块 + 青金石块：前后两个等距立方体 */
  duo:
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<g transform="translate(25 7)">' +
        '<path d="M0 5 L8 1 L16 5 L8 9 Z" fill="#8fb8ff"/>' +
        '<path d="M0 5 L8 9 L8 20 L0 16 Z" fill="#2f6fd0"/>' +
        '<path d="M16 5 L8 9 L8 20 L16 16 Z" fill="#1f4a8f"/>' +
      '</g>' +
      '<g transform="translate(6 14)">' +
        '<path d="M0 7 L12 1 L24 7 L12 13 Z" fill="#f2604a"/>' +
        '<path d="M0 7 L12 13 L12 30 L0 24 Z" fill="#c2332a"/>' +
        '<path d="M24 7 L12 13 L12 30 L24 24 Z" fill="#94231c"/>' +
      '</g>' +
    '</svg>',

  /* 长矛：木杆 + 银色矛头 + 护环 + 红色缨穗 */
  spear:
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<g transform="rotate(40 24 24)">' +
        '<rect x="22.6" y="15" width="3" height="28" rx="1.5" fill="#7a5230"/>' +
        '<rect x="23.4" y="15" width="0.9" height="28" fill="#b98a55"/>' +
        '<path d="M24 2 L28.6 9 L24 15.6 L19.4 9 Z" fill="#e6eefb"/>' +
        '<path d="M24 2 L24 15.6 L19.4 9 Z" fill="#b9c8dc"/>' +
        '<rect x="20.8" y="15.2" width="6.4" height="2.4" rx="1.2" fill="#d9c08a"/>' +
        '<path d="M21 19 Q19 22.5 20.6 26 M27 19 Q29 22.5 27.4 26" fill="none" stroke="#d94a3a" stroke-width="2" stroke-linecap="round"/>' +
      '</g>' +
    '</svg>',

  /* 弓箭：斜向拉弓搭箭（箭头朝右上，便于和弓臂区分） */
  bow:
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<g transform="rotate(-45 24 24)">' +
        '<path d="M31 7 Q13 24 31 41" fill="none" stroke="#8fe05f" stroke-width="3.4" stroke-linecap="round"/>' +
        '<path d="M31 7 L31 41" stroke="#5f8f4a" stroke-width="1.2"/>' +
        '<rect x="9" y="22.4" width="26" height="3.2" rx="1.6" fill="#e9f1fc"/>' +
        '<path d="M35 17.5 L45 24 L35 30.5 Z" fill="#e9f1fc"/>' +
        '<path d="M9 24 L14 20.4 M9 24 L14 27.6" stroke="#a9b8ca" stroke-width="2.2" stroke-linecap="round"/>' +
      '</g>' +
    '</svg>',

  /* 冰块：半透明冰立方 + 高光 + 冰晶闪点 */
  ice:
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<g transform="translate(6 13)">' +
        '<path d="M0 8 L18 0 L36 8 L18 16 Z" fill="#cdf6ff"/>' +
        '<path d="M0 8 L18 16 L18 32 L0 24 Z" fill="#78d9ec"/>' +
        '<path d="M36 8 L18 16 L18 32 L36 24 Z" fill="#369fbe"/>' +
        '<path d="M6 10.5 L18 4.5 L30 10.5" fill="none" stroke="#f4feff" stroke-width="1.4" opacity=".85"/>' +
        '<path d="M22 20 L26 22 L26 27 L22 25 Z" fill="#f4feff" opacity=".35"/>' +
      '</g>' +
      '<path d="M39 4 l1.8 -3 l1.8 3 l3 1.8 l-3 1.8 l-1.8 3 l-1.8 -3 l-3 -1.8 Z" fill="#eafcff" opacity=".9"/>' +
    '</svg>',

  /* 大狗：狗头剪影 + 激光 */
  dog:
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<path d="M13 17 L7 5 L19 11 Z" fill="#9a5a2b"/>' +
      '<path d="M35 17 L41 5 L29 11 Z" fill="#9a5a2b"/>' +
      '<path d="M24 10 C34 10 40 18 40 27 C40 36 33 42 24 42 C15 42 8 36 8 27 C8 18 14 10 24 10 Z" fill="#c98349"/>' +
      '<path d="M14 21 C18 17 30 17 34 21" fill="none" stroke="#9a5a2b" stroke-width="2" opacity=".55"/>' +
      '<circle cx="18" cy="26" r="2.6" fill="#241408"/>' +
      '<circle cx="30" cy="26" r="2.6" fill="#241408"/>' +
      '<path d="M24 29 L21.5 32.5 L26.5 32.5 Z" fill="#241408"/>' +
      '<path d="M20 34 Q24 37 28 34" fill="none" stroke="#241408" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M33 26 L47 21" stroke="#ffb765" stroke-width="2.2" stroke-linecap="round" opacity=".85"/>' +
    '</svg>',

  /* 草：草叶 + 种子 */
  grass:
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<path d="M24 42 C24 32 19 24 11 17" fill="none" stroke="#4fae4a" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M24 42 C24 30 25 22 32 13" fill="none" stroke="#93e36d" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M24 42 C24 34 28 28 37 25" fill="none" stroke="#5fbf5a" stroke-width="3.6" stroke-linecap="round"/>' +
      '<ellipse cx="24" cy="43" rx="11" ry="3.2" fill="#2e6b2b"/>' +
      '<circle cx="35" cy="35" r="3.2" fill="#d9b26a"/>' +
      '<circle cx="35" cy="35" r="1.4" fill="#8a6a33"/>' +
    '</svg>',

  /* 铁砧：左侧尖角 + 宽砧面 + 细高腰 + 宽底座（比例拉高，避免看成桌子） + 火星 */
  anvil:
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<path d="M0 15 L8 10 H34 Q38 10 38 14 V17 Q38 20 34 20 H30 V30 H36 Q38 30 38 32 V40 Q38 42 36 42 H12 Q10 42 10 40 V32 Q10 30 12 30 H18 V20 H8 Z" fill="#b3bfd2" stroke="#6c7a8f" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<path d="M8 10 H34 Q38 10 38 14 V15 H8 Z" fill="#dde6f3"/>' +
      '<path d="M0 15 L8 10 L8 15 Z" fill="#cfdaea"/>' +
      '<path d="M40 3 l1.6 -2.8 l1.6 2.8 l2.8 1.6 l-2.8 1.6 l-1.6 2.8 l-1.6 -2.8 l-2.8 -1.6 Z" fill="#ffd06a"/>' +
    '</svg>',

  /* 水桶：提手 + 桶身 + 水面 */
  bucket:
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<path d="M13 15 Q24 4 35 15" fill="none" stroke="#6fb4d6" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M11 15 L37 15 L34 40 Q34 42 31 42 L17 42 Q14 42 14 40 Z" fill="#3f86a8"/>' +
      '<path d="M11 15 L37 15 L36 21.5 L12 21.5 Z" fill="#6fc6e8"/>' +
      '<ellipse cx="24" cy="15" rx="13" ry="3.4" fill="#a9ecff"/>' +
      '<path d="M14 26 Q24 30 34 26" fill="none" stroke="#9fe6ff" stroke-width="2" opacity=".65"/>' +
      '<path d="M15 33 Q24 37 33 33" fill="none" stroke="#9fe6ff" stroke-width="2" opacity=".4"/>' +
    '</svg>'
};

function iconSvg(key) {
  return ICON_SVG[key] || '';
}

/* 战斗画布用：把同一份 SVG 变成可以 drawImage 的位图（第一次用时才创建，之后复用）。
   SVG 没有内建尺寸时 Chrome 会画成 0×0，所以补上 width/height。 */
var ICON_IMAGES = {};
function iconImage(key) {
  if (ICON_IMAGES[key]) return ICON_IMAGES[key];
  var svg = ICON_SVG[key];
  if (!svg || typeof Image === 'undefined') return null;
  var full = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" ');
  var img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(full);
  ICON_IMAGES[key] = img;
  return img;
}
