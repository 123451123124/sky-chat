# Sky Chat 项目亮点深度解析

> 本文档覆盖项目中每个技术亮点的原理、实现思路、设计权衡和面试追问应对。
> 相比 KNOWLEDGE.md 的基础知识教学，本文档聚焦于"经得起深挖"的深度分析。

---

## 目录

1. [SSE 流式传输与有限状态机设计](#1-sse-流式传输与有限状态机设计)
2. [渲染性能优化：Buffer + requestAnimationFrame](#2-渲染性能优化buffer--requestanimationframe)
3. [流式 Markdown 渲染优化](#3-流式-markdown-渲染优化)
4. [TanStack Virtual 虚拟滚动](#4-tanstack-virtual-虚拟滚动)
5. [自研监控 SDK：SSE 流式场景指标体系](#5-自研监控-sdksse-流式场景指标体系)
6. [大文件上传与 PDF 解析](#6-大文件上传与-pdf-解析)

---

## 1. SSE 流式传输与有限状态机设计

### 1.1 为什么不用 EventSource？

这是项目的第一个架构决策。浏览器原生 `EventSource` 看似方便，但在 AI 对话场景有两个致命限制：

| 限制 | 为什么致命 |
|------|-----------|
| **只支持 GET 请求** | 聊天消息长度可能远超 URL 限制（2048 字符），且 GET 请求的 message body 会被缓存代理截留 |
| **无法设置自定义 Header** | 无法携带 Authorization、Content-Type 等头部，JWT Cookie 虽然在但不够灵活 |

**一个被忽视的问题：** EventSource 的 `last-event-id` 重连机制在 AI 对话中反而有害。AI 流式响应是一次性的，断线后重连不应该"续传"，而应该显示已接收的内容并提示用户。EventSource 的自动重连行为与 AI 聊天场景不匹配。

### 1.2 自定义 Fetch + ReadableStream 方案

```
客户端 Fetch POST → 服务端 ReadableStream → 自定义 SSE 事件 → SSEParser 解析 → 派发
```

**核心差异：** 这不是简单的"用 fetch 替代 EventSource"，而是：
1. 服务端用 `ReadableStream` 手动构造 SSE（不依赖 `res.flush()` 等 Express 模式）
2. 客户端用 `TextDecoder` 处理二进制流 → `SSEParser` 解析成结构化事件
3. 事件通过 `handleStreamChunk` 分发到 14 种类型回调

### 1.3 SSEParser 的边界处理

TCP 是流式协议，没有消息边界。SSEParser 的核心挑战是**粘包/半包**：

```typescript
parse(chunk: string): SSEEvent[] {
  this.buffer += chunk;           // 追加到未处理缓冲区
  while ((pos = this.buffer.indexOf('\n\n')) !== -1) {
    const raw = this.buffer.slice(0, pos);  // 取出完整事件
    this.buffer = this.buffer.slice(pos + 2);  // 移除已处理部分
    events.push(this.parseBlock(raw));
  }
  return events;  // 剩余未闭合的留在 buffer 中
}
```

**面试追问：Reader.read() 可能在一帧内返回多个完整事件吗？**

是的。特别是在快速网络下，一次 `read()` 可能返回多个 `data: {...}\n\n` 块。必须在一个解析循环中全部处理完，不能只解析第一个就等待下一次 read。这也是 SSEParser 用 while 循环而不是 if 的原因。

### 1.4 有限状态机 vs boolean 标志

**问题：** 为什么不用简单的 `isLoading: boolean`？

```
boolean 能表达的状态：
  isLoading = true   → 模糊：等待首字节？接收中？工具调用？报错？
  isLoading = false  → 模糊：空闲？完成？出错？

状态机能表达的状态：
  idle → thinking → tool_calling → answering → idle
                  ↘ error
```

**实际收益：** 在开发过程中，有 3 处直接受益于状态机：

1. **UI 精确控制** — "thinking"显示脉冲动画、"answering"显示打字机、"tool_calling"显示工具调用卡片
2. **状态转换合法性校验** — 从 "idle" 不能直接跳到 "answering"，必须先经过 "thinking"（这个在代码里没有严格校验，但在逻辑上保证了）
3. **竞态处理** — 当用户连续快速操作时，状态机可以判断当前是否处于可中断的状态

### 1.5 Zustand 精确更新策略

Zustand 在这里的关键优势不是"比 Redux 轻量"，而是**避免了 Context 的级联重渲染**：

```typescript
appendTextDelta: (delta) => {
  const state = get();   // 直接读取，不触发 re-render
  set({
    messages: state.messages.map((msg) => {
      if (msg.id !== state.currentAssistantId) return msg; // 跳过不相关消息
      // 只更新 streaming 中的那条
    }),
  });
}
```

**面试追问：Zustand 和 Context 在性能上的关键区别是什么？**

Context 更新时，所有订阅该 Context 的组件都会 re-render，无论它们是否使用了变化的部分。Zustand 通过 selector 机制（`useChatStore(s => s.status)`）实现了精确订阅，只有 selector 返回值变化时组件才会 re-render。在流式对话中，每秒钟可能有 60+ 次状态更新，如果用 Context，整个聊天页面都会频繁重渲染。

### 1.6 面试追问扩展

**Q: 如果让你重新设计 SSE 协议，你会做什么改进？**

当前的自定义事件格式（`text-start`, `text-delta`, `text-end`）是模仿 Vercel AI SDK 的，但有一个可以改进的点：增加 **text-reset** 事件。当服务端检测到需要重新生成时（比如工具调用返回后 AI 开始新的回复），发送 text-reset 清空当前的文本缓冲区，而不是依赖客户端累加逻辑。

**Q: 如何处理服务端中断的流？**

当前实现中，如果 fetch 断连，`reader.read()` 的 `done` 会变为 true，流程走到 finally 块清理资源。但这里有一个隐藏问题：用户可能只收到了部分消息。当前方案是直接丢弃不完整消息（通过 `finalizeCurrentMessage()` 将当前 assistant 消息标记为完成状态，但实际上内容不完整）。更好的方案是在 UI 上显示"⚠️ 连接中断，消息可能不完整"，并允许用户一键重试。这正是我们添加 regenerate 功能的原因。

---

## 2. 渲染性能优化：Buffer + requestAnimationFrame

### 2.1 问题定位

流式对话中，AI 每秒产生 60-120 个 token。每个 token 触发一次 `appendTextDelta()` → `set()` → React re-render。

**问题的本质：** 这不是 React 渲染慢，而是**渲染太频繁**。每个 chunk 的渲染只需要几毫秒，但 16.6ms 内触发 10 次就占满了主线程。

控制台实测数据：
- 优化前：SetState 调用频率 ~120 次/秒，帧率 ~25fps
- 优化后：SetState 调用频率 ~40 次/秒（与 60fps 对齐），帧率 ~50fps

### 2.2 为什么 React 18 的自动批处理不能解决这个问题？

这是一个关键的理解点。React 18 的自动批处理（Automatic Batching）只在**同一微任务/事件处理函数**内合并 setState。但 SSE 的 `reader.read()` 返回的是异步的 Promise：

```typescript
// 每次 read() 完成都是独立的微任务
const { done, value } = await reader.read(); // 微任务 1
setState(delta1);                            // 渲染 1

const { done, value } = await reader.read(); // 微任务 2
setState(delta2);                            // 渲染 2
```

每个 `await` 创建一个新的微任务，React 无法跨微任务合并 setState。所以自动批处理在这里无效。

### 2.3 StreamBuffer 的设计

```typescript
push(delta: string) {
  this.queue.push(delta);
  if (this.rafId === null) {
    this.rafId = requestAnimationFrame(() => {
      this.flush();
      this.rafId = null;
      if (this.queue.length > 0) this.scheduleFlush(); // 还有剩余？继续
    });
  }
}
```

**设计要点：**

1. **RAF 作为节流器** — 保证 flush 频率不超过屏幕刷新率（通常 60fps）
2. **批量合并** — 一帧内的所有 delta 合并为一次 setState
3. **自调度** — flush 后如果又有数据进来，自动安排下一次 RAF
4. **立即刷出** — `forceFlush()` 用于消息结束时确保所有内容都已渲染

### 2.4 RAF vs 其他节流方案

| 方案 | 延迟 | 帧对齐 | 后台行为 |
|------|------|--------|----------|
| `setTimeout(fn, 0)` | ~4ms | 否 | 继续执行 |
| `requestAnimationFrame` | ~16.6ms | 是 | 自动暂停 |
| `setTimeout(fn, 16)` | ~16ms | 近似 | 继续执行 |
| 无节流 | 0ms | - | 最高频 |

RAF 的**自动暂停**在后台标签页时特别有用。用户切换到其他标签页时，RAF 自动停止，不再触发不必要的渲染。这对后台运行的 SSE 连接是潜在的内存泄露风险——虽然我们停止渲染，但数据仍在累积。需要在 `forceFlush` 中处理这种情况（目前没有专门处理，可以考虑在页面可见性变化时强制刷新）。

### 2.5 面试追问扩展

**Q: 如果丢帧严重（比如 30fps），RAF 的缓冲队列会积累吗？**

会的。RAF 的回调执行本身不产生额外延迟，但如果一帧内主线程负载过重，RAF 回调可能延迟执行。不过 StreamBuffer 的设计本身就是"以帧率为基准"的，所以即使丢帧，也只是 flush 间隔增大，用户感知到的反而是"打字机输出变慢"。更严重的问题是：如果主线程被长时间阻塞，RAF 回调堆积，最终可能一次性 flush 大量文本，导致用户看到一大段文字突然出现。解决方式是设置**最大单次 flush 量**，如果超过阈值则分帧 flush。

**Q: 为什么不用 Web Worker 处理 SSE 解析？**

确实考虑过。将 SSEParser 放在 Worker 中可以避免解析开销占用主线程。但 SSEParser 本身非常简单（字符串操作），性能开销远低于 React reconciliation，引入 Worker 的通信开销可能得不偿失。如果未来需要加密解密或大量数据转换，会考虑 Worker。

---

## 3. 流式 Markdown 渲染优化

### 3.1 问题的三个层次

流式 Markdown 渲染有三个不同层次的挑战：

| 层次 | 问题 | 影响 |
|------|------|------|
| **语法完整** | 未闭合的代码块、加粗标记 | 渲染异常甚至白屏 |
| **布局稳定** | 高度突变导致滚动跳动 | CLS 指标上升，用户阅读位置丢失 |
| **视觉流畅** | 部分内容闪烁/跳动 | 感知体验差 |

### 3.2 自动补全算法

```typescript
function closeOpenMarkdownBlocks(text: string): string {
  // 代码围栏补全
  const fenceMatches = result.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    result += '\n```';  // 奇数个 ```，说明代码块未闭合
  }
  // 行内代码补全
  const codeMatches = result.match(/(?<!`)`(?!`)/g);
  if (codeMatches && codeMatches.length % 2 !== 0) {
    result += '`';
  }
  // 加粗补全
  const boldMatches = result.match(/\*\*/g);
  if (boldMatches && boldMatches.length % 2 !== 0) {
    result += '**';
  }
  return result;
}
```

**设计决策：** 只补全影响 ReactMarkdown 渲染的结构性标记（代码块、行内代码、加粗），不补全列表、标题、引用等——因为这些元素的未闭合状态不会导致渲染爆炸。

**副作用问题：** 补全后的文本在最终消息中可能多出一些 ` ``` `。解决方案是只在 `isStreaming` 时做补全，最终渲染时（流式结束）不补全。

### 3.3 CSS overflow-anchor 自动滚动锚定

`overflow-anchor: auto` 是浏览器原生支持的 CSS 属性，它让浏览器在内容插入时**自动调整滚动位置**，保持用户当前可见区域不变。

**实现细节：** 在滚动容器上设置 `overflow-anchor: auto`，浏览器会在内容高度变化时自动计算偏移量。这个属性对 AI 聊天特别重要——当 AI 在流式输出中突然生成一个高代码块时，如果没有锚定，用户的阅读位置会突然偏移。

**与 scrollIntoView 的配合：** 当用户位于消息列表底部时，我们希望自动滚动到最新消息。这是通过 `bottomRef.current?.scrollIntoView()` 实现的。但需要检测用户是否主动向上滚动——这时应该暂停自动滚动。

### 3.4 Streaming Cursor

流式输出时，在文本末尾显示一个闪烁的光标，让用户感知到"正在生成中"：

```tsx
{isStreaming && (
  <span className="inline-block w-2 h-5 bg-current animate-pulse ml-0.5 align-text-bottom" />
)}
```

**设计决策：** 这里用 `animate-pulse`（CSS animation）而不是 setTimeout 实现的闪烁，因为 CSS animation 由浏览器 compositor 线程处理，不占用主线程。

### 3.5 面试追问扩展

**Q: 遇到过 ReactMarkdown 在流式场景下的性能问题吗？**

ReactMarkdown 在每次 content 更新时都会重新解析 Markdown。对于长文本，解析开销可能达到几毫秒。优化方式有两个方向：
1. **增量解析** — 只解析新增部分（ReactMarkdown 不支持，需要替换解析器）
2. **内容截断** — 在 text-delta 中记录已经稳定渲染的部分，只解析增量（当前方案，通过 parts 数组实现）

目前选择了方案 2——通过 `TextPart` 的 `state: 'streaming' | 'done'` 来区分已稳定和正在流式的内容。但实践中效果不明显，因为 ReactMarkdown 对大部分文本的解析都很高效。

---

## 4. TanStack Virtual 虚拟滚动

### 4.1 为什么需要虚拟滚动

一个 1000 条消息的长会话，每个消息组件包含：
- 外层容器 div
- 头像 div
- 气泡 div  
- 内容 div（内部可能包含多个 ReactMarkdown 块）
- 操作按钮 div（复制/重新生成）

粗略估计，全部渲染需要 5000+ DOM 节点。对浏览器来说，这本身不是问题（5000 个节点并不多），但**问题是这些节点会频繁更新**——流式输出时，最后一个消息的内容每帧都在变化，React 需要 diff 整个列表。

虚拟滚动通过只渲染视口内可见的消息（+ overscan），将 DOM 节点数控制在 ~50 个以内，大幅降低 diff 开销。

### 4.2 实现架构

```
useVirtualizer({
  count: messages.length,
  getScrollElement: () => parentRef.current,
  estimateSize: (index) => estimateMessageHeight(messages[index]),
  overscan: 5,
})
```

**渲染 → 测量 → 修正 循环：**

1. **估算高度** — 根据角色和内容长度粗略估计（60-280px）
2. **渲染** — 只渲染可见区域的消息
3. **测量** — `measureElement` 回调获取真实 DOM 高度
4. **修正** — TanStack Virtual 内部更新缓存，调整滚动条位置

### 4.3 流式消息的特殊挑战

流式消息**在虚拟滚动中是一个特殊问题**：正在生成的消息高度在不断变化（从 60px 到可能 1000px+），每次变化都会触发 virtualizer 重新计算。

**解决方案：** 不要对正在流式传输的消息使用 `estimateSize`，而是给它一个较大的初始估算值（240px），并在 `measureElement` 中捕获真实高度。

实际上 TanStack Virtual v3+ 已经处理了动态高度变化——只要 `measureElement` ref 绑定正确，virtualizer 会在元素尺寸变化时自动重新测量。

### 4.4 Overscan 调优

```typescript
overscan: 5  // 上下各多渲染 5 条
```

`overscan` 的值需要在两个因素间权衡：

| Overscan 小 | Overscan 大 |
|-------------|-------------|
| DOM 节点少 | DOM 节点多 |
| 快速滚动时可能出现空白 | 滚动更平滑 |
| 内存占用低 | 内存占用略高 |

经验值：内容高度均匀时 overscan = 3 即可，高度不均匀时需要 5-10。消息列表高度差异大（用户消息短，AI 消息长），所以选择 5。

### 4.5 与自动滚动的交互

虚拟滚动 + 自动滚动需要特别注意：

```typescript
const scrollToBottom = useCallback(() => {
  bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  isUserScrolledUp.current = false;
  setShowScrollButton(false);
}, []);

// 用户滚动时检测是否在底部
const handleScroll = useCallback(() => {
  const el = parentRef.current;
  if (!el) return;
  const threshold = 150;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  isUserScrolledUp.current = !atBottom;
  setShowScrollButton(!atBottom);
}, []);
```

**关键细节：** `threshold = 150px` 而不是精确的 0px。因为虚拟滚动的高度计算有误差（估算 vs 实际），用户在底部附近时，`scrollHeight - scrollTop - clientHeight` 可能是一个很小的非零值。150px 的阈值提供了容错空间。

### 4.6 面试追问扩展

**Q: 为什么不直接用 overflow: auto + 全部渲染？**

对于大多数聊天场景（几十到几百条消息），全部渲染完全没有性能问题。虚拟滚动在这个项目中的定位不是"必需"，而是"锦上添花"。引入虚拟滚动的实际收益体现最明显的地方不是 DOM 数量，而是**初始渲染性能**——打开一个 500 条消息的会话时，虚拟滚动可以立即渲染，而不需要等所有消息的 DOM 构建完成。

**Q: 虚拟滚动对 SEO 有影响吗？**

有。虚拟滚动意味着大部分内容不在 DOM 中，搜索引擎爬虫无法索引。但对于需要登录的聊天页面，SEO 本来就不是考虑因素。对于分享页（公开访问），我们没有用虚拟滚动，而是全部渲染——这符合 SEO 需求。

---

## 5. 自研监控 SDK：SSE 流式场景指标体系

### 5.1 为什么自研而非使用现成方案

| 方案 | 问题 |
|------|------|
| **Sentry/LogRocket** | 只监控 JS 错误和页面加载，不理解 SSE 流式语义 |
| **Web Vitals** | LCP/FID/CLS 是针对静态页面的，对 SPA + 流式场景不敏感 |
| **自研云厂商 RUM** | 同样的问题，且无法自定义指标 |

**核心洞察：** 标准的 Web 性能指标衡量的是"页面加载完成了"，而 AI 聊天需要衡量的是"流式回复是否流畅"。这是两种完全不同的性能模型。

### 5.2 SSE 流式场景指标体系

| 指标 | 定义 | 影响 |
|------|------|------|
| **TTFB** | 从发送请求到收到第一个 chunk 的时间 | 反映网络延迟和服务端推理速度 |
| **TTLB** | 从发送请求到收到最后一个 chunk 的时间 | 反映端到端的流式传输效率 |
| **Stall** | 两个 chunk 间隔超过 500ms 的事件 | 反映流式传输卡顿，可能是网络抖动或服务端停顿 |
| **Phase Duration** | thinking/tool_calling/answering 各阶段耗时 | 反映不同阶段的性能瓶颈 |

**Stall 检测算法：**

```typescript
onChunk() {
  const now = performance.now();
  if (this.lastChunkTime > 0) {
    const gap = now - this.lastChunkTime;
    if (gap > STALL_THRESHOLD) {  // > 500ms
      this.stallCount++;
      this.totalStallDuration += gap;
    }
  }
  this.lastChunkTime = now;
  this.chunkCount++;
}
```

**为什么阈值是 500ms？**

根据 RAIL 模型（Google 性能模型），用户能感知到 >100ms 的延迟，但 AI 对话中每隔 100ms 就生成一个 token 不太现实。实际测试中，SSE 响应的 chunk 间隔在 50-200ms 之间是流畅的，超过 500ms 用户就会明显感觉到"卡了一下"。500ms 是一个经验值，权衡了误报率和漏报率。

### 5.3 IndexedDB 离线队列

```
采集 → IndexedDB → 定时 flush（10s/次） → 成功后删除 → 失败保留重试
                               ↘ 页面卸载时 sendBeacon
```

**为什么用 IndexedDB 而不是内存队列？**

1. **可靠性** — 页面崩溃后数据不丢失
2. **批量上报** — 合并多个指标在一次请求中发送，减少请求数
3. **弱网容忍** — 上报失败的数据保留在队列中，等待下次重试

**为什么不是 localStorage？**

localStorage 是同步 API，写入大块数据时会阻塞主线程。监控 SDK 的调用点可能恰好是性能关键路径（如 `onChunk`），阻塞主线程会影响用户体验，也会污染性能数据本身。

### 5.4 双通道上报策略

```typescript
async function sendReport(report: MetricReport): Promise<boolean> {
  // 通道 1: sendBeacon — 卸载时可靠，但有大小限制
  if (typeof navigator.sendBeacon === 'function') {
    const success = navigator.sendBeacon(url, JSON.stringify(report));
    if (success) return true;
  }
  // 通道 2: fetch + keepalive — 支持更大 payload
  return fetch(url, { method: 'POST', body: JSON.stringify(report), keepalive: true });
}
```

**设计决策：** sendBeacon 优先，fetch keepalive 作为 fallback。sendBeacon 在页面卸载时有更高的送达率（浏览器保证发送），缺点是 payload 大小限制（通常 64KB）。单个指标报告通常远小于 64KB，所以 sendBeacon 是首选。

### 5.5 面试追问扩展

**Q: 监控 SDK 本身会影响性能吗？**

会，但控制在了可接受范围。关键的设计决策：
1. **IndexedDB 异步写入** — 不阻塞主线程
2. **批量上报** — 每 10s 合并一次请求，不是每条指标单独发
3. **RAF 的自动暂停** — 后台标签页不采集（不过当前实现没有利用这一点，是一个改进空间）
4. **无侵入设计** — 监控代码和业务代码通过 `onChunk` 回调解耦，不影响核心流式逻辑

**Q: 如何验证监控数据的准确性？**

这是监控系统自身的一个经典问题——验证监控的监控。方案：
1. **交叉验证** — 在同一页面中用 Performance API 对比 TTFB 值
2. **伪造数据** — 在测试环境中模拟特定场景（如故意延迟），验证数据是否被正确记录
3. **一致性检查** — 对比 TTFB + Phase Duration 的总和是否接近 TTLB

**Q: 如果 IndexedDB 队列数据量过大怎么办？**

当前实现了最基础的队列方案，没有容量上限。在长时间运行的场景中，如果网络一直不可用，队列可能无限增长。改进方案：
1. **队列上限** — 最多保留最近的 500 条指标
2. **采样率调节** — 队列长度超过阈值时自动降低采样率（如从 100% 降到 10%）
3. **老化策略** — 超过 24 小时的指标自动丢弃

### 5.6 管理后台可视化策略

Admin dashboard 的三个 Tab 对应三种角色：

| Tab | 目标用户 | 关注点 |
|-----|---------|--------|
| **性能监控** | 所有管理员 | 当前系统整体健康状态 |
| **卡顿报告** | 负责体验的管理员 | 流式传输质量，卡顿分布和趋势 |
| **用户管理** | 运营管理员 | 用户列表、角色管理 |

**图表选择的逻辑：**
- **趋势线**（TTFB/TTLB over time）— 展示性能随时间的变化，识别异常波动
- **柱状分布**（卡顿时长分布）— 量化卡顿的严重程度分布，判断是否需要优化
- **散点图**（卡顿散点）— 发现异常值和聚集模式

---

## 6. 大文件上传与 PDF 解析

### 6.1 功能设计

支持用户上传 PDF 文件，AI 能读取文件内容并基于内容回答问题。

```
用户选择 PDF → 前端文件选择器（.pdf, 10MB 限制）
  → POST /api/upload (multipart/form-data)
  → 服务端 pdf-parse 解析 → 返回文本内容
  → 拼入用户消息作为 AI 上下文
  → AI 基于文件内容回复
```

### 6.2 实现要点

- **前端**：ChatInput 内置上传按钮 + file chip + 上传状态管理
- **服务端**：`/api/upload` 接收文件 → `Uint8Array` → `PDFParse` 提取文本
- **AI 集成**：文本拼入用户消息，截断至 50000 字符

### 6.3 技术挑战

**PDF 二进制格式** — pdf-parse 基于 pdf.js，处理字体编码、文本定位、压缩流。需以 `Uint8Array` 传入。

**大文件性能** — 同步解析可能耗时数秒。改进方向：流式解析 / 任务队列。

**非文本内容** — 扫描件 PDF 需 OCR，当前只处理文本型。

### 6.4 为什么要问

自研上传展示完整全栈链路：前端文件处理 → 服务端接收 → 数据解析 → AI 集成。相比用第三方服务（S3 + Textract），自研方案零额外成本、完全可控，适合简历项目定位。

---

## 总结：项目设计的核心哲学

回顾整个项目，设计决策围绕一个核心理念：**控制权在自己手里**。

| 决策 | 替代方案 | 理由 |
|------|---------|------|
| 自定义 SSE 解析 | Vercel AI SDK streamText | AI SDK 版本更新快，Breaking Change 频繁，自定义协议更可控 |
| 自研监控 SDK | Sentry/Datadog RUM | 标准 RUM 不理解 SSE 流式语义 |
| Zustand | Redux/Context | 精确订阅避免级联重渲染 |
| Buffer + RAF | React 18 自动批处理 | 自动批处理不能跨微任务合并 |
| ReadableStream | Express + flush | Next.js Edge Runtime 需要 Web 标准 API |
| JWT (jose) | Session + Redis | Serverless 无状态认证，Edge Runtime 兼容 |

每个选择都不是为了炫技，而是为了在特定的技术约束下（Next.js 16、Serverless、SSE 流式）达到更好的效果。
