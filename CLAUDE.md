# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack AI chat platform with custom SSE streaming, Function Calling, monitoring SDK, and admin dashboard.

**Stack:** Next.js 16.2.4 App Router + TypeScript + Tailwind CSS + Zustand + Prisma + PostgreSQL (Supabase)  
**AI:** Vercel AI SDK v6 + OpenAI Compatible API (Base URL: `https://yunwu.ai/v1`)

## Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint check
npm run seed     # Seed database (npx tsx prisma/seed.ts)
npx prisma generate    # Regenerate Prisma client after schema changes
npx prisma migrate dev # Apply migrations
npx prisma studio      # Open Prisma Studio
```

## Architecture

### App Router Pages
- `/chat` — Main chat UI (RSC page → `ChatPageClient` → `ChatContainer` → `MessageList`, `ChatInput`)
- `/share/[token]` — Public share page (RSC renders markdown server-side, client bundle ~5.6KB)
- `/admin` — Admin dashboard with ECharts (user mgmt, session stats, SSE performance monitoring)
- `/login`, `/register` — Auth pages

### API Routes
- `POST /api/chat` — Core streaming endpoint: fetches OpenAI-compatible API, parses SSE, relays typed chunks (`text-start`, `text-delta`, `tool-input-start`, `tool-output-available`, `step-start`, `finish`, `error`). Supports multi-step Function Calling (up to 5 steps). Uses ReadableStream + TextEncoder, not Vercel AI SDK on the server side.
- `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`, `GET /api/auth/me` — JWT auth (jose, HS256, 7d expiry), httpOnly cookies
- `GET/POST /api/session`, `GET/DELETE /api/session/[id]` — Session CRUD
- `POST /api/message`, `GET /api/message` — Messages per session
- `POST /api/generate-image` — Image generation via DALL-E 3
- `POST /api/share` — Create share link (generates unique shareToken)
- `POST /api/monitor` — Receive frontend monitoring metrics
- `GET /api/user` — User listing (admin)

### Client-Side Streaming Architecture
- **SSEParser** (`lib/sse-parser.ts`) — Parses raw SSE text into structured events. Replaces EventSource because it can't send POST or custom headers.
- **StreamBuffer** (`lib/stream-buffer.ts`) — Buffers text deltas and flushes via requestAnimationFrame. Reduces re-render frequency from ~120fps to ~40fps.
- **ai-stream** (`lib/ai-stream.ts`) — Typed chunk definitions and dispatcher (`handleStreamChunk`). Covers 14 chunk types including text, reasoning, tool input/output, step-start, finish, error, abort.
- **useChatStore** (`store/useChatStore.ts`) — Zustand store with finite state machine: `thinking → tool_calling → answering → idle/error`. Stores messages with typed parts (`TextPart`, `ReasoningPart`, `ToolPart`, `StepStartPart`).

### Monitoring SDK (`lib/monitor/`)
- Client-side performance tracking for SSE streaming: TTFB, TTLB, stall detection (>500ms gap), phase durations
- IndexedDB offline queue with batch reporting (every 10s, max 20 per batch)
- Dual-channel reporting: sendBeacon (page unload) + Fetch fallback
- `SSEPerformanceTracker` class wraps per-session metrics, auto-flush via `startAutoFlush()`

### Auth
- JWT-based, stored in httpOnly cookie named `sky-chat-token` (7d expiry)
- Middleware (`middleware.ts`) protects `/chat`, `/admin`, redirects logged-in users away from `/login` and `/register`
- Admin role check in middleware: non-admin users redirected from `/admin` to `/chat`
- Password hashing with bcryptjs (10 salt rounds)

### Database (Prisma)
- `User` — id, email, name, password, role ("user"|"admin"), sessions[]
- `Session` — id, userId?, title, shareToken?, messages[], timestamps
- `Message` — id, sessionId, role, content, createdAt (cascade delete with session)
- `MonitorMetric` — type, name, value, url, userAgent, sessionId?, metadata (JSON), timestamp

### Key Patterns
- **SSE chunk types** are dispatched through `handleStreamChunk` with typed callbacks — the client never parses raw OpenAI API responses directly
- **Tool execution** happens server-side (in `/api/chat`): the route handler receives tool calls, executes them (currently `generateImage` via DALL-E 3), and emits output as SSE events. Client only renders state transitions.
- **Share pages** use RSC to render markdown server-side (react-markdown + remark-gfm + rehype-highlight), keeping client JS minimal
- **shadcn/ui** components in `components/ui/` with Radix UI primitives, CVA for variants, Tailwind v4
- **Geist font** loaded via `geist` package (Sans + Mono variables)
- All component CSS is Tailwind utility classes; `globals.css` uses Tailwind v4 `@import "tailwindcss"` syntax

### Notable Constraints
- Must check `node_modules/next/dist/docs/` before writing Next.js code — this repo uses Next.js 16.2.4 which may have API differences
- The `/api/chat` route is a custom SSE implementation (not using `ai` SDK's `streamText`), so streaming behavior is controlled by the typed chunk protocol
- Tool definitions are server-side only; adding a new tool requires updating both the `tools` array and `executeTool()` in `app/api/chat/route.ts`
