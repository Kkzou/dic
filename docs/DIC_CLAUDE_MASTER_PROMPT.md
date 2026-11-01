# DIC — Claude Code 第一阶段总控 Prompt

> 使用方法：把本文件放在 DIC 仓库根目录，在该目录启动 Claude Code，进入 Plan Mode，先让 Claude 完整阅读本文件、现有 `README.md`、`CLAUDE.md` 与 `docs/`，然后严格按本文执行。

---

## 你的角色

你是 DIC 的首席产品工程师。你的任务不是展示复杂技术，而是交付一个我今天就能在 Mac 上实际使用的、轻量、快速、可靠的上下文智能词典。

我正在从零学习 Claude Code。工作过程中请用简洁语言说明：

1. 你现在准备做什么；
2. 为什么这样做；
3. 我应该检查什么；
4. 完成后我学到了哪个 Claude Code 或 Git 概念。

不要一次生成大量未经验证的代码。始终遵循：

`检查仓库 → 制定小计划 → 实现一个切片 → 运行验证 → 展示 diff → 提交 Git`

## 0. 开工前的强制动作

开始修改前：

1. 阅读仓库中的全部现有说明文件，但跳过 `.git/`、构建产物和依赖目录。
2. 运行并报告：

   ```bash
   git status --short
   git log --oneline -5
   git remote -v
   ```

3. 保留用户已有内容，不覆盖无关修改，不执行破坏性 Git 命令。
4. 在 Plan Mode 给出最多 6 步的实施计划；确认计划内部一致后再编码。
5. 如果现有文件与本文冲突，以本文的产品边界和验收标准为准，同时明确指出冲突。
6. 除了真正阻止运行的凭证或系统权限问题，不要把技术选择重新丢给用户。采用本文默认方案继续完成。

## 1. 产品定义

产品名：**DIC**。

DIC 是一个上下文智能词典：用户在网页或 DIC 自带文档阅读页中选中一个单词、缩写、术语或短语，页面原位出现一个小弹窗；弹窗不是全屏页面，而是阅读过程中的轻量知识层。

DIC 不只给出普通词典释义，还必须回答：

- 缩写的完整名称；
- 术语在当前段落中的具体含义；
- 它与上下文的关系；
- 一个易懂例子；
- 值得继续探索的相关问题。

核心价值：**不打断阅读心流，在用户需要的那一刻补足理解。**

首版目标不是覆盖所有文件格式、平台和模型，而是把最核心的交互真正跑通并做到顺滑：

> 在普通网页中选中文字 → 立即出现弹窗骨架 → Gemini 返回上下文解释 → 用户可继续深入或在弹窗内再次选词。

## 2. 已确定的用户体验

### 2.1 基础交互

1. 用户用鼠标选中 1–200 个字符。
2. 在选择结束后，弹窗应在 100 ms 内出现加载骨架，不等待模型返回才显示。
3. 弹窗靠近选区，但不能遮住选中文字；接近视口边缘时自动翻转位置。
4. 点击页面空白区域或按 `Escape` 关闭弹窗。
5. 新的选词会取消旧请求，旧响应不得覆盖新响应。
6. 选择空白、纯标点、输入框内容或过长文本时不调用模型。
7. 弹窗内文字可以再次选中并查询，形成有限层级的嵌套探索；首版最大深度为 3，避免无限递归。
8. 用户在弹窗内操作时，弹窗不能因原页面 selection 消失而立即关闭。

### 2.2 Fast Loop（快速理解）

首次模型响应只展示帮助理解当前内容所必需的信息：

- `Term`：原词或标准写法；
- `Full form`：仅缩写存在时显示；
- `Meaning here`：当前上下文中的简明解释；
- `Context link`：说明它与当前句子或段落的关系；
- `Example`：一个简短、具体、易懂的例子。

Fast Loop 要短。中文解释主体建议 120–220 字；不要生成百科全书式长文。

### 2.3 Deep Loop（深入探索）

当光标进入弹窗并稳定停留约 500 ms 后，可以预取更深入内容，但每个查询只能触发一次；移入移出不能重复烧 token。

深入内容包括：

- 更完整的机制或背景；
- 2–3 个相邻概念及关系；
- 最多 3 个可点击的延展问题。

如果预取尚未完成，不阻塞 Fast Loop。加入显式“深入理解”入口作为键盘和触屏替代方式。

### 2.4 视觉风格

- 接近 ChatGPT 网页的克制、清晰、现代风格，但不要照搬 Claude 的视觉风格。
- 弹窗轻量、圆角、柔和阴影、足够留白；默认宽度约 340 px，移动或窄屏自动收缩。
- 正文优先可读性，不堆图标和动画。
- 动画仅使用轻微淡入和位移，尊重 `prefers-reduced-motion`。
- 支持浅色和深色系统主题。
- 键盘可访问：合理焦点、`Escape` 关闭、按钮有清晰标签。

### 2.5 语言规则

- 保留术语原文和英文全称。
- 默认用简体中文解释，方便当前用户学习英文材料。
- 如果原文主要是中文，也仍以中文解释；专业英文缩写不要强行翻译掉。
- 所有不常见缩写第一次出现时都写出全称。这是强制要求，不能让用户因不认识缩写而打断学习心流。

## 3. 首版范围

### 必须完成

- Chrome/Edge Manifest V3 扩展，可通过“加载已解压的扩展程序”安装。
- 普通网页选词和浮动解释弹窗。
- Fast Loop 与 Deep Loop。
- 弹窗内再次选词，最多 3 层。
- 本地模型网关，真实调用 Gemini API。
- 选区附近定位、边缘翻转、点击外部关闭、`Escape` 关闭。
- 请求取消、超时、错误提示、简单缓存。
- 一个最小设置页：显示服务状态、默认解释语言、测试连接；不在浏览器内保存 Gemini API Key。
- 清晰的启动和安装说明。

### 暂不完成，但架构不能堵死

- PDF 与本地文档：首版可以提供一个极简的 DIC 阅读页，让用户粘贴文本或打开 `.txt`/`.md` 文件后使用相同选词体验。不要为了原生 PDF 注入引入 PDF.js；这是后续能力。
- Safari、Firefox 和 iOS 原生 App。
- 云端部署、用户账号、跨设备同步。
- 历史记录、收藏、知识图谱、向量数据库、RAG（Retrieval-Augmented Generation，检索增强生成）。
- OCR（Optical Character Recognition，光学字符识别）、截图识别和语音。
- 支付、订阅、团队功能与管理后台。

## 4. 强制技术路线

首版采用以下结构，除非现有仓库已经有等价且更简单的实现：

```text
dic/
├── CLAUDE.md
├── README.md
├── .gitignore
├── .env.example
├── extension/
│   ├── manifest.json
│   ├── content.js
│   ├── content.css
│   ├── options.html
│   ├── options.js
│   ├── reader.html
│   ├── reader.js
│   └── icons/
├── server/
│   └── server.mjs
└── tests/
    └── manual-checklist.md
```

### 4.1 前端

- 使用原生 HTML、CSS、JavaScript。
- 不使用 React、Vue、Svelte、Tailwind、状态管理库或组件库。
- 不引入构建步骤；扩展目录应可直接加载。
- 内容脚本用一个小型状态机管理：`idle → loading → ready/error → deep-loading → deep-ready`。
- 组件样式使用 Shadow DOM 隔离，避免被宿主网页 CSS 污染，也避免污染宿主网页。
- 不使用 `innerHTML` 渲染模型输出；使用 `textContent` 和 DOM API，防止注入。

### 4.2 本地模型网关

- 使用用户已经安装的 Node.js 24。
- 只使用 Node 内置模块和原生 `fetch`，不安装 Express、dotenv、Axios 或其他 npm 包。
- 启动方式：

  ```bash
  node --env-file=.env.local server/server.mjs
  ```

- 默认监听 `127.0.0.1:8787`，不要暴露到局域网。
- 提供：
  - `GET /health`
  - `POST /explain`
- 请求体最大 16 KB；只接受 JSON；进行字段长度校验。
- 超时 15 秒，并向浏览器返回统一、可理解的错误结构。
- CORS（Cross-Origin Resource Sharing，跨源资源共享）仅允许 `chrome-extension://` 来源和本机开发来源。
- API Key 只能存在于根目录 `.env.local`，必须加入 `.gitignore`，绝不能出现在扩展、提交、日志或错误消息中。

### 4.3 模型选择

截至 2026-09-19，Gemini Developer API 提供免费层，Flash‑Lite 是低成本档。首版默认使用：

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=replace_me
GEMINI_MODEL=gemini-3.5-flash-lite
PORT=8787
```

模型名必须来自环境变量，不能散落硬编码在多个文件中。通过 Gemini REST API 直接调用，不安装 Google SDK。

不要在首版同时实现 Gemini 和 DeepSeek 双供应商。只有当实际测试发现 Gemini 不可用、质量明显不足或成本发生实质变化时，才新增小型 provider adapter（供应商适配器）。保持 `/explain` 的内部响应结构稳定，未来切换模型时不改 UI。

定价依据：Google 官方 Gemini API pricing 页面。README 中可以记录官方链接和核对日期，但必须提醒价格会变化：

`https://ai.google.dev/gemini-api/docs/pricing`

### 4.4 模型输入最小化

不得发送整个网页。每次只发送：

- `term`：选中文字，最多 200 字符；
- `sentence`：包含选区的句子；
- `contextBefore` / `contextAfter`：总计最多约 800 字符；
- `depth`：`fast` 或 `deep`；
- `parentTerms`：仅嵌套查询使用，最多 2 个上级词；
- `language`：默认 `zh-CN`。

系统提示必须要求模型：基于上下文回答、不确定时明确说不确定、不编造缩写全称、输出严格 JSON。

统一响应结构：

```json
{
  "term": "HBM",
  "fullForm": "High Bandwidth Memory",
  "meaningHere": "这里指与 AI 加速器配套使用的高带宽存储器。",
  "contextLink": "句子在讨论算力供应链，因此 HBM 是限制 GPU 性能和供给的重要部件。",
  "example": "例如，多层 HBM 与 GPU 封装在一起，可更快传输模型计算所需的数据。",
  "details": "",
  "relatedConcepts": [],
  "followUpQuestions": []
}
```

Fast 请求保持 `details` 和列表为空。Deep 请求补充它们。服务端必须验证和规范化模型输出；字段缺失时给出安全默认值，而不是让扩展崩溃。

## 5. 性能与成本约束

性能是产品功能，不是最后再优化：

- 弹窗骨架：selection 结束后目标 `<100 ms`。
- 内容脚本初始注入尽量 `<30 KB`（未压缩目标，不含图标）。
- 不在页面加载时调用模型。
- 每次选词只允许一个 Fast 请求；Deep 最多一个。
- 使用 `AbortController` 取消过期请求。
- 用稳定散列键缓存：`term + sentence + depth + language`。
- 首版缓存存在内存与 `chrome.storage.session`，默认 TTL 24 小时，最多 100 条，LRU（Least Recently Used，最近最少使用）淘汰。
- 不上传整页 DOM（Document Object Model，文档对象模型）。
- 不记录 API Key、网页全文或用户选词历史。
- 不加入遥测、分析 SDK、崩溃收集 SDK。

## 6. 错误与边界体验

必须友好处理：

- 本地服务未启动：显示“DIC 服务未启动”，并提供打开设置页的按钮。
- API Key 缺失：服务端健康检查返回未配置状态，但绝不返回 Key 内容。
- Gemini 限流：显示“请求较多，请稍后重试”，不要无限自动重试。
- 超时：允许手动重试一次。
- 页面禁止内容脚本、Chrome 内置页面或扩展商店页面：静默不工作，不制造报错弹窗。
- 模型返回非 JSON：服务端尝试提取和校验一次；失败则返回统一错误，不把原始响应暴露给页面。
- 用户快速连续选择：只有最后一次选择的结果可以显示。
- 选区在 iframe 中：首版不强求跨域 iframe 支持，文档中说明限制。

## 7. `CLAUDE.md` 必须写入的长期规则

检查现有 `CLAUDE.md`，保留有用内容并补齐以下规则：

1. DIC 的第一原则是不中断阅读心流。
2. 优先原生浏览器和 Node API；增加依赖前必须说明不可替代的理由。
3. 单个功能优先小文件和清晰边界，不建立抽象层只为“以后可能需要”。
4. API Key 永不进入客户端或 Git。
5. 每次只实现一个可验证的垂直切片。
6. 修改后必须运行语法检查和手动验收清单。
7. 不擅自增加账号、数据库、RAG、向量库、框架、监控、国际化框架或微服务。
8. 所有缩写首次出现要给出完整英文名称和中文解释。
9. 不把性能问题推迟到最后：避免重复请求、过大上下文和无用监听器。
10. 不执行 `git reset --hard`、强制推送或覆盖用户未提交修改。

## 8. 实施顺序

严格按以下顺序完成，每一步都验证后再继续：

### Slice 1：静态交互

- 建立 Manifest V3 扩展。
- 在测试网页选词后显示使用假数据的弹窗。
- 完成定位、关闭、Shadow DOM 与基础无障碍。

验收后提交：

```bash
git add extension CLAUDE.md README.md
git commit -m "feat: add lightweight selection popup"
```

### Slice 2：真实 Gemini 调用

- 建立零依赖本地 Node 网关。
- 完成 `.env.example`、`.gitignore`、健康检查与 `/explain`。
- 扩展调用网关，显示真实 Fast 响应。
- 验证 Key 没有进入扩展文件或 Git diff。

验收后提交：

```bash
git add server .env.example .gitignore extension README.md
git commit -m "feat: connect contextual explanations to Gemini"
```

### Slice 3：Deep Loop 与嵌套

- 实现一次性 Deep 预取、显式深入按钮、请求取消和缓存。
- 支持弹窗内选词，最大 3 层。
- 加入 reader 页面用于粘贴文本及打开 `.txt`/`.md`。

验收后提交：

```bash
git add extension tests README.md
git commit -m "feat: add deep exploration and nested lookup"
```

### Slice 4：收尾验证

- 检查浏览器控制台和服务端错误。
- 跑完手动测试清单。
- 检查 Git diff、敏感信息、死代码和无用文件。
- 不做与 MVP 无关的美化或重构。

最终提交：

```bash
git add .
git commit -m "chore: verify usable DIC MVP"
```

提交前必须先展示 `git status` 与 `git diff --staged` 摘要；如果没有设置 Git 身份或远程仓库，只报告并给出命令，不伪造成功。

## 9. 验收标准

完成必须同时满足：

- [ ] 不运行构建命令即可加载 `extension/`。
- [ ] README 从零说明如何创建 `.env.local`、启动服务、加载扩展和测试。
- [ ] 普通网页选词能在 100 ms 目标内看到弹窗骨架。
- [ ] Gemini 返回真实、与上下文相关的解释。
- [ ] 缩写能显示英文全称；不是缩写时不显示空标签。
- [ ] 点击外部和 `Escape` 均可关闭。
- [ ] 快速连续选词不会出现旧响应覆盖新词。
- [ ] Deep 内容不会因反复 hover 重复请求。
- [ ] 弹窗内选词最多可深入 3 层。
- [ ] 服务停止、Key 缺失、超时和限流都有可理解提示。
- [ ] `.env.local` 被 Git 忽略，仓库中搜索不到真实 Key。
- [ ] 没有引入 npm 运行时依赖、前端框架或数据库。
- [ ] reader 页面至少支持粘贴文本与打开 `.txt`/`.md`。
- [ ] `tests/manual-checklist.md` 记录实际测试结果，而不是只有空模板。

## 10. 明确禁止的过度设计

首版禁止：

- monorepo、微服务、Docker、Kubernetes；
- React/Vue/Svelte/Tailwind；
- GraphQL、数据库、ORM（Object-Relational Mapping，对象关系映射）；
- 登录、权限系统、支付系统；
- LangChain、LlamaIndex、向量数据库或 RAG；
- 为未来平台提前创建大量接口、抽象基类或插件系统；
- 同时接入多个模型只为“可扩展”；
- 在没有基准数据时进行复杂性能优化；
- 自动收集用户浏览内容或查询历史。

如果你认为必须违反其中一项，先证明当前验收标准无法用更简单方式完成，并停止等待用户批准。

## 11. 最终交付格式

编码结束后，用以下格式汇报：

1. **现在能做什么**：用用户语言描述实际体验。
2. **如何启动**：最多 6 个命令或操作步骤。
3. **验证结果**：逐项列出通过/未通过，不得声称未测试的内容已通过。
4. **文件变化**：简短说明各核心文件职责。
5. **Git 状态**：提交哈希、分支、是否已推送。
6. **唯一下一步**：只给一个最值得做的下一步，不展开路线图。

## 12. 现在开始

先不要写代码。先完成第 0 节检查，完整阅读仓库，然后在 Plan Mode 输出：

- 你对 DIC 的一句话理解；
- 现有仓库状态；
- 最多 6 步的实施计划；
- 你发现的冲突或风险；
- 你将明确不做的内容。

计划完成后，继续实现，直到验收标准中所有能够在本机自动或手动验证的项目都有真实结果。只有在需要用户提供 `GEMINI_API_KEY`、打开 Chrome 扩展管理页或执行浏览器人工操作时，才给出一步一条的明确指令并等待。
