# sky-chat 项目摸底报告

## 基本信息

| 字段 | 值 |
| --- | --- |
| repo_path | C:\Users\jw\Desktop\sky-chat\sky-chat |
| generated_at | 2026-05-18T03:27:02.995168+00:00 |
| file_count_scanned | 857 |
| approx_total_bytes | 312528809 |

## 语言和文件类型

| 语言 | 文件数 |
| --- | --- |
| Other | 510 |
| JavaScript | 282 |
| TypeScript | 61 |
| SQL | 3 |
| TOML | 1 |

## 依赖和环境线索

- `.next/dev/package.json`
- `.next/package.json`
- `package.json`
- `tsconfig.json`

## README

- `README.md`

## 核心链路线索

| 类别 | 命中文件数 | 代表路径 |
| --- | --- | --- |
| api_backend | 40 | .next/app-path-routes-manifest.json<br>.next/dev/routes-manifest.json<br>.next/dev/server/app-paths-manifest.json<br>.next/dev/server/app/admin/page.js<br>.next/dev/server/app/admin/page.js.map<br>.next/dev/server/app/admin/page/app-paths-manifest.json<br>.next/dev/server/app/admin/page/build-manifest.json<br>.next/dev/server/app/admin/page/next-font-manifest.json |
| config | 8 | .claude/settings.local.json<br>.next/dev/cache/next-devtools-config.json<br>.next/server/functions-config-manifest.json<br>eslint.config.mjs<br>next.config.ts<br>postcss.config.mjs<br>tsconfig.json<br>tsconfig.tsbuildinfo |
| database_state | 40 | .next/cache/.previewinfo<br>.next/cache/.rscinfo<br>.next/cache/.tsbuildinfo<br>.next/dev/cache/.rscinfo<br>.next/dev/cache/next-devtools-config.json<br>.next/dev/cache/turbopack/2275bd85/00000001.sst<br>.next/dev/cache/turbopack/2275bd85/00000005.sst<br>.next/dev/cache/turbopack/2275bd85/00000006.sst |
| devops_deploy | 6 | .next/cache/.rscinfo<br>.next/dev/cache/.rscinfo<br>.next/dev/static/chunks/node_modules_echarts_lib_label_0ew_cim._.js<br>.next/dev/static/chunks/node_modules_echarts_lib_label_0ew_cim._.js.map<br>.next/server/chunks/ssr/_0cijloo._.js<br>.next/server/chunks/ssr/_0cijloo._.js.map |
| frontend_mobile | 40 | .next/cache/.previewinfo<br>.next/dev/server/app/admin/page.js<br>.next/dev/server/app/admin/page.js.map<br>.next/dev/server/app/admin/page/app-paths-manifest.json<br>.next/dev/server/app/admin/page/build-manifest.json<br>.next/dev/server/app/admin/page/next-font-manifest.json<br>.next/dev/server/app/admin/page/react-loadable-manifest.json<br>.next/dev/server/app/admin/page/server-reference-manifest.json |
| inference_demo | 40 | .next/app-path-routes-manifest.json<br>.next/dev/server/app-paths-manifest.json<br>.next/dev/server/app/admin/page.js<br>.next/dev/server/app/admin/page.js.map<br>.next/dev/server/app/admin/page/app-paths-manifest.json<br>.next/dev/server/app/admin/page/build-manifest.json<br>.next/dev/server/app/admin/page/next-font-manifest.json<br>.next/dev/server/app/admin/page/react-loadable-manifest.json |
| model | 40 | .next/dev/server/chunks/node_modules_0~24uzp._.js<br>.next/dev/server/chunks/node_modules_0~24uzp._.js.map<br>.next/dev/server/chunks/ssr/node_modules_0.shb2p._.js<br>.next/dev/server/chunks/ssr/node_modules_0.shb2p._.js.map<br>.next/dev/server/chunks/ssr/node_modules_09w7yel._.js<br>.next/dev/server/chunks/ssr/node_modules_09w7yel._.js.map<br>.next/dev/server/chunks/ssr/node_modules_0ctd64b._.js<br>.next/dev/server/chunks/ssr/node_modules_0ctd64b._.js.map |
| security_auth | 40 | .next/dev/server/app/api/auth/login/route.js<br>.next/dev/server/app/api/auth/login/route.js.map<br>.next/dev/server/app/api/auth/login/route/app-paths-manifest.json<br>.next/dev/server/app/api/auth/login/route/build-manifest.json<br>.next/dev/server/app/api/auth/login/route/server-reference-manifest.json<br>.next/dev/server/app/api/auth/login/route_client-reference-manifest.js<br>.next/dev/server/app/api/auth/me/route.js<br>.next/dev/server/app/api/auth/me/route.js.map |

## Notebook / Docker / Test 线索

### Notebooks
- 无

### Docker
- 无

### Tests
- 无

## 潜在数据/状态/模型/资源路径

- `.next/dev/logs/next-development.log`
- `.next/dev/static/chunks/[turbopack]_browser_dev_hmr-client_hmr-client_ts_0yjw1oe._.js`
- `.next/dev/static/chunks/[turbopack]_browser_dev_hmr-client_hmr-client_ts_0yjw1oe._.js.map`
- `.next/dev/static/chunks/[turbopack]_browser_dev_hmr-client_hmr-client_ts_10mygs7._.js`
- `.next/dev/static/chunks/[turbopack]_browser_dev_hmr-client_hmr-client_ts_10z625~._.js`
- `.next/dev/static/chunks/[turbopack]_browser_dev_hmr-client_hmr-client_ts_10z625~._.js.map`
- `.next/dev/static/chunks/_0.iou3f._.js`
- `.next/dev/static/chunks/_0.iou3f._.js.map`
- `.next/dev/static/chunks/_07lq-lb._.js`
- `.next/dev/static/chunks/_07lq-lb._.js.map`
- `.next/dev/static/chunks/_0gwi_ag._.js`
- `.next/dev/static/chunks/_0gwi_ag._.js.map`
- `.next/dev/static/chunks/_0ikyn_8._.css`
- `.next/dev/static/chunks/_0ikyn_8._.css.map`
- `.next/dev/static/chunks/_0p44nws._.js.map`
- `.next/dev/static/chunks/_0rqeker._.js`
- `.next/dev/static/chunks/app_admin_page_tsx_0crj78o._.js`
- `.next/dev/static/chunks/app_chat_page_tsx_0crj78o._.js`
- `.next/dev/static/chunks/app_globals_css_0w3-wzy._.single.css`
- `.next/dev/static/chunks/app_globals_css_0w3-wzy._.single.css.map`
- `.next/dev/static/chunks/app_layout_tsx_004glpo._.js`
- `.next/dev/static/chunks/app_login_page_tsx_0crj78o._.js`
- `.next/dev/static/chunks/components_ThemeProvider_tsx_0qy4dd_._.js`
- `.next/dev/static/chunks/components_ThemeProvider_tsx_0qy4dd_._.js.map`
- `.next/dev/static/chunks/node_modules_02-64to._.js`
- `.next/dev/static/chunks/node_modules_02-64to._.js.map`
- `.next/dev/static/chunks/node_modules_06dcl1b._.js`
- `.next/dev/static/chunks/node_modules_06dcl1b._.js.map`
- `.next/dev/static/chunks/node_modules_0gdfm4s._.js`
- `.next/dev/static/chunks/node_modules_0gdfm4s._.js.map`

## 目录树摘要

```text
sky-chat/
  .claude/
  .next/
  app/
  components/
  lib/
  prisma/
  public/
  store/
  .env
  .env.example
  .gitignore
  AGENTS.md
  CLAUDE.md
  KNOWLEDGE.md
  PROJECT_HIGHLIGHTS.md
  README.md
  components.json
  eslint.config.mjs
  middleware.ts
  next-env.d.ts
  next.config.ts
  package-lock.json
  package.json
  postcss.config.mjs
  tsconfig.json
  tsconfig.tsbuildinfo
  简历.tex
  面试问答-SkyChat.md
  面试题.md
    settings.local.json
    cache/
    dev/
    diagnostics/
    server/
    static/
    types/
    BUILD_ID
    app-path-routes-manifest.json
    build-manifest.json
    export-marker.json
    fallback-build-manifest.json
    images-manifest.json
    next-minimal-server.js.nft.json
    next-server.js.nft.json
    package.json
    prerender-manifest.json
    required-server-files.js
    required-server-files.json
    routes-manifest.json
    trace
    trace-build
    turbopack
      .previewinfo
      .rscinfo
      .tsbuildinfo
      cache/
      logs/
      server/
      static/
      types/
      build-manifest.json
      fallback-build-manifest.json
      package.json
      prerender-manifest.json
      routes-manifest.json
      trace
      build-diagnostics.json
      framework.json
      route-bundle-stats.json
      app/
      chunks/
      edge/
      middleware/
      pages/
      app-paths-manifest.json
      functions-config-manifest.json
      interception-route-rewrite-manifest.js
      middleware-build-manifest.js
      middleware-manifest.json
      next-font-manifest.js
      next-font-manifest.json
      pages-manifest.json
      prefetch-hints.json
      server-reference-manifest.js
      server-reference-manifest.json
      GPWrwr1hiQ2StghBU3oaa/
      chunks/
      media/
      cache-life.d.ts
      routes.d.ts
      validator.ts
    admin/
    api/
    chat/
    login/
    register/
    share/
    favicon.ico
    globals.css
    layout.tsx
    page.tsx
      AdminPageClient.tsx
      page.tsx
      auth/
      chat/
      generate-image/
      message/
      monitor/
      session/
      share/
      upload/
      user/
      components/
      ChatContainer.tsx
      ChatPageClient.tsx
      page.tsx
      page.tsx
      page.tsx
      [token]/
    ui/
    ScrollToBottom.tsx
    ThemeProvider.tsx
    ThemeToggle.tsx
      button.tsx
      card.tsx
      input.tsx
      textarea.tsx
    monitor/
    ai-stream.ts
    auth.ts
    models.ts
    prisma.ts
    search.ts
    sse-parser.ts
    stream-buffer.ts
    utils.ts
      collector.ts
      index.ts
      indexeddb.ts
      reporter.ts
      types.ts
    migrations/
    schema.prisma
    seed.ts
      20260425123345_init/
      20260427091308_add_user_auth/
      20260514083335_add_message_parts/
      migration_lock.toml
    file.svg
    globe.svg
    next.svg
    vercel.svg
    window.svg
    useAuthStore.ts
    useChatStore.ts
```

## 下一步人工确认

- 找到最小可运行命令：API、页面、CLI、worker、测试、训练或 demo 至少一个。
- 确认依赖、环境变量、数据库/数据文件、端口和外部服务。
- 确认 baseline/demo 是否能在本地、Docker、云服务器或 GPU 环境上跑通。
- 确认自己要做的面试亮点：改造点、demo、测试、报告或实验计划。
