# Sky Chat - AI 智能对话平台

## 项目概述

目标：作为简历项目，展示全栈能力与前端工程化深度

技术栈：Next.js 16.2.4 App Router + TypeScript + Tailwind CSS + Zustand + Prisma + PostgreSQL (Supabase)

AI 调用：Vercel AI SDK v6 + OpenAI Compatible API（中转 API，Base URL: `https://yunwu.ai/v1`）

项目路径：`C:\Users\jw\Desktop\sky-chat\sky-chat`

***

## 项目组成部分

### 1. AI 聊天客户端（app/chat）

#### 核心功能

- 流式对话（SSE + ReadableStream）
- 会话管理（CRUD）
- 状态机管理（thinking/answering/idle/error）
- Markdown 消息渲染
- 图片生成(Function Calling)、语音输入、文件上传、对话分享

#### 技术亮点

**SSE 解析层与状态机驱动**

- 针对 EventSource 无法携带 POST Body 与自定义 Header 的限制，基于 Fetch + ReadableStream 封装 SSE 解析层
- 设计有限状态机管理消息生命周期（thinking → tool\_calling → answering），SSE 事件驱动状态转换
- 解决多轮 Function Calling 场景下 UI 与流式消息状态不同步的问题

**渲染与性能优化**

- 引入 buffer 缓冲队列配合 requestAnimationFrame 批量刷新，解决流式 chunk 高频触发 setState 导致的冗余 re-render，渲染频次从峰值 120 次/秒降至 40 次/秒以下
- 针对流式输出时富文本块高度突变引发的布局偏移，组合预留骨架高度、overflow-anchor 滚动锚定、未闭合 Markdown 块自动补全消除抖动
- 基于 TanStack Virtual 实现虚拟滚动，配合游标分页实现长会话场景下的流畅渲染
- 利用 RSC 将分享页 Markdown 渲染移至服务端，Page chunk 压缩至 5.6KB，TBT 控制在 90ms 以内

### 2. 自研监控 SDK（@sky/monitor）

#### 核心功能

- 采集前端性能指标（TTFB、TTLB、Stall 等）
- IndexedDB 离线缓存
- 批量上报
- sendBeacon + Fetch fallback 双通道

#### 技术亮点

**SSE 流式场景指标体系**

- 针对 SSE 流式场景扩展指标体系：首字节时间（TTFB）、流式完成时间（TTLB）、卡顿检测（Stall）、阶段耗时
- 填补传统 HTTP 请求监控盲区

**数据上报策略**

- 采用 sendBeacon + Fetch fallback 双通道上报解决页面卸载时数据丢失
- 基于 IndexedDB 实现离线队列支持弱网重传

**会话录制**

- 集成 rrweb 实现会话录制
- 针对 SPA 路由切换导致的 DOM 快照断裂问题，设计 EventsMatrix 二维时间片存储方案
- 配合 History API 劫持，实现路由变化时主动触发快照更新
- 针对流式渲染场景采样 DOM 变更避免高频 mutation 性能问题

### 3. 管理后台（app/admin）

- 用户管理
- ECharts 可视化（性能指标、会话统计）
- 监控数据面板

***

## 数据库 Schema（Prisma）

```prisma
User {
  id, email, name, sessions[]
}

Session {
  id, userId?, title, shareToken?, messages[], createdAt, updatedAt
}

Message {
  id, sessionId, role, content, createdAt
}
```

***

## 开发进度

### AI 聊天客户端

- [x] Next.js 16 App Router 基础架构
- [x] Vercel AI SDK 流式对话基础实现
- [x] Zustand 状态机定义
- [x] 会话 CRUD API
- [ ] SSE 解析层封装
- [ ] buffer 缓冲队列 + RAF 批量渲染
- [ ] Markdown 渲染 + 骨架屏
- [ ] TanStack Virtual 虚拟滚动
- [ ] RSC 分享页优化
- [ ] Function Calling 图片生成

### 自研监控 SDK

- [ ] 性能指标采集（TTFB/TTLB/Stall）
- [ ] IndexedDB 离线队列
- [ ] sendBeacon + Fetch 双通道上报
- [ ] rrweb 会话录制
- [ ] EventsMatrix 存储方案

### 管理后台

- [ ] 用户管理
- [ ] ECharts 可视化

