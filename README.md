<p align="center"><img src="extension/icons/icon128.png" width="72" alt="DIC"></p>
<h1 align="center">DIC — 上下文智能词典</h1>
<p align="center">鼠标停在网页里的词上，原位看到基于<b>当前句子</b>的解释。不跳转，不打断阅读心流。</p>
<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-2f6fed">
  <img alt="Node 22+" src="https://img.shields.io/badge/Node-%E2%89%A522-2f6fed">
  <img alt="Runtime deps 0" src="https://img.shields.io/badge/runtime%20deps-0-2f6fed">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-2f6fed">
</p>

> **English summary** — DIC is a Chrome/Edge (Manifest V3) extension that explains the word, acronym or phrase under your cursor *in the context of the sentence it appears in*, using Gemini. Bring your own Gemini API key (BYOK): paste it once in the options page and you're done — no server, no build step, no frameworks, zero runtime dependencies. An optional zero-dependency local Node gateway is available for users who prefer to keep the key out of the browser. Developed as a learning project in collaboration with Claude / Claude Code — see [§ 开发过程](#开发过程与-ai-协作).

---

## 它解决什么问题

读英文研报、论文、技术文档时，一页里可能有十几个缩写和专业词（HBM、CoWoS、EV/EBITDA、FDPR…）。切到另一个标签页去查，再切回来找刚才读到哪，每次都是一次心流中断。普通词典插件只给词的通用释义，而同一个词在金融语境和半导体语境里意思完全不同。

DIC 的做法：鼠标停在词上 0.6 秒，原位弹出一个小窗，把**这个词 + 它所在的句子 + 前后文**发给模型，让模型解释"它在这里是什么意思、和上下文什么关系"，并举一个例子。想深入就把鼠标移进弹窗，自动补充机制背景、相关概念和可点击的追问；弹窗里再选中一个词可以继续往下查（最多 3 层）。

## 演示

```
┌─────────────────────────────────────────────────────────────┐
│  …connects them to the processor through a silicon          │
│  interposer. Because the interposer is manufactured by      │
│  TSMC using its [CoWoS] packaging process, supply…          │
│                   ▲                                         │
│        ┌──────────┴──────────────────────────────┐          │
│        │ CoWoS   Chip-on-Wafer-on-Substrate       │          │
│        │ ▎台积电的 2.5D 先进封装工艺：把 GPU 和   │          │
│        │ ▎HBM 并排放在一片硅中介层上再装到基板。   │          │
│        │ 在这句里它是 HBM 加速器供给的瓶颈环节…    │          │
│        │ 例：CoWoS capacity, not wafer supply, …   │          │
│        │                             深入理解 →   │          │
│        └──────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

仓库自带一篇示例文章 `demo/sample-article.html`（故意堆满缩写），跑起来后直接用它演示。

## 安装（2 分钟，不需要装任何东西）

1. 下载本仓库（GitHub 页面右上角 **Code → Download ZIP**，解压），或 `git clone https://github.com/Kkzou/dic.git`
2. Chrome 打开 `chrome://extensions` → 右上角开「开发者模式」→「加载已解压的扩展程序」→ 选 `extension/` 文件夹
3. 点扩展图标进设置页，粘贴你的 Gemini API Key（免费申请：https://aistudio.google.com/apikey ）。状态变成 *已连接 Gemini ✓* 即可
4. 打开任何英文文章，把鼠标停在一个词上约半秒

Key 只保存在你这台电脑的浏览器本地存储里，只发往 Google，不经过任何第三方服务器。

想用自带的演示文章 `demo/sample-article.html`：在 `chrome://extensions` → DIC → 详情 → 打开「允许访问文件网址」。

<details>
<summary><b>进阶：本机网关模式</b>（不想把 Key 放进浏览器时）</summary>

需要 Node.js ≥ 22。Key 写在电脑的 `.env.local`，浏览器从头到尾拿不到它。

```bash
cd dic
cp .env.example .env.local
```

用编辑器把 `.env.local` 里的 `GEMINI_API_KEY=replace_me` 换成真实 Key，然后 `npm start`。看到 `DIC 网关已启动` 后，在扩展设置页把「连接方式」切到「通过本机网关」。终端窗口保持打开。

没有 Key 也能看交互：`npm run start:mock` 以 mock 模式启动，不联网，返回固定示例。
</details>

## 用法

| 动作 | 效果 |
|---|---|
| 鼠标停在英文词 / 缩写 / 专名上约 0.45 秒 | 立刻出现骨架屏，解释边生成边显示 |
| 选中任意文字（含中文，≤200 字） | 同上，且弹窗固定不会自动收起 |
| 鼠标进入弹窗停 0.5 秒 / 点「深入理解」 | 补充机制背景、相关概念、3 个追问（每个词只请求一次） |
| 点标题旁的小喇叭 | 朗读这个词（浏览器自带语音，不联网）；再点一次慢速。标题旁同时显示美式音标 |
| 点一个追问 | 直接回答这个问题（不是把问题当词解释），并给出更进一步的追问 |
| 在弹窗里再选中文字 | 嵌套解释，最多 3 层；「← 返回」回上一层，上一层的深入内容原样保留 |
| `Esc` / 点击弹窗外 / 滚动页面 | 关闭 |
| 设置页 → 唤醒方式 | 可改成「按住 Option 再停留」或「只在选中时」 |
| 设置页 → 阅读页 | 粘贴文本或打开 `.txt` / `.md`，用同样方式查词 |

悬停对英文单词、缩写、首字母大写的专名、大小写混排或带数字的术语（CoWoS、eVTOL、HBM3E）生效，跳过 the / and 等常见词；中文术语请用选中。

弹窗打开时决定一次放在词的上方还是下方（哪边放得下放哪边），之后内容变长只在弹窗内部滚动，不翻面、不跑出屏幕。

## 架构

```
 浏览器                                                              Google
┌─────────────────────────────────────────────────────┐          ┌─────────┐
│ 网页                                                │          │         │
│  └ content.js   取词 · 句子/上下文提取 · Shadow DOM 弹窗 │          │         │
│        │ chrome.runtime.sendMessage                  │          │ Gemini  │
│        ▼                                            │  BYOK    │   API   │
│  background.js  唯一网络出口 · LRU 缓存              │─────────▶│         │
│        │ import                                     │          │         │
│  core.js        校验 · 提示词 · schema · 解析 · 限流  │          │         │
└─────────────────────────────────────────────────────┘          └─────────┘
          │ 进阶模式                                                  ▲
          ▼                                                          │
┌─────────────────────────────────────────────────────┐              │
│ server/server.mjs  127.0.0.1:8787（Node，零依赖）     │──────────────┘
│   └ import ../extension/core.js   ← 同一份逻辑         │
│   .env.local（Key 只在这里）                          │
└─────────────────────────────────────────────────────┘
```

`core.js` 是关键：校验、提示词、schema、解析、限流、自动重试这些"围绕模型的工程"只写一份，扩展和网关 `import` 的是同一个文件。换运行位置不换逻辑。

每次请求只发送：选中词（≤200 字符）、所在句子（≤500）、前后各 ≤400 字符上下文。不发整页，不记录历史，无遥测。

```
extension/
  manifest.json     MV3 清单：仅 storage 权限 + Gemini / 本地网关两个 host 权限
  core.js           共享核心：校验、系统提示词、responseSchema、请求体、流式 / 非流式调用、半截 JSON 解析、错误码、限流、失败重试
  background.js     Service worker（ES module）：扩展里唯一发网络请求的地方；BYOK 流式直连 / 网关转发；长连接推送片段、断开即取消；两级 LRU 缓存（100 条 / 24h）
  content.js        内容脚本：caretPositionFromPoint 取词 → 句子/上下文提取 → Shadow DOM 弹窗（定边定位 + 内部滚动）→ 状态机 → 逐步渲染 → Deep Loop → 追问 / 嵌套 → 朗读
  content.css       弹窗样式（蓝色调，跟随系统深浅色，adoptedStyleSheets 注入）
  options.*         设置页：连接方式（BYOK / 网关）、API Key、模型名、连接测试、唤醒方式、解释语言
  reader.*          阅读页：粘贴 / 打开 txt、md
  icons/            图标
server/
  server.mjs        可选本地网关（70 行 HTTP 壳）：GET /health、POST /explain；CORS 仅放行扩展来源；mock 模式
tests/
  core.test.mjs     19 项 core.js 单元测试（node:test，用假 fetch 覆盖流式分块、半截 JSON、重试 / 超时 / 取消 / 错误码映射、追问模式）
  smoke.mjs         13 项网关 smoke 测试（mock 模式）
  manual-checklist.md  18 项人工验收清单
demo/
  sample-article.html  演示用英文文章
docs/
  DIC_CLAUDE_MASTER_PROMPT*.md  给 Claude Code 的总控任务书 v1 / v2（见下文）
CLAUDE.md           Claude Code 每次启动自动读取的 13 条长期规则
```

## 关键设计决策

**为什么默认是 BYOK（用户自带 Key）直连，而不是我架一个服务？**
v0.2 之前每个用户都要装 Node、开终端、建 `.env.local`——能完成的只有开发者。根因是"本地网关"这个设计：它保护的是**我的** Key。如果 Key 是用户自己的，它就该待在用户自己的浏览器里（`chrome.storage.local`，只发往 Google）。这样安装从六步变两步，可以上架商店，费用各付各的，我也不用做账号和防刷。代价是 Key 存在扩展本地存储，比存在电脑文件里略弱，这是 BYOK 类扩展的通行做法；介意的用户可以切到网关模式。

**为什么还保留本地网关？**
两个理由：一是给不想把 Key 放进浏览器的人一个选项；二是它和扩展共用 `core.js`，是同一套逻辑在 Node 里的运行形态，`npm test` 用它做自动化 smoke 测试，不需要起浏览器。

**为什么所有网络请求都走 `background.js`？**
MV3 下内容脚本发请求时携带的 Origin 是宿主网页的域名，不是 `chrome-extension://`，本地网关的 CORS 白名单会把它拦掉（v1 方案就死在这里）。改成由 service worker 统一出口后，Origin 正确，缓存和限流也只需维护一份；BYOK 模式下 Key 也只在 service worker 里出现，内容脚本（跑在网页里）永远碰不到它。

**为什么用 Gemini 的 `responseSchema` 而不是靠提示词约束 JSON？**
靠提示词"请只输出 JSON"在长文本里会漂。把结构交给 API 层强制（`responseMimeType: application/json` + schema），再在网关做一次 `normalize()` 兜底，前端就可以放心用 `textContent` 渲染而完全不碰 `innerHTML`。

**为什么是 Fast Loop + Deep Loop 两段？**
悬停场景要的是"立刻给我这句话里它是什么意思"，120–220 字够了，多了反而打断阅读。深入内容只在用户把鼠标移进弹窗（表达了兴趣）后才请求，且每个词只请求一次。这样首屏快、费用省。

**怎么让它"感觉快"？**
实测一次短解释 Gemini 要 1.0–1.5 秒，这是模型生成本身的时间，网关模式和直连模式一样。压不动总时长，就压"第一个字出现的时间"：改用流式接口（SSE，Server-Sent Events），service worker 每收到一块就用正则从还没写完的 JSON 里抠出已有字段，经长连接（`chrome.runtime.connect`）推给页面逐步渲染，schema 里把 `meaningHere` 排在前面让它最先生成。首字从 1.2 秒量级降到 0.4–0.5 秒量级。另外三处：悬停 200 ms 先预热 service worker（MV3 空闲 30 秒会被杀）；深入模式不让模型重写短解释，只生成新增的三项；鼠标移走时中止请求。流式出任何意外都自动退回非流式调用。

**为什么朗读用浏览器自带语音，而不是调 TTS（Text-to-Speech，语音合成）接口？**
零延迟、零费用、不联网、不增加依赖，对"这个词怎么读"已经够用。音标由模型在同一次请求里顺带给出，不多花一次调用。

**为什么选 `gemini-3.5-flash-lite`？**
高频、短输入、短输出、需要低延迟，正是 flash-lite 档的定位；它原生支持结构化输出。模型名通过环境变量配置，换模型不改代码。

**为什么零依赖、不用框架、没有构建步骤？**
整个扩展端 16 KB。`chrome://extensions` 直接加载源码目录就能跑，调试时看到的就是写下的代码。对一个单人维护、以"不打断阅读"为第一原则的工具，任何依赖都是未来的维护负担。

## 测试

```bash
npm test
```

三层：`node --check` 全部 JS → `tests/core.test.mjs` 19 项单元测试（用假 `fetch` 覆盖成功、流式分块与被劈开的 SSE 事件、半截 JSON 字段提取、坏 JSON 与 503 自动重试一次、流式异常回退、取消不重发、429 / 网络异常 / 超时的错误码映射、限流窗口、追问模式）→ `tests/smoke.mjs` 以 mock 模式拉起网关跑 13 项 HTTP 测试。另有无头 Chromium 加载扩展的端到端检查（悬停、上 / 下方定位与内部滚动、深入、追问、返回保留深入内容、本地假 SSE 服务验证逐步渲染）在发布前手动跑。浏览器侧交互按 `tests/manual-checklist.md` 逐项人工验收。

## 开发过程与 AI 协作

这个项目是我从零开始学 Claude Code 和 Git 的练手项目，也是一次刻意设计的人机分工实验：

- **我负责**：定义问题和产品边界（轻量优先、只做核心功能、不加账号/数据库/框架）、写并迭代给 Claude Code 的总控任务书（`docs/DIC_CLAUDE_MASTER_PROMPT.md` → `_v2.md`）、在 Chrome 里逐项人工验收、决定每一次取舍。
- **Claude / Claude Code 负责**：架构方案、代码实现、bug 修复、按切片提交。

过程里踩到的几个坑直接塑造了现在的架构：v1 方案的 CORS 死锁（见上文）、缓存放在 `chrome.storage.session` 而内容脚本读不到、Shadow DOM 里用 `contains()` 判断点击外部失效（要用 `composedPath()`）、严格 CSP 站点屏蔽内联样式（改用 `adoptedStyleSheets`）。最重要的一条经验是：**AI 自称"测试通过"不可信**，所以验收清单要求每一项都附实测证据，`CLAUDE.md` 里把它写成了长期规则。

`CLAUDE.md` 是 Claude Code 每次启动自动读取的项目规则（13 条），`.claude/skills/` 里是从 [quangpl/browser-extension-skills](https://github.com/quangpl/browser-extension-skills)（MIT）引入的 4 个 Chrome 扩展开发技能。

## 已知限制

- 跨域 iframe 内的文字不生效。
- Chrome 内置页面、扩展商店页面、PDF 查看器不生效。
- 悬停取词依赖 `caretPositionFromPoint`，个别自定义渲染的页面（如 Canvas 文本）无法取词。
- 若测试连接提示模型不存在，在设置页「模型」栏（网关模式则在 `.env.local` 的 `GEMINI_MODEL`）填入当前可用的 flash-lite 型号名（定价与型号以 https://ai.google.dev/gemini-api/docs/pricing 为准）。

## License

MIT © 2026 Yujia Zou
