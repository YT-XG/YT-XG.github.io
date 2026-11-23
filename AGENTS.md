# AGENTS.md — MC 方块对决（mc-duel-web）

> 仓库级 AI 协作指南（精简版 4 节）。**动代码前先读完本文件。**
> 细节全部拆到 [docs/](docs/README.md)：[目录结构](docs/目录结构.md)｜[内部契约](docs/接口列表.md)｜[模块业务逻辑](docs/README.md)。
> ⚠️ **本项目不是 git 仓库**（无 `.git`），`AGENTS.md` 与 `docs/` 不受版本控制，改坏了无法 `git checkout`。
> ⚠️ **2026-11-6 已从单文件拆成多文件**（`css/style.css` + `js/*.js`，共 23 个经典脚本）。
> 文中仍会出现 `index.html:行号` 形式的历史坐标——那是**拆分前**的位置，只作线索；**定位请以函数名 / 文件名**为准，文件职责见 [docs/目录结构.md](docs/目录结构.md)。

| 节 | 内容 |
|---|---|
| [1](#1-项目简介) | 项目简介 |
| [2](#2-功能与项目文件夹对应索引) | 功能与项目文件夹对应索引 |
| [3](#3-用户重点强调内容) | 用户重点强调内容 |
| [4](#4-规范) | 规范 |

---

## 1. 项目简介

一个**纯前端、零依赖**（多文件、双击即开、无构建）的 1v1 角色池原型：每个角色在 1v1 里算一个"整体"，当前角色池为 **红石块 + 青金石块（2 个单位）**、**长矛（1 个单位）**、**弓箭（1 个单位）** 、**冰块（1 个单位）**、**草（1 个单位）**、**大狗（1 个单位）**、**铁砧（1 个单位）**、**野生狗奶（1 个单位）** 与 **水桶（1 个单位）**；红方 / 蓝方都从同一个角色池选人：支持 **1v1 / 2v2 / 3v3** 三种人数 × **同时上场 / 接力** 两种上场方式（1v1 不支持接力、按钮置灰），双方阵容都可**一键随机**。红石块 / 青金石块一方阵亡后，幸存者原地无敌抖动 3 秒，随后进入「羁绊狂暴」（移速 ×3 起，并随时间继续加快）。弓箭是无羁绊的远程角色，每 3 秒发箭，第 3 发为可穿透的强化箭。冰块是无羁绊的控场 / 持续伤害角色：普攻每 **3 秒**发射 40% 攻击力的冰锥（命中回能 10）；技能每 **4 秒**在当前位置生成半径 **160** 的冰面陷阱（持续 5 秒），敌人进入后减速 30% 并每秒叠 1 层寒冷（上限 6，每层每秒 15% 施放者攻击力，离开后每秒 -1 层）；终结技为能量 100 的「极寒领域」：立刻结算一次寒冷，再给全场敌人 8 秒脆弱（受到所有类型伤害 +20%），并把整块场地切换为冰霜主题 8 秒（纯表现）；天赋每秒回能 **4**。基础移速 240 px/s，普通撞击伤害为 0。
草（2500 HP / 200 px/s）是**治疗 / 中毒**角色（2026-11-22 重做）：普攻每 **3 秒**向 **320px** 内最近敌人「捆绑」，造成**施放者生命上限 8%** 的伤害并叠 **1 层中毒**（命中回能 **5**）；中毒是层数制 DoT，每层每秒造成**施放者生命上限 0.5%** 的伤害，**上限 6 层**，**每秒结算一次并消耗 1 层**；技能冷却 **8 秒**、释放**回能 20**，在身边生成半径 **200** 的光芒持续 **4 秒**，每秒为范围内**友军（不含自己）**回复 **2% 生命上限** 并给范围内敌人叠 **1 层中毒**；终结技先为我方全体回复 **5% 生命上限**，再让自身生命上限**永久 +250**（基础 2500 的 10%，可无限叠加）。草没有羁绊、普通撞击伤害为 0；旧的种子 / 复活 / 藤蔓定身机制已不再由草使用。
大狗是**远程压制 / 团队增益**角色：普攻每 **2 秒**向前方发出汪声波（扇形 340 / 半角 0.42 rad，**70%** 攻击力，命中至少一个单位回能 10）；技能 **6 秒 CD / 回能 60**，发射一束长激光（**160%** 攻击力），并给攻击力最高的**队友** +20 攻击力 3 秒（1v1 无队友时不生效）；终结技「终极咆哮」原地引导 **5 秒**，共 **50 段**（前 20 段 5% / 中间 20 段 8% / 最后 10 段 12% 攻击力，第 50 段改为 **20% 并施加灼烧**），每段单独飘字，命中期间减速 **50%**，最后 10 段每段额外叠 5 层灼烧，光束以 1.2 rad/s 缓慢追踪；被动「厚皮」使受到的**撞击伤害** ×0.85。
铁砧（2000 HP / 200 px/s）是**延迟爆发 / 区域压制**角色（2026-11-22 重做）：普攻每 **3 秒**预判敌人走位生成半径 **120px** 的落点，**0.8 秒后**砸落造成 **125% 攻击力**，**30% 概率定身 1.5s**，命中回能 **10**；技能每 **0.32 秒**生成一个铁砧、连续生成 **8 个**（每下重新预判，各 **39.375%**，合计 **315%**），**8 个全部释放后**才开始 **8 秒**冷却，释放回能 **50**；终结技能量 100，**消耗自身一半当前生命**分裂出 **2 个**铁砧分身（生命 / 攻击 / 防御 **60%**，持续 **8s**，会放普攻与技能、不释放终结技）。落点在生成瞬间锁定、**不跟随敌人**；普通撞击伤害为 0；无羁绊 / 无狂暴。
野生狗奶（2000 HP / 200 px/s）是**全域压制 / 领域**角色（2026-11-22 重做）：**没有普攻、没有普通技能**，全部机制集中在终结技「奶狗领域」——**12 秒 CD、无条件发动**（不依赖能量），原地无敌展开领域 **12 秒**，期间**完全不可移动**，每秒对场上**所有敌方单位与召唤物**造成其**自身最大生命 7%** 的伤害（展开瞬间先结算一跳，完整 12 秒合计 **84%**）；自身获得 **500 点打断护盾**（受击先扣护盾、HP 不掉，**护盾打空立即中断**）。**冷却在领域结束后才重新读满 12 秒**（领域期间不读），自然结束与被打断都不能无缝衔接；普通撞击伤害为 0；无羁绊 / 无狂暴；是唯一使用本地贴图 `assets/milk.png` 的角色。
水桶（1800 HP / 200 px/s）是**区域控制 / 蒸发爆发**角色（2026-11-22 重做）：**普攻每 2 秒**投出一颗水滴（射程 380），命中造成 **70% 攻击力**并回能 **16**；若目标身上有**灼烧**，额外消耗 **1 层**灼烧打出「**蒸发**」，再造成 **260% 攻击力**。**技能每 10 秒**在当前位置召出一滩「**狂浪**」（半径 **230px**、**0.8 秒**扩散成型、持续 **7 秒**）：浪心产生**引力**（越靠圆心越强，圆心 300 px/s），只拖拽敌方**位置**、**不修改 `u.ang`**；敌方在浪中每 **2 秒**叠 **1 层「溺水」**（上限 **5 层**），溺水每秒按层数档位造成 **15 / 20 / 25 / 30 / 40% 攻击力**（每秒一跳、**不消耗层数**，离开浪面后仍持续）；**第 7 秒狂浪爆炸**：浪中敌方受 **170% 攻击力**并再叠 **3 层溺水**。**终结技「大浪淘」**（能量 100）展开 **6 秒**领域，**每秒拍击全场地一次**（共 6 拍，每拍 **70% 攻击力**），**最后一拍立刻结算全场敌人身上所有持续伤害**（复用 `settleDots`）。狂浪只对敌方单位生效；**贴身碰撞伤害为 0**，无羁绊 / 无狂暴。
**1v1 中**场地宽度连续匀速收缩（12 px/s）、下限 420px（约 50 秒收到底），逼双方接战；2v2 / 3v3 / 接力 / 赛事 / BOSS 战不自动收缩。对局**默认 3 分钟**，倒计时归零后进入「决杀」：全体单位**每秒扣除自身最大生命值的 5%**（草的种子也按 5% 扣，会被慢慢清掉），直到分出胜负；主菜单可在 **60 / 120 / 180 / 300 秒**四档中切换，下一局生效。每局重置时双方**出生位置与朝向随机**（各自半场内取点，朝向指向场内 ±1.0 rad）。
还有**赛事模式**：8 / 16 名选手**同权随机**抽签各自拿到 2 个角色（9 个角色不分档，从 36 个双人组合里抽，**组合全局不重复、各角色出场次数尽量均衡**），再按阵容期望强度**蛇形分组**，手动打「小组赛 BO2（积分制，**第 2 局换边**）→ 双败淘汰（胜者组 / 败者组 / 季军赛 BO3）→ 总决赛 BO5」的完整锦标赛：棋盘式赛程（抽签揭晓有逐张落位动画）、逐场点「开始」、**赛前可押注**（初始资金 1000，赔率按预测胜率）、小组赛结束自动切积分榜、进度与资金存 `localStorage`、击杀瞬间有放大 + 时缓 + 加分演出。
赔率不再只靠写死的 `TOUR_MATCHUP`：分配完成后 `js/70-tour-odds.js` 会在**后台用真实 2v2 引擎无渲染跑模拟**（分片 7ms、奇数局换边），逐场把「计算中」换成「AI n 局」的实测胜率；结果按阵容对缓存进 `localStorage`，并用「机制版本 + 数值指纹」失效。**2026-11-21 起单机选人页的预测也走同一套实时小样本模拟（`preview*`），完全不读静态矩阵**；`TOUR_MATCHUP` 只保留给「阵容期望强度 / 蛇形分组」。
> ⚠️ **数值以代码为准**：本节历史的 HP / 伤害数字（如 420 HP、80 点护盾）是 2026-11 早期版本，之后全体生命 ×1.6 并经历多轮调参；机制描述仍有效，具体数值只看 `js/00-base.js` 的 `BALANCE` 与 `js/items/*.js`，胜率看 `node tools/sim.js`。
目的不是做完整游戏，而是验证「**台球式匀速直线运动 + 只有技能/撞墙才转向**」这套玩法能不能在网页端跑通。无后端、无账号、无存档。

| 层 | 说明 |
|---|---|
| **表现层** | Canvas 2D 单画布 1290×600 逻辑分辨率，绘制场地/单位/技能/炸弹/箭矢/冰面特效（`js/40-render.js`） |
| **运动层** | 每局随机出生 + 匀速直线滑行 + 撞墙随机转向（朝场内随机角度），速度大小恒定（`js/30-sim.js`）；狂暴/无敌抖动在 `speedOf`（`js/10-core.js`） |
| **碰撞层** | 敌方等质量弹性反弹并结算伤害；友军只做位置分离、不改方向（`js/30-sim.js`） |
| **决策层** | 技能 CD 好了就直接放，**不做距离/角度/反应试探**；`think()` 只做存活/狂暴/冲刺/冷却守卫（`js/30-sim.js`） |
| **入口层** | **全屏主菜单 `#home`**（1v1 / 2v2 / 3v3 / 赛事模式 + 对局时长）→ **选人页 `#menu`**（返回主菜单条 + 红蓝对阵预览 + 角色池 + 当前方详情）（`index.html` 标记 + `js/20-menu.js`） |
| **界面层** | DOM 覆盖层：双方血条、倒计时 / **决杀时钟**、结算横幅、狂暴状态栏（`index.html` + `js/50-ui.js`） |
| **数据层** | 无网络、无持久化。数值分三层：`BALANCE`（公式常量，`js/00-base.js`）+ `TYPES`（每个物品，`js/items/*.js`）+ `POOL`（可选角色，`js/items/pool.js`）；`ROUND_OPTIONS` / `roundDuration` 在 `js/10-core.js` |
### 1.1 关键词速查

| 关键词 | 含义 |
|---|---|
| `baseSpeed` | 平时的常速（px/s）。**恒定不变**，是"直线运动"的核心 |
| `dashT` / `dashSpeed` | 技能冲刺的剩余时间与冲刺速度；`dashT<=0` 时回到 `baseSpeed` |
| `ang` | 运动方向（弧度）。**唯一能改它的地方**：`cast()`、撞墙镜面反射（±15° 噪声）、敌方弹性碰撞 |
| `cd` | 技能冷却；归零后 `think()` 先进入 0.16s 蓄力（`castT`），再把锁定的目标点交给 `cast()`；冲刺型技能贴脸（<55px）时不放 |
| `hitCd` | 撞击伤害冷却（`BALANCE.hitCd`，0.34s），防止一次接触连续掉血 |
| `dmgScale` | `BALANCE.dmgScale`（当前 **1.6**）：固定伤害的全局倍率，在 `hurt()` / `hurtSeed()` 里统一乘；传 `{pct:1}` 的百分比伤害（狗奶 / 浸水 / 决杀）不乘。**改生命上限时改这个常数，不要逐个改物品数值** |
| `u.st.shield` / `u.st.shieldT` | 护盾的吸收量与剩余时间（物品私有状态，挂在 `u.st` 上）；青金石狂暴期间用它（`shieldT` 到期清空）；冰块已不再提供护盾 |
| `speedOf(u)` | **派生的实际速度**（含冲刺 / 减速），单位没有 `speed` 字段 |
| `sense(u)` | 实时感知快照：距离、敌方速度、是否冲刺、血量比；`think()` 用它取最近敌人 |
| `POOL` / `pick` | 角色池；`pick[team]` 是该方**角色 key 数组**（长度 = `teamSize`），一个角色可以包含多个单位 |
| `teamSize` / `modeKind` | 阵容人数（1/2/3）与模式：`vs` 同时上场 / `relay` 轮流上场（`js/10-core.js`） |
| `lineupIndex` / `relayTimer` | 接力模式下该方当前第几个角色上场 / 换人读条（1.0s） |
| `deployRole(team, i)` | 让某方第 i 个角色进场（同时上场时逐次调用；接力时每换一次调用一次） |
| `countAlive` / `hasBackup` / `teamShort` | 在场单位数 / 是否还有后备角色 / 侧边信息条的短标签（接力显示「长矛 2/3」） |
| `bond` | 羁绊伙伴的 key（红石 ↔ 青金石）；一方阵亡触发另一方狂暴 |
| `rage` / `bomb` | 狂暴配置：移速倍率（×3 起，随时间 ×0.15/秒递增、上限 ×6）、可穿透敌方（只跳过位置分离与弹性反弹，伤害照常结算）、状态文案、红石炸弹参数（投弹间隔随时间从 0.4s 缩短到 0.14s，2 秒引信，爆炸半径 100 / 伤害 26）；青金石护盾每 3 秒刷新 25 |
| `u.st` | 物品私有状态：青金石狂暴护盾、红石炸弹冷却、`rage` 阶段、弓箭连发计数 `shots`、冰块普攻节奏 `basicCd` |
| `arrows` | 弓箭发射的飞行物数组：直线飞行、不反弹，出界或寿命耗尽即销毁 |
| `u.st.shots` | 弓箭连发计数：`0/1` 普通箭、`2` 强化箭，随后归零 |
| `u.faceAng` | 弓箭绘制朝向（瞄准角），只影响外观，不参与移动 |
| `noTurn` | `skill` 标记：技能不修改 `u.ang`（弓箭 / 冰块 / 草的生辉 / 水桶的狂浪） |
| `icePatches` | 冰块的贴地陷阱数组 `{x,y,r:160,life:5.0,team,owner}`；全局上限 `ICE_PATCH_MAX = 120`，超出删最早 |
| `waters` | 水桶的狂浪数组 `{x,y,r:230,age,boom,team,owner,phase}`；`life 7s` 到点爆炸 + `fade 0.45s` 残影，全场上限 `WATER_MAX = 6` |
| `spawnWave` / `waveRadius` / `updateWaves` | 狂浪寿命推进（到点调 `bucketWaveBoom`）+ 逐单位找最近敌浪 → 按 `gravity×(1-距/半径)` 拖拽**位置**（不改 `ang`）+ 每 `stackEvery` 2s 叠 1 层溺水；爆炸残影不再有引力 |
| `bucketWaveBoom` / `bucketSurfSlam` | 狂浪第 7 秒爆炸（170% + 3 层溺水）/ 大浪淘每秒全场地拍击 70%（`js/items/bucket.js`） |
| `u.drownStacks` / `u.drownAcc` / `u.drownAtk` | **溺水**层数（0–5，画在血条上方）/ 每秒结算累加器 / 施放者攻击力快照；`bucketDrownPct()` 取 15/20/25/30/40% 档位，`updateDrowns` 每秒一跳、不消耗层数 |
| `bucketDrops` | 水桶水滴飞行物 `{x,y,ang,src,target,trail}`；`updateBucketDrops` 追目标，命中调 `bucketDropImpact`（70% + 有灼烧时消耗 1 层打 260% 蒸发） |
| `seeds` | 草的种子数组 `{x,y,r:14,hp,maxHp:100,team,owner,hitCd,healAcc,flash}`；同队只留最新一颗，全场上限 `SEED_MAX = 6`；只有血量归零才消失（场地收缩改为把种子推回墙内） |
| `hurtSeed` / `destroySeed` | 种子受伤的唯一入口（无护盾/无敌，伤害计入攻击方 `dealt`）/ 血量归零时的统一碎裂表现 + 从 `seeds` 移除（`js/30-sim.js`） |
| `vines` / `reviveQueue` | 藤蔓视觉 `{x1,y1,x2,y2,life}`（只活 0.45s）/ 待复活队列 `{team,key,x,y,t}` |
| `u.st.rageHitCd` | 青金石狂暴撞击的剩余冷却（5s）：>0 时 `onAttack` 直接返回 0，状态栏会显示「冷却 N.Ns / 就绪」 |
| `tourFx` / `TOUR_KEY` | 击杀演出状态（镜头放大 + 时缓 + 加分动画）/ 赛事存档的 localStorage key `mcduel.tournament.v3` |
| `tourDealPairs(size)` / `tourAllPairs()` | 赛事抽签（**2026-11-21 第 97 条取消 A/B 档**）：9 个角色同权，从 36 个双人组合里抽 `size` 个不重复组合，贪心让各角色出场次数尽量均衡（8 人 ≈1.8 次 / 16 人 ≈3.6 次） |
| `tourRosterPower` / 蛇形分组 | 阵容期望强度 = 两角色对 8 个对手胜率平均；`tourDeal()` 按它从高到低、`0→N→N→0` 蛇形填组；组合由 `tourDealPairs()` 统一抽取，**组合全局不重复** |
| `tour.dealAnim` | 抽签动画开关：`tourDeal()` 置 true → 下一次 `renderGroups()` 给组框 / 卡片 / 徽标加 `deal` 类与 `--gseq`/`--cseq`，渲染完立即置 false（**不落存档、不随重渲染重播**） |
| `fx.sim` | 某一场的赔率样本 `{n 局数, w 玩家 a 的胜场（平局 0.5）, ok 是否达到可用局数, st 'wait'/'run'/'done'/'off'}`；**不写进 tourSave**，每局重新算 |
| `oddsRunning` / `simHeadless` | 后台模拟进行中旗标：`50-ui` 的 `frame()` 与 `40-render` 的 `render()` 都靠它让路；`simHeadless=true` 时 `finish()` 在算完胜负后直接返回，不碰横幅/赛事演出/DOM |
| `oddsFingerprint()` / `ODDS_RULES` | 缓存失效指纹：`hash(TYPES + BALANCE + POOL + roundDuration + 'r'+ODDS_RULES)`；**改了技能实现（函数体）不会被 JSON 抓到，改机制后必须手动 `ODDS_RULES++`** |
| `oddsCache` / `ODDS_KEY` | `localStorage['mcduel.odds.v1'] = {fp, pairs:{'阵容A~阵容B':{n,w}}}`；键按字典序规范化，方向翻转时 `w → n-w`；fp 不符整表清空 |
| `oddsTargetFor(count)` | 每场目标局数 = `总预算局数 / 待算场次`，夹在 `[下限, 上限]`：桌面 16~48、手机 8~24；待算场次少（如 KO 只剩 2~3 场）时自动提高样本量 |
| `ODDS_PRIOR` | 静态矩阵当先验的等价局数（6）：`tourFxPct = (w + 6·p0) / (n + 6)`，避免 4 局全胜就显示 100% / 赔率 1.05 |
| `tour.oddsOff` | 降级旗标：超预算后置 true，阻止重渲染再次触发模拟；每场结算后 / 建 KO 时清回 false，给新对局一次机会 |
| `tourFxPct(fx)` / `tourFxNote(fx)` | 赔率口径唯一入口：有 `fx.sim.ok` 用模拟值，否则回落 `tourPredict`；状态小字输出「计算中 / 计算中 n / AI n / 矩阵」 |
| `c.swap` | 本局是否换边（`c.game % 2 === 0`）：只交换 `pick.A/pick.B` 的进场阵营，`fx.a/fx.b` 仍是玩家；`winsA/winsB`、`dmgA/dmgB` **恒按玩家记**，`tourOnRoundEnd` / `tourBeginFinishFx` 里折回 |
| `teamNames` / `teamLabel` | 赛事战斗中把「红方/蓝方」换成玩家名：`tourStartGame()` 按本局实际颜色写入 `teamNames.A/B`，`openMenu()` 清空；`teamLabel(team)` 有名字用名字、否则回落 `SIDE_LABEL`。比分条 / HUD / 伤害条 / 结算横幅都读它 |
| `data-scroll` / `tourScrollSnapshot` / `tourScrollRestore` | 赛事局部滚动容器的稳定 key 与快照 / 还原：`tourRender()` 在 `innerHTML` 前后自动保存 `scrollTop/scrollLeft`（第 84 条） |
| `tourNextFixture()` / `tourPairRound` / `tourPairOrder` | 下一场小组赛的判定（轮次 → 同轮先后 → 组号）；`tourGroupPanel` / `tourNextCard` 生成排名行与对决卡 |
| `tourGroupPhaseOver()` / `ko-only` | 小组赛是否已结束（`stage='ko'/'done'` 或 `tourGroupDone()`）；为真时手机 `mobBracket()` 只渲染双败段、`.tb-bk-m` 带 `ko-only`，`bkAfterRender()` 首次切换时重置缩放（`js/60-tournament.js`） |
| `TOUR_NAMES` / `tourPickNames(count)` / `tourMakeNames(count, custom)` | 赛事选手名池（18 个）；`tourOpen()` 用 `tourMakeNames()` 定本届名单：`duelNamesGet()` 里填过的位置用自定义名，其余位置从池子**随机**取且不重名（不再固定包含某两个名字）；名字不参与抽签、分组、排名、赛程计算 |
| `BALANCE.aoeFalloff` / `aoeScale(n)` | 多目标收益衰减（2026-11-21）：同一次范围效果命中 N 个目标时每人只吃 `0.72^(N-1)`（N=1 保持原值，因此 1v1 数值不变）。接入水面 / 狗奶 / 激光 / 种子治疗四个结算点（冰块陷阱已改为逐目标叠层，不再走 `aoeScale`） |
| `BALANCE.solo` / `soloMode()` | 1v1 单挑修正表：只在双方阵容长度都是 1 时生效，`hpMul` 调生命上限（草 2.0 / 冰块 1.35 / 狗奶 1.25 / 铁砧 1.2）、`dmgMul` 调非百分比伤害（长矛 0.74 / 大狗 0.8 / 弓箭 0.86）、`pctMul` 调百分比伤害（水桶 0.78 / 狗奶 0.8）；2v2 / 3v3 完全不读 |
| `tourSyncBetUi(fx)` / `tourSelectKo(zone,ri,mi)` | 押注 / 选中节点后的**局部更新**入口：只改文字、按钮状态或 `.sel` 类与操作条，不重建 DOM，因此滚动位置与缩放平移都不丢 |
| `u.bindT` / `u.poisonStacks` | 被捆绑剩余时间（>0 时 `speedOf` 直接返回 0，只定身不改朝向）/ 中毒层数（**上限 6**）：每层每秒 `0.5% × poisonMhp`，结算一次消耗 1 层（`poisonMhp` 是施放者生命上限快照；伤害照常经过防御 / 虚弱 / 脆弱 / BOSS 承伤） |
| `u.dealt` / `u.taken` | 该单位已造成的伤害 / 已承受的伤害（承伤含被护盾吸收的部分），侧边排行条按名字合并后取占比 |
| `plantSeed` / `queueRevive` | 召唤物旧接口：种草 / 阵亡时排队在种子上复活（`js/30-sim.js`）；**草 2026-11-22 重做后已不再调用**，没有 `TYPES.grass.seed` 时 `updateSeeds` 直接跳过 |
| `u.st.ultLaserT` / `ultLaserAng` / `ultLaserElapsed` / `ultLaserN` | 大狗终结技引导剩余时间 / 光束角（1.2 rad/s 追踪）/ 已引导时间 / 已结算段数；`>0` 时 `isDogChannel` 让速度归零、不被碰撞 / 水面推动 |
| `u.atkBuffAdd` / `u.atkBuffT` | 大狗技能加攻已写入 `atk` 的数值 / 剩余时间；`tick()` 到期还原，重复获得只刷新 |
| `u.st.milkT` / `u.st.milkAcc` | 野生狗奶的领域剩余时间 / 每秒扣血累加器（初始 1.0，满 1 秒结算一次；展开瞬间额外先结算一跳）；`milkT > 0` 时 `speedOf` 返回 0、`hurt` 只扣打断护盾 |
| `TYPES.milk.drain` / `TYPES.milk.shieldMax` | 每秒扣 **7% 最大生命**、持续 **12s**（合计 84%）/ 打断护盾 **500**（打空即中断，终结技冷却重新读满 12 秒） |
| `isMilkChannel(u)` / `milkDrain(u,D)` / `interruptMilk(u)` | 是否在领域（`collide` 视为固定桩）/ 每秒遍历敌方单位与敌方种子扣血 / 护盾打空时中断并把 `u.ultCd` 重置为 `ultimate.cd`（`js/30-sim.js`） |
| `MILK_SPRITE` / `assets/milk.png` | 野生狗奶本地贴图加载器（`{img, ok}`，相对路径、离线可用）/ 本体与选人界面头像共用同一张 PNG；**其它角色仍是 Canvas 占位绘制** |
| `canCast(u)` | 物品可选钩子：返回 false 时 `think()` 跳过施放且**不消耗 CD**（野生狗奶用它声明「没有普通技能」；草已改为「冷却 8s + 释放回能 20」） |
| `SHRINK` | 场地收缩参数：`rate:12`（px/s，左右各 6）、`minW:420`；`ARENA_FULL` 保存最大尺寸；`arenaStartBox()` 按双方单位数决定开局场地（1v1 约 78% 宽 / 90% 高，3v3+ 全尺寸） |
| `updateShrink(dt)` / `resetArena()` | 每帧按 `rate*dt` 连续收窄（推回越界单位、把墙外的种子推回墙内）/ `reset()` 时按人数恢复场地 |
| `castT` / `castAim` | 技能蓄力剩余时间 / 锁定的目标点；`updateCasts(dt)` 递减，归零后 `cast()`；`drawUnit()` 画虚线预警 |
| `ultimate` / `onUlt` / `u.ultCd` | 每个物品的终结技声明（`{name,cd,text}`）与专属效果 / 独立于普通技能的充能剩余（初始 `srand(5,9)`，蓄力 `u.ultT` 0.4s）；金色充能环 + 「终结技 · 名字」飘字 |
| `startUltChain` / `updateUltChains` | 连刺链（长矛五连贯穿）：每段冲刺结束后按 `interval` 重新锁定最近敌人，段数由 `count` 控制 |
| `spawnUltBeam` / `ultBeams` | 瞬发光束（大狗长激光 / 长矛地裂等）：一次性结算沿途敌人 + 敌方种子；`ultBeams` 还承载 `kind:'bark'` 声波与 `kind:'phantom'` 分身等纯视觉 |
| `MAX_DPR` / `MAX_CANVAS_PIXELS` / `RENDER_SPRITE` | 渲染性能：后备存储 DPR 封顶 2、总像素预算 3.2M；单位光晕 / 底盘 / 水面用离屏贴图缓存，避免每帧新建渐变 |
| `syncHud()` / `hudFrame` | HUD 降频：血条 / 倒计时 / 状态栏 / 阵容条 ~10Hz 刷新，值不变不写 DOM |
| `seriesBest` / `seriesWins` / `seriesGame` | 单机赛制：1=单局、3=三局两胜；当前系列赛比分与局数；`continueSeries()` 开下一局 |
| `showResult` / `hideResult` / `continueSeries` | 赛后面板（MVP / 总伤害 / 结束方式 / 系列赛比分）；`continueSeries()` 保留比分只重置战场 |
| `rosterRefs` / `rebuildRoster` / `updateRoster` | 战斗 HUD 的双方阵容条：单位名、血条、状态字（终/蓄/狂/抖/导/定/毒/水/盾） |
| `sfxPlay` / `sfxToggle` / `sfxSync` | WebAudio 合成音效（撞击/施法/死亡/炸弹/狂暴/胜负）与本地静音开关 `mcduel.sfx.v1` |
| `draftMode` / `draftOrder` / `draftStep` | 征召模式：双方轮流选人、角色全局不可重复；`draftOrder` 是 `{team,slot}` 序列，最多 4v4（角色池 9 个只够 8 个不重复） |
| `setDraftMode` / `draftPickRole` / `roleOwner` / `lineupsComplete` | 开启征召（会清空双方阵容）/ 按当前轮次写入并校验角色是否已被选走 / 查角色归属 / 双方每个格子都合法才允许开战 |
| `SIM_DT` / `simAcc` / `tick(SIM_DT)` | 固定步长 1/60；`frame()` 用累加器把真实时间换成固定 tick，帧率/倍速不再改变胜负 |
| `seedSim` / `srand` / `matchSeed` | 可复现随机：`reset()` 先 `seedSim()`，出生点/CD/撞墙噪声用 `srand()`；粒子/震屏仍用 `rand()`，不消耗模拟随机流 |
| `setNextSeed(seed, source)` / `matchSource` | 每日挑战/幽灵挑战写入待用种子与来源（`'daily'`/`'ghost'`）；普通局 `reset()` 用随机种子，所有局都走固定步长，分享出去的幽灵链接可逐 tick 复现 |
| `dailyConfig` / `startDaily` / `dailyRecordGet` | 按本地日期生成固定种子 + 固定 2v2 阵容（2 分钟）；完成后写 `localStorage['mcduel.daily.v1']` |
| `ghostUrl` / `readGhostLink` / `startReplay` / `applyGhost` | 幽灵码：URL 携带 `ghost=1&seed&size&mode&dur&a&b`；打开后先弹邀请层，点「开始观看」再 `startReplay()` |
| `showGhostInvite` / `hideGhostInvite` / `copyText` | 幽灵邀请层与复制链接（`navigator.clipboard` 失败时回退 textarea） |
| `mobiIsPortrait` / `mobiSyncOrientation` | 竖屏不提供纵向布局 / 手机界面，只盖 `#rotateTip`「请使用横屏游玩」遮罩（不可关闭）；同步提示显隐并清掉旧 portrait 状态，横屏回来由 `mobiOnResize` 恢复 |
| `portraitCam` / `updatePortraitCamera` | 旧竖屏战斗镜头（已停用：不再挂载 `body.portrait`，函数保留为死代码，类不出现即自动跳过） |
| `u.coldStacks` / `u.coldAcc` / `u.coldOn` | 寒冷层数（0–6）/ 每秒结算累加器 / 是否站在敌方陷阱上；进入立即 +1 层，离开后每秒 -1 层，归零前持续结算 |
| `u.vulnT` / `u.vulnMul` | 脆弱剩余时间 / 受到所有类型伤害的倍率（冰块终结技写入 8s、×1.2；`hurt()` 统一读取） |
| `u.st.domainT` | 极寒领域剩余时间（8s，与脆弱同长）；只供 `drawIceDomain()` 切换整块场地主题，不参与模拟 |
| `u.slowMul` | 本次减速系数：青金石 0.6 / 冰块陷阱 0.7；`slowT <= 0` 时恢复 `BALANCE.slowSpeedMul` |
| `TYPES[key].shieldMax` | 护盾条分母（青金石 25 / 野生狗奶 **500（打断护盾）**）；没有这个字段的单位不画护盾条（冰块已移除护盾） |
| `passiveOnly` | `skill` 标记：纯被动、无主动施放；当前无物品使用（冰块已改为主动技能） |
| `SPAWN` | 随机出生参数：`margin 70` / `gap 46` / `faceSpread 1.0` / `tries 80`（`index.html:967`） |
| `roundDuration` / `ROUND_OPTIONS` | 当前对局时长（默认 180s）与可选档位 `[60,120,180,300]`（`index.html:773-774`） |
| `suddenDeath` / `deathAcc` / `DEATH_DRAIN` | 决杀开始标记 / 扣血累加器 / 每秒扣血比例 5%（`index.html:776-777`、`index.html:1637-1654`） |
| `onCast` / `onTick` / `onHit` / `onAttack` / `onDamaged` / `onDash` / `onRageStart` | 物品技能/被动/狂暴钩子，调用处缺失时安全跳过 |
| 红石 / 青金石 `onAttack` | **常规模式普通撞击伤害为 0**；只有 `dashT > 0`（技能冲刺期间）才结算伤害（`index.html:437-440`、`index.html:501-506`） |
| `bossMode` / `bossRoleKey` / `BOSS_ROLES` | BOSS 模式开关 / 当前 BOSS 组合 key（`duo`）/ 组合表（`units: ['bossred','bosslapis']`、`merged: 'bosscore'`）（`js/10-core.js`） |
| `bossMerged` / `bossMergeAct` / `bossMergeFx` | 是否已合体 / **合体前「停手 + 靠拢」阶段** `{a,b,ax,ay,bx,by,mx,my,t,pause,move,dur}` / 合体瞬间的残影白闪演出（`js/10-core.js` + `js/40-render.js`） |
| `BALANCE.boss` | BOSS 战唯一调参入口：`duration 300` / `lockHp 1` / `dmgTakeMul 0.60`（BOSS 承伤）/ `pctTakeMul 0.20`（BOSS 抗百分比）/ `dmgMul 0.62`（BOSS 出手）/ `mergePause 0.55` + `mergeSlide 0.45` + `mergeFill 1.2`（合体演出）/ `redBomb` / `lapis` / `core`（含 `nukeDelay 24` / `nukePct 0.50` / `nukeWarn 8`）（`js/00-base.js`） |
| 一阶段锁血停手 | `bossLock` 单位打到 `lockHp` 后：`speedOf()` 返回 0、`think()` 直接 return、`bossred/bosslapis.onTick` 也停（不投弹 / 不刷盾 / 不发光环），但**仍在场**等另一只锁血 |
| `u.st.nukeT` / `coreNuke(u)` | 紫晶核心的「终末震荡」倒计时（`onRageStart` 置为 `nukeDelay`，最后 `nukeWarn` 秒状态栏读秒）/ 释放时全屏一震：所有存活敌方单位与敌方种子 `hurt(maxHp×nukePct,{pct:1})`，每局一次 |
| `boss` / `bossImmune` / `bossLock` / `rageCasts` | `addUnit` 打上的 BOSS 标记：BOSS 本体 / 免疫控制（定身 / 减速 / 引力 / 光环）/ 锁血（伤害最多扣到 `lockHp`）/ 狂暴后仍施放技能（`js/10-core.js`、`js/30-sim.js`） |
| `deployBoss(team)` / `bossConfig()` / `isBossUnit(u)` | BOSS 方进场（右半场中线上下错开 62px）/ 取当前组合配置 / 是否是 BOSS 单位 |
| `updateBossMerge(dt)` / `completeBossMerge()` | 两段式合体：锁血判定 → `bossMergeAct` 停手靠拢 → 生成 `bosscore`（`hp = 1` + `st.mergeFill` 充能涨血，期间免伤且不动）（`js/30-sim.js`） |
| `u.st.mergeFill` / `mergeFillRate` / `u.st.appear` | 核心血条充能剩余时间与每秒涨血量（1.2s 内 1 → 2000）/ 核心浮现放大计时 |
| `drawBossCharge()` / `drawBossMerge()` / `drawBossBlock()` | 停顿蓄能球 + 能量丝 + 充能进度环 / 残影白闪紫环 / BOSS 方块外观（`js/40-render.js`、`js/items/boss/shared.js`） |
| 舞台收缩 | `updateShrink()` **在 `bossMode` 下直接 return**、`resetArena()` 固定 `ARENA_FULL`（BOSS 战整局不收缩） |

### 1.2 仓库构成

- `index.html`（骨架 + HUD 标记）、`css/style.css`（桌面）、`css/mobile.css`（手机紧凑布局 + 竖屏横屏提示遮罩）、`css/mobi.css`（手机横屏 1024×512 独立界面）、`js/*.js`（23 个经典脚本，含 `js/25-field.js` 的场地环境与 `js/45-icons.js` 的内联 SVG 角色图标）、`js/items/*.js`（10 个常规物品）、`js/items/boss/`（按 BOSS 拆文件：`shared.js` 共用工具、`duo.js` 红青三形态、`storm.js` 雷云巨像）、`assets/milk.png`（野生狗奶贴图，唯一的图片资源；本体与选人界面头像共用，本地相对路径、离线可用）、`preview.png`（截图，不参与运行）、`tools/sim.js` / `tools/sim2v2.js` / `tools/simboss.js`（无头模拟：1v1 / 2v2 / BOSS 5v1）。
- 仓库根目录有 `.git`；`AGENTS.md` 与 `docs/` 目前未纳入版本控制，作为本地参考文档。
- 没有子仓库、没有 package.json、没有构建产物、没有打包步骤。
- ⚠️ **拆成多文件后仍可双击打开**：用的是经典 `<script src>`，不是 ES Modules（`type="module"` 在 `file://` 下会被 CORS 拦截）。

**手机端**：竖屏只显示「请使用横屏游玩」提示遮罩（不提供可玩界面）；横屏走 1024×512 手机画布；没有触屏走位，手机上是"看比赛"。

**线上地址**：<https://yt-xg.github.io/>（仓库 `YT-XG/YT-XG.github.io`，游戏在根目录，原生日页已改名为 `wishes.html` 保留）。发布流程见 [docs/部署与发布.md](docs/部署与发布.md)。

完整目录与"改 X 去哪"见 **[docs/目录结构.md](docs/目录结构.md)**。

### 1.3 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 语言 | 原生 JavaScript（ES5 写法：`var` + `function`，IIFE 包裹） | 无构建、无转译 |
| 渲染 | Canvas 2D API + `requestAnimationFrame` | 浏览器内置 |
| 页面 | 原生 HTML + 外链 CSS（`css/style.css`，无预处理器） | — |
| 组织 | 23 个**经典脚本**按固定顺序加载（`js/00-base.js` → `80-mobi.js`），共享顶层作用域 | 无模块系统 |
| 依赖 | **无**（无 `package.json` / `node_modules` / CDN 引用） | — |

> ⚠️ 本项目**没有 `package.json`**，因此任何"版本号"都无处可对；唯一的外部要求是浏览器支持 Canvas 2D。

### 1.4 常用命令

```powershell
# ---- 语法校验：每个 js 各查一遍（唯一可自动化的一步，无需任何依赖）----
Get-ChildItem js -Recurse -Filter *.js | ForEach-Object {
  node --check $_.FullName
  if ($LASTEXITCODE -ne 0) { "FAIL $($_.Name)" }
}

# ---- 本地打开 ----
Start-Process index.html

# ---- 无头对位矩阵（改数值后必须跑，别再临时写脚本）----
node tools/sim.js --n 10            # 9×9，每个对位双向各 10 局
node tools/sim.js --probe ice,spear # 单场诊断：双方 HP / 已造成伤害 / 场上实体

# ---- BOSS 战 5v1 模拟（改 BALANCE.boss 或 BOSS 技能后必须跑）----
node tools/simboss.js --n 8 --team duo,spear,bow,ice,grass   # 指定挑战者阵容
node tools/simboss.js --n 8 --all                            # 13 套阵容综合胜率
node tools/simboss.js --n 8 --dmg 0.62 --all                 # 临时覆盖 BOSS 出手倍率
node tools/simboss.js --n 8 --nuke 24 --all                  # 临时覆盖终末震荡倒计时
```

⚠️ **改完必须跑语法校验**；不要启动常驻服务（本项目也不需要），不要安装任何依赖。

### 1.5 环境配置入口

**没有配置文件、没有环境变量、没有密钥。** 接手第一件事：`js/00-base.js`（`BALANCE` 公式常量）→ `js/items/*.js`（每个物品的全部数值与技能）→ `js/items/pool.js`（角色池）→ `js/10-core.js`（`ROUND_OPTIONS` / `SPAWN`）。所有可调数值、物品技能、箭矢 / 冰面参数、可选角色与时长档位都在这几处。

---

## 2. 功能与项目文件夹对应索引

### 2.1 功能 → 代码位置 → 详细文档

| 功能 | 逻辑代码 | 界面代码 | 详细文档 |
|---|---|---|---|
| **随机出生 + 初始朝向** | `js/10-core.js`（`spawnSide` / `faceInward` / `SPAWN`） | — | [运动与碰撞](docs/模块业务逻辑/运动与碰撞.md) |
| **匀速直线运动 + 撞墙随机转向** | `js/30-sim.js`（`move` / `wallBounceAngle`） | `js/40-render.js`（速度尾迹） | [运动与碰撞](docs/模块业务逻辑/运动与碰撞.md) |
| **敌方弹性碰撞 / 友军位置分离** | `js/30-sim.js`（`collide`） | — | [运动与碰撞](docs/模块业务逻辑/运动与碰撞.md) |
| **伤害、护盾、减速结算** | `js/30-sim.js`（`hurt` / `dmgOf` / `speedOf`） | `js/40-render.js`（飘字/血条/护盾条） | [技能与数值](docs/模块业务逻辑/技能与数值.md) |
| **七个物品的技能（含冰块突进、草的捆绑 / 生辉、大狗激光）** | `js/items/red.js`…`dog.js` 的 `skill` / 钩子 + `js/30-sim.js`（`cast` / `think`） | `js/40-render.js`（冷却环） | [技能与数值](docs/模块业务逻辑/技能与数值.md) |
| **铁砧落点 / 野生狗奶领域** | `js/items/anvil.js`、`js/items/milk.js`、`js/30-sim.js`（`updateAnvilMarks` / `milkDrain` / `interruptMilk`）、`js/10-core.js`（`speedOf` 领域分支） | `js/40-render.js`（`drawAnvilMarks` / `drawAnvilDrops` / `drawMilk` / `drawMilkLinks`） | [技能与数值 §2.9/§2.10](docs/模块业务逻辑/技能与数值.md) |
| **野生狗奶贴图（`assets/milk.png`）** | `js/items/milk.js`（`MILK_SPRITE`）、`js/items/pool.js`（`img` 字段） | `js/20-menu.js`（选人界面头像）、`js/40-render.js`（`drawMilk`） | [渲染与界面](docs/模块业务逻辑/渲染与界面.md) |
| **水桶：水滴蒸发 / 狂浪溺水 / 大浪淘** | `js/items/bucket.js`（数值 + `bucketApplyDrown` / `bucketWaveBoom` / `bucketSurfSlam` / `bucketDropImpact`）、`js/30-sim.js`（`spawnWave` / `waveRadius` / `updateWaves` / `updateDrowns`）、`js/10-core.js`（`waters` / `WATER_MAX` / `drownStacks`） | `js/40-render.js`（`drawBucket` / `drawWaters` / `drawSurfWaves` / `drawSurfSpray` / `drawBucketDrops` / 溺水环） | [技能与数值 §2.11](docs/模块业务逻辑/技能与数值.md) |
| **弓箭箭矢：飞行、命中、强化穿透、出界销毁** | `js/30-sim.js`（`updateArrows`） | `js/40-render.js`（`drawArrows`） | [运动与碰撞](docs/模块业务逻辑/运动与碰撞.md) |
| **冰面陷阱：生成、减速 30%、寒冷叠层 DoT、脆弱** | `js/items/ice.js`、`js/30-sim.js`（`dropIceTrap` / `updateIcePatches` / `hurt`） | `js/40-render.js`（`drawIcePatches` / `drawArrows` / 寒冷条） | [技能与数值](docs/模块业务逻辑/技能与数值.md) |
| **大狗：汪声波 / 长激光 / 50 段终结激光 / 队友加攻** | `js/items/dog.js`（`dogBark` / `onCast` / `dogUltLaserTick`）、`js/30-sim.js`（`laserStrike` / `isDogChannel` / `atkBuffT`）、`js/10-core.js`（`speedOf`） | `js/40-render.js`（`drawDog` / `drawLasers` / `drawDogBark`） | [技能与数值 §2.8](docs/模块业务逻辑/技能与数值.md) |
| **草的捆绑 / 生辉光环 / 中毒叠层** | `js/items/grass.js`（数值与 `grassBind` / `grassAuraPulse` / `grassApplyPoison` / `updatePoisons` / `onCast` / `onTick` / `canCast`）、`js/30-sim.js`（`updatePoisons` 调用点）、`js/items/spear.js`（地裂瞬间结算中毒） | `js/40-render.js`（`drawGrass` / `drawGrassAuras` / `drawVines` / 中毒绿泡与层数） | [技能与数值 §2.6](docs/模块业务逻辑/技能与数值.md) |
| **护盾（青金石 25/3s、狗奶打断护盾）** | `js/items/lapis.js`、`js/items/milk.js`、`js/30-sim.js` | `js/40-render.js`（血条下护盾条） | [技能与数值](docs/模块业务逻辑/技能与数值.md) |
| **羁绊狂暴 / 红石炸弹** | `js/30-sim.js`（`startRage` / `updateRage` / `updateBombs`） | `js/40-render.js`（光环/文字/炸弹） | [技能与数值](docs/模块业务逻辑/技能与数值.md) |
| **回合判定 / 决杀 / 结算横幅** | `js/30-sim.js`（`finish` / `deathStrike`） | `js/50-ui.js`（横幅与时钟文案） | [技能与数值](docs/模块业务逻辑/技能与数值.md) |
| **对局时长档位（60/120/180/300s）** | `js/10-core.js`（`ROUND_OPTIONS`）、`js/50-ui.js`（`buildRoundPick`） | `index.html`（`#roundPick`） | [渲染与界面](docs/模块业务逻辑/渲染与界面.md) |
| **主菜单（1v1/2v2/3v3/赛事入口）** | `js/20-menu.js`（`buildHome` / `enterPick` / `openMenu`） | `index.html`（`#home`）、`css/style.css`（`.home`） | [渲染与界面](docs/模块业务逻辑/渲染与界面.md) |
| **主页面：三栏角色池选人** | `js/20-menu.js`（`buildMenu` / `detailHtml` / `syncPick`） | `index.html`（`.menu` 标记） | [渲染与界面](docs/模块业务逻辑/渲染与界面.md) |
| **对战模式 / 多角色阵容 / 一键随机** | `js/20-menu.js`（`buildModePick` / `setSize` / `randomTeam` / `syncPick`）、`js/10-core.js`（`pick` / `teamSize` / `modeKind` / `deployRole`） | `index.html`（`#modePick` / `#diceA` / `#diceB` / `#btnRandom`） | [渲染与界面](docs/模块业务逻辑/渲染与界面.md)、[技能与数值](docs/模块业务逻辑/技能与数值.md) |
| **两侧伤害 / 承伤排行条** | `js/30-sim.js`（`hurt` 里累加 `u.taken`）、`js/10-core.js`（`addUnit` 初始化 `dealt` / `taken`） | `js/40-render.js`（`drawDamagePanels`） | [渲染与界面](docs/模块业务逻辑/渲染与界面.md) |
| **场地 / 物品 / 箭矢 / 冰面 / 炸弹 / 特效绘制** | — | `js/40-render.js`（全部 `draw*`） | [渲染与界面](docs/模块业务逻辑/渲染与界面.md) |
| **赛事模式：8/16 人锦标赛（平衡抽签 → 小组赛 BO2 → 淘汰赛 BO3 → 决赛 BO5）** | `js/60-tournament.js`（`tourDeal` / `tourBuild` / `tourNextMatch` / `tourOnRoundEnd` / `tourAdvanceBracket`）、`js/30-sim.js`（`finish` 里转交） | `js/60-tournament.js`（`tourRender`）、`index.html`（`#tourPanel` / `#btnTour` / `#tourSize`）、`css/style.css`（`.tb-band` + `tbDeal*` 动画） | [渲染与界面](docs/模块业务逻辑/渲染与界面.md)、[技能与数值](docs/模块业务逻辑/技能与数值.md) |
| **赔率后台模拟（2v2 无渲染、分片、换边、缓存、降级）** | `js/70-tour-odds.js`（`tourOddsKick` / `tourOddsStop` / `oddsCollect` / `oddsPump` / `oddsStart` / `oddsDegrade` / `oddsFingerprint`）、`js/60-tournament.js`（`tourFxPct` / `tourFxNote`）、`js/30-sim.js`（`finish` 的 `simHeadless` 早退） | 赔率处 `data-prob` 由 `oddsPaint` 局部改写文案（`renderGroups` / `koCard` / `koActBar` / `renderBattleStrip`） | [渲染与界面 §9.2](docs/模块业务逻辑/渲染与界面.md)、[接口列表 §32](docs/接口列表.md) |
| **交互（重开/暂停/加速/主菜单）** | `js/50-ui.js`（`togglePause` / 键鼠绑定） | `index.html`（按钮） | [渲染与界面](docs/模块业务逻辑/渲染与界面.md) |
| **BOSS 模式 5v1（红青双子 / 雷云巨像）** | `js/items/boss/`（`shared.js` 共用工具 + `duo.js` 红青三形态 + `storm.js` 双血雷云巨像）、`js/00-base.js`（`BALANCE.boss`）、`js/10-core.js`（`BOSS_ROLES` / `bossPhase` / `deployBoss`）、`js/30-sim.js`（`hurt` 三层倍率 / `bossLock` / `onLethal` / `phaseShift` / `updateBossMerge`）、`tools/simboss.js`（无头模拟，`--boss` 选择 BOSS） | `js/20-menu.js`（`enterBossPick` / `renderBossCard` / `bossDetailHtml`）、`js/50-ui.js`（`bossCry` / 结算 BOSS 阶段）、`js/40-render.js`（`drawBossCharge` / `drawBossMerge`） | [技能与数值 §6.17](docs/模块业务逻辑/技能与数值.md) |
### 2.2 文档索引与新增文档放置规则

> 总索引见 **[docs/README.md](docs/README.md)**（新增/修改文档时**必须登记**）。

| 分类 | 文档 | 用途 |
|---|---|---|
| `docs/README.md` | ⭐ 总索引 | 文档总入口、阅读顺序、维护规则 |
| `docs/目录结构.md` | 目录结构 | 文件职责 + "改 X 去哪" |
| `docs/接口列表.md` | 内部契约 | **无网络接口**；登记内部函数签名 + 调参入口 |
| `docs/模块业务逻辑/` | 模块文档 | 运动与碰撞 / 技能与数值 / 渲染与界面 / 角色技能总览 |
| `docs/部署与发布.md` | 部署 | GitHub Pages 线上结构、发布流程、排错 |
| `docs/<YYYY-M-D>修改记录.md` | 当日改动 | 按天记录（§4.6 模式 A） |

**新增文档放置规则（AI 生成文件必须遵守）：**

1. 属于已有模块 → 直接写进 `docs/模块业务逻辑/<对应模块>.md`，**不要为一个小改动新建文件**。
2. 确实需要新主题（如"移植到 Three.js 的方案"）→ 在 `docs/模块业务逻辑/` 下新建一份，并在 `docs/README.md` 登记。
3. **禁止在 `dist/`、源码同级或任何子目录里另建文档**；本项目全部文档只在 `docs/`（唯一例外是根目录本文件）。
4. 新增、重命名或移动文档后 → 同步 `docs/README.md` 与本表，并修正所有相对链接。

---

## 3. 用户重点强调内容

### 3.1 需求方重点强调的业务目标

1. **验证可行性**优先于"做完整游戏"：这是一个能跑的原型，不是可上线产品。
2. **运动模型是硬要求**：所有单位**匀速直线运动**，**只有释放技能、撞到墙壁才改变运动方向**（2026-11-6 用户明确纠正过一次，见 §3.4）。
3. **每个物品都要有自己的一套技能**，且技能效果要能一眼看出来。
4. **红石块 + 青金石块是一个整体**：在 1v1 里算 1 个角色；一方阵亡后，另一方必须原地无敌抖动 3 秒并进入狂暴（移速 ×3 起、随时间继续加快，2026-11-6 新增）。
5. **1v1 指角色数 1v1**：红方 / 蓝方都从同一个角色池 `POOL` 各选 1 个角色，而不是从固定阵容列表里取。
6. **冰块是"控场 + 续航"角色**：经过留冰面（5 秒后淡出）→ 敌人踩冰减速 + **每秒掉 15 血**；自身**仅在 HP < 50% 最大生命时**每 5 秒刷新 **10** 点护盾（刷新覆盖、不叠加；不超时消失，只被伤害消耗），护盾条显示在血条下；每 5 秒沿当前运动方向突进一次（**不转向**），基础移速 240 px/s。它和弓箭一样没有羁绊，不做 `bond` / `rage`。
7. **对局默认 3 分钟，时间到打「决杀」**：倒计时归零不直接结算，改为全体单位每秒扣 `最大生命 × 5%`，直到一方全灭；主菜单可选 60 / 120 / 180 / 300 秒档位，切换后下一局生效。
8. **每局出生点 + 初始朝向随机**：双方在各自半场随机取点，不贴墙、同队不重叠；朝向指向场内并 ±1.0 rad 随机。
9. **对战模式 = 人数 + 上场方式两个开关**（2026-11-6 新增，同日从"四个模式按钮"改为两维设置）：
   - **人数**：1v1 / 2v2 / 3v3（每方选 N 个角色）
   - **上场方式**：同时上场 / 接力（**1v1 时接力按钮置灰不可用**）
   - 同时上场 = 该方全部角色的所有单位一起进场；接力 = 一次只上一个角色，其全部单位阵亡后 1.0s 放下一名，**胜者保留血量/护盾/冷却**继续打
   - 红蓝双方都支持**一键随机**阵容（单边 `#diceA` / `#diceB`，或 `#btnRandom` 双方一起）
10. **只有 1v1 会自动收缩场地**：12 px/s（左右各 6），宽度下限 420px；2v2 / 3v3 / 接力 / 赛事 / BOSS 均不自动收缩。决杀扣血**包含种子**。场地会随机刷新食物（10 种增益）、局部危险区域（岩浆 / 毒沼 / 霜冻 / 雷区 / 泥沼 / 荆棘）与全场天气（7 种 debuff），见 `js/25-field.js`。
11. **草（2026-11-22 重做）**：2500 HP；普攻 3 秒一次「捆绑」（施放者生命上限 8% + 1 层中毒，命中回能 5）；技能 8 秒冷却、释放回能 20、光环持续 4 秒（友军每秒回 2% 生命上限，**不含自己**；敌人每秒 +1 层中毒）；终结技全体回 5% 生命上限 + 自身生命上限永久 +250（可无限叠加）。旧的种子 / 复活 / 藤蔓定身已移除。
12. **大狗**：普攻 2 秒一次的汪声波（扇形 70%），技能 6 秒 / 回能 60 的长激光（160%）并给队友 +20 攻击，终结技原地 5 秒、50 段激光（2% / 4% / 6%，最后 10 段叠灼烧）；被动厚皮只减撞击伤害。
13. **赛事模式**：8 / 16 人选，**9 个角色同权随机抽 2 个**（组合全局不重复、各角色出场次数尽量均衡；2026-11-21 第 97 条取消 A/B 档），按阵容期望强度**蛇形分组**；**小组赛 BO2（积分制，第 2 局换边）→ 双败（胜者组/败者组/季军赛）→ 总决赛 BO5**；带竞猜（初始 1000，赔率按预测胜率），可倍速观战；抽签/落位有揭晓动画（尊重 `prefers-reduced-motion`）。
14. **野生狗奶**（2026-11-22 重做）：**没有普攻、没有普通技能**；终结技「奶狗领域」**12 秒 CD、无条件发动**（不依赖能量），原地无敌展开领域 **12 秒**，期间**完全不可移动**；场上**所有敌方单位与召唤物**每秒扣其**自身最大生命 7%**（展开瞬间先结算一跳，完整 12 秒合计 **84%**）；身上显示 **500 点打断护盾**，**护盾打空立即中断**。**冷却在领域结束后才重新读满 12 秒**（`onUlt` 把 `u.ultCd` 清零，自然结束 / 被打断才设为 12），**不能无缝衔接**；普通撞击伤害为 0；角色贴图使用用户提供的图片（`assets/milk.png`），**本体与选人界面头像共用**。
15. **草的中毒是层数制 DoT**（2026-11-22）：每层每秒造成**施放者生命上限 0.5%** 的伤害，**上限 6 层**，结算一次消耗 1 层；捆绑 +1 层、光环每秒 +1 层。伤害走 `hurt(...,{dot:1})`，因此会被目标防御、虚弱、脆弱与 BOSS 承伤倍率影响。旧种子系统（`seeds` / `plantSeed` / 复活队列）仍保留在核心里供召唤物机制使用，但**草已不再种植种子**。
16. **赔率必须能跟上机制变化**（2026-11-7 第 83 条）：分配完成后**后台用真实 2v2 引擎无渲染跑模拟**（每场样本按待算场次分摊：桌面 16~48 局、手机 8~24 局；奇数局换边抵消出生侧偏差），逐场替换写死的 `TOUR_MATCHUP`；**计算期间给「计算中」占位、算完一场更新一场**；结果按阵容对缓存并用「`ODDS_RULES` + 数值指纹」失效；**超时/低端机自动回落静态矩阵**；押注始终可用（用当前最优估计的赔率）。
17. **押注不能跳回顶部 / 小组赛只展示下一场**（2026-11-8 第 84 条）：
   - 押注、选中赛程节点、赔率数字更新**都不整块重建 DOM**：押注只调 `tourSyncBetUi()` 改文字与按钮，选中只调 `tourSelectKo()` 切类并重写操作条；确需整块重绘的路径由 `tourRender()` 统一做 `data-scroll` 快照 / 还原。
   - 小组赛页改成「**下一场对决**（吸顶）+ **各组排名**」：每组只列名字 / 两个角色 / 胜-负 / 积分；不再铺开全部 vs 卡；押注只针对下一场。
   - 下一场判定：**轮次 → 同轮先后 → 组号**（R1 `(0,1)(2,3)`、R2 `(0,2)(1,3)`、R3 `(0,3)(1,2)`，各组交错），8 人 12 场 / 16 人 24 场不重不漏。
   - 双败赛程图、积分榜、结算屏与手机双指缩放 / 拖动平移全部保持原样。
18. **主菜单 + 选人页改版**（2026-11-8 第 85 条）：
   - 进入游戏先看到**主菜单 `#home`**：1v1 / 2v2 / 3v3 / 赛事模式四张入口卡 + 底部对局时长；1v1/2v2/3v3 点击后 `enterPick(size)` 进选人页。
   - 选人页顶部有「← 主菜单」与当前模式；**人数由主菜单决定**，页内只保留「上场方式（同时 / 接力）」。
   - 手机端信息顺序：对阵预览 → 上场方式 + **整行开始按钮** → 角色池 → 当前编辑方详情（另一侧详情隐藏）；桌面保持三栏（左详情 / 中选人 / 右详情）+ 底部角色池。
   - **3v3 由核心真实支持**：`pick[team]` 是变长数组，`reset()` 按长度逐个 `deployRole()`；出生点挤不下时 `spawnSide()` 会排环；HUD 血条按全队聚合、伤害条按角色名合并，接力按 `lineupIndex` 推进，无需额外槽位改动。
   - **小组赛结束后手机赛程图收起小组赛段**（2026-11-8 第 87 条）：`tourGroupPhaseOver()`（`stage='ko'/'done'` 或小组赛全部打完）为真时 `mobBracket()` 不再渲染 `.tb-bk-sec.grp`（连标题），只留双败合并段；8 人 / 16 人同一分支，淘汰赛进行中与结束后都只显示双败图；桌面 `bracketSvg()` 不动。
19. **赛事选手名单扩到 18 人**（2026-11-8 第 88 条，2026-11-11 第 94 条改为全随机）：`TOUR_NAMES` = 原 16 个 + **兮眠 / 西瓜**，共 18 个；`tourOpen()` 用 `tourMakeNames()` 定本届名单——**自定义姓名优先，其余全部随机**（不重名、不再固定包含某两个）；名字不参与任何规则计算，抽签、蛇形分组、排名与赛程完全同权。
20. **新增角色「水桶」+ 缺氧值**（2026-11-9 第 89 条）：每 **8 秒**在当前位置放出一滩水（半径 **220px**、**0.9 秒**从圆心扩散成型），水持续 **6 秒**、再用 **2 秒**淡出，**淡出途中引力与伤害仍然生效，直到完全消失**（CD 8s = 6+2）；水面向圆心有**引力**且**越靠近圆心越大**（边缘 0 → 圆心 320 px/s），只拖拽敌方位置、不改 `u.ang`；敌方**头顶显示缺氧值**，约 **4 秒**充满，充满后每秒扣 **8% 最大生命**；离开水面按 **0.35/s** 缓慢回落（约 11 秒清空）；水只对敌方单位生效，无羁绊 / 无狂暴。（原「赛事 B 档」划分已随 2026-11-21 第 97 条取消，9 个角色同权抽签）。
21. **BOSS 模式 5v1**（2026-11-21 第 98/99 条）：主菜单第 4 张卡进入，红方 **5 个角色** vs 蓝方 **1 个 BOSS**（先做「红青双子」，`BOSS_ROLES.duo`）。红 / 青各 **3000 HP**、`bossLock` 锁 1 血、`bossImmune` 免疫一切控制；**其中一只被打到 1 血就原地停手（不移动、不攻击、不投弹），等另一只也到 1 血** → 停手 0.55s → 靠拢 0.45s → 合体成紫色「紫晶核心」（`bosscore`，**800 HP**，`rageCasts`），核心以 **1 HP** 登场并在 **1.2s** 内把血条涨到 800（期间免伤），随后狂暴：移速 ×2.6 起、沿途投弹、撞击伤害叠到 +70；**合体后 24 秒还没被打死 → 终末震荡**：全屏一震，敌方每个存活单位（含种子）扣 **50% 最大生命**（每局一次）。**挑战者不做任何数值加成**，难度只用 `BALANCE.boss` 的 `dmgTakeMul 0.60` / `pctTakeMul 0.20` / `dmgMul 0.62`；**BOSS 战舞台整局不收缩**（全尺寸）；BOSS 战时长固定 300s，不看主菜单分钟档位。数值用 `node tools/simboss.js --all` 回归。
22. **铁砧重做**（2026-11-22）：普攻 3s 预判落砧 125% + 30% 定身 1.5s + 命中回能 10；技能每 0.32s 生成一个铁砧、共 8 个（每下重新预判、各 39.375%，合计 315%），**8 个全部释放后**才开始 8s CD，释放回能 50；终结技能量 100，消耗自身一半当前生命分裂 2 个 60% 数值的分身 8 秒（分身会放普攻 / 技能，不释放终结技）；落点位置生成后不跟随，普通撞击伤害为 0。数值经 82.8%→55.7%→51.0% 三轮调整。

### 3.2 反复强调的开发红线

| # | 重点强调 | 为什么 |
|---|---|---|
| 1 | **不得给单位加"追着敌人跑"的操控**（转向、加速、减速、寻路） | 一旦加 Steering，玩法立刻变成追逐战，与参考视频不符。证据：`move()` 里除了技能冲刺（`index.html:1460-1471`）和撞墙随机转向（`index.html:1450-1474`），没有任何地方改 `u.ang`；弓箭与冰块的技能都声明 `noTurn` |
| 2 | **技能是唯一主动转向手段** | `index.html:1383` 的 `cast()` 是全项目唯一"主动"改 `ang` 的函数；弓箭与冰块的技能声明 `noTurn`，连主动转向都不做（弓箭只改 `u.faceAng`，冰块只加速不改方向） |
| 3 | **改数值必须跑模拟再下结论** | 平衡对 HP 极度敏感：长矛 330→380 之间胜负会整体翻转，详见 [技能与数值 §6](docs/模块业务逻辑/技能与数值.md) |
| 4 | **友军不反弹**（同队单位只做位置分离） | `index.html:1497-1507` 的分离逻辑。这是刻意的：友军互撞会破坏"只有技能和墙才转向"的规则 |
| 5 | **狂暴的定身/提速是用户指定的机制，不是 Steering** | 3 秒原地抖动 + 随时间递增的倍率提速在 `speedOf`（`index.html:720-735`）与 `startRage`（`index.html:1148`）里完成，**仍然不改方向** |
| 6 | **技能 CD 归零就直接放** | 不做距离/角度/反应试探；也**不再有"防僵局重置 CD"**。`think()` 只做守卫（`index.html:1401-1412`） |
| 7 | **冰面陷阱 / 寒冷是"地面效果"，不是 Steering** | 只写 `slowT` / `slowMul` 与 `coldStacks`，**不改 `u.ang`、不改位置**；`updateIcePatches()` 只做判定与 `hurt()`（`js/30-sim.js`） |
| 8 | **冰块突进不改方向** | `skill.noTurn = true`，`cast()` 只设置 `dashT / dashSpeed`；不要在 `onCast` 里写 `u.ang`，也不要把突进做成"朝敌人冲刺"（`index.html:615-619`） |
| 9 | **撞击是技能，不是通用出伤**（2026-11-21 用户口径） | `dmgOf`（`js/10-core.js`）第一行就拦：`TYPES[attacker.key].impact` 为假直接返回 0。只有 `spear / red / lapis / milk` 声明了 `impact: true`，且都是"技能期间"才有伤害（长矛/红/青=冲刺或狂暴、狗奶=引导结束的收汁冲撞）。**不要再给弓箭 / 冰块 / 大狗 / 草 / 铁砧 / 水桶加默认撞击伤害**；`hurtSeed` 里"冲刺撞种子"的伤害也因此只对这几个角色生效 |
| 10 | **DoT 数值可调，但走统一口径** | 冰面 / 激光 / 中毒 / 缺氧都用 `hurt(..., {dot:1})` 或 `{pct:1}`，固定值会被 `dmgScale` 放大、百分比不会被放大；改数只改 `js/items/*.js` 里的 `dot / dotPct / pctPerStack`，不要在 `hurt` 里另加倍率 |
| 11 | **BOSS 战不给挑战者加任何数值**（2026-11-21 用户明确要求） | 挑战者沿用常规数值，难度只用 `BALANCE.boss` 的三个倍率（`dmgTakeMul` / `pctTakeMul` / `dmgMul`）压；**不要**再引入 `playerHpMul` 之类按角色维护的 BOSS 战数值表——以后每加一个角色都得跟着维护 |
| 12 | **BOSS 战舞台不收缩** | `updateShrink()` 在 `bossMode` 下直接 return，`resetArena()` 固定 `ARENA_FULL`；把收缩逻辑搬回去会让 5v1 在大约 50 秒被挤进 420px，走位空间消失 |
| 13 | **合体必须分三段，且不可跳步** | 锁血 → **停手**（`mergePause`，速度归零 + 免伤 + 清冲刺/蓄力）→ **靠拢**（`mergeSlide`，位置插值）→ 核心以 `hp = 1` 进场并 `mergeFill` 涨到 2000；合体期间 `hurt` 直接免伤，不要让"瞬间移除两只 + 核心满血"这种写法回潮 |

### 3.3 最该先修的 N 个问题

| # | 问题 | 位置 | 后果 |
|---|---|---|---|
| 1 | 长矛的**视觉长度（96px 杆 + 矛头）远大于碰撞半径 30** | `index.html:1887` vs `index.html:546` | 看起来戳到了其实没判定，玩家会认为"打空了" |
| 2 | 友军相撞**没有反馈**（只做位置分离） | `index.html:1497-1507` | 红石与青金石交错时会被"推开"但不改方向，观感像没碰到；且轨迹被轻微扰动，不是数学意义上的严格直线 |
| 3 | 无移动端操作 | `index.html:2371-2404` | 手机上只能看不能玩（按钮可用，但无触屏走位/技能） |
| 4 | 无音效 | 全文件无 `Audio` | 撞击、破盾、炸弹缺少听觉反馈，冲击力打折扣 |
| 5 | 数值全部硬编码 | `index.html:383-667` | 换角色/调平衡只能改源码，无法在游戏内配 |
| 6 | **狂暴分支的强度不对称** | `index.html:422-434`、`index.html:490-497`、`index.html:437-440` | 当前对位整体接近五五开，但自然局中红石狂暴偏弱（约 25% 翻盘）、青金石狂暴偏强（约 57% 翻盘）；需要继续观察后再决定是否调参 |
| 7 | **弓箭 2.5s 一发，空箭/箭出界时该窗口无输出** | `index.html:582-586`、`index.html:1266-1298` | 可能出现"只跑不打"的时段；当前模拟对位约 56–57%，仍在可接受范围 |
| 8 | 🟢 **冰块单方向 0% / 100% 极端**（已修复） | `index.html:967-992` | 第 43 条改为随机出生后，三个对位两方向差仅 3–4 个百分点 |
| 9 | 🟡 **冰块对长矛已从 81.7% 降到 46.4%（第 44 条）** | `index.html:626-631`、`index.html:646-662` | 移速 300→240 + 半血以下才刷 10 护盾后，对长矛 46.4%、红青 46.0%、**弓箭 0%**（双向）。长矛压制已消除，但对弓箭被完全压制，是否需要回调见 [技能与数值 §6.6](docs/模块业务逻辑/技能与数值.md) |

### 3.4 最容易看错/记反的几点

- **`ang` 是"运动方向"**，不是"面朝敌人的朝向"。`cos(ang)`/`sin(ang)` 直接乘速度就是位移方向。
- **撞墙后方向随机，但一定朝场内**：`wallBounceAngle(hx, hy)` 根据撞到的墙面随机取角度（左墙 `-π/2~π/2`、右墙 `π/2~3π/2`、上墙 `0~π`、下墙 `π~2π`，角落取对应内角象限）；不再使用固定镜面反射，避免一直沿对角线路循环（`index.html:1115-1163`）。
- **弹性碰撞的符号**：`rel = (vb - va)·n`，应用时 **a 用 `+rel`、b 用 `-rel`**（`index.html:1127`、`index.html:1132-1133`）。写反的后果不是"弹得不对"，而是两个物体撞完**继续朝对方前进**、黏在一起持续掉血（2026-11-6 已踩过一次，见修改记录）。
- **伤害归属**：`da` 是"a 承受的伤害"，所以乘的是 **b** 的 `dmgMult` 和 `atk`（`index.html:1152-1153`）。
- **冲刺减伤 0.6 只有长矛有，且只在 `dashT>0` 期间生效**（`dmgOf()` 调用 `TYPES.spear.onDamaged`，`index.html:589-596`、`index.html:521-523`）。
- **A / B 只是内部阵营**：A = 红方，B = 蓝方，由 `addUnit()` 的 `team` 参数决定；角色由 `POOL` + `pick`（`index.html:530-551`、`index.html:609`）决定（`index.html:752-771`、`index.html:782-808`）。
- **护盾只吸收伤害，不改方向**（`index.html:901-911`）；常规模式下青金石不再提供护盾，护盾只在狂暴期间每 3 秒刷新 25。
- **羁绊狂暴不是 Steering**：3 秒抖动期间 `speedOf` 返回 0、`hurt` 直接返回（无敌）；结束后从 ×3 开始、按 `rage.speedRampPerSec`（0.15/秒，上限 ×6）继续提速，方向仍然不改（`index.html:597-611`、`index.html:935-966`）。
- **红石 / 青金石常规模式普通碰撞伤害为 0**，只有技能冲刺期间才有伤害；红石狂暴后**可穿透敌方**、撞击伤害仍为 0，只靠炸弹（爆炸半径 100 / 伤害 26）；青金石狂暴期间不再放技能，撞击伤害 = 基础 + 每秒 10 点（**额外伤害上限 +100**），**命中后有 5 秒冷却**（CD 未好时撞击无伤害），且每 3 秒刷新 25 护盾（`index.html:423-427`、`index.html:486-521`）。
- **红石狂暴的「穿透」只跳过位置分离与弹性反弹**：`collide()` 仍计算 `rel / impact` 并走伤害结算，所以长矛冲刺可以正常打到红石；不再因为穿透而免疫伤害。
- **长矛突刺距离**：`dashTime 0.42s × 880 px/s ≈ 370px`（原 0.40s / 352px）；该参数对胜率高度敏感，0.43s 即可能把长矛胜率推到 60% 以上，调参必须重跑模拟。
- **长矛普通撞击伤害为 0**：`TYPES.spear.onAttack` 只在 `dashT > 0`（技能冲刺期间）返回伤害（`index.html:546`）。
- **弓箭的 `faceAng` 与 `ang` 是两回事**：`faceAng` 只给 `drawBow()` 用（瞄准朝向），箭矢沿它发射；`u.ang` 仍是运动方向，发箭不改它（`skill.noTurn`）。
- **箭矢不反弹**：直线飞行，命中/飞出 `ARENA` 外 24px / 寿命 0.95s 用尽即销毁（`index.html:1220-1252`）。
- **强化箭的"穿透"与红石狂暴的"穿透"不是一回事**：强化箭只对每个敌人结算一次（`a.hit` 去重）并继续飞；红石狂暴是跳过位置分离与弹性反弹、伤害照常。
- **弓箭普通撞击伤害恒为 0**（`TYPES.bow.onAttack` 返回 0），伤害只来自箭（普通 48 / 强化 66）。
- **弓箭没有 `bond` / `rage`**：阵亡不会触发任何狂暴；角色详情面板也不显示狂暴段落。
- **弓箭连发计数放 `u.st.shots`**：`0/1` 普通箭、`2` 强化箭，随后归零；不要改成全局变量。
- **冰块没有 `bond` / `rage`**：阵亡不触发任何狂暴；角色详情面板也不显示狂暴段落。
- **冰块普通撞击伤害恒为 0**（`impact: false`），伤害只来自冰锥、寒冷 DoT 与脆弱易伤。
- **冰块普攻是冰锥**：`onTick` 每 3.0s 发一支 `kind:'iceshard'` 箭，40% 攻击力、命中回能 10；不是近身脉冲。
- **冰块技能是地面陷阱**：`skill.cd = 4.0`、`noTurn: true`、`dashTime = 0`；`onCast` 在当前位置调用 `dropIceTrap()`，不改 `u.ang`、不冲刺。
- **冰面陷阱减速只改速度大小**：写 `slowT` / `slowMul`（0.7），由 `speedOf()` 派生，方向仍只由 `ang` 决定；不要改成操控或改方向。
- **寒冷 DoT 是"陷阱叠层 + 逐秒结算"**：进入立即 +1 层，此后每满 1 秒 +1（上限 6）；每层每秒 `0.15 × 施放者 atk`；离开后每满 1 秒 -1 层，层数归零前伤害继续。不是"站上去每帧掉血"。
- **脆弱是承伤倍率**：冰块终结技给全场敌人写 `vulnT = 8s`、`vulnMul = 1.2`；`hurt()` 在防御减伤前统一乘，DoT 也吃这层加成；多次领域只刷新时间、不叠乘。
- **护盾条是通用判断**：`drawUnit()` 读 `TYPES[key].shieldMax`（青金石 25 / 狗奶 500），没有该字段的单位不画；不要再写死青金石。
- **`passiveOnly` 当前没有物品使用**：冰块已改为主动技能；`think()` 仍保留该守卫，留给未来的纯被动角色。
- **决杀扣血绕过护盾与无敌抖动**：`deathStrike()` 直接 `hp -= maxHp × 0.05`，不走 `hurt()`；目的是保证时间到后一定能推进，不会因为护盾/抖动卡住（`index.html:1605-1623`）。
- **出生点随机不是 Steering**：`spawnSide()` / `faceInward()` 只在 `reset()` 执行一次，局中不改方向；不要把它扩展成"每帧朝敌人重定向"。
- **狂暴前红石块与青金石块属性一致**：都是 200 HP / 200 px/s / atk 1.0 / r 24（`index.html:410`、`index.html:477`）；狂暴后移速都从 ×3 开始且同样随时间加快。
- **技能 CD 好了直接放**：`think()` 只检查"活着 / 没狂暴 / 没在冲刺 / CD > 0"，通过就立即 `cast()`；**没有 AI 距离/角度/反应阈值，也没有防僵局重置 CD**（`index.html:1401-1412`）。
- **野生狗奶领域期间不可移动，但不是 Steering**：`milkT > 0` 时 `speedOf()` 直接返回 0（`js/10-core.js`）；`collide()` 用 `isMilkChannel()` 把她当**固定桩**（不被位置分离推动、也不改对方的 `ang`）。场地收缩仍会把她推进场内。
- **领域期间受击先扣打断护盾**：`hurt()` 里 `u.st.milkT > 0` 时只扣 `u.st.shield`（HP 不掉、无视其他护盾规则），护盾 **500** 打空立即 `interruptMilk()`；**中断后 `u.ultCd = 12`（重新读满终结技 CD），不会立刻再展开**。
- **冷却在领域结束后才开始读**：`onUlt` 把 `u.ultCd = 0`，领域期间不读 CD；自然结束时 `onTick` 设 `u.ultCd = 12`，护盾打空时 `interruptMilk()` 同样设为 12。**两种情况都不能无缝衔接**。
- **百分比扣血走 `hurt()`**：因此会**吃护盾**、**计入 `dealt / taken`**、能触发死亡与羁绊；敌方种子（召唤物）走 `hurtSeed()`（无护盾/无敌，但**伤害计入攻击方 `dealt`**）。决杀 `deathStrike()` 不走 `hurt()`，领域施放者照样每秒掉 5%。
- **种子不再被"踩碎"**：`updateSeeds()` 里只有 `dashT > 0` 的敌方**技能冲刺**才会伤到种子；普通贴身接触完全不掉血。旧常量 `SEED_HIT_DMG / SEED_HIT_CD` 已删除，改成 `TYPES.grass.seed.hitCd`（0.35s）。
- **种子受伤统一走 `hurtSeed()`**：它没有护盾、没有无敌，`hp` 归零才 `destroySeed()`（碎裂 + 从 `seeds` 删除）。箭矢（`updateArrows`）、激光（`laserStrike`）、铁砧（`updateAnvilMarks`，只吃溅射、不会顶掉单位的全额伤害）、炸弹（`updateBombs`）、冰面（`updateIcePatches`）、狗奶（`milkDrain`）、种子冲刺（`updateSeeds`）都必须走这个入口。
- **种子治疗是"每满 1 秒"结算**：`healAcc` 累加到 1.0 时给 `healRadius`（200px）内同级单位 +5 HP（**不含种子自己**）；同队同屏只有一颗种子，**不存在多颗叠加**；草自己也能被治疗。
- **场地收缩不再压碎种子**：`updateShrink()` 改为把 `x` 夹回新墙内（只有血量归零才消失）。
- **种子不会自动再生**：被摧毁或被复活消耗后，只能等生花 CD（20s）到点、且 `canCast` 通过（场上无种子 + 复活次数 < 2）才重新种。
- **完整 12 秒合计 84%**：展开瞬间 + 之后 11 次每秒结算，共 12 跳 × 7% = 84%；叠加上「领域期间 HP 无敌」，单次完整领域是绝对优势，强度主要靠 500 点护盾与 12 秒 CD 调节。
- **护盾是"越大越强"**（反直觉）：打断护盾是**保护领域施放者**的，护盾越大越难被打断。要削弱狗奶应**减小 `shieldMax`**，而不是加大。当前平衡值为 **500**（初版按需求 70 实现时 1v1 仅 1.6%，500 时 45.3%）。
- **狗奶贴图与其它角色**：`MILK_SPRITE.ok` 为 true 时 `drawMilk()` 用 `assets/milk.png`（`cos(u.ang)<0` 水平翻转、底部对齐圆心），失败退化为纯色剪影；选人界面 `POOL` 项有 `img` 字段就用 `<img class="ps-img">`，**其它角色都没有 `img`，仍是 Canvas 占位绘制**。
- **换边只换进场阵营，不换玩家**：`c.swap = (c.game % 2 === 0)`，`tourStartGame()` 里把 `pick.A/pick.B` 的 roles 对调；`c.fx.a` / `c.fx.b` 始终是玩家，`winsA/winsB`、`dmgA/dmgB`、`fx.score` 也**恒按玩家**记 —— `tourOnRoundEnd()` 与 `tourBeginFinishFx()` 里必须先把本局红蓝方折回 a/b，否则第 2 局会记反。
- **底部比分条的左右必须是本局颜色**（第 86 条）：`renderBattleStrip` 里 `redP = c.swap ? fx.b : fx.a`、`blueP` 取反，`redW/blueW` 同步翻转，换边局的「系统预测」百分比也要 `100-p`；不要再直接写 `fx.a.name` + `winsA` 的顺序。
- **抽签不分档**（2026-11-21 第 97 条）：平衡重构后 9 个角色综合胜率已拉平（2v2 48%~51%、1v1 44%~56%），A/B 档失去意义，`tourDealPairs()` 从 36 个双人组合里抽、**组合全局不重复**、各角色出场次数尽量均衡；`tourDeal()` 再按阵容强度蛇形分组。
- **后台模拟跑的是真实 2v2 引擎，不是 1v1 矩阵**：它临时接管 `units / pick / ARENA` 等全局，跑完由 `oddsRestore()` 还原快照。因此**任何会重置或改写这些全局的入口（`startBattle` / `openMenu` / `tourStartGame` / `tourDeal` / `tourOpen` / `tourClose`）都必须先调 `tourOddsStop()`**，否则模拟会和真实对局互相踩。
- **后台模拟期间不能渲染**：`frame()` 靠 `paused + oddsRunning` 双保险不 tick，`render()` 直接早退；`finish()` 在 `simHeadless` 时算完胜负就返回，**不会弹横幅、不触发赛事演出**。
- **`fx.sim.w` 恒为玩家 a 的胜场**：缓存键按阵容字典序规范化，方向翻转时用 `n - w` 折算；平局记 0.5。写反会让镜像阵容的赔率整段倒挂。
- **`ODDS_RULES` 是手动版本号**：`oddsFingerprint` 用 `JSON.stringify` 抓 `TYPES/BALANCE/POOL`，**函数体改动抓不到**；改了技能实现必须 `ODDS_RULES++`，否则旧缓存（旧机制跑出来的胜率）会一直命中。
- **`tour.oddsOff` 只挡"重渲染后又重跑"的循环**：超预算降级后置 true；**每场结算后与 `tourBuildKO()` 会清回 false**，让新对局再试一次；不要把它当成"永久禁用"。

---

## 4. 规范

### 4.1 硬性要求

1. **改完必须做语法校验**：命令见 §1.4（`node --check`）。**不要启动服务、不要装依赖。**
2. **每次改代码必须写变更记录**：追加到当天的 `docs/<YYYY-M-D>修改记录.md`（模式 A，见 §4.6）。**强制。**
3. **需求模糊必须先问用户**，不要自己加玩法（尤其是任何"让它更聪明地追人"的改动，见 §3.2 红线 1）。
4. **改代码必须同步改文档**（见 §4.5）。
5. **保持零依赖、无构建**：不引入构建工具、框架、CDN、npm 包，也不要把经典脚本换成 ES Modules（`file://` 下会被 CORS 拦死，双击就废了）。
6. **不改 `preview.png` 之外的二进制/截图**；图片资源只允许放 `assets/`（当前仅野生狗奶的 `assets/milk.png`），且必须是**本地相对路径、不得引用外链**（保证离线双击可用）。

### 4.2 注释规范

- 中文注释，与现有风格一致（`/* ===== 分节 ===== */` + 行内 `//`）。
- 注释解释**为什么**，不重复代码：例如 `index.html:564-571` 那句"突刺期间允许极小幅度的追踪（仍属技能效果）"就是在解释这条转向为何不违反红线。
- 新增物理/数值逻辑时，把单位和符号写清楚（谁减谁、乘谁）。

### 4.3 分层与命名（新增内容照抄）

| 场景 | 做法 |
|---|---|
| **新增一个物品** | ① 新建 `js/items/<key>.js`，写 `TYPES.<key> = { ... }`；② 在 `js/items/pool.js` 的 `POOL` 里加/改一项（`units` 数组决定该角色由哪几个物品组成）；③ 在 `index.html` 的脚本列表里加一行 `<script src="js/items/<key>.js"></script>`（必须在 `pool.js` 之前） |
| 新增技能 | 技能专属效果写进该物品的 `onCast`；通用转向/冲刺仍由 `js/30-sim.js` 的 `cast()` 统一处理；CD 归零后 `think()` 会立即施放；远程/不转向技能声明 `noTurn: true`；纯被动声明 `passiveOnly: true`（`think()` 直接跳过） |
| 新增被动 | 用物品钩子：`onTick`（每帧状态）、`onHit`（撞击命中）、`onAttack`（攻击伤害修正）、`onDamaged`（承受伤害修正）、`onDash`（冲刺期间效果）、`onRageStart`（狂暴开始）；护盾类物品同时在 `TYPES[key]` 写 `shieldMax` 让护盾条生效 |
| 新增飞行物 | 独立数组（如 `arrows`）+ 每帧 `update` + `render` 插层；命中用 `segDist` 做连续帧判定，伤害走 `hurt()`；出界/超时销毁、不反弹；穿透对同目标用 `hit` 数组去重 |
| 新增地面残留 | 独立数组（如 `icePatches`）+ 每帧 `update` + `render` 紧跟 `drawArena()`；**必须有数量上限**（如 `ICE_PATCH_MAX = 120`）；减速只写 `slowT / slowMul`，持续伤害用累计计时 + `hurt()`，**不改 `ang`** |
| 新增羁绊 | 在两个物品上互相写 `bond`，并在 `TYPES[key].rage` 里配置 `speedMul`（×3 起）/ `speedRampPerSec` / `speedMulCap` / `passThrough` / `status` / 专属参数；通用 3 秒无敌抖动由 `startRage` / `updateRage` 处理 |
| 新增特效 | 只用三个原语：`burst()` / `ring()` / `floater()`（`js/30-sim.js`） |
| 新增可调参数 | 公式常量进 `js/00-base.js` 的 `BALANCE`；物品参数进对应 `js/items/<key>.js`（含 `skill` / `passive` / `rage` / `arrow` / `trap` / `shieldMax`）；出生范围进 `js/10-core.js` 的 `SPAWN`；对局时长进同文件的 `ROUND_OPTIONS`；不要散落在函数体里 |
| **新增角色贴图** | 图片放 `assets/`（本地相对路径）；在物品文件里用 `new Image()` 加载并维护 `{img, ok}` 状态，绘制时 `ok=false` 必须退化到 Canvas 剪影；选人界面头像在 `POOL` 项加 `img` 字段即可（`js/20-menu.js` 会自动换成 `<img>`） |
| 改画布尺寸 | 三处联动：`index.html` 的 `<canvas width height>`、`js/00-base.js` 的 `ARENA_PAD_*`、`css/style.css` 里 `.app` 的宽高比系数（当前 2.15） |
| 改出生点 | 只改 `SPAWN` 与 `spawnSide()`；随机只发生在 `reset()`，局中**不得**重定向 |
| 改对局时长 / 决杀 | 改 `ROUND_OPTIONS` / `roundDuration` / `DEATH_DRAIN`；同步 `buildRoundPick()`、`statusText()`、`render()` 时钟文案 |

### 4.4 统一响应与错误码

**不适用**：本项目没有任何网络请求、没有接口、没有后端。HUD 文案直接写在 `index.html:239-250`。

### 4.5 文档同步规范（强制）

| 变更类型 | 必须更新 |
|---|---|
| 新增/删除/重命名文件 | `docs/目录结构.md` |
| 改动运动/碰撞/反弹公式 | `docs/模块业务逻辑/运动与碰撞.md`（含箭矢飞行/命中/销毁） |
| 改动数值、技能、伤害公式、胜负判定、对局时长、决杀 | `docs/模块业务逻辑/技能与数值.md`（含 §6 平衡实测、弓箭 §6.4、冰块 §6.5） |
| 改动冰面 / 护盾 / 减速 / 持续伤害 | `docs/模块业务逻辑/技能与数值.md`（冰面数值）+ `docs/模块业务逻辑/运动与碰撞.md`（减速与判定） |
| 改动绘制顺序、HUD、交互、护盾条、冰面绘制 | `docs/模块业务逻辑/渲染与界面.md` |
| 新增/修改内部函数 | `docs/接口列表.md` |
| **任何代码改动** | **当天的 `docs/<YYYY-M-D>修改记录.md`（强制，见 §4.6）** |

### 4.6 变更记录（每次改代码必写）

本项目采用 **模式 A｜按天修改记录**。

| 规则 | 说明 |
|---|---|
| 文件命名 | `docs/YYYY-M-D修改记录.md`，日期**不补零**（例：`docs/2026-11-6修改记录.md`） |
| 同一天多次改动 | **追加到同一个文件**，不新建、不覆盖已有条目 |
| 跨天 | 新建当天日期的文件 |
| 必记内容 | ① 每个被改动的文件 ② 改动一句话 ③ 改动原因 ④ 验证命令与结果（未验证必须写"未验证"） |
| 只改文档时 | 也建议记一条，标注"仅文档改动" |

```markdown
# <YYYY-M-D> 修改记录

## 1. 改动清单
| # | 文件 / 模块 | 类型 | 改动内容 | 原因 / 需求 |

## 2. 验证
| 项 | 命令 | 结果 |

## 3. 遗留 / 待确认
```

### 4.7 数据库连接信息（默认不记录）

- 本项目**没有数据库、没有后端**，本节恒为空。
- 若将来接入排行榜等服务，也**不在此记录任何地址/端口/账号/密码**。

| 数据库/环境 | 用途 | 账号 | 类型 | 来源（用户何时提出） |
|---|---|---|---|---|
| （暂无） | — | — | — | — |







