<p align="center"><img src="extension/icons/icon128.png" width="72" alt="DIC"></p>
<h1 align="center">DIC — 上下文智能词典</h1>
<p align="center">鼠标停在网页里的词上，原位看到基于<b>当前句子</b>的解释。不跳转，不打断阅读心流。</p>
<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-2f6fed">
  <img alt="Node 22+" src="https://img.shields.io/badge/Node-%E2%89%A522-2f6fed">
  <img alt="Runtime deps 0" src="https://img.shields.io/badge/runtime%20deps-0-2f6fed">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-2f6fed">
</p>

> **English summary** — DIC is a Chrome/Edge (Manifest V3) extension that explains the word, acronym or phrase under your cursor *in the context of the sentence it appears in*, using Gemini. A zero-dependency local Node gateway holds the API key so the browser never sees it. Built with vanilla JS, no build step, no frameworks. Developed as a learning project in collaboration with Claude / Claude Code — see [§ 开发过程](#开发过程与-ai-协作).

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

## 5 分钟跑起来（macOS）

**前提**：Node.js ≥ 22、Chrome 或 Edge、一个 Gemini API Key（https://aistudio.google.com/apikey ，有免费额度）。

```bash
git clone https://github.com/Kkzou/dic.git
cd dic
cp .env.example .env.local
```

用任意编辑器打开 `.env.local`，把 `GEMINI_API_KEY=replace_me` 换成真实 Key。然后：

```bash
npm start
```

看到 `DIC 网关已启动：http://127.0.0.1:8787` 即可，终端保持打开。

加载扩展：Chrome 打开 `chrome://extensions` → 右上角开「开发者模式」→「加载已解压的扩展程序」→ 选本仓库的 `extension/` 文件夹。点扩展图标进设置页 → 「测试连接」应显示 *已连接 ✓*。

打开 `demo/sample-article.html`（要允许扩展访问文件网址：`chrome://extensions` → DIC → 详情 → 打开「允许访问文件网址」），或任何英文文章，把鼠标停在一个词上。

**没有 Key 也能看效果**：`npm run start:mock` 以 mock 模式启动，不联网，返回固定示例内容，用于离线演示和自动测试。

## 用法

| 动作 | 效果 |
|---|---|
| 鼠标停在英文词 / 缩写 / 专名上 0.6 秒 | 立刻出现骨架屏，随后显示解释 |
| 选中任意文字（含中文，≤200 字） | 同上，且弹窗固定不会自动收起 |
| 鼠标进入弹窗停 0.5 秒 / 点「深入理解」 | 补充机制背景、相关概念、3 个追问（每个词只请求一次） |
| 在弹窗里再选中文字 / 点追问 | 嵌套查询，最多 3 层，「← 返回」回上一层 |
| `Esc` / 点击弹窗外 / 滚动页面 | 关闭 |
| 设置页 → 唤醒方式 | 可改成「按住 Option 再停留」或「只在选中时」 |
| 设置页 → 阅读页 | 粘贴文本或打开 `.txt` / `.md`，用同样方式查词 |

悬停只对英文单词、缩写、首字母大写的专名生效（跳过 the / and 等常见词）；中文术语请用选中。

## 架构

```
 浏览器                                          你的电脑                      Google
┌────────────────────────────────────────┐    ┌──────────────────────┐    ┌─────────┐
│ 网页                                   │    │ server/server.mjs    │    │         │
│  └ content.js  取词 · 上下文 · 弹窗    │    │ 127.0.0.1:8787       │    │ Gemini  │
│       │ chrome.runtime.sendMessage     │    │                      │    │   API   │
│       ▼                                │    │ 校验 → 限流 → 提示词  │    │         │
│  background.js  唯一网络出口 · LRU 缓存 │───▶│ → fetch → schema 校验 │───▶│         │
│                 (Origin = chrome-ext://)│◀───│ ← 统一错误码          │◀───│         │
└────────────────────────────────────────┘    └──────────────────────┘    └─────────┘
                                                 ▲ .env.local（API Key 只在这里）
```

每次请求只发送：选中词（≤200 字符）、所在句子（≤500）、前后各 ≤400 字符上下文。不发整页，不记录历史，无遥测。

```
extension/
  manifest.json     MV3 清单：仅 storage 权限 + 本地网关 host 权限
  background.js     Service worker：扩展里唯一发网络请求的地方；内存 + session 两级 LRU 缓存（100 条 / 24h）
  content.js        内容脚本：caretPositionFromPoint 取词 → 句子/上下文提取 → Shadow DOM 弹窗 → 状态机 → Deep Loop → 嵌套
  content.css       弹窗样式（蓝色调，跟随系统深浅色，adoptedStyleSheets 注入）
  options.*         设置页：服务状态、唤醒方式、解释语言
  reader.*          阅读页：粘贴 / 打开 txt、md
  icons/            图标
server/
  server.mjs        本地网关：GET /health、POST /explain；CORS 仅放行扩展来源；30 次/分钟限流；15 s 超时；mock 模式
tests/
  smoke.mjs         13 项自动化 smoke 测试（mock 模式，零依赖）
  manual-checklist.md  18 项人工验收清单
demo/
  sample-article.html  演示用英文文章
docs/
  DIC_CLAUDE_MASTER_PROMPT*.md  给 Claude Code 的总控任务书 v1 / v2（见下文）
CLAUDE.md           Claude Code 每次启动自动读取的 13 条长期规则
```

## 关键设计决策

**为什么要一个本地网关，而不是扩展直接调 Gemini？**
API Key 放进扩展就等于公开。网关跑在本机 `127.0.0.1`，Key 只存在 `.env.local`（已被 `.gitignore` 排除），浏览器从头到尾拿不到它。网关同时承担校验、限流、超时和输出规范化，扩展端只需要处理 7 个固定错误码。

**为什么所有网络请求都走 `background.js`？**
MV3 下内容脚本发请求时携带的 Origin 是宿主网页的域名，不是 `chrome-extension://`，本地网关的 CORS 白名单会把它拦掉（v1 方案就死在这里）。改成由 service worker 统一出口后，Origin 正确，缓存也只需维护一份。

**为什么用 Gemini 的 `responseSchema` 而不是靠提示词约束 JSON？**
靠提示词"请只输出 JSON"在长文本里会漂。把结构交给 API 层强制（`responseMimeType: application/json` + schema），再在网关做一次 `normalize()` 兜底，前端就可以放心用 `textContent` 渲染而完全不碰 `innerHTML`。

**为什么是 Fast Loop + Deep Loop 两段？**
悬停场景要的是"立刻给我这句话里它是什么意思"，120–220 字够了，多了反而打断阅读。深入内容只在用户把鼠标移进弹窗（表达了兴趣）后才请求，且每个词只请求一次。这样首屏快、费用省。

**为什么选 `gemini-3.5-flash-lite`？**
高频、短输入、短输出、需要低延迟，正是 flash-lite 档的定位；它原生支持结构化输出。模型名通过环境变量配置，换模型不改代码。

**为什么零依赖、不用框架、没有构建步骤？**
整个扩展端 16 KB。`chrome://extensions` 直接加载源码目录就能跑，调试时看到的就是写下的代码。对一个单人维护、以"不打断阅读"为第一原则的工具，任何依赖都是未来的维护负担。

## 测试

```bash
npm test
```

先对所有 JS 做 `node --check`，再以 mock 模式拉起网关跑 `tests/smoke.mjs`：健康检查、字段校验、超长输入、非法 JSON、CORS 白名单、预检、404、错误码枚举，共 13 项。浏览器侧交互（骨架屏 < 100 ms、快速连续悬停不串词、Deep 不重复请求、嵌套 3 层上限等）按 `tests/manual-checklist.md` 逐项人工验收。

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
- 若 Gemini 返回 404，请在 `.env.local` 把 `GEMINI_MODEL` 改为当前可用的 flash-lite 型号（定价与型号以 https://ai.google.dev/gemini-api/docs/pricing 为准）。

## License

MIT © 2026 Yujia Zou
