# Sky Chat - AI 智能对话平台

三维功能后续实现计划见 [Three.js 三项功能实现方案](docs/Three.js三项功能实现方案.md)：优先建设回答证据探索、知识库语义地图和对话分支地图；三维讲解、AI 形象与语音反馈作为未来扩展。新增能力目前处于设计阶段。

全栈 AI 聊天客户端，支持 SSE 流式对话、文件知识库 RAG、单 Agent 检索与补查、Three.js 来源探索，以及监控与管理后台。

RAG 进阶链路已实现，使用、限制和双进程部署见 [RAG 使用与部署](docs/RAG使用与部署.md)。管理员在管理平台批量上传并发布知识库，普通账号从聊天工具栏“资料”选择已发布文件；回答来源可切换列表与 3D 关系视图。

进阶能力、开源复用与可复现评测见 [RAG 进阶改造](docs/RAG进阶改造与开源复用.md)。管理平台新增检索实验台、层级用户组、文件权限、父子/语义分块预览和文档版本。

**技术栈：** Next.js 16.4.2 App Router + TypeScript + Tailwind CSS v4 + Zustand + Prisma + PostgreSQL (Supabase)
**AI：** 阿里云 OpenAI 兼容接口 + 内置 Tool Calling 运行时；RAG 使用 text-embedding-v4 / pgvector。

---

## 快速开始

### 先看界面（不需要数据库和模型密钥）

```powershell
npm ci
npx prisma generate
npm run dev
```

访问 [界面预览](http://localhost:3000/preview)。预览支持输入、快捷提问、模型与主题切换，但不调用真实模型，也不保存会话。首页为 `http://localhost:3000/`。

### 环境变量

```bash
# 复制环境变量模板
cp .env.example .env
# PowerShell: Copy-Item .env.example .env

# 编辑 .env 填写配置
```

`.env` 所需变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接字符串（Supabase） | 必填 |
| `OPENAI_API_KEY` | OpenAI 兼容 API Key | 必填 |
| `OPENAI_BASE_URL` | 阿里云百炼北京地域接口 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `SEARCH_API_KEY` | Tavily 联网搜索密钥 | 可选 |
| `SEARCH_API_URL` | 联网搜索接口 | `https://api.tavily.com/search` |
| `JWT_SECRET` | JWT 签名密钥 | 生产环境必填；开发环境有默认值 |

### 初始化数据库

```bash
npx prisma migrate deploy   # 首次运行先建表
npm run seed                # 可选：创建管理员
```

普通用户可以直接注册。可用模型在 `lib/models.ts` 中配置，聊天接口使用客户端选择的模型。

### 启动

```bash
npm run dev      # 开发服务器 http://localhost:3000
npm run build    # 生产构建
npm run start    # 启动生产服务
npm run rag:worker # 另一个终端运行：处理文件与向量入库
```

### 其他命令

```bash
npm run lint        # ESLint 检查
npx prisma studio   # Prisma Studio 数据库管理
npx prisma migrate dev  # 创建/应用迁移
```

### 默认管理员账户

执行 `npm run seed` 后自动创建：

| 字段 | 默认值 |
|------|--------|
| 邮箱 | `admin@skychat.com` |
| 密码 | `admin123` |
| 角色 | 管理员 |

可通过环境变量覆盖：

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secure-password npm run seed
```

普通用户需通过 `/register` 页面注册。

---

## 项目结构

```
./
├── app/
│   ├── page.tsx           # 首页（已登录自动跳转 /chat）
│   ├── login/             # 登录页
│   ├── register/          # 注册页
│   ├── chat/              # AI 聊天客户端
│   │   ├── page.tsx       # 服务端鉴权与数据预取
│   │   ├── ChatPageClient.tsx # 会话管理
│   │   ├── ChatContainer.tsx  # 流式聊天、状态机与分享
│   │   └── components/
│   │       ├── MessageList.tsx       # 虚拟滚动消息列表
│   │       ├── MarkdownRenderer.tsx  # 流式 Markdown 与工具调用卡片
│   │       ├── ChatInput.tsx          # 自动伸缩输入框
│   │       ├── Sidebar.tsx            # 会话侧边栏与用户信息
│   │       ├── ThinkingIndicator.tsx  # 对话状态指示器
│   │       ├── KnowledgePanel.tsx     # 选择会话使用的知识库资料
│   │       ├── RagSources.tsx         # 展示回答引用的来源
│   │       └── SourceGraph3D.tsx      # 来源的 3D 关系视图
│   ├── share/[token]/     # 公开分享页
│   ├── admin/
│   │   ├── page.tsx       # 管理后台入口
│   │   ├── AdminPageClient.tsx # 监控可视化
│   │   ├── knowledge/     # 知识库上传、发布与权限管理
│   │   └── rag/           # 检索实验台、评测与入库阶段记录
│   └── api/
│       ├── auth/          # JWT 认证
│       ├── chat/          # SSE 流式对话、工具调用与 RAG 引用
│       ├── session/       # 会话管理与资料选择（[id]/documents/）
│       ├── documents/     # 文档上传与管理
│       ├── knowledge/     # 查询、创建与发布知识库
│       ├── admin/         # 检索、评测、入库管道与用户组接口
│       ├── message/       # 消息管理
│       ├── share/         # 分享链接生成
│       ├── generate-image/ # 可选的独立图片服务
│       ├── monitor/       # 监控数据上报与查询
│       └── user/          # 用户管理
├── proxy.ts               # 路由保护（JWT 校验 + 角色检查）
├── components/            # 共享 UI 组件
│   ├── ThemeProvider.tsx  # 暗色模式上下文
│   ├── ThemeToggle.tsx    # 主题切换按钮
│   └── ui/               # shadcn/ui 组件
├── lib/
│   ├── auth.ts            # JWT + bcrypt 工具
│   ├── prisma.ts          # Prisma Client 单例
│   ├── sse-parser.ts      # SSE 流式解析层
│   ├── ai-stream.ts       # 类型化事件分发（14 种 chunk 类型）
│   ├── stream-buffer.ts   # RAF 批量渲染缓冲
│   ├── rag/               # 文档解析、分块、权限校验与检索
│   │   ├── pipeline/      # 入库阶段执行与中间产物
│   │   ├── messaging/     # Kafka 消费与阶段消息投递
│   │   └── search/        # Elasticsearch 索引、BM25 与向量检索
│   └── monitor/           # 自研监控 SDK
│       ├── types.ts       # 指标类型定义
│       ├── collector.ts   # SSEPerformanceTracker + WebVitalsCollector
│       ├── indexeddb.ts   # IndexedDB 离线队列
│       └── reporter.ts    # sendBeacon + Fetch 双通道上报
├── prisma/migrations/     # 知识库、文档版本与入库状态等数据库迁移
├── infra/compose.rag.yml  # Elasticsearch 与 Kafka 的 Compose 配置
├── scripts/
│   ├── rag-kafka-worker.ts # 启动 Kafka 入库 worker
│   ├── rag-reindex-es.ts   # 重建 Elasticsearch 索引
│   └── rag-evaluate.ts     # 运行检索评测
└── store/
    ├── useChatStore.ts    # 聊天状态机（Zustand）
    └── useAuthStore.ts    # 认证状态
```

---

## 核心架构

### 流式对话数据流

```
用户输入 → ChatContainer.handleSend()
  → setStatus('thinking')
  → fetch POST /api/chat (携带 JWT Cookie)
  → 服务端 getCurrentUser() 鉴权
  → fetch OpenAI chat/completions (stream: true, tools)
  → 解析 OpenAI SSE → 转换为文本、工具及 RAG 自定义事件
  → ReadableStream 推送 → 客户端 TextDecoder
  → SSEParser 解析 → handleStreamChunk 分发
  → onTextDelta → StreamBuffer.push() → RAF → flush()
  → appendTextDelta() → React 批量渲染
  → onFinish → finalizeCurrentMessage() → saveMessage()
  → SSEPerformanceTracker → IndexedDB → 批量上报
```

### SSE 事件协议（自定义类型）

| 事件 | 说明 |
|------|------|
| `text-start/delta/end` | AI 文本输出 |
| `reasoning-start/delta/end` | 推理过程 |
| `tool-input-start/delta/available` | 工具参数流式解析 |
| `tool-output-available/error` | 工具执行结果 |
| `step-start` | 多轮 Function Calling 步骤切换 |
| `finish` | 流式结束 |
| `error/abort` | 错误/中断 |
| `rag-trace` | 检索步骤、实际来源及执行状态 |
| `text-replace` | 引用 ID 校验后的完整回答 |

### 消息状态机

```
idle → thinking → answering → idle
                 ↘ tool_calling → answering → idle
                                ↘ error
```

### 渲染优化

- **StreamBuffer + requestAnimationFrame** — 将 Token 增量合并为按帧批量提交，具体性能收益需实测
- **自动补全未闭合 Markdown** — 流式输出时补全 ` ``` `、`**` 等标记，消除布局抖动
- **TanStack Virtual 虚拟滚动** — 只渲染可视区域消息（+ overscan 5），支持长会话流畅滚动
- **智能滚动** — 检测用户是否向上滚动，自动暂停/恢复滚动行为

### 监控 SDK

- **SSE 流式指标**：TTFB、TTLB、Stall（>500ms 间隔检测）、阶段耗时
- **离线队列**：IndexedDB 存储 → 每 10s 批量上报 → 成功后清除
- **双通道上报**：sendBeacon（卸载可靠） + fetch keepalive（payload 更大）

### 认证与安全

- JWT（jose, HS256, 7d 过期），httpOnly Cookie
- 中间件层路由保护 + API 层权限校验（双层防护）
- bcrypt 密码哈希（10 轮 salt）
- 用户数据隔离（只能操作自己的会话/消息）

---

## 项目亮点

详细技术深度解析见 [PROJECT_HIGHLIGHTS.md](./PROJECT_HIGHLIGHTS.md)，涵盖：

1. SSE 流式传输与有限状态机设计
2. Buffer + requestAnimationFrame 渲染性能优化
3. 流式 Markdown 渲染优化
4. TanStack Virtual 虚拟滚动
5. 自研监控 SDK：SSE 流式场景指标体系


## 本次体验优化

- 统一首页、登录注册和聊天界面的视觉，支持暗色主题、手机抽屉侧栏及减少动画偏好。
- 历史对话直接使用服务端预取数据，支持本地标题搜索；删除失败保留会话，删除成功只发送一次请求。
- 修复中文输入法误发送、停止生成清空历史、错误后无法再次发送、切换会话旧请求污染等问题。
- 断流时保留部分回复，重试覆盖原回答；继续操作创建独立分支，保留原对话。
- 附件失败保留文件和输入，支持同一文件重选；增加 Markdown 对话导出。
- Next.js 升级到 16.4.2，认证入口迁移为 proxy；生产依赖审计结果为 0 条已知告警。

## 验证

```bash
npm run lint
npm test
npm run test:e2e
npm run build
npx tsc --noEmit
npm audit --omit=dev
```

浏览器测试使用模拟接口，不需要真实数据库或模型密钥。运行前停止本项目的开发服务器；测试会在端口 3101 临时启动开发服务器并自动移除测试页面。默认使用本机 Chrome；没有 Chrome 时安装 Chromium 并调整 `playwright.config.ts` 的 `channel`。

优化记录和验证范围见 [reports/optimization.md](reports/optimization.md)。


## 阿里云百炼模型配置

当前聊天使用北京地域 OpenAI 兼容接口：`https://dashscope.aliyuncs.com/compatible-mode/v1`。密钥写入本地 `.env` 的 `OPENAI_API_KEY`，不会进入客户端代码或 Git。

模型下拉列表依据官方文档及当前账号模型目录配置：

| 模型 | ID |
| --- | --- |
| Qwen3.7 Plus（默认） | `qwen3.7-plus` |
| Qwen3.8 Flash | `qwen3.8-flash` |
| Qwen3.8 Max | `qwen3.8-max` |
| Qwen3 Coder Flash | `qwen3-coder-flash` |

[接口说明](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope) · [官方模型列表](https://help.aliyun.com/zh/model-studio/text-generation-model)

图片生成使用独立的 `IMAGE_API_KEY`、`IMAGE_BASE_URL`、`IMAGE_MODEL`，需要兼容 OpenAI Images API 的服务；未配置时不向聊天模型提供图片生成工具，避免将千问聊天接口误用于旧的 GPT 图片接口。

数据库通过控制台提供的 Supabase Session pooler URI 连接（5432 端口），适用于当前 IPv4 网络。RAG 首版已应用新增数据表与 pgvector 迁移；新环境执行 `npm run db:migrate`，无需重置已有账号或聊天数据。

## TypeScript / Elasticsearch / Kafka RAG

当前 RAG 使用 Elasticsearch 8.19 + IK、2048 维 HNSW KNN 与 BM25，经过短语 Rescore、RRF 融合和可选 qwen3-rerank 后返回父块与引用。KafkaJS 将入库拆为解析、分块、向量化、索引四阶段；业务事务 Outbox、租约/epoch 幂等、检查点及 DLQ 重放处理失败恢复。权限仍由业务数据库实时判断，库/文件权限交集在两路召回前过滤，并在模型调用后复核。

管理平台 `/admin/knowledge` 统一批量上传与发布共享资料；`/admin/rag` 提供五种检索对照、评测和文件阶段/DLQ 记录。聊天页保留 Agent 工具循环、SSE 与来源视图。

部署、迁移、回滚及验收步骤见 [ES-Kafka 部署与验收](docs/ES-Kafka-部署与验收.md)。本机服务采用官方原生包完成验收；Compose 配置已提供，容器拉取受当前网络限制。
