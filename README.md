# Sky Chat - AI 智能对话平台

全栈 AI 聊天平台，支持 SSE 流式对话、Function Calling 图片生成、自研监控 SDK、管理后台。

**技术栈：** Next.js 16.2.4 App Router + TypeScript + Tailwind CSS v4 + Zustand + Prisma + PostgreSQL (Supabase)  
**AI：** Vercel AI SDK v6 + OpenAI Compatible API（Base URL: `https://yunwu.ai/v1`）

---

## 快速开始

### 环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 填写配置
```

`.env` 所需变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接字符串（Supabase） | 必填 |
| `OPENAI_API_KEY` | OpenAI 兼容 API Key | 必填 |
| `OPENAI_BASE_URL` | API 中转地址 | `https://yunwu.ai/v1` |
| `OPENAI_MODEL` | 模型名 | `gpt-4o` |
| `JWT_SECRET` | JWT 签名密钥 | 内置默认（生产环境请修改） |

### 初始化数据库

```bash
npm run seed
```

### 启动

```bash
npm run dev      # 开发服务器 http://localhost:3000
npm run build    # 生产构建
npm run start    # 启动生产服务
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
app/
├── page.tsx               # 首页（已登录自动跳转 /chat）
├── login/                 # 登录页
├── register/              # 注册页
├── chat/                  # AI 聊天客户端
│   ├── page.tsx           # RSC 页面（服务端鉴权 + 数据预取）
│   ├── ChatPageClient.tsx # 页面客户端（会话管理）
│   ├── ChatContainer.tsx  # 核心容器（SSE + StreamBuffer + 状态机 + 分享）
│   └── components/
│       ├── MessageList.tsx       # 虚拟滚动消息列表（智能滚动、复制/重新生成）
│       ├── MarkdownRenderer.tsx  # Markdown 渲染 + 流式补全 + 工具调用卡片
│       ├── ChatInput.tsx         # 自动伸缩输入框
│       ├── Sidebar.tsx           # 会话侧边栏 + 用户信息
│       └── ThinkingIndicator.tsx # 状态指示器（thinking/tool_calling/answering）
├── share/[token]/         # RSC 分享页（公开，无需登录，客户端 JS ~5.6KB）
├── admin/                 # 管理后台（ECharts 可视化）
│   ├── page.tsx           # RSC 页面（仅管理员）
│   └── AdminPageClient.tsx
├── api/
│   ├── auth/              # JWT 认证（register/login/logout/me）
│   ├── chat/              # SSE 流式对话 + Function Calling（原生 ReadableStream）
│   ├── session/           # 会话 CRUD（用户隔离）
│   ├── message/           # 消息 CRUD
│   ├── share/             # 分享链接生成
│   ├── generate-image/    # DALL-E 3 图片生成
│   ├── monitor/           # 监控数据上报/查询
│   └── user/              # 用户管理（仅管理员）
├── middleware.ts          # 路由保护（JWT 校验 + 角色检查）
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
│   └── monitor/           # 自研监控 SDK
│       ├── types.ts       # 指标类型定义
│       ├── collector.ts   # SSEPerformanceTracker + WebVitalsCollector
│       ├── indexeddb.ts   # IndexedDB 离线队列
│       └── reporter.ts    # sendBeacon + Fetch 双通道上报
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
  → 解析 OpenAI SSE → 转换为 14 种自定义事件
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

### 消息状态机

```
idle → thinking → answering → idle
                 ↘ tool_calling → answering → idle
                                ↘ error
```

### 渲染优化

- **StreamBuffer + requestAnimationFrame** — 将 120 次/秒的 setState 合并为 ~40 次/秒，与屏幕刷新同步
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
