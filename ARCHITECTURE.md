# AI 游戏厅 · 架构说明（Step 1–4）

> 一个多 AI 驱动的群聊式小游戏 App。
> 核心思想只有一句：**不为每个游戏写独立逻辑，只写 1 个通用 GameEngine + N 份 config JSON。**

---

## 一、目录结构

```
ai-game-hall/
├── docker-compose.yml           # postgres + redis + server 一键起
├── server/                      # Node 20 + Fastify + Drizzle + ws
│   ├── Dockerfile
│   ├── .env.example
│   ├── configs/                 # ★ 7 份游戏 config JSON（Step 5 补全）
│   │   └── werewolf.json
│   ├── sql/001_init.sql
│   └── src/
│       ├── index.ts             # 入口：迁移 → 种子 → 挂 WS → 监听
│       ├── env.ts               # zod 校验环境变量
│       ├── logger.ts            # pino
│       ├── db/
│       │   ├── schema.ts        # Drizzle schema（13 张表）
│       │   ├── migrate.ts       # 幂等 DDL
│       │   └── index.ts
│       ├── plugins/auth.ts      # JWT + bcrypt + refresh 轮换
│       ├── routes/
│       │   ├── auth.ts          # 注册/登录/刷新/登出
│       │   ├── games.ts         # 游戏厅、详情、回放、消息补发
│       │   ├── rooms.ts         # 建房/开局/插话/动作/暂停/举报
│       │   ├── me.ts            # 资料、记忆偏好、用量
│       │   └── uploads.ts       # 分享图上传
│       ├── ws/hub.ts            # 房间分组广播 + 心跳 + 鉴权
│       ├── llm/
│       │   ├── client.ts        # ★ 统一 LLM 客户端（重试 + fallback + 流式）
│       │   └── prompts.ts       # 裁判 / 结算润色 / 内容安全 / 记忆抽取
│       ├── engine/              # ★★ 一切业务逻辑在这里
│       │   ├── types.ts         # GameConfig / GameState / PlayerState
│       │   ├── engine.ts        # GameEngine 接口 + Message/Action/Prompt
│       │   ├── base.ts          # 五个引擎共用的工具集
│       │   ├── hiddenRole.ts    # 狼人杀 + 谁是卧底
│       │   ├── groupChat.ts     # 恋爱模拟 + 海龟汤
│       │   ├── debate.ts        # 模拟法庭
│       │   ├── negotiation.ts   # 商业谈判
│       │   ├── simulation.ts    # 创业公司
│       │   ├── registry.ts      # engine_type → 引擎实例
│       │   ├── scheduler.ts     # ★ RoomRuntime：状态机 + 回合调度
│       │   └── __smoke__.ts     # 不连库不调模型的规则冒烟测试
│       ├── gameconfig/
│       │   ├── loader.ts        # config JSON → GameConfig（带校验）
│       │   └── seed.ts          # 灌进 games / ai_roles 表
│       └── services/
│           ├── roomManager.ts   # 内存房间注册表
│           ├── roomStore.ts     # 唯一数据库通道
│           └── usage.ts         # token 用量汇总 + 预算告警
└── app/                         # Expo + TS + NativeWind + Zustand
    ├── app.json / tailwind.config.js / metro.config.js / babel.config.js
    ├── app/                     # expo-router 路由
    │   ├── _layout.tsx
    │   ├── index.tsx            # 按登录态分流
    │   ├── (auth)/login.tsx  (auth)/register.tsx
    │   ├── (tabs)/_layout.tsx   # 四个 Tab
    │   ├── (tabs)/index.tsx     # 游戏厅
    │   ├── (tabs)/rooms.tsx     # 进行中
    │   ├── (tabs)/history.tsx   # 战绩
    │   ├── (tabs)/me.tsx        # 我的（记忆偏好、用量）
    │   ├── game/[id].tsx        # 游戏详情
    │   ├── room/create.tsx      # 配角色 + 轮次
    │   ├── room/[id]/index.tsx  # ★ 房间（群聊 + 动态操作栏）
    │   ├── room/[id]/result.tsx # 结算卡 + 分享图
    │   ├── room/[id]/replay.tsx # 回放
    │   └── legal/{terms,privacy}.tsx
    └── src/
        ├── lib/api.ts           # 双 token 自动刷新
        ├── lib/ws.ts            # 断线重连（指数退避）
        ├── lib/ui.ts            # DiceBear / 配色 / 震动 / 格式化
        ├── lib/notifications.ts
        ├── store/auth.ts        # zustand
        ├── store/room.ts        # ★ 消息流 + 流式缓冲
        └── components/{MessageBubble,Composer,SeatStrip}.tsx
```

---

## 二、五层调用链

```
Expo App
   │  HTTP (JWT)              WebSocket (房间广播)
   ▼                                ▲
Fastify routes ──► RoomManager ──► WsHub
                       │
                       ▼
                  RoomRuntime  ◄──── 回合调度、用户插话、暂停
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   GameEngine      llmClient      RoomStore
   （纯规则）    （重试/fallback）  （Postgres）
        ▲
        └── GameConfig（configs/*.json）
```

关键约束：

1. **引擎是纯函数**，不碰数据库、不发网络请求 → 可以离线测试（见 `__smoke__.ts`）
2. **Runtime 是唯一的状态推进者**，单房间串行，天然无并发写
3. **Store 是唯一数据库通道**，换库只改这一层
4. **API Key 永远只在服务端**，客户端只有 JWT

---

## 三、GameEngine 接口

```ts
interface GameEngine {
  initState(config, players, roomId): GameState
  nextPhase(state, config): GameState
  getVisibleMessages(state, playerId, all): Message[]     // ← 私有信息隔离的唯一闸口
  buildPrompt(state, player, config, visible, memories): Prompt
  parseAction(aiOutput, player, config): Action
  applyAction(state, action, config): GameState
  checkWin(state, config): WinResult | null
  summarize(state, config): SummaryCard

  // 可选钩子
  nextSpeaker?(state, config, alreadySpoke): PlayerState | null
  resolvePending?(state, config): { state, events }       // 并行/投票阶段的统一结算
  narration?(state, config): string | null
  earlyWin?(state, config): WinResult | null
}
```

一个游戏 = 一份 config，引擎只认 config 里的 `engineType` / `phases` / `roles`。

### 五种子类型的差异

| engine_type | 代表游戏 | 私有信息载体 | 阶段调度 | 胜负判定 |
|---|---|---|---|---|
| `hidden_role` | 狼人杀、谁是卧底 | `player.private`（狼队友/查验记录/药水） | parallel → sequential → vote | 阵营人数比 / 卧底存活 |
| `group_chat` | 恋爱模拟、海龟汤 | 主持人的真相、搅局者的线索 | sequential / user_turn | 好感度阈值 / 真相还原 |
| `debate` | 模拟法庭 | 当事人主张、证人证词 | sequential + vote | 陪审团票 + 表现分 |
| `negotiation` | 商业谈判 | 隐藏底线、BATNA、时间压力 | sequential 循环 + 最后通牒 | 成交价 vs 底线中位 |
| `simulation` | 创业公司 | 岗位 KPI、秘密担忧 | sequential，每轮抛事件 | 估值 / 破产 |

---

## 四、回合调度（RoomRuntime）

```
loop:
  ├─ 播报阶段旁白（narration）
  ├─ phase.mode === 'narration' → 直接下一阶段
  ├─ phase.mode === 'user_turn' → 等用户输入（Promise 挂起）
  ├─ 循环取 nextSpeaker → runAI() → parseAction() → applyAction()
  │    · 每句结束即 checkWin，能提前结束就提前结束
  │    · 流式：先落一条空消息，边收边广播 delta，最后 update 覆盖
  ├─ parallel / vote 阶段 → resolvePending() 统一结算
  └─ advance() → nextPhase() → 落快照 → 广播 room.phase
```

用户随时插话：`userSpeak()` 把消息直接进公共流，下一轮 context 自动带上。
用户提交动作：`userAction()` → `applyAction` → 如果是等用户的阶段就放行 Promise。

### 断线重连
- 每个房间维护 `rooms.seq` 自增，消息表上有 `(room_id, seq)` 唯一索引
- 客户端重连后调 `GET /rooms/:id/messages?after=<本地最大 seq>` 补差量
- WS 有心跳（30s ping / 60s 无响应断开）和指数退避重连（1s→15s）

---

## 五、LLM 调用与成本控制

`llmClient.callLLM()` 的行为：

```
for provider in [primary, fallback]:
    for attempt in 1..(LLM_RETRY+1):
        try  → 成功返回，记录 prompt/completion/ttft/genMs/rate
        catch → 可重试错误（5xx/429/超时/网络）才重试，4xx 直接跳到下家
```

- **流式优先**：`stream: true`，`ttft` 和 `genMs` 分开记，速率 = completion / 纯生成时间
- **`stream_options` 兼容**：供应商 400 且报错含 `stream_options|unknown field` 就摘掉重试
- **token 估算**：后端没回 usage 就按「中文 0.75 tok/字、其他 0.3 tok/字」估，展示时加 `≈`

成本控制清单：

| 手段 | 位置 |
|---|---|
| 每局限轮次（狼人杀 5 轮） | `config.maxRounds` + `nextPhase` 硬停 |
| 上下文只给最近 20 条 | `config.costs.contextWindow` + `renderHistory` |
| 单次输出上限 | `config.costs.maxOutputTokens` |
| 角色提示词稳定（吃前缀缓存） | `baseSystem()` 只依赖人设/规则，不放轮次时间戳 |
| 历史掐中间保头尾 | `renderHistory` 把省略提示固定成常量 |
| 同时房间数封顶 | `MAX_CONCURRENT_ROOMS` |
| token 记账 | `daily_usage` + `global_usage` |
| 日预算告警 | `checkBudget()` 超了发 webhook，**不自动停服** |

并且：**不做每日免费局数限制、不做广告、不做内购、不做付费墙。**

---

## 六、合规与安全实现点

| 要求 | 实现 |
|---|---|
| AI 消息带「AI」标签 | `MessageBubble` 里 `msg.isAi` 渲染标签 |
| 长按举报 | `MessageBubble.onLongPress` → `POST /api/reports` |
| 敏感词过滤 | `moderate()` 本地词表 + 模型二次确认，插话前拦截 |
| 隐私政策 / 用户协议 | `app/legal/terms.tsx`、`privacy.tsx` |
| 年龄分级 12+ | `me.tsx` 设置项 + `playtime-policy` |
| 防沉迷 | 客户端本地计时，60 分钟提醒 |
| 邀请码内测 | `INVITE_CODES` 环境变量，注册时校验 |
| 密码 bcrypt | `hashPassword` / `checkPassword` |
| JWT 过期 + 刷新 | access 15 分钟，refresh 30 天，轮换即作废 |
| 接口限流 | `@fastify/rate-limit`，按设备指纹/IP 240 req/min |
| 防刷 | 设备指纹 + 邀请码 + 限流 |

---

## 七、本地跑起来

```bash
# 1) 起数据库
docker compose up -d postgres redis

# 2) 后端
cd server
cp .env.example .env          # 填 MODEL_PROVIDER_URL / KEY / DATABASE_URL
npm install
npm run dev                   # 自动 migrate + seed + 监听 8787

# 3) 冒烟测试（不连库、不花钱，纯跑规则）
npx tsx src/engine/__smoke__.ts

# 4) 前端
cd ../app
npm install
npx expo start                # 真机调试把 app.json 里 apiBaseUrl 改成局域网 IP
```

---

## 八、Step 进度

- [x] **Step 1** Expo 项目 + Tab 导航 + 登录注册（JWT 双 token + 设备指纹 + 邀请码）
- [x] **Step 2** PostgreSQL 数据表 + Drizzle schema（13 张表 + 索引 + 唯一约束）
- [x] **Step 3** Fastify 后端 + JWT 认证 + WebSocket（房间广播 + 心跳 + 重连）
- [x] **Step 4** GameEngine 接口 + 5 种 engine_type（含狼人杀全流程跑通）
- [x] **Step 5** 7 份游戏 config JSON 全部完成，每份都跑通（`__configs_check__.ts`）
- [x] **Step 6** 房间页：轮次分隔线、长按菜单（复制/引用/举报）、点击引用、表情行、座位点名
- [x] **Step 7** AI 调度服务（llmClient + 重试 + fallback + 流式），待接真实供应商联调
- [x] **Step 8** 狼人杀跑通（引擎层已通，端到端待联调）
- [x] **Step 9** 其余 6 个游戏接入（引擎与 config 已通，待真实模型调语气）
- [x] **Step 10** 结算卡 + 回放 + 分享图（截图 → 系统分享 → 上传存档）
- [x] **Step 11** 推送 + 震动 + 成本记账 + 合规（防沉迷提醒、举报、协议页、邀请码）

> 剩下的是「接上真实模型供应商后的联调与体验调优」，代码层面 Step 1-11 已全部落地。

## 九、七个游戏的阶段结构速查

| 游戏 | engine_type | 阶段 | 关键机制 |
|---|---|---|---|
| AI 狼人杀 | hidden_role | 夜晚 → 天亮 → 发言 → 投票 → 判定 | 狼人互认、预言家查验、女巫双药、猎人开枪 |
| AI 谁是卧底 | hidden_role | 发词 → 描述 → 投票 → 判定 | 16 组近义词对、白板角色、卧底活到剩 3 人获胜 |
| AI 恋爱模拟 | group_chat | 初见 → 约会 → 冲突 → 表白 → 结局 | 用户每句话加减好感度，好感差 >8 触发冲突 |
| AI 海龟汤 | group_chat | 出题 → 提问 → 主持人回答 → 猜真相 → 揭晓 | 6 道谜题，主持人只答是/不是/无关 |
| AI 模拟法庭 | debate | 开庭 → 原告 → 被告 → 举证 → 交叉询问 → 结案 → 判决 | 6 个案子，反对成立率跟是否有证据挂钩 |
| AI 商业谈判 | negotiation | 开局 → 报价 → 拉锯 → 最后通牒 | 每方随机隐藏底线，超授权报价直接扣分 |
| AI 创业公司 | simulation | 选赛道 → 产品 → 增长 → 融资 → 复盘 | 7 个随机事件，起始现金 1200 万，4 轮 |

## 十、三个自检脚本（不连库、不调模型、不花钱）

```bash
npx tsx src/engine/__registry_check__.ts   # 5 个引擎接口完整性 + 未知类型抛错
npx tsx src/engine/__smoke__.ts            # 狼人杀完整对局 + 结算卡
npx tsx src/engine/__configs_check__.ts    # 7 份 config 逐份真跑，并检查 5 种引擎全覆盖
```

`__configs_check__` 会顺带校验：
- 每个玩家都分到了角色
- 每个阶段的 `expect` 不为空（否则 UI 操作栏会是空的）
- prompt 里带上了角色名字
- 事件 `visibleTo` 只能是数组或 null

## 十一、本次踩的关键坑

**① 引擎里凡是模型给的引用，都要过 `resolvePlayer`**
模型输出的 `target` 是「名字」或者「3 号」，不是 id。
一开始直接 `players.find(p => p.name === action.targetId)` 永远匹配不到，
表现为「夜晚永远是平安夜、投票永远平票」——很难查，因为不报错。

**② `checkWin` 分支必须互斥**
卧底局一开始会掉进狼人杀的分支：`wolves.length === 0` → 判好人胜。
结果是开局即结束、AI 一次都没说话。加 `if (config.data.wordPairs) return this.earlyWin(...)` 独立出口。

**③ 四个引擎的 `initState` 忘了读 config 角色**
写了 `roleKey: p.roleKey || 'host'` 这种兜底，看着能跑，
实际测试时所有人都是同一个角色 → 法庭只有陪审团在说话。
统一改成 `resolveRoles(config, players)`：优先用房间定好的角色，对不上再按 count 展开。

**④ 轮次要卡住不能溢出**
`if (s.round > maxRounds)` 写在自增之后，导致 `state.round` 会变成 maxRounds+1，
前端显示成「跑了 6 轮」。改成先判断再自增，`round` 永远不超过 `maxRounds`。
