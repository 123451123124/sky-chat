# 快手 AI应用开发工程师-前端技术 · 面试标准答案

> 基于 Sky Chat AI对话平台 + BHWebClient工业监测平台 × 岗位JD
> 7 模块 41 题 | 每题含：标准答案 + 追问及答案
> 答案策略：贴合项目实际 + 适当美化符合普遍开发标准，可口述、有深度（第三层）

---

## 备考核心心法

**第三层深度回答框架：** 做了什么（What）→ 为什么这么做（Why）→ 怎么验证有效（How to verify）

**STAR 法则：** S（背景）→ T（任务）→ A（方案）→ R（结果）

**答题节奏：** 先给结论（30秒）→ 展开细节（1-2分钟）→ 主动抛出权衡/踩坑（展现深度）

---

# 模块一：Sky Chat 项目深挖（10题）⭐核心

## M1-1. 你用 Fetch + ReadableStream 实现 SSE 而不是 EventSource，为什么？两者本质区别是什么？

> **考察点：** SSE底层原理 + 技术选型决策

**标准答案：**

本质区别在于 EventSource 是浏览器封装的 SSE 消费者，而 Fetch + ReadableStream 是我基于 Web 标准手动实现的流式消费链路。选 Fetch 是因为 EventSource 有三个致命限制：

1. **只支持 GET 请求** —— AI 聊天需要把消息历史、模型参数、搜索开关等数据放 POST Body 里发送，消息可能上千 token，拼在 URL 上会超长度限制且被缓存代理截留。
2. **不支持自定义 Header** —— 无法携带 Authorization、Content-Type 等头部，鉴权只能依赖 Cookie，灵活性不足。
3. **自动重连机制对 AI 场景有害** —— EventSource 断线后会用 `last-event-id` 自动重连续传，但 AI 流式响应是一次性的，断线重连不应该"续传"，而应该保留已接收内容并提示用户手动重试。

我的方案是：Fetch 发 POST 请求 → `response.body.getReader()` 拿 ReadableStream → `TextDecoder` 解码 → 自研 `SSEParser` 按 `\n\n` 切割事件 → 分发到 14 种类型回调。代价是多了约 60 行 SSEParser 代码处理 TCP 粘包，但换来了 POST Body、自定义 Header、AbortController 取消请求的完全控制权。

**追问 1：Reader.read() 一次可能返回多个完整事件吗？**

可能。特别是在快速网络下，一次 `read()` 返回的 chunk 里可能包含多个 `data: {...}\n\n` 块。所以 SSEParser 必须用 `while` 循环把所有完整事件都解析出来，剩余不完整的（没有 `\n\n` 结尾的）留在 buffer 里等下一次。如果只解析第一个就返回，会丢事件。

**追问 2：为什么不直接用 Vercel AI SDK 的 useChat？**

考虑过。但 AI SDK 版本更新快，v3→v4→v5→v6 事件协议多次 breaking change，生产稳定性差。自定义协议可控性更强，也让我真正理解底层（面试能讲到原理）。另外 useChat 的抽象在多步推理（thinking→tool_calling→answering）场景下定制成本高，不如自己控制状态机灵活。

---

## M1-2. thinking → tool_calling → answering 多步推理，前端如何设计 UI 状态机驱动渲染？

> **考察点：** AI应用前端状态管理 + 流式渲染架构

**标准答案：**

核心是不用 `isLoading: boolean`，而是用有限状态机。boolean 的问题在于语义模糊：`true` 时到底是等待首字节、接收中、还是工具调用？`false` 是空闲、完成、还是出错？

我定义的状态枚举是：

```
idle → thinking → answering → idle
                 ↘ tool_calling → answering → idle
                                ↘ error
```

状态机驱动渲染的设计要点：

1. **状态映射 SSE 事件** —— `step-start` 事件触发状态切换；`reasoning-start` 进 thinking；`tool-input-start` 进 tool_calling；`text-start` 进 answering；`finish` 回 idle。
2. **三种状态的 UI 区分** —— thinking 阶段显示脉冲折叠动画（推理过程可选展开）；tool_calling 阶段暂停文本渲染，显示工具调用卡片（工具名+参数+等待状态）；answering 阶段实时渲染打字机效果。
3. **Function Calling 暂停渲染** —— 进入 tool_calling 时，当前文本 part 标记为 `done`，等待 `tool-output-available` 事件回来后，开新的 text part 续写，避免工具调用前后的文本混在一起。

状态存在 Zustand store 里，组件通过 selector 精确订阅 `status` 字段，只有状态变化才重渲染，避免流式高频更新触发全页重渲染。

**追问 1：状态转换合法性怎么校验？**

逻辑上保证转换路径合法：从 idle 不能直接跳到 answering，必须先经过 thinking。代码里用 switch-case 处理，非法转换打 warning 日志便于排查。虽然没做强校验抛错（避免流式中断），但状态机的设计本身就约束了流程，开发时能快速发现逻辑错误。

**追问 2：用户中途点停止，状态机怎么处理？**

调用 `AbortController.abort()` 终止 fetch → 状态机回 idle → `forceFlush()` 清空渲染缓冲确保已收内容都渲染 → 当前 assistant 消息标记为"已停止"状态。如果是在 tool_calling 阶段中断，需要额外清理工具调用的 pending 状态，避免下次发消息时残留。

---

## M1-3. Function Calling 与 SSE 如何结合？工具调用结果回传后如何续接对话？

> **考察点：** Agent 工具调用循环的前端实现

**标准答案：**

Sky Chat 的 Function Calling 是一个 SSE 流内的多步循环：

1. 服务端配置 tools（如 `generate_image`、`web_search`），随消息发给模型。
2. 模型决定调用工具时，SSE 推送 `tool-input-start/delta/available` 事件（参数是流式解析的）。
3. 前端收到 `tool-call` 事件后，UI 进入 tool_calling 状态，显示工具卡片。
4. 服务端执行工具（如调图片生成 API），把结果通过 `tool-output-available` 事件推回。
5. 服务端把工具结果作为新 message 拼进上下文，继续请求模型生成最终回答，SSE 推 `text-delta`。
6. 前端进入 answering 状态，在新的 text part 上续写回答。

多轮工具调用的**循环终止条件**是：模型不再请求工具调用，直接输出文本（`finish` 事件），循环结束。如果是连续多轮（如先搜索再生成图片），`step-start` 事件标记每一步切换。

关键设计是**整个循环在一个 SSE 连接里完成**，前端不需要多次发请求。服务端内部循环调模型，前端只消费一条流，这样状态连续、体验顺滑。

**追问 1：工具调用是前端执行还是后端执行？**

看工具类型。涉及 API Key 和敏感操作的（如图片生成、联网搜索）必须在后端执行，Key 不能暴露给前端。前端能做的（如读取本地数据、计算）才前端执行。Sky Chat 的工具都在后端执行，前端只接收结果并展示，这样安全且便于统一限流监控。

**追问 2：多轮工具调用怎么防止死循环？**

服务端设置 `max_steps` 上限（如 5 轮），超过强制终止并返回提示。同时监控每轮工具调用的耗时，单工具超时（如 30s）也终止。前端层面，状态机如果长时间停在 tool_calling，会显示超时提示并允许用户停止。兜底是 AbortController，用户随时能中断。

---

## M1-4. 虚拟滚动从 120fps 降到 40fps，你具体做了什么？为什么用 requestAnimationFrame 而不是 setTimeout？

> **考察点：** 渲染性能优化 + 浏览器渲染机制

**标准答案：**

先说问题本质。AI 每秒产生 60-120 个 token，每个 token 触发一次 `appendTextDelta` → Zustand `set()` → React re-render。问题不是 React 渲染慢，而是**渲染太频繁**：16.6ms 的帧内触发 10 次 setState 就占满主线程。

React 18 的自动批处理（Automatic Batching）在这里无效——它只在同一微任务内合并 setState，但 `reader.read()` 的 `await` 每次都创建新微任务，跨微任务无法合并。

我的方案是 **StreamBuffer + requestAnimationFrame**：

1. 每个 token delta 不直接 setState，而是 `push()` 进 StreamBuffer 队列。
2. push 时如果没有待执行的 RAF，就用 `requestAnimationFrame` 调度一次 flush。
3. flush 时把队列里所有 delta 合并成一次 setState。
4. flush 后如果又有数据，自动安排下一次 RAF。

一帧（16.6ms）内无论来多少 delta，都只触发一次渲染，频率从 120 次/秒降到 ~40 次/秒（对齐 60fps 屏幕刷新率）。实测帧率从 25fps 提升到 50fps。

**为什么 RAF 而不是 setTimeout：**
- RAF 在浏览器渲染前执行，天然对齐屏幕刷新率，不丢帧；setTimeout(0) 实际约 4ms 延迟且不对齐渲染帧，可能一帧内多次执行或错过渲染。
- RAF 在后台标签页自动暂停，避免后台无效渲染浪费资源；setTimeout 后台继续执行。

**追问 1：RAF 在后台标签页暂停，SSE 数据还在累积怎么办？**

数据会累积在 StreamBuffer 队列里。切回前台时 RAF 恢复，会一次性 flush 所有累积数据。风险是一次性渲染大量文本，用户看到一大段突然出现。改进方案是设置**单次 flush 最大量**，超过阈值分帧渲染；或监听 `visibilitychange`，切回前台时分批 flush。

**追问 2：为什么不用 Web Worker 处理 SSE 解析？**

考虑过。但 SSEParser 本质是字符串操作（indexOf、slice），开销远低于 React reconciliation。引入 Worker 有通信序列化开销（postMessage 传数据要拷贝），得不偿失。如果未来要做加密解密或大量数据转换，才会考虑 Worker。

---

## M1-5. overflow-anchor 处理 Markdown 流式渲染有什么坑？怎么解决的？

> **考察点：** CSS 新特性实践 + 实战踩坑

**标准答案：**

`overflow-anchor: auto` 是浏览器原生属性，内容插入时自动调整滚动位置保持可见区域稳定。对 AI 聊天很关键——AI 流式输出突然生成一个高代码块时，没有锚定用户阅读位置会突然偏移。

实际踩了两个坑：

1. **锚点跳动** —— 流式追加内容时，浏览器自动锚定的元素可能是中间某条消息，导致用户看到的位置反复跳动。原因是浏览器选择锚定元素的算法与流式场景不匹配。
2. **与手动滚动冲突** —— 我同时用了 `scrollIntoView` 做自动跟底，自动锚定和手动滚动打架，滚动行为不可预测。

**解决方案：**
- 流式输出区域设 `overflow-anchor: none` 禁用浏览器自动锚定，改用手动控制 `scrollTop`。
- 配合智能滚动：监听 scroll 事件，检测用户是否在底部（`scrollHeight - scrollTop - clientHeight < 150px` 阈值）。在底部才自动 `scrollIntoView` 跟底；用户向上滚动则暂停自动滚动，显示"回到底部"按钮。
- 配合未闭合 Markdown 自动补全（补全 ` ``` ` 和 `**`），保证流式过程中结构完整，减少高度突变。

**追问 1：为什么 threshold 是 150px 而不是精确的 0px？**

虚拟滚动的高度估算有误差（estimateSize vs 实际高度），用户在底部附近时 `scrollHeight - scrollTop - clientHeight` 可能是个小的非零值。150px 容错避免误判用户"向上滚动"而暂停跟底。这是实测调出来的经验值。

**追问 2：流式输出时高度突变（代码块突然出现）怎么处理？**

两层处理：1）未闭合 Markdown 自动补全——流式过程中补全 ` ``` `，让代码块结构完整渲染，避免半截代码块导致的高度异常；2）预留骨架高度——给消息容器一个 min-height，避免内容从无到有的高度跳变。CLumsy layout shift 主要是结构不完整导致，补全后大幅缓解。

---

## M1-6. SSE 断流重连：TTFB/TTLB 监控怎么设计？sendBeacon 和 Fetch fallback 区别？

> **考察点：** 网络可靠性工程 + 监控体系

**标准答案：**

传统 Web 监控（LCP/FID/CLS）针对页面加载，对 AI 流式场景是盲区——它衡量"页面加载完了"，而 AI 聊天要衡量"流式回复是否流畅"。我自研了 SSE 流式场景的指标体系：

| 指标 | 定义 | 意义 |
|------|------|------|
| **TTFB** | 发请求到第一个 chunk 的时间 | 反映网络延迟 + 服务端推理首字延迟 |
| **TTLB** | 发请求到最后一个 chunk 的时间 | 反映端到端流式传输效率 |
| **Stall** | 两个 chunk 间隔 >500ms | 反映流式卡顿，可能是网络抖动或服务端停顿 |
| **Phase Duration** | thinking/tool_calling/answering 各阶段耗时 | 定位性能瓶颈环节 |

采集靠 `SSEPerformanceTracker`，在 `onChunk` 回调里记录时间戳计算各项指标。

**上报策略——双通道：**
- **sendBeacon 优先**：页面卸载时浏览器保证发送（不阻塞卸载），适合 `visibilitychange=hidden` 时上报。缺点是只 POST 无响应、payload 限制 64KB。
- **fetch keepalive fallback**：sendBeacon 失败或 payload 超限时用 `fetch(url, { keepalive: true })`，支持更大 payload。

数据先写 IndexedDB 离线队列，每 10s 批量上报，失败保留重试，避免弱网丢数据。

**追问 1：TTFB 超时怎么触发重连？**

设置 TTFB 阈值（如 10s），超时 `AbortController.abort()` 并提示用户。AI 对话流是一次性的，**不自动重连**——避免重复扣费和上下文混乱。保留已接收内容，让用户手动点"重新生成"。EventSource 的自动重连在 AI 场景反而是反模式。

**追问 2：为什么 Stall 阈值是 500ms？**

RAIL 模型说用户感知 >100ms 延迟，但 AI 生成 token 间隔 100ms 不现实。实测 chunk 间隔 50-200ms 是流畅的，超过 500ms 用户明显感觉"卡了一下"。500ms 平衡了误报率（太低会把正常间隔当卡顿）和漏报率（太高漏掉真实卡顿）。

---

## M1-7. IndexedDB 缓存 ECharts 历史数据，容量和过期策略怎么设计？

> **考察点：** 客户端存储方案 + 数据治理

**标准答案：**

监控数据用 IndexedDB 存离线队列，容量和过期策略设计如下：

1. **按会话分 store** —— 每个会话的监控数据独立存储，便于按会话查询和清理。
2. **LRU 淘汰** —— 总容量上限（如保留最近 50 个会话），超限删除最久未访问的。用 `lastAccessed` 时间戳排序淘汰。
3. **单会话大小上限** —— 单会话监控数据超过阈值（如 5MB）触发清理，删最旧的指标记录。
4. **过期老化** —— 超过 7 天的数据定时清理。清理放在 `requestIdleCallback` 空闲时段执行，避免影响交互。

**为什么不用 localStorage：** 容量小（5-10MB 共享）、同步 API 阻塞主线程（监控调用点可能恰在性能关键路径，阻塞会污染性能数据本身）、无法存二进制。

**为什么不用内存：** 页面崩溃数据丢失，监控的可靠性要求无法满足。IndexedDB 持久化，崩溃后还能上报。

**追问 1：IndexedDB 事务失败怎么处理？**

重试 3 次，仍失败降级到内存队列。记录错误日志上报。监控数据丢失不影响核心功能，是可接受的降级——监控本身不能成为系统的单点故障。

**追问 2：队列数据量无限增长怎么办？**

当前实现了基础方案，改进点：1）队列长度上限（如最多 500 条），超限丢弃最旧的；2）采样率自适应——队列长时自动降采样（100%→10%）；3）老化策略——超 24h 自动丢弃。核心思路是监控数据是"尽力而为"，不能反噬主业务。

---

## M1-8. P50/P90/P99 监控数据怎么采集和上报？为什么前端要关心这些指标？

> **考察点：** 可观测性 + 性能度量

**标准答案：**

**采集：** `SSEPerformanceTracker` 在每次流式对话记录 TTFB、TTLB、Stall 等指标，存 IndexedDB。

**P50/P90/P99 计算：** 对指标排序取百分位。P50 是中位数，反映**典型用户体验**；P90 反映**较差的 10% 用户**；P99 反映**最差的 1% 长尾用户**。

**为什么前端要关心 P99：** 平均值会被大量正常请求拉低，掩盖少数极差体验。比如 100 个请求里 99 个 200ms、1 个 5s，平均 248ms 看起来没问题，但那 1 个 5s 的用户已经放弃了。P99 确保最差用户体验也可接受，是服务质量的真正底线。前端关心是因为前端是用户感知的最后一公里——服务端再快，前端渲染卡顿用户也觉得慢。

**上报策略：**
1. **批量** —— 每 10s 合并多条指标一次请求，减少请求数。
2. **采样** —— 高峰期降采样（如只报 10%），避免上报本身成为负载。
3. **降级** —— 网络差时降低上报频率，优先保证核心功能。

**追问 1：P99 怎么计算？需要存所有数据吗？**

不需要存全部。生产用 t-digest 或 HDR Histogram 流式算法，固定内存近似计算百分位。轻量方案是**分桶统计**（如 0-100ms、100-500ms、500ms+），用桶频次估算百分位，内存占用固定。Sky Chat 量级不大，目前是排序计算，量大后会切流式算法。

**追问 2：前端上报会不会影响性能？**

控制了影响：1）IndexedDB 异步写入不阻塞主线程；2）批量上报每 10s 一次而非每条；3）监控代码与业务通过 `onChunk` 回调解耦，核心流式逻辑零侵入；4）上报失败不重试阻塞（静默丢弃）。监控本身不能成为性能瓶颈，这是设计原则。

---

## M1-9. JWT + HttpOnly Cookie 防 XSS，为什么不只用 JWT？HttpOnly 解决了什么？

> **考察点：** 前端安全 + 认证方案

**标准答案：**

关键在于 **JWT 存哪里**。如果 JWT 存 localStorage，JS 能读取，一旦页面被注入恶意脚本（XSS），脚本就能 `localStorage.getItem('token')` 偷走 token 冒充用户。

**HttpOnly Cookie 解决的问题：** 设置了 `HttpOnly` 标志的 Cookie，JavaScript 无法通过 `document.cookie` 读取。即使 XSS 注入脚本，也拿不到 token。token 只能由浏览器在每次请求时自动携带（同源策略）。

**Sky Chat 的方案：**
- JWT 签发后存 HttpOnly Cookie（`httpOnly: true, secure: true, sameSite: 'lax'`）。
- 每次请求浏览器自动带 Cookie，后端用 jose 库 `jwtVerify` 校验。
- bcrypt 哈希密码（10 轮 salt），即使数据库泄露密码也无法逆推。
- 双层防护：middleware 路由层校验 + API 业务层校验，任何一层漏过另一层兜底。

**追问 1：HttpOnly 能完全防 XSS 吗？**

不能。HttpOnly 只防 token 被偷，但 XSS 还能做其他事：篡改页面内容、伪造用户操作发起请求（利用已登录状态，不需要 token）、窃取页面数据。还需要 CSP（内容安全策略）、输入输出转义、rehype-sanitize 过滤 AI 输出等纵深防御。安全是多层的，没有银弹。

**追问 2：CSRF 怎么防？SameSite 够吗？**

`SameSite=Lax` 阻止跨站 POST 的 Cookie 携带，防大部分 CSRF。但 Lax 允许顶级导航的 GET 请求带 Cookie。更严格用 `SameSite=Strict`，或配合 CSRF Token。Sky Chat 用 Lax + API 层校验 `Origin`/`Referer` 头，双重防护。因为 API 都是 POST 且校验 Origin，CSRF 风险已可控。

---

## M1-10. rehype-sanitize 过滤 AI 返回 HTML，白名单怎么定？AI 输出不可控有哪些安全风险？

> **考察点：** AI内容安全 + XSS防护

**标准答案：**

AI 输出是不可控的——模型可能被 prompt injection 诱导输出 `<script>alert('xss')</script>`、`<img src=x onerror=...>`、`javascript:` 链接等恶意内容。如果直接渲染，就是 XSS。

**白名单定义原则：** 只允许 Markdown 正常对应的语义标签，禁止一切可执行代码的标签和属性：
- **允许的标签**：`p, code, pre, em, strong, a, ul, ol, li, blockquote, table` 等结构性标签。
- **禁止的标签**：`script, iframe, style, object, embed, form` 等可执行/可加载外部资源的标签。
- **允许的属性**：`a` 的 `href`（且只允许 http/https 协议，过滤 `javascript:`、`data:`）、`code` 的 `class`（高亮用）。
- **禁止的属性**：所有 `on*` 事件属性（onclick、onerror 等）。

**为什么不能只靠正则：** HTML 嵌套复杂，正则无法可靠解析，容易被变形绕过（如 `<img src=x onerror=alert(1)>` 的各种编码变形）。rehype-sanitize 基于 AST（抽象语法树）解析后过滤，先转成语法树再遍历删节点，是结构化的、可靠的。

**追问 1：代码块里的 `<script>` 会被过滤吗？**

不会被执行。代码块 `<pre><code>` 里的内容是文本节点，rehype-sanitize 对文本节点做转义处理，不解析为 HTML。所以代码块里写 `<script>` 是展示文本，不会运行。但要确保 Markdown 解析器把代码块正确识别为 code 而非普通段落。

**追问 2：AI 输出恶意链接（如钓鱼网站）怎么办？**

这是内容安全层面，不是 XSS。处理方式：1）`a` 标签加 `rel="noopener noreferrer target=_blank"`，防止新开窗口通过 `window.opener` 篡改原页面；2）System Prompt 约束模型不输出恶意链接；3）关键场景可对接 URL 安全检测 API；4）用户举报机制。白名单解决的是代码执行风险，内容风险需要 Prompt 约束 + 运营兜底。

---

# 模块二：AI应用核心概念（8题）⭐核心

## M2-1. 用自己的话解释 LLM 的 Token、上下文窗口、温度参数，它们如何影响应用设计？

> **考察点：** 大模型基础理解深度

**标准答案：**

**Token** 是模型处理文本的最小单位，也是计费和长度单位。粗略地，英文约 4 字符 = 1 token，中文约 1-2 字 = 1 token。应用影响：前端要做 token 估算，超限要截断或压缩，否则请求会被模型拒绝。

**上下文窗口** 是模型一次能处理的 token 总量（输入+输出）。如 GPT-4o 是 128K。应用影响：长对话会超出窗口，必须做上下文管理——滑动窗口只保留最近 N 轮、摘要压缩旧对话、向量记忆按需检索。这是"上下文工程"的核心问题。

**温度（Temperature）** 控制输出的随机性。0 = 近似确定性（每次输出基本相同），1+ = 更多样随机。应用影响：事实问答、代码生成用低温度（0.3）保证准确；创意写作、头脑风暴用高温度（0.9）要多样性。Sky Chat 对话默认 0.7 平衡稳定和自然。

这三个参数直接决定应用的可行性边界：token 决定成本预算、上下文窗口决定记忆策略、温度决定输出风格调优。

**追问 1：前端怎么估算 token 数？**

粗略估算：英文 `chars/4`，中文 `chars/1.5`。精确用 tiktoken 库（OpenAI 的 BPE 分词器），但体积大（几 MB）不适合前端全量引入。Sky Chat 用粗略估算做截断提示和上下文长度预警，够用且轻量。如果要精确，可以起一个轻量 API 在服务端算。

**追问 2：温度=0 就完全确定吗？**

基本是，但有微小差异。temperature=0 相当于 argmax 选最大概率 token，但浮点数精度和 GPU batching 的并行计算可能导致极小波动。实际工程上当 0 是确定的。如果业务要求严格一致（如评测），要固定 seed + temperature=0。

---

## M2-2. RAG 的完整流程是什么？为什么不用微调？chunking 策略怎么影响效果？

> **考察点：** RAG工程理解

**标准答案：**

**RAG 完整流程：**
1. **文档加载** —— 读取 PDF/Word/网页等原始文档。
2. **切块（Chunking）** —— 把长文档切成小块（chunk），通常 256-512 token，块之间有 overlap。
3. **向量化（Embedding）** —— 每个 chunk 用 embedding 模型转成向量。
4. **存向量库** —— 向量存入向量数据库（如 Pinecone、Milvus、pgvector）。
5. **检索** —— 用户 query 向量化，与库中向量做相似度搜索（余弦相似度），取 Top-K。
6. **拼 Prompt** —— 把检索到的 chunks 作为上下文拼进 prompt。
7. **生成** —— 模型基于上下文回答，可引用来源。

**为什么不用微调：**
- RAG 适合**知识更新**——改文档就更新了，无需训练；微调更新慢、成本高。
- RAG **可溯源**——能告诉用户答案来自哪个文档哪一段；微调知识内化在权重里无法追溯。
- RAG **成本低**——只付 embedding + 存储费；微调要 GPU 训练。
- 微调适合改变模型的**风格/能力**（如让它学会某种输出格式），不适合灌具体知识。

**chunking 策略影响：**
- chunk **太大**：一个 chunk 混入太多无关内容，检索召回精度低，拼进 prompt 还浪费 token。
- chunk **太小**：语义被切断，上下文不完整，模型理解困难。
- **overlap**（如 50 token）很重要：避免在语义边界切断，让边界内容在相邻 chunk 都有，提高召回完整性。

**追问 1：chunk 有 overlap 为什么重要？**

避免语义被切断。比如一句话"变压器故障会导致温度升高"被切成两个 chunk："变压器故障会导致"和"温度升高"，检索时可能只命中一半，模型拿不到完整语义。overlap 让边界内容在两个 chunk 都出现，保证召回的 chunk 语义完整。

**追问 2：检索的 Top-K 怎么定？**

K 太小漏召回，太大拼入 prompt 太长增加成本和噪音。通常 K=3-5。进阶做法是**先检索多、再重排序**：先粗检索 Top-20，用 rerank 模型（如 bge-reranker）精排取 Top-5。rerank 比纯向量相似度更准，能理解 query 和 chunk 的语义相关性。

---

## M2-3. Agent 的 ReAct 模式和 Plan-and-Execute 有什么区别？你的 Sky Chat 属于哪种？

> **考察点：** Agent架构理解 + 项目关联

**标准答案：**

**ReAct（Reasoning + Acting）：** 边想边做的循环。每一步：Think（推理当前状态）→ Act（调用工具）→ Observe（观察结果）→ Think（决定下一步）。根据每步观察动态调整，灵活但可能发散。

**Plan-and-Execute：** 先规划完整计划再执行。Planner 生成步骤列表（如 1.查资料 2.分析 3.总结），Executor 依次执行每步。结构化但计划可能不适应执行中的变化。

**核心区别：**
| 维度 | ReAct | Plan-and-Execute |
|------|-------|------------------|
| 决策时机 | 每步动态决策 | 开头一次规划 |
| 灵活性 | 高，能适应变化 | 低，计划固化 |
| 可控性 | 低，可能跑偏 | 高，路径明确 |
| 成本 | 每步调 LLM，贵 | 规划一次+执行，相对省 |
| 适用 | 探索性、不确定任务 | 步骤可预测的复杂任务 |

**Sky Chat 属于 ReAct：** 我的 `thinking → tool_calling → answering` 流程，每个工具调用后模型根据结果决定是否继续调用或给出最终答案，是典型的 ReAct 循环。适合对话场景因为用户意图开放，无法预先规划。

**追问 1：ReAct 的缺点是什么？**

1）可能陷入循环反复调用工具浪费 token；2）没有全局规划容易偏离目标；3）每步都调 LLM 成本高。改进：加 `max_steps` 上限防死循环；混合模式——让模型先输出简短计划再 ReAct 执行，兼顾灵活和方向感。

**追问 2：什么场景适合 Plan-and-Execute？**

任务明确、步骤可预测的场景。如"帮我订北京到上海的机票并预订酒店"——可以先规划（查机票→选航班→订票→查酒店→预订）再逐步执行。复杂多步任务 Plan-Execute 更可靠，因为每步执行有明确目标，不会像 ReAct 那样在观察中迷失。

---

## M2-4. Prompt 工程里 System/User/Assistant 角色分别什么作用？few-shot 什么时候用？

> **考察点：** Prompt设计实战

**标准答案：**

**三种角色作用：**
- **System**：设定人设、约束、规则。如"你是 Sky Chat 助手，回答简洁准确，不输出违法内容"。优先级最高，影响整个对话。System 是"定义 AI 是谁"。
- **User**：用户输入。每次用户发的消息。
- **Assistant**：AI 的历史回复。用于维持多轮对话上下文，让模型记得之前说过什么。

**few-shot（少样本示例）：** 在 prompt 里给几个输入→输出的示例，引导模型按期望格式/风格输出。比如给 2-3 个"问题→结构化 JSON 答案"的示例，模型就学会按 JSON 格式回答。

**什么时候用 few-shot：**
- 需要**特定输出格式**（JSON、表格、特定模板）且难以用规则描述时。
- **复杂指令**光靠描述模型理解不准时，示例比啰嗦的规则更有效。
- 代价：示例消耗 token，挤占上下文窗口。所以要在效果和成本间权衡。

**追问 1：few-shot 示例放 System 还是 User？**

通常放 System 作为全局示范，影响整个对话。关键要求：示例要**典型、多样、与真实任务一致**。如果示例只覆盖简单情况，模型遇到复杂情况就退化。反面：示例不能误导，比如示例都输出短答案，模型会倾向什么都答短的。

**追问 2：few-shot 和 fine-tune 怎么选？**

few-shot 零成本、灵活、即时生效，但占上下文 token、受窗口限制、效果有上限。fine-tune 效果稳定、不占上下文、能学到深层模式，但成本高、需训练数据、更新慢。**决策：** 少量格式引导用 few-shot；大量稳定的、prompt 无法解决的行为模式用 fine-tune。先 few-shot 验证可行再考虑 fine-tune 固化。

---

## M2-5. 上下文/Harness 工程是什么？长对话如何做上下文压缩和记忆管理？

> **考察点：** 岗位JD核心概念（上下文/Harness工程）

**标准答案：**

**Harness 工程：** 包裹裸模型的工程层。"Harness"原意是马具/束具，引申为套在模型外面的工程框架，包括：prompt 模板、工具定义、记忆管理、安全过滤、上下文组装、错误处理。裸模型只是"引擎"，Harness 是让引擎真正能服务用户的"整车"。岗位强调这个概念，说明看重把模型变成可用产品的工程能力。

**上下文工程：** 管理送入模型的上下文，在有限窗口内最大化有用信息。核心矛盾是：上下文窗口有限（如 128K），但对话历史、检索知识、工具结果都可能很长。

**长对话记忆管理策略：**
1. **滑动窗口** —— 只保留最近 N 轮对话（如 20 条），超出的丢弃。简单但丢早期信息。
2. **摘要压缩** —— 把早期对话用模型总结成摘要，放 System prompt。保留要点但摘要有损。
3. **向量记忆** —— 把所有历史对话存向量库，每轮按当前 query 检索相关历史补充。最完整但复杂。
4. **混合策略** —— 近期对话原文 + 早期摘要 + 关键事实向量检索，兼顾完整性和 token 预算。

Sky Chat 实践：滑动窗口（最近 20 条）+ 超限时提示用户开新会话。未来会加摘要压缩。

**追问 1：摘要压缩会不会丢信息？**

会，摘要必然有损。缓解：1）只压缩较早的对话，保留近期原文；2）摘要时明确要求保留关键实体、决策、用户偏好；3）让模型自己判断什么重要；4）重要信息（如用户明确要求的）标记为"不压缩"。本质是信息完整性和上下文长度的权衡，没有完美解。

**追问 2：向量记忆和 RAG 什么区别？**

本质相似，都是检索补充。区别在检索源：RAG 检索**外部知识库**（文档、网页），向量记忆检索**对话历史**。可以结合：先查对话记忆（用户偏好、历史决策、已确认信息）再查知识库，拼成完整上下文。这样模型既"记得"用户说过什么，又"知道"外部知识。

---

## M2-6. 多模态大模型在前端怎么接入？图片/语音输入输出的前端处理？

> **考察点：** 多模态应用实践

**标准答案：**

**图片输入：**
- File API 读取用户选择的图片 → 转 base64 或 Blob。
- 大图要压缩（Canvas resize）减小延迟，否则上传慢、token 贵。
- 格式校验（jpg/png/webp）+ 大小限制（如 10MB）。
- 预览用 `URL.createObjectURL` 或 base64 data URL。
- 传模型时：小图 base64 内联，大图先传 OSS 拿 URL 再传 URL。

**语音输入：**
- `MediaRecorder` 录制音频 → WebM/Opus 格式 → 上传。
- 两条路：1）传 STT（语音转文字）服务转文本再送 LLM；2）直接送多模态模型（如 GPT-4o 音频）。
- 注意权限申请（`getUserMedia`）和录制状态 UI。

**图片输出：**
- 模型返回 URL 或 base64，前端 `<img>` 渲染。
- 注意加载态、失败重试、点击放大。

**语音输出（TTS）：**
- 流式 TTS 边生成边播放降延迟。服务端分句返回音频块，前端用 `AudioContext` 第一个块到达即播放，后续排队。
- 关键是首块要快，不要等全部生成完才播。

**追问 1：图片 base64 和 URL 上传哪个好？**

小图 base64 省一次 HTTP 请求但增大请求 payload。大图先上传对象存储（OSS/S3）拿 URL，再传 URL 给模型更好——payload 小、可复用、CDN 加速。Sky Chat 图片生成走后端，模型返回 URL，前端直接显示，避免大 base64 在前后端传输。

**追问 2：语音流式 TTS 怎么实现低延迟？**

1）服务端分句流式返回音频块（不要整段生成）；2）前端 `AudioContext` 解码第一个块到达立即播放；3）后续块用 `AudioBufferSourceNode` 排队无缝拼接；4）用 `MediaSource Extensions` 处理连续流。核心是"首块优先"，用户听到声音就知道在工作，比等全部生成完体验好得多。

---

## M2-7. 模型微调、RAG、Prompt优化，什么场景该用哪个？成本和效果怎么权衡？

> **考察点：** AI应用技术选型（岗位JD：技术选型和方案设计）

**标准答案：**

**三者定位：**
- **Prompt 优化**：最轻量。改提示词调整模型行为，零成本迭代。适合格式引导、角色设定、简单任务调优。
- **RAG**：加外部知识。适合知识更新频繁、需要溯源、私有数据场景。改文档即更新，无需训练。
- **微调**：改变模型内在行为。适合稳定的风格/能力需求、prompt 无法解决、有足够训练数据。

**决策顺序（从轻到重）：**
1. 先 **Prompt 优化**——成本最低，能解决就不升级。
2. Prompt 不够（需外部知识）加 **RAG**——补知识，仍可快速迭代。
3. RAG 也不行（需改变模型能力本身）且数据足够才 **微调**——成本最高、最慢。

**权衡维度：**
| 维度 | Prompt | RAG | 微调 |
|------|--------|-----|------|
| 成本 | 最低 | 中（embedding+存储） | 最高（GPU训练） |
| 延迟 | 低 | 中（多一次检索） | 低（无检索） |
| 可维护 | 最好改 | 较好（改文档） | 最难改（要重训） |
| 效果上限 | 有限 | 中高 | 高 |
| 适用 | 行为引导 | 知识补充 | 能力改变 |

**追问 1：微调和 RAG 能结合吗？**

能，且是常见最佳实践。微调让模型更擅长某类任务（如医学问答的专业表达风格），RAG 补充最新医学知识。微调提升"能力"，RAG 提供"数据"，互补。顺序通常是先 RAG 解决知识问题，再微调解决 prompt 解决不了的行为问题。

**追问 2：怎么判断 Prompt 优化到头了需要 RAG？**

信号：1）Prompt 再长模型也答不准特定领域知识（它真不知道）；2）知识更新频繁，改 prompt 不现实；3）需要引用来源让答案可追溯；4）多个知识源要灵活组合。这些信号说明模型缺的是"知识"而非"指令"，该上 RAG。如果模型答得准但格式/风格不对，那是 prompt 或微调的范畴。

---

## M2-8. 你了解哪些开源和闭源模型？它们在前端接入上有什么差异？

> **考察点：** 模型生态认知 + 前端适配

**标准答案：**

**闭源模型：** GPT-4o/Claude/通义千问/文心一言等。能力强、API 稳定、收费。OpenAI 的 API 格式是事实标准，多数厂商兼容。

**开源模型：** LLaMA/Qwen/DeepSeek/Mistral 等。可本地部署、免费、能力接近闭源（DeepSeek 等部分场景已比肩）。需要自己起推理服务（vLLM/Ollama）。

**前端接入差异：**
1. **SSE 格式**：OpenAI 格式（`data: {"choices":[{"delta":...}]}`）是事实标准，多数模型兼容。但事件字段名可能有细微差异。
2. **工具调用协议**：OpenAI 用 `function calling` 格式，Claude 用 `tool_use`，需适配层抹平差异。
3. **思考模式（reasoning）**：不同模型暴露推理过程的字段不同（如 DeepSeek 的 `reasoning_content`），前端要针对性解析。
4. **速率限制**：各厂商不同，前端要做限流 UI 提示（"请求过快请稍后"）。

**Sky Chat 的做法：** 用 OpenAI 兼容 API（yunwu.ai 中转），一套协议接多个模型，前端几乎无感知切换。抽象成统一事件层，换模型只改后端配置。

**追问 1：换模型时前端要改什么？**

主要是事件解析适配。如果都用 OpenAI 兼容格式，前端几乎不改。差异集中在：工具调用事件结构、思考模式字段名、流式结束信号。最佳实践是**抽象统一事件层**——后端把不同模型协议转成自定义统一事件（Sky Chat 的 14 种 chunk 类型），前端只认统一协议，换模型不影响前端。

**追问 2：本地部署开源模型前端怎么接？**

本地起推理服务（如 vLLM、Ollama、LM Studio），它们都暴露 OpenAI 兼容 API。前端照常请求 `localhost:port/v1/chat/completions`。注意：1）CORS 配置（本地服务要允许前端域）；2）本地资源限制（显存决定能跑多大模型）；3）部署在内网时的网络可达性。开发调试本地模型很方便，生产看场景。

---

# 模块三：BHWebClient 项目深挖（3题）

## M3-1. ECharts 标注系统：graphic API + convertToPixel/convertFromPixel，坐标转换原理是什么？标注如何随缩放联动？

> **考察点：** ECharts底层API掌握 + 数据可视化深度

**标准答案：**

**坐标转换原理：**
ECharts 内部维护两套坐标系——**数据坐标系**（如 x 轴的时间值、y 轴的数值）和**像素坐标系**（canvas 上的 px）。两者之间有变换矩阵。`convertToPixel(dataCoord)` 把数据坐标转成像素坐标，`convertFromPixel(pixelCoord)` 反向转换。

**标注系统实现：**
1. 用 ECharts 的 `graphic` 组件（而非 series 的 markPoint）在像素坐标上绘制标注（引线、文字框、可拖拽点）。graphic 是底层绘图 API，完全自定义样式和事件。
2. 标注数据存在数据坐标系里（绑定到数据点），渲染时用 `convertToPixel` 转成像素坐标定位 graphic 元素。
3. 拖拽标注时，`convertFromPixel` 把鼠标像素位置转回数据坐标，更新标注数据，实现"拖拽改数据"。
4. 边界约束：拖拽时校验数据坐标是否在图表范围内，超出则夹紧。

**缩放联动：**
监听 `datazoom`（缩放）/`georoam` 事件，事件触发后重新对所有标注 `convertToPixel` 计算新像素位置，更新 graphic 元素的 position。原理是缩放改变了变换矩阵，同样的数据坐标对应的像素坐标变了，重算即可对齐。

**为什么不用 markPoint：** markPoint 样式受限（不可拖拽、不可自定义复杂引线和右键菜单），graphic 组件完全自由。代价是要手动管理坐标转换和缩放联动。

**追问 1：标注位置随缩放更新有性能问题吗？**

标注多时，每次缩放（datazoom 连续触发）重算所有标注坐标会卡。优化：1）**防抖**——datazoom 过程中不更新，只在缩放结束（`datazoom` 的 `batch` 结束事件）算一次；2）**requestAnimationFrame 合并**——把多次缩放事件合并到一帧更新；3）**只更新可视区标注**——超出视口的标注不更新。

**追问 2：convertToPixel 在图表未渲染完成时调用会怎样？**

返回 NaN 或不准确的值，因为变换矩阵还没建立。要确保在 `ready` 事件或 `dispatchAction` 后再调用。我踩过这个坑——初始化标注时图表还在渲染，坐标算出来是错的。解决：用 `chart.on('finished', ...)` 等首次渲染完再标注，或 setTimeout 延迟一帧。

---

## M3-2. 为什么用 ResizeObserver 触发 echarts.resize 而不是 window.resize？有什么坑？

> **考察点：** 响应式布局 + 浏览器API

**标准答案：**

**为什么不用 window.resize：** `window.resize` 只响应浏览器窗口大小变化。但容器尺寸变化不一定来自窗口变化——flex 布局里兄弟元素展开/折叠、侧边栏开关、内容动态加载撑开、父容器动画过渡，都会改变图表容器尺寸，但不触发 window.resize。这种情况图表不会自适应，出现"容器变了图没变"的错位。

**ResizeObserver 优势：** 直接观察元素自身尺寸变化，无论变化原因是什么都能捕获。更精确、更可靠。

**踩过的坑：**
1. **回调频繁触发** —— 拖拽调整大小时 ResizeObserver 连续触发，每次 echarts.resize 都重算布局重绘，卡顿。解决：防抖（300ms），只在尺寸变化停止后 resize 一次。
2. **display:none 误触发** —— 元素被 `display:none` 后尺寸变为 0，ResizeObserver 触发，echarts.resize 到 0×0 报错。解决：回调里判断 `offsetWidth > 0` 才 resize。
3. **循环错误（ResizeObserver loop）** —— 回调里修改被观察元素尺寸会再次触发回调形成循环，浏览器报 `ResizeObserver loop limit exceeded`。解决：回调里不改被观察元素尺寸；或 disconnect 先断开再操作再重连。

**追问 1：ResizeObserver 循环错误具体怎么避免？**

根因是回调里修改了被观察元素的尺寸，新尺寸又触发回调。避免方法：1）回调里只调 `echarts.resize()`（改的是 canvas 不改容器），不直接改容器尺寸；2）如果必须改容器，先 `observer.disconnect()`，改完再 `observer.observe(el)`；3）用 `requestAnimationFrame` 把修改延迟到下一帧，打断同步循环。

**追问 2：echarts.resize 本身有性能问题吗？**

有。resize 会重新计算布局、重绘整个图表，开销不小。频繁 resize（如拖拽过程实时跟）会卡。优化：1）拖拽过程用防抖，结束才 resize；2）拖拽时只调整容器 CSS（width/height），视觉跟着变但图表不重算，结束才 echarts.resize 一次；3）大图表考虑 `notMerge: false` 增量更新而非全量重绘。

---

## M3-3. keep-alive 轮询优化：deactivated/activated 生命周期具体怎么处理？为什么需要优化？

> **考察点：** Vue生命周期 + 性能优化

**标准答案：**

**为什么需要优化：** BHWebClient 的实时监测页每隔几秒请求一次接口刷新数据。Vue 的 `keep-alive` 会缓存不活跃的组件实例（不销毁），切到其他页面后组件还在内存里——**但定时器还在跑**。这导致：1）切走后持续打接口浪费带宽和服务端资源；2）用户切回时数据可能因后台轮询时序不一致而错乱；3）多个 keep-alive 页面堆积定时器拖慢性能。

**处理方式：**
```javascript
export default {
  data() { return { timer: null } },
  activated() {
    this.fetchData();  // 切回立即拉一次最新数据
    this.timer = setInterval(this.fetchData, 5000);  // 恢复轮询
  },
  deactivated() {
    clearInterval(this.timer);  // 切走清除定时器，停止轮询
    this.timer = null;
  }
}
```

`activated` 是 keep-alive 组件被激活（切回）时触发，`deactivated` 是被停用（切走）时触发。在 deactivated 清理定时器，activated 恢复，做到"用时轮询、不用时停止"。

**追问 1：deactivated 和 beforeUnmount 什么区别？**

- `beforeUnmount`：组件真正销毁前触发（不用 keep-alive，或被 `exclude` 排除时）。组件实例会被回收。
- `deactivated`：keep-alive 缓存组件被切走时触发。组件实例**还在内存**，只是不活跃，随时能 activated 复用。

用 keep-alive 时，deactivated 替代 beforeUnmount 做清理（定时器、事件监听等）。两者的共同点是都要清理副作用，区别是 deactivated 后组件还活着，beforeUnmount 后组件死了。

**追问 2：WebSocket 长连接在 keep-alive 页面怎么处理？**

看需求：
- 要持续接收数据（如消息推送）→ 保持连接，但 `deactivated` 时降低处理频率或只缓存不渲染（切回再渲染）。
- 不需要离线接收 → `deactivated` 时关闭连接，`activated` 重连。权衡重连成本和资源节省。高频实时数据建议保持连接（重连成本高），低频数据可断开（省资源）。

---

# 模块四：前端基础（AI场景）（6题）

## M4-1. 浏览器事件循环：SSE 流式渲染为什么用 requestAnimationFrame 而不是 setTimeout？宏任务和微任务区别？

> **考察点：** 事件循环 + 渲染时机

**标准答案：**

**事件循环机制：** 一轮循环 = 一个宏任务 → 清空所有微任务 → 渲染（RAF + paint）→ 下一轮宏任务。
- **宏任务**：setTimeout、setInterval、I/O、事件回调、MessageChannel。
- **微任务**：Promise.then、queueMicrotask、MutationObserver。每个宏任务后、渲染前，微任务队列全部清空。

**为什么 SSE 渲染用 RAF 而非 setTimeout：**
1. **RAF 对齐渲染帧** —— RAF 回调在浏览器每次渲染前执行，天然对齐屏幕刷新率（60fps=16.6ms）。一帧一次渲染，不丢帧、不重复。
2. **setTimeout 不对齐渲染** —— setTimeout(0) 实际约 4ms 延迟（HTML5 规范嵌套 5 层后限制），是宏任务，可能在一次渲染前的微任务后、也可能错过渲染帧，导致一帧内多次执行或跳帧。
3. **RAF 后台暂停** —— 标签页切到后台时 RAF 自动停止，不浪费资源渲染用户看不到的画面；setTimeout 后台继续执行。

流式场景下，RAF 把高频 token 更新合并到每帧一次渲染，既流畅又不掉帧。setTimeout 做不到这种与渲染的精确同步。

**追问 1：为什么 setTimeout(0) 不是 0ms？**

浏览器有最小延迟限制。HTML5 规范规定嵌套调用超过 5 层后，setTimeout 最小延迟 4ms。而且 setTimeout 是宏任务，要等当前宏任务和所有微任务队列清空后才执行，不是"立即"。所以 `setTimeout(fn, 0)` 实际延迟可能 4ms+，且不对齐渲染。

**追问 2：Promise.resolve().then 和 setTimeout(fn,0) 谁先执行？**

Promise 先。微任务在当前宏任务后、下一次渲染前清空，setTimeout 作为新宏任务要等下一轮事件循环。所以微任务优先级高于宏任务。这个特性常用于"尽快执行但不阻塞当前同步代码"的场景，但流式渲染不能用微任务——微任务清空后才渲染，高频微任务会推迟渲染。

---

## M4-2. Fetch、XMLHttpRequest、EventSource 三者在流式请求上的区别？SSE 和 WebSocket 什么场景选哪个？

> **考察点：** 网络通信方案选型

**标准答案：**

**三者流式能力对比：**
| 特性 | Fetch+ReadableStream | XMLHttpRequest | EventSource |
|------|---------------------|----------------|-------------|
| 请求方法 | 任意 | 任意 | 仅 GET |
| 自定义 Header | 支持 | 支持 | 不支持 |
| 流式读取 | response.body.getReader() | progress 事件（粗粒度） | 自动推送 |
| 取消请求 | AbortController | abort() | close() |
| 重连 | 手动 | 手动 | 自动 |
| 灵活性 | 最高 | 中 | 低 |

- **Fetch + ReadableStream**：最灵活，AI 场景首选。能 POST、带 Header、AbortController 取消、手动解析流。
- **XHR**：老 API，有 `onprogress` 但流式支持差（只能拿已接收的 `responseText`，无法精细控制），不推荐新项目用。
- **EventSource**：简单（一个 URL 自动接收），但只 GET、无自定义 Header、自动重连（AI 场景反而有害）。

**SSE vs WebSocket 选型：**
- **SSE**：单向（服务端→客户端）、标准 HTTP、兼容代理防火墙、Serverless 友好、自动重连。适合"客户端发一次、服务端持续回复"模式。
- **WebSocket**：双向、独立协议（需握手升级）、长连接（不兼容 Serverless 按需启动）。适合实时双向通信（协同编辑、多人游戏、即时通讯）。

**AI 聊天选 SSE：** 请求-响应模式，单向推送足够；走标准 HTTP 部署简单；Serverless 兼容。Sky Chat 用 SSE，没必要为双向能力引入 WebSocket 的复杂度。

**追问 1：WebSocket 双向通信在 AI 场景有什么用？**

实时协作编辑、多用户共享对话（如客服转接）、服务端主动推送（如其他设备消息同步）。Sky Chat 是单用户请求-响应，SSE 够用。如果要做"多端同步对话"或"客服协同"就考虑 WebSocket。技术选型看场景，不为用而用。

**追问 2：SSE 能做客户端→服务端推送吗？**

不能直接做，SSE 是单向的。客户端要发消息用普通 HTTP POST 新开请求。所以"双向"需求要么 SSE（接收）+ POST（发送）组合，要么 WebSocket（全双工）。AI 对话场景下，用户发消息是低频的，POST 足够，不需要 WebSocket 的双向通道。

---

## M4-3. 你的虚拟滚动优化里，增量 buffer 管理具体是什么？怎么避免大列表内存爆炸？

> **考察点：** 性能优化实战

**标准答案：**

**问题：** 1000 条消息的长会话，每条消息组件含外层容器、头像、气泡、Markdown 内容、操作按钮等，全渲染 5000+ DOM 节点。问题不是 DOM 多，而是**这些节点频繁更新**——流式输出时最后一条消息每帧在变，React 要 diff 整个列表。

**虚拟滚动核心：** 只渲染可视区 + overscan 缓冲区的消息，超出的卸载。TanStack Virtual 计算可见范围 `[startIndex, endIndex]`，加 overscan（我设 5），动态 mount/unmount 对应组件。DOM 节点从 5000+ 降到 ~50。

**增量 buffer 管理：**
1. **estimateSize 估算** —— 根据消息角色和内容长度粗略估算高度（用户消息 60-120px，AI 消息 120-280px）。未渲染的位置用估算高度占位计算滚动条。
2. **measureElement 测量修正** —— 渲染后的元素用 ref 回调拿真实高度，更新 virtualizer 缓存，修正滚动条位置。
3. **滚动方向预渲染** —— overscan 在上下各多渲染 5 条，滚动时缓冲区提前就位，避免快速滚动闪白。

**避免内存爆炸：**
- 只保留可视 DOM，超出即卸载，节点数恒定（~50）。
- 估算高度 + 测量修正，滚动条长度渐进准确。
- 流式消息（高度变化中）用 `measureElement` 自动重测，TanStack Virtual v3+ 支持动态高度。

**追问 1：estimateSize 不准会怎样？**

滚动条长度不准（偏长或偏短）、跳到指定位置有偏差。TanStack Virtual 用 measureElement 测真实高度后修正缓存，滚动几次后趋于准确。初次渲染可能有跳动（估算→实测的修正）。优化：根据历史消息平均高度调估算公式，让初始估算更接近实际。

**追问 2：overscan 设多少合适？**

看内容高度均匀度。均匀（如表格行）overscan=3 够；不均匀（消息列表，用户短消息 vs AI 长回答差异大）需要 5-10。太小快速滚动闪白，太大 DOM 多影响性能。我选 5 是实测权衡——消息列表高度差异大，5 能覆盖大多数快速滚动场景不闪白，又不至于 DOM 过多。

---

## M4-4. TypeScript 泛型在 AI SDK/请求封装里怎么用？如何类型安全地处理 SSE 多种事件类型？

> **考察点：** TS进阶 + 类型设计

**标准答案：**

**泛型在请求封装：** 封装 fetch 函数泛型化返回类型，调用时指定：
```typescript
async function apiFetch<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
  return res.json() as Promise<T>;
}
// 调用
const user = await apiFetch<User>('/api/user/1');
```

**AI SDK 泛型：** 工具定义用泛型约束参数类型，确保工具调用时参数类型安全。

**SSE 事件类型安全——discriminated union（可辨识联合）：**
```typescript
type StreamChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; toolName: string; args: unknown }
  | { type: 'tool-output'; toolCallId: string; result: unknown }
  | { type: 'finish'; reason: string }
  | { type: 'error'; message: string };

function handleChunk(chunk: StreamChunk) {
  switch (chunk.type) {
    case 'text-delta':      // TS 窄化：chunk 是 { type:'text-delta'; text:string }
      return chunk.text;     // 安全访问 text
    case 'tool-call':
      return chunk.toolName; // 安全访问 toolName
    // ...
  }
}
```

`type` 字段是判别式（literal string）。`switch(chunk.type)` 里 TS 自动窄化类型，访问对应字段不报错。漏处理某个 case TS 会提示（穷尽性检查）。

**追问 1：discriminated union 比 any 好在哪？**

1）**编译期类型检查**——访问不存在的字段 TS 报错，bug 在编码时暴露而非运行时；2）**穷尽性检查**——switch 漏处理某个 type，TS 提示，避免新增事件类型时遗漏处理；3）**重构友好**——改类型定义，所有受影响点 TS 自动标红，不会漏改。any 等于放弃类型安全，AI 场景事件多、结构复杂，没类型保护很容易出 bug。

**追问 2：泛型约束怎么写？**

用 `extends` 约束泛型范围：
```typescript
// 约束 T 必须有 id 字段
function fetchById<T extends { id: string }>(url: string): Promise<T> {}

// 工具定义泛型
type Tool<TArgs> = {
  name: string;
  run: (args: TArgs) => Promise<unknown>;
};
// 使用
const imageTool: Tool<{ prompt: string; size: string }> = { ... };
```
约束让泛型不只是"任意类型"，而是"符合某种结构的类型"，既灵活又安全。

---

## M4-5. React 并发渲染（useTransition/useDeferredValue）在 AI 流式场景有什么用？和 Zustand 怎么配合？

> **考察点：** React 18新特性 + 状态管理

**标准答案：**

**useTransition：** 把状态更新标记为低优先级（transition），不阻塞高优先级更新（如用户输入）。`startTransition(() => setState())` 内的更新可被中断。

**useDeferredValue：** 类似 useTransition 但作用于值。`const deferred = useDeferredValue(value)`，deferred 延迟更新，React 空闲时才应用。

**AI 流式场景应用：**
- 流式文本更新是**高频但不紧急**的，用 `useTransition` 降优先级，确保用户输入（发消息、点停止）等高优先级操作立即响应，不被流式渲染阻塞。
- 例如用户在流式输出时点"停止"，没有 useTransition 时 React 可能正在处理大量流式 setState，停止操作要排队等；有 useTransition，停止操作（高优先级）插队立即执行。

**Zustand 配合：**
Zustand 的核心优势是 **selector 精确订阅**，避免 Context 的级联重渲染：
```javascript
// 只订阅 status，status 变才重渲染
const status = useChatStore(s => s.status);
// 只订阅当前流式消息，而非整个 messages 数组
const currentMsg = useChatStore(s => s.messages.find(m => m.id === s.currentId));
```
流式高频更新下，Zustand selector 实现类 Vue 的细粒度订阅，只有真正用到变化数据的组件才重渲染。配合 useTransition，高频更新既不阻塞交互又不全页重渲染。

**追问 1：useTransition 和防抖区别？**

防抖是**延迟执行**（固定时间窗口内只执行最后一次）。useTransition 是**优先级调度**——React 空闲时立即执行，没有固定延迟；高优先级任务来时能中断低优先级。useTransition 更智能，语义是"可中断的低优先级更新"。防抖适合"只要最后一次"（如搜索框），useTransition 适合"都要但不阻塞交互"（如流式渲染）。

**追问 2：Zustand 的 selector 怎么避免不必要渲染？**

1）**返回基本类型**而非整个对象——`useStore(s => s.count)` 而非 `useStore(s => state)`；2）**对象用 shallow 比较**——`useStore(s => ({ a: s.a, b: s.b }), shallow)` 避免每次返回新对象引用导致误判变化；3）**流式更新订阅最小单元**——只订阅 `currentMessage` 而非整个 `messages` 数组，流式 delta 只触发当前消息组件重渲染，其他消息不动。

---

## M4-6. Vue 和 React 你都用过，在 AI 流式渲染场景下两者的响应式差异对实现有什么影响？

> **考察点：** 框架对比 + 技术广度

**标准答案：**

**Vue 响应式：** 基于 Proxy 自动追踪依赖。组件渲染时访问的响应式数据被收集为依赖，数据变化时只触发依赖该数据的组件更新。**细粒度、自动、组件级精准更新。**

**React 响应式：** 不可变 + reconciliation。setState 触发组件树 reconciliation（diff），靠 `React.memo`/`useMemo`/`shouldComponentUpdate` 跳过未变化子树。**手动优化、组件级但默认全树 diff。**

**AI 流式高频更新下的影响：**
- **Vue**：细粒度更新天然高效。流式 delta 只更新"用到 delta 的那个组件"，其他组件不感知。无需额外优化。
- **React**：默认 setState 触发组件 re-render，子树跟着 diff。流式每帧 setState，如果不优化，整个消息列表组件树都在 diff。需要手动优化：`React.memo` 包裹消息组件、`useMemo` 缓存计算、Zustand selector 精确订阅。

**Sky Chat 选 React + Zustand 的原因：** Zustand 的 selector 机制实现了类 Vue 的细粒度订阅——组件只订阅自己关心的状态切片，流式更新只触发相关组件。弥补了 React 默认全树 diff 的不足。React 的生态（TanStack Virtual、AI SDK 生态、RSC）也是考量。

**追问 1：Vue 细粒度更新就没性能问题吗？**

也有代价。响应式追踪本身有开销——Proxy 拦截、依赖收集、触发更新的调度。大量数据响应式化（如 10000 条数据全部 reactive）成本不低。且组件更新虽细粒度，但 DOM 操作仍需批量调度。React 的不可变 + 批量 reconciliation 在大列表整体更新时可能更高效（一次 diff 整批）。各有利弊，没有绝对优劣。

**追问 2：React 能实现 Vue 那样的细粒度更新吗？**

React 的设计哲学是"不可变 + reconciliation"，天然是组件级更新，要做细粒度得绕过 React 渲染机制：1）用 signal 库（如 `@preact/signals-react`）——signal 变化直接更新 DOM 不走 React；2）用外部状态（Zustand selector）精确订阅。React 核心团队研究过 signal 但未采纳（认为与 React 模型冲突）。所以 React 里靠 Zustand + selector 是务实的细粒度方案。

---

# 模块五：全栈与工程化（5题）

## M5-1. Next.js 为什么适合 AI 应用？SSR 和 API Routes 在 Sky Chat 里各自承担什么？

> **考察点：** 框架选型理由

**标准答案：**

**Next.js 适合 AI 应用的三个原因：**

1. **API Routes 做 SSE 后端代理** —— 把模型 API 调用放在服务端，隐藏 API Key（不暴露给前端）、统一 CORS、加鉴权、加限流。前端只调自己的 `/api/chat`，后端带 Key 调模型 API。
2. **SSR/RSC 提升体验** —— 首屏服务端渲染加速（分享页 RSC 渲染 Markdown，客户端 JS 仅 ~5.6KB）、SEO（公开页可被爬虫索引）、降低客户端 JS 体积。
3. **全栈一体** —— 前后端同仓库，类型共享（Prisma 类型前后端都用），部署简单（一个命令部署全部），适合独立开发者或小团队快速交付。

**Sky Chat 里各自承担：**
- **API Routes**：SSE 流式对话（`/api/chat`）、JWT 鉴权（`/api/auth/*`）、会话/消息 CRUD、Function Calling 工具执行、监控数据上报。
- **RSC（React Server Components）**：分享页 `/share/[token]` 服务端渲染 Markdown，客户端只接收渲染好的 HTML，无需加载 react-markdown 等重依赖；聊天页 RSC 做服务端鉴权 + 数据预取，客户端组件接管交互。

**追问 1：为什么 API Key 不能放前端？**

前端代码客户端可见（打包后的 JS 能被查看/反混淆），Key 一旦暴露会被盗用产生费用、被滥用导致服务被封。必须放服务端环境变量（`process.env`），前端只调自己的 API Route，后端带 Key 调模型 API。这是 AI 应用的安全铁律。

**追问 2：Edge Runtime 和 Node Runtime 区别？**

- **Edge Runtime**：基于 Web 标准 API（无 Node 模块如 `fs`），冷启动快（<100ms）、可全球边缘部署降低延迟，但功能受限（无原生依赖、执行时间限制如 30s）。
- **Node Runtime**：功能全（可用 fs、原生 npm 包），但冷启动慢（几百 ms~秒级）。

Sky Chat 用 Node Runtime——需要 pdf-parse（原生依赖）、bcryptjs 等不兼容 Edge 的包。如果是纯 SSE 代理（无重依赖）可以上 Edge 降延迟。

---

## M5-2. Prisma + PostgreSQL 的数据建模：对话、消息、工具调用记录怎么建表？关系怎么设计？

> **考察点：** 数据建模能力

**标准答案：**

**核心表设计：**

```
User
  id          String   @id @default(uuid())
  email       String   @unique
  password    String   // bcrypt 哈希
  role        Role     // USER | ADMIN
  createdAt   DateTime

Session (会话)
  id          String   @id @default(uuid())
  userId      String   // 外键
  title       String   // 会话标题
  createdAt   DateTime
  updatedAt   DateTime
  user        User     @relation(fields:[userId], references:[id])

Message (消息)
  id          String   @id @default(uuid())
  sessionId   String   // 外键
  role        Role     // user | assistant
  content     String   // 文本内容
  parts       Json     // 结构化部分（文本块、工具卡片）
  createdAt   DateTime
  session     Session  @relation(fields:[sessionId], references:[id])

ToolCall (工具调用)
  id          String   @id @default(uuid())
  messageId   String   // 外键
  toolName    String   // generate_image / web_search
  args        Json     // 调用参数
  result      Json     // 执行结果
  status      String   // pending / success / error
  createdAt   DateTime
  message     Message  @relation(fields:[messageId], references:[id])
```

**关系：** User 1-N Session 1-N Message 1-N ToolCall（一对多链式）。

**设计要点：**
- **索引**：`sessionId` 查消息、`userId` 查会话、`createdAt` 排序，加复合索引加速常用查询。
- **软删除**：`deletedAt` 字段，查询时过滤，保留数据可恢复，避免硬删丢数据。
- **分页**：cursor-based（游标，用 `id` + `createdAt`）比 offset 高效，大数据量不退化。
- **parts 用 JSON**：消息结构多变（文本、工具卡片、图片），JSON 灵活，PostgreSQL JSONB 支持索引查询。

**追问 1：为什么 Message 的 parts 用 JSON 而不是单独建表？**

parts 是消息的强内聚部分——总是一起读取、结构多变（纯文本/带工具调用/带图片）、且属于同一条消息。单独建表会引入 N+1 查询问题（查消息再查 parts）。JSON 字段保留灵活性，PostgreSQL 的 JSONB 还能建索引查询内部字段。权衡：JSON 内部不做关系约束（如外键），但对 parts 这种"属于消息的数据"是合理的。

**追问 2：游标分页比 offset 好在哪？**

1）**性能**：offset 要扫描跳过 N 条（`OFFSET 10000` 要扫 10000 条），大 offset 慢；游标用 `WHERE id > cursor ORDER BY id LIMIT 20` 直接定位，恒定快。2）**稳定性**：数据插入时 offset 会错位（新数据插前面，offset 跳过的变了，出现重复或跳过）；游标基于 id 不受插入影响。缺点：不能直接跳页（只能上一页/下一页），但聊天场景不需要跳页，游标正合适。

---

## M5-3. Webpack 和 Vite 你都用过，AI 应用构建选哪个？为什么？

> **考察点：** 构建工具理解

**标准答案：**

**两者特点：**
- **Vite**：开发体验好（ESM 按需编译、HMR 极快、配置简单），生产用 Rollup。适合纯前端 SPA、追求开发体验。
- **Webpack**：生态成熟（插件丰富、生产优化成熟、处理复杂依赖强），配置繁琐但可控性高。

**AI 应用特殊考虑：**
1. **AI SDK 的 Node 依赖**（如 pdf-parse、bcryptjs）在打包时可能被错误地 bundle 进 client，要确保只在 server 用。
2. **Server 端代码不该进 client bundle**——Next.js 用 RSC 边界和 `serverComponentsExternalPackages` 配置处理。
3. **重依赖控制**——react-markdown、rehype 等如果全打进 client 会增大体积，RSC 服务端渲染能规避。

**Sky Chat 的选择：** 用 Next.js 自带构建（开发用 Turbopack，生产用 Webpack）。因为 Next.js 已经封装好前后端边界、RSC、代码分割，自己配 Vite/Webpack 反而要重新解决这些问题。如果是纯前端 SPA 才考虑 Vite。

**追问 1：Vite 生产构建用什么？**

用 Rollup。Vite 开发用 esbuild（极快但功能简单），生产用 Rollup（成熟、代码分割和 Tree Shaking 好）。所以 Vite 开发和生产构建行为可能不完全一致——开发跑得飞快，生产构建可能暴露问题（如循环依赖）。这是 Vite 的已知点，生产前要测构建产物。

**追问 2：AI SDK 在 client bundle 过大怎么办？**

1）**确保 AI SDK 只在 server 用**——AI 调用全放 API Route，client 组件不 import AI SDK；2）**`serverComponentsExternalPackages` 配置**——告诉 Next.js 这些包不 bundle 而是运行时 require，避免 bundle 进去；3）**client 只引轻量类型定义**——用 `import type` 只引类型不引实现。Sky Chat 的 AI 调用全在 `/api/chat`，client 零 AI SDK 依赖。

---

## M5-4. 如果要把 Sky Chat 部署上线，我会怎么设计？前端、API、模型调用分别怎么部署？

> **考察点：** 部署架构思维（岗位JD：测试上线全流程）

**标准答案：**

**部署架构：**

```
[用户] 
  ↓ HTTPS
[CDN] —— 静态资源(JS/CSS/图片)
  ↓
[Next.js Node 服务] —— SSR/RSC + API Routes(SSE/鉴权/CRUD)
  ↓                    ↓
[PostgreSQL]      [模型 API](OpenAI/通义/yunwu.ai)
  ↓
[监控采集服务] —— 接收 SDK 上报 → 存 DB → ECharts 展示
```

**各层部署：**
1. **前端 + API**：Next.js 整体部署。可容器化（Docker）部署到云主机（ECS/CVM）或 Serverless（Vercel/Cloud Run）。容器化更可控，Serverless 更省心但 SSE 有执行时间限制。
2. **模型调用**：走云厂商 API（OpenAI/通义等），API Key 存环境变量不进代码。不自己部署模型（成本高、运维重）。
3. **数据库**：PostgreSQL 用托管服务（Supabase/阿里云 RDS），自动备份、高可用、连接池。不自建（运维成本高）。
4. **监控**：自研 SDK 上报到采集 API → 存 DB → 管理后台 ECharts 展示。

**环境隔离：** dev/staging/prod 三套环境，环境变量分别管理（Vercel Environment Variables 或 .env 文件 + 密钥管理服务）。

**追问 1：Serverless 部署 SSE 有什么坑？**

1）**执行时间限制**——Vercel 默认 10s（Pro 300s），流式长对话可能超时被杀；2）**冷启动延迟**——长时间无请求后首次调用要冷启动，影响 TTFB；3）**连接数限制**——Serverless 实例多，并发 SSE 连接可能超数据库连接池。解决：升级超时、用 Edge Runtime 降冷启动、连接池（PgBouncer）、或自建 Node 服务避免这些限制。

**追问 2：怎么防 API 被滥用？**

1）**鉴权**——必须登录才能调用；2）**限流**——每用户每分钟 N 条（Redis 计数器，超限返回 429）；3）**内容过滤**——敏感词检测，违法内容拒绝；4）**监控告警**——调用频率突增、异常 IP 自动告警；5）**费用上限**——单用户日消费上限（token 计费维度），超限停用。AI API 按 token 收费，不防滥用账单会爆。

---

## M5-5. AI 应用的 CI/CD 有什么特殊考虑？模型版本、Prompt 版本怎么管理？

> **考察点：** AI工程化深度

**标准答案：**

AI 应用 CI/CD 比传统应用多几层考虑：

**1. Prompt 版本化：** Prompt 作为配置文件纳入 git 版本管理，支持回滚。不同环境（dev/prod）用不同 Prompt 版本。可以用配置中心或环境变量管理，变更走 PR review 而非直接改代码。

**2. 模型版本管理：** 每条消息记录用的模型版本（如 `gpt-4o-2024-08`），便于问题排查和效果对比。模型升级（如 GPT-4→4o）时记录切换时间点，分析影响。

**3. AB 测试：** 流量分流（如 10% 用新 Prompt/模型），对比关键指标（用户满意度、准确率、完成率），数据驱动决策而非拍脑袋。

**4. 评测集回归测试：** 维护评测集（如 100 个典型问题 + 期望答案要点），改 Prompt 或换模型后自动跑评测集，对比改动前后输出质量。关键指标（格式正确率、要点覆盖率）不降才允许上线。这是 AI 版的"单元测试"。

**5. 灰度发布：** 小流量先上（如 5%），监控指标和用户反馈，无异常逐步放量到全量。AI 输出有不确定性，灰度能及早发现问题。

**追问 1：Prompt 改动怎么验证不回归？**

1）维护评测集——100 个典型问题，覆盖各类场景；2）改 Prompt 后自动跑评测集；3）用 **LLM-as-judge**（让另一个模型评分）或人工评分对比改动前后输出；4）关键指标（格式正确率、要点覆盖率、安全合规率）不降才上线；5）上线后持续监控用户反馈（赞/踩）验证。AI 的"测试"是概率性的，靠评测集量化趋势。

**追问 2：模型升级（如 GPT-4→4o）怎么平滑切换？**

1）**AB 测试**对比新模型输出质量和成本；2）关注**格式差异**——新模型可能输出格式不同（如工具调用协议变了），前端要适配；3）**小流量灰度**先上 5%，监控错误率和用户反馈；4）保留旧模型 fallback——新模型异常时自动切回；5）记录切换时间点便于事后分析。模型升级不只是换名字，要验证行为一致性，尤其工具调用和格式输出。

---

# 模块六：产品思维与问题拆解（4题）

## M6-1. 岗位JD提到"AI Native交付模式"，你怎么理解？和传统开发流程有什么区别？

> **考察点：** AI Native认知（岗位核心概念）

**标准答案：**

**AI Native 交付：** AI 深度参与全流程（需求拆解、原型设计、代码生成、测试、文档），不是简单"用 AI 写代码"，而是把 AI 作为开发流程的核心协作方。人在 loop 里审核、引导、决策。

**与传统开发流程的区别：**

| 维度 | 传统开发 | AI Native |
|------|---------|-----------|
| 需求拆解 | 人工分析文档 | AI 辅助拆解，人审核（不确定性更高，需快速迭代） |
| 原型 | 手画/手写 | AI 生成原型，人筛选调整 |
| 编码 | 手写为主 | AI 生成 + 人工审核，人从"执行者"变"引导者/审核者" |
| 测试 | 用例驱动 | AI 生成用例 + 探索性测试，人补充边界 |
| 交付节奏 | 敏捷迭代（周/双周） | 更快迭代，接受不确定性，小步快跑 |

**核心变化：** 人的角色从"写代码的执行者"升级为"判断和决策的引导者"——重点在于判断 AI 产出对不对、引导 AI 朝对的方向走、做架构和边界决策。这要求更强的判断力和系统思维，而非单纯的编码能力。

**追问 1：AI Native 开发质量怎么保证？**

1）**人在 loop 里审核**——AI 产出必须经人审核，不盲目信任；2）**自动化测试兜底**——含 AI 生成的测试用例 + 传统测试；3）**代码审查不能省**——AI 写的代码也要 review；4）**小步快跑**——频繁验证，早发现问题。AI 提效但不替代质量门禁，反而因为生成快，审核要更严格跟上节奏。

**追问 2：AI 生成代码有什么风险？**

1）**幻觉 API**——看似对实则调用了不存在的 API，编译/运行才暴露；2）**安全隐患**——可能引入漏洞（如未过滤的 SQL、XSS）；3）**性能问题**——非最优实现，能跑但慢；4）**维护性差**——逻辑难懂，后续改不动；5）**版权风险**——可能复制训练数据中的代码。必须审查、测试、不可盲目合并。

---

## M6-2. 如果让你从0设计一个"AI辅助XX"功能（场景题），你怎么拆解需求和技术方案？

> **考察点：** 问题拆解能力（岗位要求4）

**标准答案：**

**我的拆解方法论（五步）：**

1. **先定义真实问题** —— 用户痛点是什么？频率多高？现有方案差在哪？避免"为了 AI 而 AI"。很多人一上来就想"用 AI 做 X"，但先要问"X 是真问题吗"。

2. **判断是否真需要 AI** —— 能用规则解决的不用 AI（贵、慢、不确定）。AI 适合：模糊匹配、自然语言理解、内容生成、处理非结构化数据。明确字段（如性别下拉）用规则；模糊意图（如"帮我整理这段话")用 AI。

3. **设计交互闭环** —— 用户输入 → AI 处理 → 输出 → 用户反馈 → 迭代。考虑中断、错误、重试。AI 不确定性高，要给用户修正和重来的机会。

4. **兜底方案** —— AI 失败/不准时怎么办？降级到规则、人工兜底、明确告知用户"AI 不确定请核实"。不能让 AI 失败等于功能崩溃。

5. **效果度量** —— 定义指标（准确率、满意度、完成率、耗时），AB 测试验证，持续优化。不上线就不知道效果，先上再迭代。

**举例——AI 辅助填表单：**
- 问题：表单字段多，用户嫌烦，完成率低。
- 是否需 AI：模糊字段（如"从一段话提取地址"）用 AI；明确字段（性别、年龄）用下拉/输入。
- 交互：用户语音/文本描述 → AI 解析填充各字段 → 用户确认修改 → 提交。
- 兜底：AI 解析失败 → 用户手动填，不阻塞流程。
- 度量：表单完成率、平均耗时、AI 填充后修改率（修改率高说明 AI 不准）。

**追问 1：怎么判断不该用 AI？**

1）规则能可靠解决（如表单校验、计算）；2）错误代价高且 AI 不可靠（如医疗诊断、财务计算）；3）频率低，手写比调 AI 更省；4）用户不接受不确定性（如必须精确的输出）。AI 适合**容忍模糊、容错可修正**的场景。高确定性需求用规则更稳更便宜。

**追问 2：AI 功能效果不好怎么优化？**

按成本从低到高试：1）**看数据**——收集 bad case 找失败模式；2）**改 Prompt**——加约束、加 few-shot 示例；3）**加 RAG**——补外部知识提升准确率；4）**换更强模型**——能力不够就升级；5）**加人工审核兜底**——关键场景人工确认；6）**微调**——数据足够时固化行为。先低成本试，不行再升级，避免一上来就微调浪费。

---

## M6-3. AI 生成内容不可控（幻觉、格式错乱），前端如何兜底和引导用户？

> **考察点：** 用户体验设计 + AI局限性认知

**标准答案：**

**幻觉兜底：**
1. **明确标注"AI 生成"** —— 管理用户预期，让用户知道要核实关键信息。
2. **提供反馈通道** —— 赞/踩按钮收集 bad case，用于持续优化。
3. **关键信息提示核实** —— 涉及数据、链接、事实性内容时，UI 提示"请核实准确性"。
4. **引用来源**（RAG 场景）—— 展示答案来源，用户可点击验证。

**格式错乱兜底：**
1. **流式解析容错** —— 未闭合 Markdown 自动补全（补 ` ``` `、`**`），保证渲染过程结构完整。
2. **结构化输出约束** —— 用 JSON mode 或 function calling 约束模型输出结构化数据，减少格式自由发挥。
3. **加载态/错误态/重试** —— 流式中显示进度，出错提供重试按钮，不让用户对着空白等。

**用户体验设计：**
1. **流式展示** —— 让用户感知进度，比等 10 秒一次弹出好。
2. **可编辑修正** —— 允许用户编辑 AI 回答，既修正错误又给反馈信号。
3. **重新生成** —— 不满意给第二次机会，换个回答。
4. **停止生成** —— 用户发现方向不对能立即停，不浪费等待。

**Sky Chat 实践：** 未闭合 Markdown 补全、rehype-sanitize 过滤危险 HTML、错误重试、停止生成、重新生成、复制编辑。

**追问 1：流式输出中途出错怎么处理？**

1）**已输出内容保留**——不丢失用户已等待的成果；2）错误位置标记提示——"⚠️ 此处生成中断"；3）提供"从错误处继续"或"完整重试"两个选项；4）上报错误日志便于排查。关键是**不白费用户的等待**，已出的内容要留住。

**追问 2：怎么防止 AI 输出敏感内容？**

多层防御：1）**System Prompt 约束**——明确禁止违法/敏感内容；2）**输入过滤**——用户输入敏感词检测，拒绝或提示；3）**输出过滤**——关键词匹配 + 模型审核双重过滤；4）**用户举报机制**——违规内容可举报，运营处理。没有单一手段能 100% 拦截，要纵深防御。Sky Chat 主要靠 System Prompt + 用户举报，后续会加内容审核 API。

---

## M6-4. 你的 Sky Chat 是为解决什么真实需求做的？如果用户反馈"AI回答不准"，你怎么排查和优化？

> **考察点：** 用户视角 + 问题排查（岗位要求4）

**标准答案：**

**Sky Chat 解决的真实需求：**
1. **实践 AI 应用全栈开发** —— SSE 流式、Function Calling、Agent 多步推理这些 AI 应用的核心技术，光看文档不够，必须动手做才能理解工程挑战。
2. **探索 AI 应用工程化** —— 监控（SSE 流式指标）、安全（AI 输出 XSS）、性能（流式渲染优化）这些"让 AI 真正好用"的工程问题，比 demo 更深。
3. **做一个能用的产品** —— 不是玩具 demo，而是有鉴权、会话管理、分享、监控后台的完整应用，验证全流程交付能力。

**"AI 回答不准"排查思路（控制变量法）：**

1. **定位问题环节** —— 是 Prompt 问题？检索问题（RAG）？还是模型能力问题？
2. **Prompt 检查** —— System 是否清晰？上下文是否足够？有无误导性表述？
3. **检索检查**（如有 RAG）—— 召回是否相关？chunk 是否合理？检索结果有没有拼进上下文？
4. **模型检查** —— 换更强模型对比？温度是否过高导致发散？
5. **数据分析** —— 收集 bad case 找规律（是某类问题都不准？还是偶发？）

**优化路径：** 加用户反馈通道（赞/踩）→ 建 bad case 库 → 针对性改 Prompt/加 RAG/换模型 → 建评测集量化改进 → AB 验证。

**追问 1：怎么区分是 Prompt 问题还是模型问题？**

控制变量：1）**同 Prompt 换模型**——如果换模型好了，是模型能力问题；2）**同模型改 Prompt**——如果改 Prompt 好了，是 Prompt 问题；3）**对比优秀案例的 Prompt**——找差异。两个变量只动一个，才能定位归因。如果都不行，可能是任务本身超出当前模型能力，要降级方案（拆解任务、加 RAG、人工兜底）。

**追问 2：用户反馈（赞/踩）怎么利用？**

1）**踩的 case 进 bad case 库**分析失败模式；2）**赞的 case 作为 few-shot 示例**引导模型；3）**统计高频问题**优先优化（投入产出比高）；4）**作为评测集补充**——真实用户问题是最好的评测集。反馈是持续优化的数据飞轮，但要注意用户反馈有偏差（爱点赞的多是满意的，不满意的直接走），要结合留存率等客观指标。

---

# 模块七：软性 / HR 问题（5题）

## M7-1. 你之前在准备腾讯视频前端，现在投快手 AI 应用前端，方向转变的原因是什么？

> **考察点：** 职业动机一致性

**标准答案：**

不是跟风，是 Sky Chat 项目让我发现了真正的热情。

做 Sky Chat 的过程中，我深入接触了 AI 应用工程化的核心技术——SSE 流式传输、Function Calling 多步推理、流式渲染性能优化、自研监控体系。我发现这些技术挑战比传统前端更让我兴奋：它不只是把 UI 做好看，而是要解决"如何让 AI 可靠地、流畅地服务用户"的工程难题。这种"前端工程 + AI 应用"的交叉地带，既用到我的前端基础，又有新的技术深度。

其次，前端 + AI 是明确的趋势。AI 应用需要前端工程能力（流式渲染、性能优化、交互设计），懂前端又懂 AI 应用的人有差异化优势。我不是放弃前端，而是用前端能力做 AI 应用，方向更聚焦。

快手 AI 业务（可灵、快影 AI）有真实场景和海量用户，能让 AI 应用真正落地产生影响力，这是吸引我的地方。

**追问：会不会觉得 AI 是泡沫？**

泡沫确实有，但底层价值是真实的。模型能力会持续提升，但"如何把模型变成好产品服务用户"——也就是 AI 应用工程化——是实打实的需求。不论模型多强，都需要前端把流式渲染做好、把交互设计好、把性能优化好、把监控建起来。我关注的是应用层工程能力，这层价值不依赖模型炒作，模型越强应用层越重要。

---

## M7-2. 你的职业规划？未来3年想成为什么样的工程师？

> **考察点：** 自我定位

**标准答案：**

**第 1 年：深耕 AI 应用前端工程化。** 精通流式渲染、Agent 前端架构、性能优化，能独立交付高质量 AI 应用。把 Sky Chat 里探索的技术在生产环境打磨成熟。

**第 2 年：扩展 AI 工程全栈能力。** 掌握 RAG、Agent、评测等 AI 应用核心技术栈，能主导 AI 应用技术方案设计，不只是执行者而是方案设计者。

**第 3 年：成为 AI 应用全栈工程师。** 前端深度 + AI 工程能力 + 产品思维三者结合，能从需求到上线全流程负责，带小团队攻坚复杂 AI 应用。

**核心定位：** 不做纯算法（放弃我的前端优势），也不做纯传统前端（错过 AI 浪潮）。用前端工程能力做 AI 应用，在"前端 × AI"的交叉地带形成差异化。这个定位扬长避短，既发挥我现有基础，又押注未来方向。

**追问：为什么不转纯 AI 算法？**

1）**我的优势在前端工程**——转算法等于放弃积累从零开始，不划算；2）**AI 应用开发和算法是不同赛道**——应用开发需求量大，且我的背景更匹配（前端 + 全栈 + AI 应用实践）；3）**兴趣所在**——我对"把 AI 变成好产品"更有兴趣，而非研究模型本身。算法工程师和 AI 应用工程师是互补的两个角色，我选应用层是扬长避短，不是退而求其次。

---

## M7-3. 你怎么学习新技术？最近在关注什么 AI 前沿？

> **考察点：** 学习能力（岗位要求5）

**标准答案：**

**学习方法（四步）：**
1. **官方文档优先** —— 最权威最新。如 Next.js/React/AI SDK 文档，第一手信息，避免二手博客过时。
2. **动手实践验证** —— 边学边做项目。Sky Chat 就是边学 AI SDK 边做的，遇到问题查文档、改代码、验证，比光看记得牢。
3. **读源码理解原理** —— 不满足于会用，要看实现。如读 AI SDK 源码理解 SSE 协议怎么设计的，读 TanStack Virtual 理解虚拟滚动原理。理解原理才能举一反三、面试讲深度。
4. **关注社区但批判性看** —— 了解趋势，但不盲从。每篇"X 要取代 Y"的文章都自己验证。

**近期关注的 AI 前沿：**
1. **MCP（Model Context Protocol）** —— Anthropic 提出的协议，标准化 AI 模型连接外部工具/数据源。类似 AI 的"USB-C"，统一接口降低集成成本，可能改变 Agent 开发模式。
2. **Agent 框架** —— LangGraph、CrewAI 等多 Agent 协作框架，复杂任务拆解给多个 Agent。
3. **多模态应用** —— 视频生成（可灵）、语音交互，前端怎么接多模态流式输出。
4. **长上下文模型** —— 1M token 上下文窗口对应用模式的影响（是否还需要 RAG、上下文管理怎么变）。

**追问 1：MCP 是什么？为什么重要？**

Anthropic 提出的开放协议，标准化 AI 模型与外部工具/数据源的连接方式。之前每个 AI 应用接工具都要自定义协议，MCP 统一了接口——工具按 MCP 标准实现，任何支持 MCP 的模型都能用。类似 USB-C 统一了接口。重要性：降低集成成本、生态共享（一个工具实现，所有模型可用）、可能成为 Agent 开发的事实标准。

**追问 2：怎么判断新技术值不值得投入？**

四个标准：1）**解决真实问题**（非伪需求炒作）；2）**有生态支持**（大厂或活跃社区背书，不会昙花一现）；3）**与我方向相关**（AI 应用工程，不追所有热点）；4）**早期投入收益高**（技术红利期先发优势）。不追所有热点，选与方向强相关的深入研究，其他的保持了解即可。

---

## M7-4. 实习中遇到过最大的技术挑战？怎么解决的？团队怎么协作？

> **考察点：** 抗压 + 协作（岗位要求5）

**标准答案（STAR）：**

**S（背景）：** Sky Chat 流式输出时帧率掉到 25fps，用户明显感觉卡顿，体验差。

**T（任务）：** 在保证功能（流式、Markdown、工具调用）前提下，把帧率优化到流畅（50fps+）。

**A（方案）：**
1. **Profile 定位** —— Chrome DevTools Performance 录制，发现每个 token 触发一次 setState，高频 re-render 占满主线程。
2. **查原理** —— 读 React 18 文档发现自动批处理只在同一微任务内合并，但 `reader.read()` 的 await 跨微任务无法合并。这是根因。
3. **设计 StreamBuffer + RAF** —— token delta 入队，requestAnimationFrame 每帧合并一次 setState。读 RAF 规范确认它对齐渲染帧、后台暂停的特性正合适。
4. **配套优化** —— TanStack Virtual 虚拟滚动减少 DOM、未闭合 Markdown 补全消除布局抖动、Zustand selector 精确订阅。
5. **验证** —— DevTools 实测 setState 频次 120→40 次/秒，帧率 25→50fps。

**R（结果）：** 流式渲染流畅，用户不再感知卡顿。

**协作：** 实习时周会同步进度，遇阻主动沟通——设计稿不明确及时问设计师而非自己猜，技术方案不确定找 mentor 讨论而非闷头做。代码 review 互相学习，别人的 review 意见认真对待。

**追问 1：遇到瓶颈怎么突破？**

1）**查文档/源码找原理**——很多问题根因在底层机制，理解了原理就有解；2）**社区/同事请教**——不闭门造车，描述清楚问题让别人帮看；3）**最小复现验证假设**——把问题剥离到最小 demo 验证猜想，排除干扰；4）**记录过程沉淀**——解决问题的过程写成笔记，下次类似问题快速定位。Sky Chat 优化时读了 React 批处理源码才理解为什么自动批处理无效，这是突破点。

**追问 2：和同事意见冲突怎么办？**

1）**对事不对人**——聚焦技术方案，不针对个人；2）**用数据/文档说话**——而非主观"我觉得"，拿规范、benchmark、源码佐证；3）**找共识点**——先认同对方合理部分，再讨论分歧；4）**必要时找资深同事拍板**——僵持不下时请第三方裁决，执行决议。关键是沟通而非对抗，目标是把事做好不是争输赢。

---

## M7-5. 为什么选快手？对快手 AI 业务有什么了解？

> **考察点：** 求职动机

**标准答案：**

**快手 AI 业务了解：**
1. **可灵（Kling）** —— 视频生成大模型，文生视频/图生视频，效果在国内领先，是对标 Sora 的核心产品。
2. **快影 AI** —— AI 剪辑、AI 特效、AI 配音，降低短视频创作门槛，让普通用户也能做出专业效果。
3. **AI 评论/互动** —— 评论区 AI 生成内容、AI 互动玩法，提升社区活跃度。
4. **AI 对话/搜索** —— 基于大模型的智能交互和搜索，探索 AI 在内容消费场景的应用。

**为什么选快手：**
1. **AI 业务有真实场景和海量用户** —— 可灵、快影 AI 有真实落地的产品和亿级用户，AI 应用能真正产生影响，不是 PPT。
2. **短视频 + AI 的独特结合** —— 内容生成、理解、推荐，这个交叉场景其他公司没有，技术挑战独特。
3. **技术氛围** —— 快手在开源（如 KwaiAgents）和技术分享上有投入，工程文化好。
4. **能力匹配** —— 我的 AI 应用前端能力（流式渲染、Agent 前端、性能优化、监控）正好匹配快手 AI 产品的工程需求，能快速上手贡献价值。

**追问：快手 AI 和字节/百度比优势在哪？**

1）**短视频原生场景**——快手是短视频起家，AI 赋能创作（可灵/快影）有独特的数据壁垒和场景理解；字节 AI 偏内容推荐和豆包对话，百度偏搜索 + 文心。赛道不同。2）**用户基数大且下沉**——AI 应用普惠到更广泛人群，验证 AI 产品在非技术用户群的可用性。3）**技术投入聚焦**——可灵在视频生成上效果领先，资源集中。各家 AI 战略不同，快手在"视频生成 + 创作辅助"这条赛道有差异化优势，和我的方向契合。

---

# 附：答题通用技巧

1. **先结论后展开** —— 30 秒给核心答案，再展开细节。面试官时间有限，先让他知道"你会"。
2. **主动抛权衡** —— 不等追问，主动说"这个方案的代价是 X，我权衡后选它因为 Y"。展现深度思考。
3. **联系项目** —— 抽象概念尽量用 Sky Chat 或 BHWebClient 的实例说明，证明不是背的。
4. **诚实边界** —— 不会的不硬编，说"这块我了解的是 X，没深入实践过，我的理解是 Y"。诚实比装懂加分。
5. **反问收尾** —— 回答完可以反问"这是您关心的方向吗？"或"您项目里是怎么处理的？"展现交流意识。

> 备考优先级：M1 > M2 > M4 > M6 > M3/M5 > M7
> M1、M2 每题讲到第三层（做了什么→为什么→怎么验证）；M6 设计题重点讲"判断是否需要 AI"和"兜底"；M7 真诚用 Sky Chat 体验支撑。

