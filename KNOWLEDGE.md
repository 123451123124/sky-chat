# Sky Chat 关键知识点教学文档

> 本文档覆盖项目中每个技术亮点的原理、实现思路和面试高频问题

---

## 一、JWT 认证系统

### 为什么选择 JWT 而不是 Session？

| 特性 | JWT | Session |
|------|-----|---------|
| 存储位置 | 客户端（Cookie/LocalStorage） | 服务端（内存/Redis/数据库） |
| 扩展性 | 无状态，天然支持分布式 | 需要共享 Session 存储 |
| 跨域 | 通过 Cookie sameSite 控制 | 需要额外配置 |
| 注销 | 较难（Token 签发后无法撤回） | 简单（删除服务端记录） |

本项目选择 JWT 的原因：
1. **Serverless 友好** — Next.js 部署在 Vercel 等平台，无状态认证更合适
2. **无需额外基础设施** — 不需要 Redis 存储 Session
3. **跨服务验证** — JWT 自包含用户信息，任何服务都能验证

### JWT 认证流程

```
注册: POST /api/auth/register
  → 校验参数 → 查重 → bcrypt 哈希密码 → 写入数据库
  → 签发 JWT → 设置 HttpOnly Cookie → 返回用户信息

登录: POST /api/auth/login
  → 查找用户 → bcrypt 校验密码 → 签发 JWT → 设置 HttpOnly Cookie

鉴权: 每次请求
  → Cookie 中的 JWT → jose jwtVerify → 获取用户信息
  → 中间件层校验路由权限 → API 层校验操作权限
```

### 密码安全：bcrypt 哈希

```typescript
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

// 注册时哈希
const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

// 登录时校验
const valid = await bcrypt.compare(password, user.password);
```

**为什么用 bcrypt 而不是 MD5/SHA256？**

1. **自带盐值** — 每次哈希自动生成随机盐，无需单独存储
2. **可调工作因子** — `SALT_ROUNDS=10` 意味着 2^10=1024 次迭代，暴力破解成本高
3. **慢哈希设计** — 故意设计为计算缓慢，阻止暴力破解

**面试追问：SALT_ROUNDS 设多少合适？**
- 10 是当前推荐值，约 100ms 哈希时间
- 每增加 1，计算时间翻倍
- 需要在安全性和用户体验间权衡

### JWT 签发与验证（jose 库）

```typescript
import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// 签发
const token = await new SignJWT({ userId, email, role })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('7d')
  .sign(JWT_SECRET);

// 验证
const { payload } = await jwtVerify(token, JWT_SECRET);
```

**为什么用 jose 而不是 jsonwebtoken？**

1. **Edge Runtime 兼容** — jose 基于 Web Crypto API，可在 Vercel Edge Functions 运行
2. **零原生依赖** — jsonwebtoken 依赖 Node.js crypto 模块，Edge 不支持
3. **更小的 Bundle** — jose 支持 Tree Shaking

**面试追问：HS256 和 RS256 的区别？**

| 特性 | HS256（对称） | RS256（非对称） |
|------|-------------|---------------|
| 密钥 | 同一个密钥签发和验证 | 私钥签发，公钥验证 |
| 适用场景 | 单服务 | 微服务/第三方验证 |
| 性能 | 更快 | 稍慢 |
| 安全性 | 密钥泄露即全面失效 | 私钥泄露才失效 |

本项目使用 HS256，因为只有一个服务签发和验证 Token。

### HttpOnly Cookie 安全策略

```typescript
function setAuthCookie(token: string) {
  return {
    name: 'sky-chat-token',
    value: token,
    httpOnly: true,                                    // JS 无法读取，防 XSS
    secure: process.env.NODE_ENV === 'production',     // HTTPS Only（生产环境）
    sameSite: 'lax',                                   // 防 CSRF
    maxAge: 60 * 60 * 24 * 7,                          // 7 天过期
    path: '/',
  };
}
```

**三个关键安全属性：**

1. **httpOnly: true** — JavaScript 无法通过 `document.cookie` 读取，防止 XSS 窃取 Token
2. **secure: true** — 只在 HTTPS 下传输，防止中间人攻击
3. **sameSite: 'lax'** — 跨站请求不携带 Cookie，防止 CSRF 攻击

**面试追问：sameSite 的三个值？**
- `strict` — 任何跨站请求都不带 Cookie（最安全但体验差，从外链点进来需要重新登录）
- `lax` — GET 导航请求带 Cookie，POST/iframe 等不带（推荐）
- `none` — 都带（必须配合 secure）

---

## 二、路由保护：Next.js Middleware

### 中间件执行流程

```
用户请求 → Edge Middleware → 匹配路由规则 → 放行/重定向
```

```typescript
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const user = await verifyTokenFromRequest(request);

  // /chat 路由：必须登录
  if (pathname.startsWith('/chat')) {
    if (!user) return NextResponse.redirect(new URL('/login', request.url));
  }

  // /admin 路由：必须管理员
  if (pathname.startsWith('/admin')) {
    if (!user) return NextResponse.redirect(new URL('/login', request.url));
    if (user.role !== 'admin') return NextResponse.redirect(new URL('/chat', request.url));
  }

  // 已登录用户不能访问登录/注册页
  if (pathname === '/login' || pathname === '/register') {
    if (user) return NextResponse.redirect(new URL('/chat', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/chat/:path*', '/admin/:path*', '/login', '/register'],
};
```

### 双层权限校验

1. **中间件层** — 在 Edge Runtime 执行，拦截未授权的页面访问
2. **API 层** — 每个 API 路由内部用 `getCurrentUser()` 校验，防止绕过中间件直接调用 API

```typescript
// API 路由中的权限校验
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // ... 业务逻辑
}
```

**为什么需要双层？**
- 中间件只拦截页面路由，API 路由可能被直接 curl 调用
- 中间件在 Edge 运行，某些 Node.js API（如 Prisma）不可用
- 纵深防御：一层被绕过，另一层仍能拦截

### 服务端组件的权限校验

```typescript
// app/chat/page.tsx — Server Component
export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sessions = await prisma.session.findMany({
    where: { userId: user.userId },
  });

  return <ChatPageClient initialSessions={sessions} user={user} />;
}
```

Server Component 中直接调用 `getCurrentUser()`，因为可以访问 Cookie。如果未登录则 `redirect()`，这是服务端重定向，不会闪烁未授权页面。

---

## 三、SSE 解析层：为什么不用 EventSource？

### 问题背景

浏览器原生 `EventSource` API 有两个致命限制：

1. **只支持 GET 请求** — 无法携带 POST Body（聊天消息必须放在 Body 里）
2. **无法设置自定义 Header** — 无法传 Authorization 等 Header

### 解决方案：Fetch + ReadableStream 手动解析

```
浏览器 Fetch API → Response.body (ReadableStream) → TextDecoder → SSEParser → 结构化事件
```

### SSE 协议格式

SSE（Server-Sent Events）基于文本协议，格式如下：

```
data: {"type":"text-delta","delta":"你好","id":"msg-1"}

data: {"type":"text-delta","delta":"世界","id":"msg-1"}

```

关键规则：
- 事件之间用 `\n\n`（两个换行）分隔
- 每行格式为 `field:value`
- `data` 字段可以多行，用 `\n` 连接

### SSEParser 实现要点

```typescript
class SSEParser {
  private buffer = '';

  parse(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];

    while ((pos = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, pos);
      this.buffer = this.buffer.slice(pos + 2);
      events.push(this.parseBlock(raw));
    }

    return events;
  }
}
```

**为什么需要 buffer？** TCP 是流式协议，一次 `reader.read()` 可能：
- 收到半个事件 → 需要缓冲等待后续数据
- 收到多个事件 → 需要逐个解析

### 面试高频问题

**Q: SSE 和 WebSocket 的区别？**

| 特性 | SSE | WebSocket |
|------|-----|-----------|
| 方向 | 服务端 → 客户端（单向） | 双向 |
| 协议 | HTTP | WS |
| 重连 | 浏览器自动重连 | 需手动实现 |
| 兼容性 | 原生支持（除 IE） | 原生支持 |
| 适用场景 | AI 流式输出、通知推送 | 实时聊天、协作编辑 |

**Q: 为什么 AI 对话用 SSE 而不是 WebSocket？**
- AI 对话是请求-响应模式，不需要双向通信
- SSE 基于 HTTP，天然兼容 CDN、代理、负载均衡
- 断线重连更简单，SSE 有 Last-Event-ID 机制
- Serverless 平台对 WebSocket 支持有限

---

## 四、原生 OpenAI API 实现（替代 Vercel AI SDK）

### 为什么不使用 Vercel AI SDK？

1. **版本更新太快** — v4 → v5 → v6 频繁 Breaking Change，API 不稳定
2. **抽象层过重** — 封装了太多细节，出 Bug 难以定位和修复
3. **黑盒行为** — 流式解析、工具调用的具体行为不透明
4. **Bundle 体积** — 引入不必要的依赖

### 原生实现架构

```
客户端 POST /api/chat → 服务端 route handler
  → 构建 OpenAI API 请求（含 tools 定义）
  → fetch OpenAI chat/completions（stream: true）
  → 逐行解析 SSE 响应
  → 转换为自定义 SSE 事件格式
  → ReadableStream 推送给客户端
```

### 服务端 SSE 流式转发

```typescript
export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 多轮循环：支持 Function Calling
      let step = 0;
      while (step < MAX_STEPS) {
        step++;

        // 调用 OpenAI API
        const response = await fetch(`${BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages: chatMessages,
            tools,
            stream: true,
          }),
        });

        // 解析 SSE 响应
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentToolCalls = new Map();
        let hasToolCalls = false;
        let textContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            // 处理文本增量
            if (delta.content) {
              controller.enqueue(encoder.encode(
                createSSEMessage({ type: "text-delta", delta: delta.content })
              ));
            }

            // 处理工具调用增量
            if (delta.tool_calls) {
              hasToolCalls = true;
              // 累积工具调用参数...
            }
          }
        }

        // 如果有工具调用，执行并继续循环
        if (hasToolCalls) {
          for (const tc of currentToolCalls.values()) {
            const output = await executeTool(tc.name, toolInput);
            chatMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(output) });
          }
          // 继续下一轮循环，让 AI 基于工具结果生成回复
        } else {
          break; // 没有工具调用，结束循环
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
```

### Function Calling 多轮循环机制

```
Step 1: 用户消息 → AI 返回 tool_calls
Step 2: 工具结果 → AI 生成回复（可能再次调用工具）
Step 3: 工具结果 → AI 生成最终文本回复
...
最多 MAX_STEPS 轮
```

**OpenAI 流式响应中 tool_calls 的结构：**

```json
// 第一个 chunk — 工具调用开始
{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"generateImage","arguments":""}}]}}]}

// 后续 chunks — 参数增量
{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"prom"}}]}}]}
{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"pt\": \"a cat\"}"}}]}}]}
```

关键点：
- `index` 用于区分多个并行工具调用
- `id` 只在第一个 chunk 出现
- `arguments` 是增量拼接的 JSON 字符串

### 自定义 SSE 事件协议

服务端将 OpenAI 的原始 SSE 转换为更语义化的事件格式：

| 事件类型 | 含义 | 数据 |
|---------|------|------|
| `text-start` | 文本输出开始 | `{ id }` |
| `text-delta` | 文本增量 | `{ id, delta }` |
| `text-end` | 文本输出结束 | `{ id }` |
| `tool-input-start` | 工具调用开始 | `{ toolCallId, toolName }` |
| `tool-input-delta` | 工具参数增量 | `{ toolCallId, delta }` |
| `tool-input-available` | 工具参数完整 | `{ toolCallId, toolName, input }` |
| `tool-output-available` | 工具执行成功 | `{ toolCallId, output }` |
| `tool-output-error` | 工具执行失败 | `{ toolCallId, errorText }` |
| `step-start` | 新一轮开始 | `{}` |
| `finish` | 全部完成 | `{ finishReason }` |
| `error` | 出错 | `{ errorText }` |

**为什么不直接转发 OpenAI 的 SSE？**
- OpenAI 的格式是通用的，缺少业务语义
- 自定义格式让客户端解析更简单，不需要理解 OpenAI 的 delta 结构
- 解耦：客户端不依赖 OpenAI 的具体协议，换模型只需改服务端

### 客户端解析流程

```typescript
const response = await fetch("/api/chat", {
  method: "POST",
  body: JSON.stringify({ messages }),
  signal: abortController.signal,
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
const sseParser = new SSEParser();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  const events = sseParser.parse(chunk);

  for (const event of events) {
    const streamChunk = parseAIStreamChunk(event.data);
    if (streamChunk) {
      handleStreamChunk(streamChunk, callbacks);
    }
  }
}
```

### 面试高频问题

**Q: 为什么用 ReadableStream 而不是直接 res.json()？**

AI 回复是流式的，需要逐 token 展示。如果等全部生成完再返回，用户需要等待数秒甚至数十秒才能看到任何内容。ReadableStream 允许服务端边生成边推送，实现"打字机效果"。

**Q: 如何实现中断生成？**

```typescript
const abortController = new AbortController();
fetch("/api/chat", { signal: abortController.signal });

// 用户点击停止
abortController.abort();
```

`AbortController` 会同时中断客户端的 fetch 请求和服务端的 ReadableStream。

---

## 五、有限状态机：消息生命周期管理

### 状态定义

```
idle → thinking → answering → idle
                 ↘ tool_calling → answering → idle
                                ↘ error
```

| 状态 | 含义 | UI 表现 |
|------|------|---------|
| `idle` | 空闲，等待用户输入 | 输入框可用 |
| `thinking` | 请求已发出，等待首字节 | 思考动画 |
| `answering` | 正在接收流式文本 | 打字机效果 |
| `tool_calling` | AI 调用工具中 | 工具调用卡片 |
| `error` | 出错 | 错误提示 |

### 面试高频问题

**Q: 为什么不用 boolean 标志（如 isLoading）？**

boolean 只能表达两种状态，无法区分"等待首字节"和"正在接收数据"。状态机能精确表达所有阶段，避免状态组合爆炸（多个 boolean 组合产生不可能状态）。

---

## 六、Buffer 缓冲队列 + RAF 批量渲染

### 问题：流式 chunk 高频触发 setState

SSE 流每秒可能产生 60-120 个 chunk，每个 chunk 触发一次 `setState` → React re-render → DOM 更新。导致主线程被渲染占满，UI 卡顿。

### 解决方案：StreamBuffer

```
SSE chunk → push(delta) → queue[] → RAF → flush() → setState(批量合并的delta)
```

```typescript
class StreamBuffer {
  private queue: string[] = [];
  private rafId: number | null = null;

  push(delta: string) {
    this.queue.push(delta);
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.flush();
        this.rafId = null;
      });
    }
  }

  private flush() {
    if (this.queue.length === 0 || !this.flushCallback) return;
    const batch = this.queue.splice(0, this.queue.length);
    const combined = batch.join('');
    this.flushCallback(combined);
  }
}
```

### 效果

- 渲染频次从峰值 **120 次/秒 → 60 次/秒以下**（等于屏幕刷新率）
- 每次 setState 携带更多数据，减少 React reconciliation 开销
- 用户感知更流畅，因为渲染与屏幕刷新同步

### 面试高频问题

**Q: 为什么用 requestAnimationFrame 而不是 setTimeout？**

- RAF 与浏览器渲染周期同步（通常 16.6ms 一帧），不会造成帧丢失
- setTimeout(fn, 0) 实际延迟约 4ms，且不与渲染对齐，可能在一帧内触发多次
- 当页面不可见时 RAF 自动暂停，节省资源

**Q: 为什么不用 React 18 的自动批处理？**

React 18 的自动批处理确实能在同一事件循环中合并 setState，但 SSE chunk 来自异步的 `reader.read()`，每次 read 完成都是独立的微任务，不会被自动批处理。Buffer + RAF 是在应用层主动合并。

---

## 七、流式 Markdown 渲染优化

### 问题：未闭合 Markdown 块导致布局抖动

流式输出时，AI 可能输出到一半，代码块未闭合。ReactMarkdown 会将未闭合的 ` ``` ` 渲染为普通文本，当代码块闭合后又突然变成代码块 → **高度突变 → 布局偏移（CLS）**

### 解决方案：自动补全未闭合块

```typescript
function closeOpenMarkdownBlocks(text: string): string {
  let result = text;
  const fenceMatches = result.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    result += '\n```';
  }
  return result;
}
```

### 滚动锚定（overflow-anchor）

```css
overflow-anchor: auto;
```

CSS `overflow-anchor` 让浏览器在内容插入时保持用户当前可见区域不变。配合 `scrollIntoView({ behavior: 'smooth' })` 实现平滑自动滚动。

---

## 八、TanStack Virtual 虚拟滚动

### 问题：长会话性能

一个 1000 条消息的会话，如果全部渲染，DOM 节点可能达到数万个，导致首次渲染慢、滚动卡顿、内存占用高。

### 解决方案：虚拟滚动

只渲染视口内可见的消息 + 上下各 overscan 条：

```
[不可见] msg 1-95
[overscan] msg 96-100
[可见] msg 101-110  ← 实际渲染
[overscan] msg 111-115
[不可见] msg 116-1000
```

### 关键实现

```typescript
const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => parentRef.current,
  estimateSize: (index) => {
    const msg = messages[index];
    if (msg.role === 'user') return 60;
    const len = msg.content.length;
    if (len < 50) return 60;
    if (len < 200) return 100;
    return 240;
  },
  overscan: 5,
});
```

`estimateSize` 是关键 — 初始估算不需要精确，TanStack Virtual 会在渲染后用 `measureElement` 测量真实高度并更新。

### 面试高频问题

**Q: 虚拟滚动的难点是什么？**

1. **动态高度** — 消息高度不固定，需要先估算后测量
2. **滚动位置维护** — 新消息插入时不能跳转
3. **快速滚动** — overscan 太少会闪烁，太多失去虚拟化意义

---

## 九、Function Calling 图片生成

### Tool 定义

```typescript
const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "generateImage",
      description: "根据用户描述生成图片。当用户要求画图、生成图片、创建图像时使用此工具。",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "图片描述，英文效果更好" },
          size: {
            type: "string",
            enum: ["1024x1024", "1024x1792", "1792x1024"],
            default: "1024x1024",
          },
        },
        required: ["prompt"],
      },
    },
  },
];
```

### 工具执行

```typescript
async function executeTool(name: string, args: Record<string, unknown>) {
  if (name === "generateImage") {
    const response = await fetch(`${BASE_URL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: args.prompt,
        n: 1,
        size: args.size || "1024x1024",
      }),
    });
    const data = await response.json();
    return { url: data.data[0].url, revisedPrompt: data.data[0].revised_prompt };
  }
}
```

### 多轮工具调用流程

```
用户: "画一只猫"
  → AI 决定调用 generateImage(prompt: "a cute cat")
  → 服务端执行 DALL-E API → 返回 { url: "..." }
  → AI 收到结果，生成回复: "这是为你生成的猫咪图片"
  → 如果 AI 还想调用其他工具，继续循环
  → 最多 MAX_STEPS 轮
```

### 面试高频问题

**Q: Function Calling 和 Plugin 有什么区别？**

Function Calling 是模型能力 — 模型输出结构化的函数调用意图，由应用层执行。Plugin 是 OpenAI 平台功能 — OpenAI 服务器执行函数。前者更灵活，后者更简单。

**Q: 工具调用的参数如何验证？**

OpenAI 返回的 `arguments` 是 JSON 字符串，需要 `JSON.parse()` 解析。应该 try-catch 包裹，解析失败时给模型返回错误信息，让模型自我修正。

---

## 十、分享功能实现

### 分享流程

```
用户点击分享 → POST /api/share { sessionId }
  → 查找会话 → 生成/获取 shareToken（UUID v4）
  → 更新 Session.shareToken → 返回分享链接
  → 客户端复制链接到剪贴板 → 显示 Toast 反馈
```

### 分享页（RSC）

```typescript
// app/share/[token]/page.tsx — Server Component
export default async function SharePage({ params }) {
  const { token } = await params;
  const session = await prisma.session.findUnique({
    where: { shareToken: token },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) notFound();
  return <SharePageClient title={session.title} messages={serializedMessages} />;
}
```

**为什么用 RSC？**

1. **服务端渲染 Markdown** — 不需要客户端加载 react-markdown 等库
2. **更小的 Page Chunk** — 客户端 JS 从 ~50KB 降到 ~5KB
3. **更好的 SEO** — 搜索引擎可以直接索引分享内容
4. **更快的 FCP** — 用户看到内容不需要等 JS 加载执行

**面试追问：分享页需要登录吗？**

不需要。分享页是公开的只读页面，任何人通过链接都可以查看。中间件的 matcher 不包含 `/share` 路由。

---

## 十一、自研监控 SDK

### SSE 流式场景指标体系

| 指标 | 含义 | 计算方式 |
|------|------|---------|
| **TTFB** | 首字节时间 | `firstChunkTime - requestStartTime` |
| **TTLB** | 流式完成时间 | `lastChunkTime - requestStartTime` |
| **Stall** | 卡顿检测 | 两个 chunk 间隔 > 500ms |
| **Phase Duration** | 阶段耗时 | thinking/answering/tool_calling 各耗时 |

### 数据上报策略

**sendBeacon + Fetch 双通道：**

```typescript
async function sendReport(report) {
  if (typeof navigator.sendBeacon === 'function') {
    const success = navigator.sendBeacon(url, JSON.stringify(report));
    if (success) return true;
  }
  return fetch(url, { method: 'POST', body: JSON.stringify(report), keepalive: true });
}
```

**为什么需要双通道？**
- `sendBeacon` 保证页面卸载时数据不丢失，但有大小限制（64KB）
- `fetch + keepalive` 支持更大 payload，但兼容性稍差
- 两者互为 fallback

### IndexedDB 离线队列

```
采集指标 → IndexedDB 队列 → 定时/批量上报 → 成功后清除
                              ↘ 失败保留，下次重试
```

**为什么用 IndexedDB 而不是 localStorage？**
- IndexedDB 是异步 API，不会阻塞主线程
- 存储容量大（通常数百 MB vs localStorage 的 5MB）
- 支持索引查询，方便按类型/时间筛选

---

## 十二、Zustand 状态管理设计

### Message 模型：parts 数组

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;        // 纯文本内容（用于搜索/存储）
  parts: MessagePart[];   // 结构化内容（用于渲染）
}
```

**为什么需要 parts？**

AI 的回复不只是纯文本，可能包含：
- 文本（TextPart）
- 推理过程（ReasoningPart）
- 工具调用（ToolPart）
- 步骤标记（StepStartPart）

parts 数组让 UI 可以精确渲染每种类型，而 content 是 parts 中所有文本的拼接，用于存储和搜索。

### 精确更新策略

```typescript
appendTextDelta: (delta) => {
  const state = get();
  set({
    messages: state.messages.map((msg) => {
      if (msg.id !== state.currentAssistantId) return msg;

      const parts = [...msg.parts];
      const lastPart = parts[parts.length - 1];

      if (lastPart?.type === 'text' && lastPart.state === 'streaming') {
        parts[parts.length - 1] = { ...lastPart, text: lastPart.text + delta };
      } else {
        parts.push({ type: 'text', text: delta, state: 'streaming' });
      }

      return { ...msg, parts, content: ... };
    }),
  });
}
```

用 `currentAssistantId` 精确定位要更新的消息，避免遍历所有消息。

---

## 十三、Prisma 数据模型设计

### Schema 定义

```prisma
model User {
  id        String    @id @default(cuid())
  email     String    @unique
  name      String
  password  String
  role      String    @default("user")
  sessions  Session[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}

model Session {
  id          String    @id @default(cuid())
  userId      String?
  user        User?     @relation(fields: [userId], references: [id])
  title       String    @default("新对话")
  shareToken  String?   @unique
  messages    Message[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

model Message {
  id        String    @id @default(cuid())
  sessionId String
  session   Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  role      String
  content   String
  createdAt DateTime  @default(now())
}
```

### 关键设计决策

**Q: 为什么 userId 是可选的（String?）？**

为了兼容已有数据（迁移前创建的 Session 没有 userId）。新创建的 Session 一定关联用户。

**Q: 为什么用 cuid 而不是 UUID？**

- cuid 比 UUID 更短（25 字符 vs 36 字符）
- cuid 是时间有序的，有利于数据库索引性能
- cuid 在分布式环境下不会冲突

**Q: onDelete: Cascade 的含义？**

删除 Session 时自动删除其所有 Message。避免孤儿数据。

**Q: 为什么 password 字段不叫 passwordHash？**

虽然存储的是哈希值，但叫 `password` 更简洁。代码中通过 `hashPassword()` 和 `verifyPassword()` 函数名已经明确表达这是哈希操作。

---

## 十四、项目架构总结

```
app/
├── page.tsx                 # 首页（RSC，已登录自动跳转 /chat）
├── login/page.tsx           # 登录页
├── register/page.tsx        # 注册页
├── chat/
│   ├── page.tsx             # 聊天页（RSC，服务端鉴权 + 数据预取）
│   ├── ChatPageClient.tsx   # 页面客户端（会话管理 + 登出）
│   ├── ChatContainer.tsx    # 核心容器（SSE + Buffer + 状态机 + 分享）
│   └── components/
│       ├── MarkdownRenderer.tsx  # Markdown 渲染 + 流式补全 + Part 渲染
│       ├── MessageList.tsx       # 虚拟滚动消息列表
│       ├── ChatInput.tsx         # 输入组件
│       ├── Sidebar.tsx           # 会话侧边栏 + 用户信息
│       └── ThinkingIndicator.tsx # 状态指示器
├── share/[token]/           # RSC 分享页（公开，无需登录）
├── admin/
│   ├── page.tsx             # 管理后台（RSC，仅管理员）
│   └── AdminPageClient.tsx  # 管理后台客户端
├── api/
│   ├── auth/
│   │   ├── register/route.ts  # 注册（哈希密码 + 签发 JWT）
│   │   ├── login/route.ts     # 登录（校验密码 + 签发 JWT）
│   │   ├── logout/route.ts    # 登出（清除 Cookie）
│   │   └── me/route.ts        # 获取当前用户
│   ├── chat/route.ts        # AI 流式对话 + Function Calling（原生 API）
│   ├── session/route.ts     # 会话 CRUD（auth 校验 + 用户隔离）
│   ├── session/[id]/route.ts
│   ├── message/route.ts     # 消息 CRUD（auth 校验）
│   ├── share/route.ts       # 生成分享链接（auth 校验）
│   ├── generate-image/route.ts  # 图片生成（auth 校验）
│   ├── user/route.ts        # 用户管理（仅管理员）
│   └── monitor/route.ts     # 监控数据（GET 仅管理员）
├── middleware.ts            # 路由保护中间件
└── lib/
    ├── auth.ts              # JWT + bcrypt 工具库
    ├── prisma.ts            # Prisma Client 单例
    ├── sse-parser.ts        # SSE 解析层
    ├── ai-stream.ts         # AI 流式事件处理
    ├── stream-buffer.ts     # Buffer + RAF 批量渲染
    └── monitor/             # 自研监控 SDK
        ├── types.ts
        ├── collector.ts
        ├── indexeddb.ts
        ├── reporter.ts
        └── index.ts
```

### 数据流全景

```
用户输入 → ChatContainer.handleSend()
  → setStatus('thinking')
  → fetch /api/chat (POST, 携带 JWT Cookie)
  → 服务端 getCurrentUser() 校验权限
  → fetch OpenAI chat/completions (stream: true)
  → 解析 OpenAI SSE → 转换为自定义 SSE 事件
  → Response.body (ReadableStream) 推送
  → 客户端 TextDecoder → SSEParser → parseAIStreamChunk
  → handleStreamChunk(callbacks)
    → onTextDelta → StreamBuffer.push()
    → RAF → flush() → appendTextDelta() → React re-render
    → onToolInputAvailable → addToolPart()
    → onToolOutputAvailable → updateToolOutput()
    → onFinish → finalizeCurrentMessage() → saveMessage()
  → SSEPerformanceTracker → IndexedDB → 批量上报
```

### 安全防护全景

```
1. 中间件层 — Edge Runtime 路由保护
   /chat/* → 未登录重定向 /login
   /admin/* → 非管理员重定向 /chat
   /login, /register → 已登录重定向 /chat

2. API 层 — 每个 Route Handler 校验
   getCurrentUser() → 未登录返回 401
   user.role !== 'admin' → 返回 403
   Session.userId === user.userId → 用户只能操作自己的数据

3. Cookie 安全
   httpOnly: true → 防 XSS
   secure: true → 防 MITM（生产环境）
   sameSite: 'lax' → 防 CSRF

4. 密码安全
   bcrypt 哈希 + 盐值 → 防彩虹表
   最小长度 6 位 → 防弱密码
```
