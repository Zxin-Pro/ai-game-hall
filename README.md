# AI 游戏厅

多 AI 驱动的群聊式小游戏 App。你建房、选游戏、拉 3-9 个 AI 进群，AI 互相看得见消息，
会吵、会骗、会投票、会演。你围观、插话、当裁判。

**完全免费 · 无广告 · 无内购 · 无付费墙 · 不限局数。**

---

## 一句话技术选型

| 层 | 选型 |
|---|---|
| 客户端 | Expo (React Native) + TypeScript + expo-router + NativeWind + Zustand |
| 服务端 | Node 20 + Fastify + TypeScript |
| 数据 | PostgreSQL 16 + Drizzle ORM / Redis 7 |
| 实时 | ws（房间分组广播，支持断线重连补差量） |
| AI | 自建 llmClient，OpenAI 兼容，多供应商 fallback，多模型混用 |
| 部署 | 全 Docker 化（`docker-compose.yml`） |

## 核心架构思想

**不为每个游戏写独立逻辑。只写 1 个通用 GameEngine + 7 份 config JSON，引擎读 config 驱动游戏。**

```
GameEngine 接口（8 个方法 + 4 个可选钩子）
   ├─ hidden_role  → 狼人杀、谁是卧底
   ├─ group_chat   → 恋爱模拟、海龟汤
   ├─ debate       → 模拟法庭
   ├─ negotiation  → 商业谈判
   └─ simulation   → 创业公司
```

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## 快速开始

```bash
# 数据库
docker compose up -d postgres redis

# 后端
cd server
cp .env.example .env      # 至少要填 MODEL_PROVIDER_URL / MODEL_PROVIDER_KEY / DATABASE_URL
npm install
npm run dev               # 会自动建表 + 灌游戏配置 + 监听 8787

# 规则冒烟测试（不连库、不调模型）
npx tsx src/engine/__smoke__.ts

# 前端
cd ../app
npm install
npx expo start
```

真机调试时把 `app/app.json` 的 `extra.apiBaseUrl` 改成电脑的局域网 IP。

## 环境变量

见 `server/.env.example`。关键几个：

```env
MODEL_PROVIDER_URL=https://your-cheap-provider.com/v1
MODEL_PROVIDER_KEY=sk-xxx
DEFAULT_SPEAK_MODEL=deepseek-chat
DEFAULT_JUDGE_MODEL=qwen-plus
DEFAULT_SUMMARY_MODEL=gpt-4o-mini
FALLBACK_PROVIDER_URL=          # 主供应商挂了才用
DAILY_TOKEN_BUDGET_K=3000       # 日预算告警（只告警，不自动停服）
```

每个 AI 角色可以在 config JSON 的 `roles[].model` 里单独指定模型，
狼人用 deepseek、预言家用 qwen、女巫用 gemini flash —— 避免同质化。

## 目录

- `server/src/engine/` —— 所有游戏逻辑（纯函数，可离线测试）
- `server/configs/` —— 7 份游戏配置 JSON
- `server/src/llm/` —— LLM 客户端与提示词
- `app/app/` —— 页面路由
- `app/src/` —— 状态、网络、组件

## 自检脚本（不连库、不调模型、不花钱）

```bash
cd server
npx tsx src/engine/__registry_check__.ts   # 5 个引擎接口完整性
npx tsx src/engine/__smoke__.ts            # 狼人杀完整对局 + 结算卡
npx tsx src/engine/__configs_check__.ts    # 7 份 config 逐份真跑
```

两端类型检查：`cd server && npx tsc --noEmit`、`cd app && npx tsc --noEmit`。

## 七个游戏

| 游戏 | 类型 | 特色机制 |
|---|---|---|
| AI 狼人杀 | 身份推理 | 狼人互认、预言家查验、女巫双药、猎人开枪 |
| AI 谁是卧底 | 身份推理 | 16 组近义词对、白板角色 |
| AI 恋爱模拟 | 自由群聊 | 你说的话直接影响好感度，会吃醋会冲突 |
| AI 海龟汤 | 自由群聊 | 6 道谜题，主持人只答是/不是/无关 |
| AI 模拟法庭 | 唇枪舌战 | 6 个案子，反对成立率跟证据挂钩 |
| AI 商业谈判 | 利益博弈 | 双方隐藏底线，超授权报价直接扣分 |
| AI 创业公司 | 模拟经营 | 7 个随机事件，4 轮内做出取舍 |

## 进度

代码层面 Step 1-11 已全部落地。剩下的只有「接上你的便宜模型供应商之后做联调和语气调优」。

详见 [ARCHITECTURE.md](./ARCHITECTURE.md) 的进度表和踩坑记录。

## 合规

内容分级 12+。所有 AI 发言带「AI」标签，长按可举报。内置敏感词过滤、
防沉迷时长提醒、邀请码内测、bcrypt 密码、JWT 双 token、接口限流。
隐私政策与用户协议见 App 内「我的」页。
