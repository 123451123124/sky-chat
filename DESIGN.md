---
name: "Sky Chat · 云白编辑台"
description: "中文 AI 写作、编程与问答的清晰阅读和输入工作台"
colors:
  light-paper: "#fcfcff"
  light-panel: "#f0f1f6"
  light-field: "#fff"
  light-line: "#dddde9"
  light-ink: "#252535"
  light-muted: "#646477"
  light-accent: "#4d4ecb"
  light-primary: "#4d4ecb"
  light-hover: "#e6e7f0"
  light-selected: "#e1e2f4"
  on-primary: "#fff"
  dark-paper: "#181820"
  dark-panel: "#20202b"
  dark-field: "#23232f"
  dark-line: "#3d3d50"
  dark-ink: "#eeeef7"
  dark-muted: "#b3b3ca"
  dark-accent: "#b2b3ff"
  dark-primary: "#5d5ed5"
  dark-hover: "#303041"
  dark-selected: "#343450"
  primary-hover: "#4142b9"
  composer-line: "#d3d3e3"
  light-scrollbar: "#b4b4c9"
  dark-scrollbar: "#62627b"
  switch-off: "#9292a6"
  drawer-backdrop: "#13132280"
  delete-ink: "#b52d48"
  delete-hover: "#b52d4812"
  syntax-keyword: "#c4b5fd"
  syntax-string: "#b7d7ff"
  syntax-number: "#facb9e"
  syntax-title: "#d2c8ff"
  syntax-comment: "#aeb4c8"
  syntax-deletion: "#ffb4bd"
  syntax-deletion-bg: "#4c2230"
  syntax-addition: "#b5ebcd"
  syntax-addition-bg: "#203d31"
typography:
  display:
    fontFamily: "\"Noto Serif SC\", \"Source Han Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "36px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: ".025em"
  display-mobile:
    fontFamily: "\"Noto Serif SC\", \"Source Han Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: ".01em"
  auth-display-mobile:
    fontFamily: "\"Noto Serif SC\", \"Source Han Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "32px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: ".025em"
  brand:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "22px"
    fontWeight: 650
    letterSpacing: "-.025em"
  title:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "16px"
    fontWeight: 550
  body:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  reading-shell:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "15px"
    lineHeight: 1.85
  reading-paragraph:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
    lineHeight: 1.625
  message-input:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "15px"
    lineHeight: 1.8
  message-input-mobile:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "16px"
    lineHeight: 1.8
  user-message:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "15px"
    lineHeight: 1.8
  markdown-headline:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
  markdown-title:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "24px"
  markdown-subtitle:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  label:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
    fontWeight: 500
  small-label:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "13px"
  caption:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "12px"
  micro-label:
    fontFamily: "var(--font-geist-sans), \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    fontSize: "11px"
  code:
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace"
    fontSize: "14px"
    lineHeight: 1.625
rounded:
  delete: "6px"
  message-action: "7px"
  control: "8px"
  action: "10px"
  popover: "12px"
  composer: "16px"
  circle: "50%"
spacing:
  2: "2px"
  4: "4px"
  8: "8px"
  10: "10px"
  12: "12px"
  14: "14px"
  16: "16px"
  18: "18px"
  20: "20px"
  22: "22px"
  24: "24px"
  28: "28px"
  32: "32px"
  36: "36px"
  40: "40px"
  44: "44px"
  48: "48px"
components:
  button-new:
    backgroundColor: "{colors.light-primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.action}"
    padding: "10px 14px"
    height: "46px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-submit:
    backgroundColor: "{colors.light-primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.action}"
    height: "48px"
    width: "100%"
  button-send:
    backgroundColor: "{colors.light-primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.action}"
    size: "40px"
  button-icon:
    textColor: "{colors.light-muted}"
    rounded: "{rounded.control}"
    size: "40px"
  auth-input:
    backgroundColor: "{colors.light-field}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.action}"
    padding: "0 14px"
    height: "48px"
  history-item-selected:
    backgroundColor: "{colors.light-selected}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.control}"
  composer:
    backgroundColor: "{colors.light-field}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.composer}"
  quick-prompt:
    textColor: "{colors.light-muted}"
    padding: "6px 4px"
    height: "44px"
  attachment:
    backgroundColor: "{colors.light-selected}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  user-message:
    backgroundColor: "{colors.light-panel}"
    textColor: "{colors.light-ink}"
    rounded: "16px 16px 4px 16px"
    padding: "12px 18px"
  popover:
    backgroundColor: "{colors.light-field}"
    rounded: "{rounded.popover}"
    padding: "6px"
---

# Design System: Sky Chat · 云白编辑台

## Overview

**Creative North Star: "云白编辑台"**

“云白编辑台”让中文写作、编程和问答围绕一条清晰的阅读与输入轴展开。冷白画布、淡紫灰历史栏与靛蓝操作形成安静的编辑环境；常规控件保持紧凑，空白用于区分任务层次。问候和认证标题采用用户所选方向中的中文衬线字，日常操作与回复使用无衬线字。

本系统覆盖登录、注册、聊天和界面预览，依据已实现的 app/cloud-desk.css 与对应组件记录。营销首页的 .sky-home 和后台管理各自保留现有样式，不受本系统约束。没有随此次重设计交付的栅格图像；品牌云标和操作图标以 SVG 绘制。

**Key Characteristics:**
- 单一阅读与输入轴，桌面历史栏与手机模态抽屉。
- 冷白与紫灰中性面，靛蓝主操作，完整浅色与深色语义。
- 衬线问句，无衬线内容，轻边界与克制圆角。
- 快捷提问以细下划线表达悬停和选中状态。

## Colors

画布与中性面带轻微冷紫倾向，靛蓝让新对话、发送和认证操作成为视觉锚点。上方 tokens 为规范值，源码的 `--sky-*` 同名角色在主题容器内切换；前缀 light-/dark- 是文档对这两个实际值的标记。

### Primary

- **靛蓝操作 / light-primary、dark-primary**：主按钮的实底；其文字使用 on-primary。
- **靛蓝强调 / light-accent、dark-accent**：图标、链接、焦点、光标、选中操作。浅色与主操作相同，深色特意更亮。
- **主操作悬停 / primary-hover**：新对话、发送和认证按钮的共同悬停底色，两种主题均保留此实现。
- **选中与悬停面 / light-selected、dark-selected、light-hover、dark-hover**：分别用于选中会话、附件、提示背景及控件悬停。

### Neutral

- **云白 / light-paper、dark-paper**：工作区与认证页面的基础画布。
- **紫灰栏面 / light-panel、dark-panel**：历史栏与用户气泡；深色代码面也使用栏面色。
- **输入纸面 / light-field、dark-field**：输入框与弹出菜单。
- **轻边界 / light-line、dark-line**：分隔线与常规输入边界；浅色 composer 单独使用 composer-line。
- **正文墨色 / light-ink、dark-ink** 与 **辅助墨色 / light-muted、dark-muted**：主文本及占位符、时间/状态、操作说明。
- **辅助角色**：light-scrollbar/dark-scrollbar 为窄滚动条；switch-off 为关闭开关；drawer-backdrop 为抽屉遮罩；delete-ink/delete-hover 只属于删除反馈。

深色代码以 dark-panel 为底、dark-ink 为普通文本，语法前景使用 syntax-keyword、syntax-string、syntax-number、syntax-title、syntax-comment。删除与新增分别配成前景/底色两对。工作台先令未单独定义的高亮 span 继承可读文本色，再指定这些分类；轻色代码沿用引入的 highlight.js GitHub 主题。不要使用全局旧深色高亮值覆盖这里更具体的规则。最终修复复查记录的采样对比度均达到 (4.5:1)。

**The Theme Roles Rule.** 深色模式分别替换画布、栏面、输入面、边界、正文、次级文字和状态面；主按钮底色与文本/焦点强调色必须分开使用。

## Typography

**Display Font:** "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif

**Body Font:** var(--font-geist-sans), "Segoe UI", "Microsoft YaHei", sans-serif

**Label/Mono Font:** var(--font-geist-mono), ui-monospace, monospace

Geist 由 app/layout.tsx 提供；中文无衬线与衬线均依赖各自字体栈回退，没有新增字体文件或外部字体加载。标题的书写感是所选方向的明确例外，不扩展为全站展示字体。

### Hierarchy

- **Display**：欢迎与认证标题使用 display；手机欢迎改用 display-mobile，手机认证改用 auth-display-mobile。
- **Brand**：历史栏品牌使用 brand；认证品牌为 (21px)、字距 (-.02em)。云标通常为 (32px)，描边 (1.6)，无底板。
- **Title**：模型选择器使用 title；手机为 (14px)。Markdown h1/h2/h3 分别使用 markdown-headline、markdown-title、markdown-subtitle。
- **Body**：产品容器默认 body。回复容器为 reading-shell，但内部段落、列表与代码依照组件现有工具类使用 reading-paragraph/code；不要把容器的 (15px) 误记为全部回复子元素的计算字号。
- **Input / user message**：输入与用户气泡保持宽松行高；手机输入与认证输入提升到 (16px)。欢迎说明在桌面为 (15px)、手机 (14px)。
- **Label**：表单标签与主按钮为 label；历史标题、页脚和输入说明为 caption；会话行和消息操作为 small-label；账号副行和部分生成状态为 micro-label。
- **Code**：代码使用 Geist Mono 回退栈；长行在代码区域横向滚动，正文和用户气泡可在长单词内部断行。

**The Serif Question Rule.** 衬线字体属于欢迎问句和认证标题；导航、按钮、输入和 Markdown 标题继续使用无衬线字体。

## Layout

桌面工作台为视口高 (100dvh) 的左右结构，历史栏固定 (240px)，右侧主区允许收缩并分别管理内容滚动。工具栏高度至少 (80px)，内边距 (16px 36px)。历史栏品牌内边距为 (28px 28px 32px)，主要操作两侧 (20px)，会话列表两侧 (12px)。

欢迎区外框最大 (784px)，左右各 (32px) 内边距形成最大 (720px) 的内容轴，顶部留白 (125px)。该居中输入区域不再加 composer 外边距。活动会话的消息外框最大 (768px)，左右内边距 (16px)，大屏 (24px)；底部 composer 外框最大 (800px)、两侧 (24px)，可用输入宽度因此为 (752px)。这些相关宽度服务同一阅读轴，并非所有状态统一锁死在 720px。

间距以小量 (2–4px)、控件 (8–16px)、成组内容 (20–32px)、段落分区 (36–48px) 组织；源码中的 (10px)、(14px)、(18px)、(22px)、(28px) 调节文字、图标和触控密度，不要求所有间距被 8 整除。

- **手机边界 (767px 以下)**：常驻侧栏在 (768px) 断点隐藏，工具栏至少 (68px)、内边距 (10px 12px)；历史导航变为原生模态 dialog 抽屉，宽 `min(300px, 88vw)`，保留同一历史、搜索、删除和账号操作。进入桌面断点时关闭抽屉。
- **手机欢迎态**：内边距 (72px 22px 32px)，快捷项间距 (22px)；活动 composer 两侧 (16px)，用户气泡最大宽度从 (80%) 变为 (92%)。
- **窄手机动作 (639px 以下)**：导出/分享的直接按钮收进带文字的更多操作菜单；搜索开关保留，联网搜索文字在 (640px) 以上显示。
- **触控与安全区**：手机图标按钮 (40×44px)、发送 (44×44px)、消息操作至少 (44×44px)；会话删除常显，桌面则在行悬停/聚焦时显示。底部 composer 使用 `max(18px, env(safe-area-inset-bottom))`。
- **短屏**：桌面宽度至少 (768px) 且高度最多 (800px) 时，欢迎顶部改为 (68px)；高度最多 (650px) 时进一步改为 (28px)，认证表单上对齐并以 (20px) 顶部内边距进入。
- **认证**：表单最大宽度 (380px)，字段间距 (22px)，主区内边距 (48px 24px 96px)，手机为 (32px 24px 64px)。头部两侧 (40px)，手机 (20px)。

## Elevation & Depth

共享工作台、认证、composer 和弹出菜单不使用投影。历史栏的紫灰面、输入纸面、细边界与留白承担层次；模态抽屉用半透明遮罩标明前后关系。菜单为绝对定位，位于触发器下方 (8px)，toast 使用反转正文/画布色并位于工具栏下方。

继承的 Markdown 表格包装仍带局部轻投影；这不是共享容器的阴影规则，不据此给新表面增加阴影。

**The Quiet Boundary Rule.** 工作台、认证、输入框与菜单通过色面、留白和 1px 边界区分；共享控件不添加装饰性投影，引用侧线保持 1px。

## Shapes

以 (1px) 边界、温和圆角和线图标组织形体。常规图标按钮、会话行、附件为 control；实底动作与认证输入为 action；菜单为 popover；composer 为 composer。用户气泡只收紧右下角，使用上方 user-message 的四角值。头像与开关圆点为圆形，开关轨道为 (16px) 圆角。Markdown 代码块保留局部 (6px) 圆角。

## Components

### Buttons

主按钮以主题 primary 实底配 on-primary 文字；新对话至少 (46px) 高，认证至少 (48px)，发送 (40px) 方形。悬停只改变底色，不抬升。发送不可用时改成 hover 面与 muted 文字；认证加载时不透明度 (.6)，常规图标禁用时 (.45)。

图标按钮透明底、muted 前景，悬停改为 hover 面与 accent 前景；模型和搜索控制保持透明轻操作。所有可见按钮/链接的键盘焦点为主题 accent 的 (2px) outline，偏移 (4px)。

### Inputs / Fields

认证输入为 (48px) 高、主题 field 底与 line 边界，左右内边距 (14px)。聚焦边界改 accent，同时保留键盘焦点 outline。历史搜索平时透明，focus-within 切为 field 底与 accent 边界。

输入光标使用 accent；选中文字使用 selected 底与 ink 前景。占位符使用 muted，opacity 为 (1)。composer 与搜索输入去除子元素 outline，由父容器的 focus-within 边界表达焦点；其他可交互元素仍保留全局焦点样式。

### Navigation

历史项以 small-label 会话文字、SVG 线图标、圆角色面表达当前项；悬停 hover，当前 selected，文字不反白。删除按钮仅在行悬停/含焦点时显现，手机常显，删除悬停使用局部红色反馈。底部账号区用 (1px) 顶边界与列表分隔。手机 dialog 具有遮罩、关闭按钮、Escape 关闭以及选择会话后的关闭行为。

### Composer

单一描边输入框是主要工作区域。textarea 最小 (96px)、最大 (200px)，桌面内边距 (20px 20px 12px)；手机最小 (104px)、内边距 (18px 16px 10px)。附件与发送按钮位于同一底部操作行。生成中发送箭头切换为停止图标，上传/错误用中文可读状态呈现；Enter 发送、Shift+Enter 换行，并保护中文输入法组合状态。

### Quick Prompts

三个纯文字快捷提问无卡片底。悬停或当前草稿等于该提问时，文字切 accent，底部 (1px) 线由 scaleX(0) 展开到 scaleX(1)。点击填入现有 composer 并聚焦，保留用户可以继续编辑的操作路径。该线条动画为 (.2s)、`cubic-bezier(.16,1,.3,1)`。

### Messages / Markdown

用户气泡使用 panel；助手回复以云标和开放正文排列，无整块卡片底。消息操作为次级轻按钮，可复制或重新生成，按状态显示。引用为左侧 (1px) line、左内边距 (16px) 与 muted 文本。代码块允许横向滚动并保留复制操作；深色完整高亮前景按 Colors 执行。表格、思考与工具输出保留已有内容模板和局部语义状态色，SVG 图标与中文状态文字承担识别；这些语义色不构成第二套品牌强调色。

### Popovers / Toasts / Attachments

菜单使用 field、line 边界、popover 圆角与 (6px) 内边距，选项最小 (44px) 高，悬停或按下状态使用 selected 面；Escape 和外部点击关闭。toast 使用 ink 底与 paper 文字，内边距 (12px 16px)，最大宽为主区减 (32px)。附件为 selected 底、control 圆角、(8px 12px) 内边距的文件名条，保留移除按钮。

共享控件的背景、边界、前景与开关位移转换通常为 (.18s)；动画不改变布局。系统的减少动态效果偏好将动画和转换时长缩到 (.01ms)，并关闭平滑滚动。

## Do's and Don'ts

### Do:

- **Do** 使用成对主题角色，尤其保留深色强调色与深色主按钮底色的区别。
- **Do** 保留中文衬线问句与无衬线操作/回复的分工。
- **Do** 保持桌面 240px 历史栏、欢迎态最大 720px 内区与手机可达的输入操作。
- **Do** 让快捷提问填入并聚焦现有输入框，以 1px 下划线显示其状态。
- **Do** 保持手机导出和分享入口、模态抽屉及减少动态效果偏好。
- **Do** 在深色代码中为普通文本和所有语法类别保留清楚的前景色。

### Don't:

- **Don't** 把营销首页或后台的局部样式认定为这个工作台的漂移。
- **Don't** 将欢迎态衬线标题扩散到按钮、导航或代码。
- **Don't** 用字形表情代替产品操作图标；使用 SVG 线图标和可读状态文字。
- **Don't** 为共享表面增加装饰卡片、硬偏移阴影或粗引用侧线。
- **Don't** 在手机收起桌面按钮时一并删除导出或分享能力。
- **Don't** 将单个工具状态的语义色或继承的表格投影提升为共享品牌规则。



## 管理与知识库扩展（2026-10-19）

管理平台复用云白编辑台主题、侧栏、图标与排版，桌面采用侧栏和文档工作区，手机采用顶部横向导航。知识库维护与聊天选择分离，管理端呈现批次、文件状态与发布结果，聊天端保留阅读与提问。3D 视图采用卡片式来源路径，不使用彩色小球；手机聚焦选定来源，其他来源通过等价列表访问。
