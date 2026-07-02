# Sky Chat 面试问答

> 回答结构统一采用 STAR 面试法：S（背景）→ T（任务）→ A（方案）→ R（结果）。
> 代码块用于辅助理解方案细节，面试时根据需要选择性展示。

---

## 一句话自我介绍

面试官好，我叫姜家旺。

我在 Sky Chat 这个项目里担任全栈开发，独立负责了从架构设计到部署上线的全部工作。这是一个 AI 智能聊天平台，技术栈是 Next.js 16 + TypeScript + PostgreSQL。核心功能包括 SSE 流式对话、联网搜索、图片生成、文件上传、会话管理和分享，还有一套自研的 SSE 性能监控系统和 ECharts 可视化后台。

下面我按模块介绍我做的具体工作。

---

## 一、SSE 流式传输

### Q14：SSE 和 WebSocket 有什么区别？为什么选 SSE？

**S（背景）**：AI 聊天的核心体验是流式输出——用户发一条消息，服务端要持续把 AI 的回复一个字一个字推回来。我需要选一种服务端推送技术。

**T（任务）**：在 SSE 和 WebSocket 之间做技术选型，要求方案既要满足业务需求，又要兼容 Serverless 部署环境。

**A（方案）**：我从三个维度做了对比。能力维度——WebSocket 是全双工双向通信，SSE 是服务端到客户端的单向推送。AI 聊天是典型的"客户端发一次、服务端持续回复"的场景，单向完全够用。协议维度——SSE 走标准 HTTP，天然兼容所有代理和防火墙。WebSocket 是独立协议 ws://，企业防火墙可能拦截。部署维度——Next.js API Route 原生支持 ReadableStream 做 SSE，不需要额外引入 Socket.IO。但 WebSocket 长连接跟 Serverless 按需启动的模型不兼容。

**R（结果）**：SSE 方案在 Serverless 环境下稳定运行，实现代码量远少于 WebSocket，而且保持了标准 HTTP 的部署优势。

**追问"那 EventSource 自带重连不是更好吗"**：EventSource 确实自带重连能力，但我没用它。原因是 EventSource 只能发 GET 请求，而 AI 聊天需要 POST 消息历史、模型参数等数据。所以我用 Fetch + ReadableStream 自己封装了 SSE 消费逻辑。重连可以通过业务层实现。

---

### Q15：原生 EventSource 有什么限制？为什么用 Fetch + ReadableStream 自己封装？

**S（背景）**：浏览器有原生的 EventSource API 来消费 SSE 流，用一个 URL 就能自动接收服务端推送。

**T（任务）**：需要把完整的消息历史、模型参数、搜索开关等数据发送给服务端，EventSource 能不能满足？

**A（方案）**：分析后发现三个限制。第一，EventSource 只能发 GET 请求，无法携带 POST Body。AI 聊天的消息历史可能上千 token，不可能拼在 URL 上。第二，不支持自定义 HTTP Header。第三，不支持 Content-Type: application/json。所以改用 Fetch 发送 POST 请求，然后通过 response.body.getReader() 拿到 ReadableStream 手动消费。代价是需要自己处理 TCP 粘包问题——也就是说要自己写一个 SSEParser 来切割消息，这个后面会讲。

**R（结果）**：拿到了对请求的完全控制权——POST Body、自定义参数、AbortController 取消请求。代价是多了约 60 行 SSEParser 代码，但换来的灵活性是值得的。

**核心代码：**

```typescript
const response = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages, model, searchEnabled }),
  signal: abortController.signal,
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();
const sseParser = new SSEParser();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const events = sseParser.parse(decoder.decode(value, { stream: true }));
  for (const event of events) {
    const chunk = parseAIStreamChunk(event.data);
    if (chunk) handleStreamChunk(chunk, callbacks);
  }
}
```

---

### Q16：ReadableStream 你怎么消费的？写一下伪代码。

**S（背景）**：选了 Fetch + ReadableStream 方案后，需要从头实现流的消费链路。原始数据是 Uint8Array 字节块，最终要变成 UI 能消费的结构化 Chunk。

**T（任务）**：设计一个清晰的消费架构，把字节流逐层转换，每层只做一件事。

**A（方案）**：设计了三层。第一层 Reader 层——用 fetch 发 POST 请求，拿到 reader，循环 await reader.read() 获取字节块。第二层 SSEParser 层——把字节解码为文本，按 SSE 协议的 \n\n 分隔符切出完整事件。第三层 Chunk Dispatcher 层——把事件的 data 字段做 JSON.parse，校验 type 字段，按类型分发到 14 个回调函数。三层之间的数据格式依次是 Uint8Array → 文本 → SSEEvent → StreamChunk → callback 参数。

用户点停止时，调用 abortController.abort() 终止 fetch，forceFlush 清空渲染缓冲区，重置状态机。

**R（结果）**：三层架构各司其职，每层只有一种数据转换职责。任何一层出问题都隔离在层内，不会污染其他层。

**代码参考 Q15，此处省略。**

---

### Q17：类型化 Chunk 协议——数据结构是什么？怎么区分不同类型？

**S（背景）**：OpenAI API 返回的原始 SSE 格式跟供应商绑定。如果客户端直接解析原始格式，换 API 供应商时客户端要大改。

**T（任务）**：设计一套中间协议，把上游 API 的原始响应统一翻译为前端可消费的类型化事件，实现前后端解耦。

**A（方案）**：定义了 15 种 chunk 类型，用 type 字段区分。服务端发的每个 SSE 事件的 data 都是一个 JSON：`{"type":"text-delta","id":"text-1","delta":"你好"}`。文本类 3 种（start/delta/end），推理类 3 种，工具调用类 5 种（start/delta/available/output-available/output-error），再加 step-start、finish、error、abort 四种生命周期事件。客户端通过 switch-case 按 type 分发到不同回调，每个回调的参数签名由 TypeScript 类型系统保证。

**R（结果）**：客户端永远不解析 OpenAI 的原始响应。以后换 API 供应商只改服务端，客户端零改动。TypeScript 的类型安全保证不会出现回调参数不匹配。

**核心代码：**

```typescript
export type StreamChunkType =
  | 'text-start' | 'text-delta' | 'text-end'
  | 'reasoning-start' | 'reasoning-delta' | 'reasoning-end'
  | 'tool-input-start' | 'tool-input-delta' | 'tool-input-available'
  | 'tool-output-available' | 'tool-output-error'
  | 'step-start' | 'finish' | 'error' | 'abort';

export function handleStreamChunk(chunk: StreamChunk, callbacks: StreamCallbacks) {
  switch (chunk.type) {
    case 'text-delta':
      callbacks.onTextDelta?.(chunk.id as string, chunk.delta as string);
      break;
    case 'tool-input-start':
      callbacks.onToolInputStart?.(chunk.toolCallId as string, chunk.toolName as string);
      break;
    case 'finish':
      callbacks.onFinish?.(chunk.finishReason as string);
      break;
    // ... 共 15 个 case
  }
}
```

**追问"为什么工具输入要分 start/delta/available 三个类型"**：因为工具调用的参数是流式到达的，不是一次性给全。start 让 UI 立刻弹工具卡片，delta 让参数逐步显示，available 表示参数收完可以执行了。如果只用一个类型，UI 就得等参数收完才知道有工具调用，出现几百毫秒的空白。

---

### Q18：怎么把收到的 SSE 文本解析成结构化 Chunk？分割规则是什么？

**S（背景）**：TCP 是字节流，不保证消息边界。一次 reader.read() 可能返回 0.5 条、1 条或 2.3 条 SSE 消息——这就是粘包和半包问题。

**T（任务）**：需要一个解析器，能从连续的字节流中准确切出每一条完整的 SSE 事件。

**A（方案）**：我写了一个 SSEParser 类，核心逻辑是维护一个内部 buffer 字符串。每次收到新数据追加到 buffer，然后在 buffer 里找 \n\n——这是 SSE 协议规定的事件分隔符。找到一组完整的事件块就切出来，解析 data 字段，末尾不完整的留在 buffer 等下次拼接。两层保护：SSE 协议层用 \n\n 保证不拿到半条消息，JSON 解析层用 try-catch 保证畸形数据不崩溃。

**R（结果）**：无论 TCP 怎么切分字节流，SSEParser 都能还原出服务端发的一条条完整事件。

**核心代码：**

```typescript
export class SSEParser {
  private buffer = '';

  parse(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];
    let pos: number;
    while ((pos = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, pos);
      this.buffer = this.buffer.slice(pos + 2);
      const event = this.parseBlock(raw);
      if (event) events.push(event);
    }
    return events;
  }
}
```

---

## 二、有限状态机

### Q19：状态机有几个状态？转换规则是什么？

**S（背景）**：AI 回复有多个阶段——等待响应、模型思考、工具调用、正文输出、完成或出错。不同阶段 UI 需要展示不同的指示器。

**T（任务）**：设计一套状态管理机制，让 UI 始终知道"现在应该显示什么"，并且状态转换逻辑集中可控。

**A（方案）**：定义了五个状态：idle（空闲）、thinking（等待首字节）、tool_calling（模型在调工具）、answering（正在输出文字）、error（异常）。转换规则很直接——用户发消息 → idle 变 thinking。收到第一个 text-delta → thinking 变 answering。中间收到 tool-input-start → 变 tool_calling。工具执行完 → 回 answering。收到 finish → 回 idle。任何阶段出错 → error。状态存在 Zustand store 里，所有 setStatus 调用集中在 SSE chunk 回调这一处。UI 层只读 status 一个值做渲染决策——组件不需要知道状态是怎么变的。

**R（结果）**：调试时只需要追踪 status 的变化日志就能复现问题。多轮 Function Calling 场景下 UI 跟 SSE 实际状态严格同步，不会出现"提示正在输入但没字出来"的问题。

**核心代码：**

```typescript
export type ChatStatus = 'idle' | 'thinking' | 'tool_calling' | 'answering' | 'error';

// 所有状态转换集中在一处（ChatContainer 的 SSE callbacks）
const callbacks = {
  onTextStart: () => setStatus('answering'),
  onToolInputStart: () => setStatus('tool_calling'),
  onToolOutputAvailable: () => setStatus('answering'),
  onFinish: () => setStatus('idle'),
  onError: (err) => setError(err),
};

// UI 只读不写
{status === 'thinking' && <ThinkingSkeleton />}
{status === 'tool_calling' && <ToolCard />}
<ChatInput disabled={status !== 'idle'} />
```

---

### Q20：多轮 Function Calling 时状态不同步，遇到了什么问题？怎么解决的？

**S（背景）**：实现联网搜索功能时，一轮对话触发两轮 LLM 调用。第一轮模型决定调搜索工具，服务端执行搜索。第二轮模型基于搜索结果输出最终答案。

**T（任务）**：两轮之间有个空窗期——工具执行完了但第二轮还没返回首字节——UI 显示什么？

**A（方案）**：问题在于我一开始在工具执行完后立即把状态从 tool_calling 切成了 answering。用户看到"正在输入..."动画但几百毫秒没字出来，以为卡了。根本原因是状态切换被我自己的"预期"驱动了——我以为下一轮马上会输出——而不是被"事实"驱动。解决方案很简单：工具执行完不切状态，保持 tool_calling。只有第二轮的第一个 text-delta 真正到达时才切 answering。核心原则就是状态切换由数据驱动，不由预期驱动。

**R（结果）**：多轮场景下用户在工具执行完到下一轮输出之间看到的是"搜索中"，而不是空白的"输入中"，不再困惑。

---

### Q21：Function Calling 返回错误怎么处理？

**S（背景）**：Function Calling 涉及外部网络请求——图片生成 API、搜索引擎——可能因为超时、Key 无效、服务宕机等失败。

**T（任务）**：需要一套完整的异常兜底机制，确保任何异常都不会导致 UI 崩溃或流程卡死。

**A（方案）**：设计了三层兜底。第一层工具层——服务端执行工具失败时 emit tool-output-error，错误信息注回对话让模型知道失败了。第二层状态机层——客户端收到错误后切回 answering，不中断流程，模型会尝试修正。第三层全局兜底——服务端外层 try-catch 捕获所有未预期异常 emit error 关闭流，客户端的 catch 中 forceFlush 把已收到内容先展示再提示错误。另外设置了 MAX_STEPS=5 硬限制防止死循环。

**R（结果）**：任何异常用户都能看到已输出的内容 + 错误提示，不会白屏或丢失数据。关键是精确区分了"用户主动停止"（AbortError）和"真的网络错误"——两类异常处理逻辑不同，不能混。

**核心代码：**

```typescript
// 服务端：工具执行区分成功/失败
if (hasError) {
  emit("tool-output-error", { toolCallId, errorText });
} else {
  emit("tool-output-available", { toolCallId, output });
}

// 客户端：错误不中断流程
onToolOutputError: (id, err) => { updateToolError(id, err); setStatus('answering'); },

// 全局兜底：区分 AbortError
catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  buffer.forceFlush(); finalizeCurrentMessage(); setError('网络错误，请重试');
}
```

---

### Q22：为什么不直接用 if-else？状态机比 if-else 好在哪？

**S（背景）**：可以用三个布尔变量（isThinking、isAnswering、isToolCalling）加 if-else 判断当前阶段。我一开始确实是这样做的。

**T（任务）**：if-else 方案开始出问题了，需要重构。

**A（方案）**：if-else 方案有三个问题。第一，判断逻辑散落在各个回调里，每次要加新状态得在所有相关分支里加条件，很容易漏。第二，三个布尔变量有 2^3=8 种组合，但只有 4 种是合法的——可能出现"isThinking 和 isAnswering 同时为 true"这种矛盾状态。第三，出了问题无法追踪——得同时检查多个变量的值才能知道"现在是什么状态"。状态机用一个 status 变量替代所有布尔变量，状态转移集中在一处，TypeScript 类型系统保证不会出现非法值，DevTools 能看到完整的状态变化日志。

**R（结果）**：重构后代码减少约 30%，状态追踪只需看一个变量。这个项目中 Function Calling 导致状态变化非常频繁，状态机是唯一可持续的方案。

---

## 三、渲染性能优化

### Q23：每个 chunk 都 setState，为什么导致 120 次/秒 re-render？React 不是自动合并吗？

**S（背景）**：LLM API 每秒推送 30-120 个 SSE chunk，每个 chunk 到达后触发一次 Zustand set()。

**T（任务）**：为什么 React 18 的自动批处理（Automatic Batching）解决不了这个高频 re-render 问题？

**A（方案）**：React 的自动批处理有个前提——多个 setState 要在同一个同步执行上下文里调用，React 才能合并。但流式场景中，每个 chunk 在 await reader.read() 之后到达，每次 await 恢复执行都在新的微任务里。每个 setState 都单独开了一个批处理窗口，互相合并不了。本质不是"每次 setState 太多"而是"setState 被分散到了 120 个不同的微任务里"。实测不用 buffer 时平均 85 次/秒 re-render，峰值 120 次。

**R（结果）**：找到了根因——不是 React 的问题，是异步循环导致了天然的"反批处理"效果。解决方案就是下一题的 StreamBuffer。

---

### Q24：buffer + requestAnimationFrame 怎么工作的？

**S（背景）**：上题发现每个 chunk 都 setState 导致高频 re-render。需要一种"攒一批再更新"的策略。

**T（任务）**：把 16ms 内到达的所有 chunk 合并为一次 setState，把 re-render 频率从 120 次降到 60 次以下。

**A（方案）**：写了一个 StreamBuffer 类。核心逻辑是 push 方法只往数组追加，不触发渲染——把"收到数据"和"渲染"解耦。同一帧内多次 push 只注册一次 requestAnimationFrame 回调。rAF 回调里 splice 取出所有积累的 delta、join 拼接、一次性写入 Zustand store。为什么用 rAF 不用 setTimeout？rAF 跟屏幕刷新率 60fps 同步，天然限频。后台标签页自动降频省资源。流结束时 forceFlush 不等下一帧立即清空，防止最后几个字符丢失。

**R（结果）**：re-render 频率从峰值 120 次降到平均 32 次/秒，稳定在 30-40。不是每帧都有新数据，所以实际低于 60fps 理论上限。

**核心代码：**

```typescript
export class StreamBuffer {
  private queue: string[] = [];

  push(delta: string) {
    this.queue.push(delta);                    // 只推不渲染
    if (this.rafId === null) this.scheduleFlush();  // 同一帧只调度一次
  }

  private flush() {
    const batch = this.queue.splice(0, this.queue.length);
    this.flushCallback(batch.join(''));   // 一次性写入 store
  }
}
```

---

### Q25："120 次降到 40 次"怎么测的？

**S（背景）**：做了性能优化后需要定量评估效果，不能只凭感觉。

**T（任务）**：精确测量优化前后的 re-render 频率，给出可信的数据对比。

**A（方案）**：用了三种方法交叉验证。第一种，React DevTools Profiler 录制流式输出过程，统计每秒的 commit 次数。第二种，直接在 Zustand setter 里埋计数器，用 performance.now() 计时每秒打印一次。为什么用 performance.now 而不用 Date.now？performance.now 是单调时钟，不受系统时间调整和 NTP 校时影响，精度亚毫秒级。第三种，useRef 在组件函数中自增计数，useEffect 每秒输出。

**R（结果）**：不加 buffer 时平均 85 次/秒、峰值 120。加上 buffer+rAF 后平均 32 次/秒、峰值 42。降幅来自两个因素——rAF 限频（不超 60fps）+ 批量合并减少调用次数。

**追问"有遇到过计时不准的情况吗"**：有四种情况。系统休眠时 performance.now 在 Windows 上继续走，可能误报几万毫秒的 Stall，需要加上限过滤。TTFB 包含了 TCP 握手阶段，拆不开网络延迟和 LLM 推理延迟。rAF buffer 让 tracker 记时比用户实际看到早 0-16ms。主线程繁忙时 reader.read 回调被推迟，记录的是回调执行时间而非数据到达时间。这些不是 bug，而是在设计指标时需要明确的定义边界——你测的到底是什么。

---

### Q26：虚拟滚动行高不确定怎么处理？

**S（背景）**：消息行高差异巨大——用户消息 40px，AI 回复含代码块可能 600px。虚拟滚动需要每行高度来计算总高度和可见范围。

**T（任务）**：在不渲染之前就要给出每行的高度估值，但实际高度要渲染后才能精确知道。

**A（方案）**：用 TanStack Virtual，提供了两层高度策略。第一层 estimateSize——渲染前给粗估值：用户消息 60px，AI 回复按内容长度分四档（100/160/280/400px）。第二层 measureElement——渲染后通过 ref 注册，自动测量真实高度并修正总高度和位置映射。流式输出中消息高度不断增长也没关系，因为 TanStack Virtual 内部用 ResizeObserver 监听 DOM 变化自动重新测量。

**R（结果）**：几百条消息的会话流畅滚动 60fps。估算偏差只影响首帧，下一帧就被 measureElement 修正。

**核心代码：**

```typescript
const virtualizer = useVirtualizer({
  estimateSize: (index) => {
    const msg = messages[index];
    if (msg.role === 'user') return 60;
    const len = msg.content.length;
    if (len < 50) return 100;
    if (len < 200) return 160;
    if (len < 500) return 280;
    return 400;
  },
  overscan: 5,
});
// 每行 ref={virtualizer.measureElement} 注册实际测量
```

---

### Q27：骨架屏怎么估高度？估不准怎么办？

**S（背景）**：AI 消息刚创建时 content 为空，如果渲染空 div（高度 0px），第一个 text-delta 到达后从 0px 突变到有内容的高度，抖动明显。

**T（任务）**：需要一个占位组件，在无内容时提供视觉反馈，同时减少高度突变。

**A（方案）**：设计了一个 StreamingSkeleton 组件——三条灰色条，长短不一（模拟段落节奏），总高约 72px，加上 animate-pulse 呼吸动画。72px 接近一条简短 AI 回复的高度，真实内容出现后高度变化可控。估小的后果是内容超出骨架后下面的元素被推，但逐步撑开比 0→400px 的突变好很多。估大的后果是轻微收缩，收缩的感知远弱于推挤。

**R（结果）**：消除了"空白等待→突现大段文字"的闪烁，用户始终看到加载中的视觉信号。

---

### Q28：overflow-anchor 是什么？怎么解决滚动跳动的？

**S（背景）**：流式输出时消息高度不断增长，如果用户正在读上方的历史消息，新内容会把它往下推。

**T（任务）**：让用户在阅读历史消息时不被下方内容增长干扰。

**A（方案）**：overflow-anchor 是 CSS 属性，控制浏览器滚动锚定行为。浏览器自动在视口顶部附近选一个 DOM 节点作为锚点，当锚点上方内容高度变化时自动调整 scrollTop 补偿偏移。我把它配置在流式输出的块级元素（p、li、h1-h4）上，这样代码块渲染或段落增长都不会让用户正在读的内容跳走。

**R（结果）**：跟虚拟滚动互补——虚拟滚动解决加新行的跳动，overflow-anchor 解决单行内容增长的跳动。用户在历史位置和底部之间自由切换，不会被动跳走。

```css
.markdown-body.streaming :where(p, li, h1, h2, h3, h4) {
  overflow-anchor: auto;
}
```

---

### Q29：未闭合 Markdown 块为什么导致布局偏移？怎么自动补全？

**S（背景）**：流式输出 Markdown 时，代码块标记（```）是分两步到达的。闭合之前内容被当普通段落渲染，闭合后变成代码块样式，高度突变几十倍。

**T（任务）**：消除从"普通段落"到"代码块"的样式突变带来的剧烈跳动。

**A（方案）**：写了一个 closeOpenMarkdownBlocks 函数。流式输出时统计 ```、`、** 的数量，奇数个说明未闭合，就在末尾临时补上闭合标记。ReactMarkdown 就能从一开始按"代码块"样式渲染，样式不变，只增长内容。补全可能多补一个标记（如果模型不打算写代码块），但下一个 chunk 到后修正回来——宁可临时按"多占空间"渲染，也不从"少占空间"突变成"多占空间"。

**R（结果）**：代码块从"普通文字样式→突然变几十倍"变成"代码块样式→内容继续增长"，视觉平滑很多。

**核心代码：**

```typescript
function closeOpenMarkdownBlocks(text: string): string {
  let result = text;
  const fences = result.match(/```/g);
  if (fences && fences.length % 2 !== 0) result += '\n```';
  const codes = result.match(/(?<!`)`(?!`)/g);
  if (codes && codes.length % 2 !== 0) result += '`';
  const bolds = result.match(/\*\*/g);
  if (bolds && bolds.length % 2 !== 0) result += '**';
  return result;
}
```

---

## 四、RSC（服务端组件）

### Q30：RSC 和客户端渲染的区别？分享页用 RSC 的好处？

**S（背景）**：分享页是用户通过链接查看历史聊天记录的页面，只读、不需要交互。

**T（任务）**：最小化分享页的客户端 JS 体积，同时保持 Markdown 渲染质量。

**A（方案）**：RSC 是服务端组件，在 Node.js 环境运行，可以 async、可以直接查数据库，但不能用 useState 等 Hook。客户端组件在浏览器运行，可以交互但不能直接访问数据库。分享页架构是 page.tsx（RSC）直接用 Prisma 查数据库 → 数据传给 SharePageClient.tsx（客户端组件）渲染 Markdown。好处是分享页加载零 API 请求、HTML 直出首屏快、客户端 JS 只有约 5.6KB（没有聊天功能、SSE、状态管理）。

**R（结果）**：分享页首屏加载快，SEO 友好（内容在服务端渲染为 HTML），同时标记渲染利用了客户端浏览器的能力（语法高亮插件需要 DOM）。

---

### Q31：RSC 能不能用 useState？哪些 Hook 不能用？怎么区分？

**S（背景）**：Next.js App Router 中组件默认是 RSC，但有些功能必须用客户端组件。

**T（任务）**：正确划分 RSC 和客户端组件的职责，避免写错。

**A（方案）**：useState、useEffect、useRef、useContext、useReducer、useCallback、useMemo 都不能在 RSC 里用，因为服务端无状态、无浏览器环境、只渲染一次。区分方式：文件顶部有 "use client" 就是客户端组件，没有就是 RSC。RSC 可以做 async/await、直接查数据库和文件系统、导入客户端组件。

**R（结果）**：项目中 RSC 负责数据获取，客户端组件负责交互和渲染，职责清晰。

---

## 五、SSE 性能监控

### Q32：TTFB、TTLB、Stall 三个指标怎么计算、怎么采集？

**S（背景）**：传统 HTTP 监控只有 TTFB 和总耗时，但 AI 流式场景有个独特痛点——中间卡顿。文字在输出突然停了半秒再继续，比整体慢更糟糕。

**T（任务）**：设计一套专用于流式传输的指标体系，覆盖首字节、整体完成、卡顿三个维度。

**A（方案）**：写了 SSEPerformanceTracker 类。TTFB = firstByteTime - startTime，TTLB = endTime - startTime，Stall 是相邻 chunk 间隔大于 500ms 判定为一次卡顿。500ms 阈值是基于 LLM API 正常 chunk 间隔 10-50ms 倒推的——500ms 意味着约 10-50 个 token 的延迟，用户明显感知。计时用 performance.now()（单调时钟，不受系统时间调整影响）而不是 Date.now()（挂钟时间，可能回跳）。采集链路：tracker 记录 → IndexedDB 离线队列 → 每 10 秒批量上报 → 服务端入库 → ECharts 后台展示。

**R（结果）**：监控数据从客户端到后台形成完整闭环，P50/P90/P99 统计 + 健康评分能量化分析流式传输质量。

**核心代码：**

```typescript
class SSEPerformanceTracker {
  onChunk() {
    const now = performance.now();
    if (this.chunkCount === 0) this.firstByteTime = now;
    if (this.lastChunkTime > 0) {
      const gap = now - this.lastChunkTime;
      if (gap > 500) { this.stallCount++; this.totalStallDuration += gap; }
    }
    this.lastChunkTime = now;
  }
  finish() {
    const ttfb = this.firstByteTime - this.startTime;
    const ttlb = performance.now() - this.startTime;
  }
}
```

---

### Q33：sendBeacon 怎么解决页面卸载时数据丢失？

**S（背景）**：监控数据在 IndexedDB 队列中，每 10 秒上报一次。但用户可能在任何时刻关闭标签页——定时器最后几秒的数据会丢失。

**T（任务）**：保证页面卸载时队列中的数据能被成功发送。

**A（方案）**：普通 fetch 请求绑定页面生命周期——页面卸载后浏览器可能直接杀掉进程，请求发不出去。sendBeacon 是专门为这个场景设计的——浏览器内部排队处理，即使页面销毁也在后台完成，不绑定页面生命周期。我设计了双通道上报：优先 sendBeacon（发完就走，但不能自定义 Header、拿不到响应），失败降级到 Fetch + keepalive。三层触发保证不漏：每 10 秒定时器、visibilitychange 切后台、beforeunload 卸载时。

**R（结果）**：正常退出、切后台、关闭标签页三种场景全覆盖。上线后未发现数据丢失。

---

### Q34：IndexedDB 离线队列怎么保证不丢？会不会重复上报？

**S（背景）**：监控数据需要持久化存储——内存变量页面刷新就没了。

**T（任务）**：用 IndexedDB 实现离线队列，保证数据不丢。

**A（方案）**：核心策略是上报成功才删除。每 10 秒取所有数据，一批最多 20 条。sendBeacon/Fetch 发送 → 成功就逐条删除，失败就保留下次重试。不需要监听 online/offline 事件——定时器一直在跑，网络恢复自动重试。页面刷新数据在 IndexedDB 里不会丢。重复上报基本不会——每条有唯一 ID，上报完立即删除。极端情况（上报成但删除前崩溃）极小概率，服务端可按 metric.id 去重。这是"至少一次送达"模型，对监控指标可以接受。

**R（结果）**：网络断开、刷新、标签页关闭都测过，数据不丢。

---

### Q35：P50/P90/P99 是什么意思？为什么不用平均值？

**S（背景）**：管理后台需要展示流式延时的统计数据。

**T（任务）**：选择合适的统计方法，能真实反映用户体验。

**A（方案）**：P50 是中位数——50% 请求延迟 ≤ 此值。P90 是 90% 请求 ≤ 此值。P99 是 99% 请求 ≤ 此值。不用平均值是因为它对极端值极度敏感——99 次 100ms、1 次 30000ms，平均值 399ms，但 99% 用户只等了 100ms。平均值不反映任何实际用户。P50 反映典型用户，P90 反映比较倒霉的 10%，P99 反映极端尾部的 1%。

**R（结果）**：管理后台展示 TTFB 和 TTLB 的 P50/P90/P99 三列，配合健康评分机制能快速判断流式传输的整体质量。

---

## 六、安全

### Q36：JWT 为什么要放 HttpOnly Cookie？

**S（背景）**：JWT token 需要在客户端存储，可选的方案有 localStorage、sessionStorage、内存、Cookie。

**T（任务）**：选择最安全的存储方式，防止 token 泄露。

**A（方案）**：HttpOnly Cookie 最大的特点是 JS 完全读不到——document.cookie 拿不到。如果放 localStorage，任何 XSS 注入的恶意脚本都能窃取 token。HttpOnly 模式下即使 XSS 成功，攻击者只能"使用"（浏览器自动携带），不能"窃取"持久化。另外我还加了 secure（生产环境仅 HTTPS）和 sameSite:'lax'（防 CSRF 跨站攻击）。

**R（结果）**：三层 Cookie 属性（httpOnly + secure + sameSite）同时防护 XSS、中间人、CSRF 三种攻击。

---

### Q37：XSS 有哪几种类型？你做的 rehype-sanitize 防哪种？

**S（背景）**：AI 可能被诱导输出恶意 HTML，内容存入数据库后任何浏览聊天记录的用户都可能被攻击。

**T（任务）**：防止 AI 输出的恶意 HTML 在用户浏览器中执行。

**A（方案）**：XSS 分三种——存储型（恶意数据存数据库）、反射型（恶意代码在 URL 参数回显）、DOM 型（纯客户端 JS 写入不可信数据）。这个项目主要防存储型，因为 AI 回复存在数据库里。用 rehype-sanitize 插件，在 react-markdown 渲染时做白名单过滤：允许 p、code、a 等安全标签，删除 script、iframe、form 等危险标签，删除所有 on* 事件属性，过滤 javascript: 协议。

**R（结果）**：危险内容在到达 DOM 前就被拦截，用户浏览任何聊天记录都不会执行恶意脚本。

---

### Q38：rehype-sanitize 白名单机制是什么？

**S（背景）**：需要了理 sanitiize 的工作原理和配置方式。

**T（任务）**：用白名单过滤 AI 输出内容，只放行安全的 HTML 元素。

**A（方案）**：白名单就是只放行已知安全的标签和属性，其余全删。黑名单的问题是永远列不完新攻击向量。默认白名单涵盖了 Markdown 需要的所有标签——标题 h1-h6、段落 p、列表 ul/ol/li、表格、代码 pre/code、链接 a、图片 img、引用等。删除的包括 script、iframe、object、embed、form、input、style 等。属性层面：href 只允许 http/https/mailto，javascrip: 被清空，所有 on* 事件属性全删。sanitize 插件放在 rehypeHighlight 之前——先过滤危险内容，再做语法高亮。

**R（结果）**：使用默认 GitHub 兼容 schema 即可满足需求，不需要自定义白名单。
