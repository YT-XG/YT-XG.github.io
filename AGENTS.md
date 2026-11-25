# AGENTS.md — MC 方块对决（mc-duel-web）

> 仓库级 AI 协作指南。**动代码前先读完本文件**；细节见 [docs/README.md](docs/README.md)。
> 纯前端、零依赖、无构建：28 个经典 `<script>` 按顺序加载，双击 `index.html` 即可运行（不能用 ES Modules，`file://` 下会被 CORS 拦死）。
> 线上地址 <https://yt-xg.github.io/>；发布见 [docs/部署与发布.md](docs/部署与发布.md)。

## 1. 项目速览

- 玩法：台球式**匀速直线**运动，只有技能 / 撞墙才改变方向；1v1 / 2v2 / 3v3 × 同时上场 / 接力，另有赛事模式、BOSS 5v1，以及卡牌 Roguelite「秘境试炼」（90 张牌库、3 战斗席 + 6 备战席、海克斯、双试炼与双 BOSS）。
- 数据层：`BALANCE`（`js/00-base.js`，公式与全局倍率）→ `TYPES`（`js/items/*.js`，每个单位的面板与技能）→ `POOL`（`js/items/pool.js`，可选角色）→ `BOSS_ROLES`（`js/10-core.js`，BOSS 组合）。
- 文件职责见 [docs/目录结构.md](docs/目录结构.md)；内部函数与调参入口见 [docs/接口列表.md](docs/接口列表.md)。

## 2. 改数值 / 加角色的标准流程（强制）

1. **只改数据入口**：公式常量进 `js/00-base.js` 的 `BALANCE`；单位数值进 `js/items/<key>.js` 的顶层常量；不要散落在函数体里。
2. **同步 [角色技能总览](docs/模块业务逻辑/角色技能总览.md)**（角色数值的唯一口径）：
   - 面板（HP / 移速 / 攻防 / 半径 / 能量 / 羁绊）→ 改 §1 总表 + 对应角色小节；
   - 普攻 / 技能 / 终结技 / 被动 / DoT / 狂暴 → 改该角色小节的表格；
   - **新增角色** → `js/items/<key>.js` + `POOL` + `index.html` 脚本顺序 + 总览 §1 一行 + §2 新小节；
   - **新增 BOSS** → `js/items/boss/<key>.js`（共用工具放 `shared.js`）+ `BOSS_ROLES` + 总览 §3 新小节（两条血 / 全部技能 / 全部终结技 / 阶段机制都要写）；
   - **改 BOSS 数值或阶段机制** → 同步总览 §3 对应小节；转阶段伤害、终结技循环、承伤倍率都属于必须同步项；
   - 改 BOSS 承伤倍率 → 改总览 §3 开头；BOSS 出手没有整体倍率，直接改技能常量。
3. **验证**：`node --check` 全部 js；改常规数值跑 `node tools/sim.js`；改 BOSS 跑 `node tools/simboss.js --boss duo|storm`；改秘境跑 `node tools/simadventure.js`（含 `--selftest`）。
4. **口径**：总览按**代码常量**记录。`skill.text` 与常量不一致时以常量为准，并在总览 §4 登记差异。

## 3. 不可违反的红线

| # | 红线 |
|---|---|
| 1 | 不得加入追踪 / 寻路 / 操控：`u.ang` 只能由 `cast()`、撞墙、敌方弹性碰撞改变 |
| 2 | 技能 CD 好了直接放，不做距离 / 角度 / 反应试探 |
| 3 | 友军只做位置分离，不反弹、不改方向 |
| 4 | 撞击伤害属于技能：`dmgOf` 先看 `impact`；默认不给角色加撞击伤害 |
| 5 | DoT 统一走 `hurt(..., {dot:1})`，百分比伤害走 `{pct:1}`；不要在 `hurt` 外另加倍率 |
| 6 | BOSS 战不给挑战者加数值，难度只用 BOSS 血条 / 技能常量与 `BALANCE.boss` 的承伤两个倍率；BOSS 出手不再做整体缩放，舞台全程不收缩。秘境试炼是独立模式：BOSS 走 `ADV_BOSS`，不得反向影响普通 BOSS 5v1。 |
| 7 | 红青合体必须三段：锁血 → 停手 → 靠拢 → 核心 1 血登场涨血，不可跳步 |
| 8 | 保持零依赖 / 无构建：不引框架、CDN、npm、ES Modules；图片只放 `assets/` 且用相对路径 |

## 4. 常用命令

```powershell
# 语法校验（改完必跑）
Get-ChildItem js -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }

# 本地打开
Start-Process index.html

# 1v1 对位矩阵 / 单场诊断
node tools/sim.js --n 10
node tools/sim.js --probe ice,spear

# BOSS 5v1（改 BOSS 后必跑）
node tools/simboss.js --boss duo --n 8 --all
node tools/simboss.js --boss storm --n 8 --all

# 秘境试炼（真实 startBattle / 90 张牌库 / 自动升星 / 海克斯 / 双 BOSS）
node tools/simadventure.js --n 4
node tools/simadventure.js --selftest
```

不要启动常驻服务、不要安装依赖。

## 5. 新增内容放哪

| 内容 | 做法 |
|---|---|
| 角色 | `js/items/<key>.js` + `POOL` + `index.html` 脚本顺序 + 总览 |
| 技能 | 专属效果写 `onCast`；通用冲刺 / 转向仍由 `js/30-sim.js` 的 `cast()` 处理；不转向声明 `noTurn` |
| 被动 | `onTick` / `onHit` / `onAttack` / `onDamaged` / `onDash` / `onRageStart`；护盾类同时写 `shieldMax` |
| 飞行物 | 独立数组 + 每帧 update / render；命中用 `segDist`，伤害走 `hurt()` |
| 地面残留 | 独立数组 + 数量上限；减速只写 `slowT / slowMul`，不改 `ang` |
| 羁绊 | 两个物品互相写 `bond`，`rage` 里配倍率 / 穿透 / 状态文案 |
| BOSS | `js/items/boss/<key>.js` + `BOSS_ROLES` + 总览 §3；共用附魔 / 锁血工具放 `shared.js` |
| 模式 / Roguelite | `js/85-adventure.js`（`ADV_CONFIG` / `ADV_STARS` / `ADV_ENVS` / `ADV_HEXES` / `ADV_ITEMS` / `ADV_NODES` / `ADV_BOSS`）+ `css/adventure.css` + `index.html` + [秘境闯关](docs/模块业务逻辑/秘境闯关.md) |
| 画布 / 时长 | 画布改 `index.html` + `ARENA_PAD_*` + `css/style.css` 比例；时长改 `ROUND_OPTIONS` |

## 6. 文档维护

| 改动 | 更新 |
|---|---|
| 文件增删改 | [目录结构](docs/目录结构.md) |
| 运动 / 碰撞 / 出生点 | [运动与碰撞](docs/模块业务逻辑/运动与碰撞.md) |
| 数值 / 技能 / 伤害 / 胜负 / 时长 | **[角色技能总览](docs/模块业务逻辑/角色技能总览.md)**（主）+ [技能与数值](docs/模块业务逻辑/技能与数值.md)（公式与实测） |
| 绘制 / HUD / 交互 | [渲染与界面](docs/模块业务逻辑/渲染与界面.md) |
| 内部函数 | [接口列表](docs/接口列表.md) |
| 秘境 / 卡牌 / 海克斯 / 装备合成 / 双试炼 | [秘境闯关](docs/模块业务逻辑/秘境闯关.md) |
| 新文档 | 放 `docs/模块业务逻辑/`，并在 [docs/README.md](docs/README.md) 登记 |

- **不再维护按天「修改记录」**。
- 总览是角色数值的唯一口径：改数值不同步总览视为未完成。
