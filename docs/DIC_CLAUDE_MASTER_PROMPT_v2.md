# DIC — Claude Code 第一阶段总控 Prompt（v2）

> **使用方法**：把本文件放在 DIC 仓库根目录，在该目录启动 Claude Code，进入 Plan Mode。先让 Claude 完整阅读本文件、现有 `README.md`、`CLAUDE.md` 与 `docs/`，然后严格按本文执行。
>
> **裁决优先级**（冲突时从高到低）：本文件 > `CLAUDE.md` > `README.md` > 仓库中其他文档 > 你的默认偏好。发现冲突要**明确指出**，然后按本优先级继续，不要停下来问。

---

## 你的角色

你是 DIC 的首席产品工程师。你的任务不是展示复杂技术，而是交付一个我**今天就能在 Mac 上实际使用**的、轻量、快速、可靠的上下文智能词典。

我正在从零学习 Claude Code。每做完一个动作，用简洁语言说明四件事：

1. 你现在准备做什么；
2. 为什么这样做；
3. 我应该检查什么（给出我能亲手运行或点击的具体动作）；
4. 完成后我学到了哪个 Claude Code 或 Git 概念（一句话，不要讲课）。

不要一次生成大量未经验证的代码。始终遵循：

`检查仓库 → 制定小计划 → 实现一个切片 → 运行验证 → 展示 diff → 提交 Git`

### 什么时候可以停下来问我

只有三种情况可以停下等待我：

1. 需要我提供 `GEMINI_API_KEY` 或其他凭证；
2. 需要我在 Chrome 里做人工操作（加载扩展、授权、点击页面）；
3. 需要我确认**删除**已有文件或覆盖我未提交的修改。

除此之外——包括技术选型、命名、目录结构、样式细节——一律按本文默认方案自己决定并继续。**不要把技术选择重新丢回给我。**

---

## 0. 开工前的强制动作

开始修改前：

1. 阅读仓库中的全部现有说明文件，跳过 `.git/`、`node_modules/`、构建产物。
2. 运行并报告：

   ```bash
   git status --short
   git log --oneline -5
   git remote -v
   node --version
   ```

   如果 `git log` 报错说明这是空仓库或未初始化，**报告事实**，不要伪造历史。
3. 保留用户已有内容，不覆盖无关修改，不执行破坏性 Git 命令。
4. 在 Plan Mode 给出**最多 6 步**的实施计划；确认计划内部一致后再编码。
5. 如果现有文件与本文冲突，按上面的裁决优先级处理，并在计划里列出冲突清单。
6. 如果 Node 版本低于 22，报告并改用 `dotenv` 之外的手写 `.env` 解析（仍然零依赖），不要因此停工。

---

## 1. 产品定义

产品名：**DIC**。

DIC 是一个上下文智能词典：用户在网页或 DIC 自带阅读页中选中一个单词、缩写、术语或短语，页面**原位**出现一个小弹窗；弹窗不是全屏页面，而是阅读过程中的轻量知识层。

DIC 不只给普通词典释义，还必须回答：

- 缩写的完整名称；
- 术语在**当前段落**中的具体含义；
- 它与上下文的关系；
- 一个易懂例子；
- 值得继续探索的相关问题。

核心价值：**不打断阅读心流，在用户需要的那一刻补足理解。**

首版目标不是覆盖所有文件格式、平台和模型，而是把最核心的交互真正跑通并做到顺滑：

> 在普通网页中选中文字 → 立即出现弹窗骨架 → Gemini 返回上下文解释 → 用户可继续深入或在弹窗内再次选词。

---

## 2. 已确定的用户体验

### 2.1 基础交互

1. 用户用鼠标选中 1–200 个字符。
2. 选择结束后，弹窗应在 **100 ms 内出现加载骨架**，不等待模型返回才显示。
3. 弹窗靠近选区但不遮住选中文字；接近视口边缘时自动翻转位置。
4. 点击页面空白区域或按 `Escape` 关闭弹窗。
5. 新的选词取消旧请求，旧响应**绝不能**覆盖新响应（用递增 `requestId` 做守卫，不只靠 `AbortController`）。
6. 以下情况不调用模型：空选区、纯标点或纯数字、长度 > 200 字符、选区落在 `input` / `textarea` / `contenteditable` 内、选区落在 DIC 自己的 UI 之外但属于其他扩展注入的节点。
7. 弹窗内文字可再次选中并查询，形成有限层级的嵌套探索；**首版最大深度 3**。
8. 用户在弹窗内操作时，弹窗不能因原页面 selection 消失而立即关闭。

**事件实现约束（避免常见坑）：**

- 用 `pointerup` + 一次 `requestAnimationFrame` 读取选区，不要只监听 `mouseup`；同时监听 `keyup`（Shift+方向键选词）。
- 弹窗内的选区必须用 `shadowRoot.getSelection?.() ?? document.getSelection()` 读取，因为 Shadow DOM 里的选区在部分路径下拿不到。
- 关闭逻辑用捕获阶段的 `pointerdown` 判断 `event.composedPath()` 是否包含弹窗宿主节点，不要用 `contains()`（Shadow DOM 下会误判）。

### 2.2 Fast Loop（快速理解）

首次模型响应只展示帮助理解当前内容所必需的信息：

- `Term`：原词或标准写法；
- `Full form`：仅缩写存在时显示，否则**整行不渲染**（不要留空标签）；
- `Meaning here`：当前上下文中的简明解释；
- `Context link`：说明它与当前句子或段落的关系；
- `Example`：一个简短、具体、易懂的例子。

Fast Loop 要短。中文解释主体 **120–220 字**；不要生成百科全书式长文。服务端用 `maxOutputTokens` 硬性封顶（fast ≈ 400，deep ≈ 900）。

### 2.3 Deep Loop（深入探索）

指针进入弹窗并稳定停留约 **500 ms** 后预取更深入内容，但**每个查询只触发一次**；移入移出不能重复烧 token（用 `Map<cacheKey, 'pending'|'done'>` 记账，不要只用布尔标志）。

深入内容包括：

- 更完整的机制或背景；
- 2–3 个相邻概念及关系；
- 最多 3 个可点击的延展问题。

预取未完成不阻塞 Fast Loop。必须提供显式「深入理解」按钮，作为键盘与触屏的等价入口（`prefers-reduced-motion` 与无指针设备下它是唯一入口）。

### 2.4 视觉风格

- 克制、清晰、现代；不照搬任何单一产品的视觉语言。
- 弹窗轻量、圆角、柔和阴影、足够留白；默认宽度约 **340 px**，窄屏收缩到 `min(340px, calc(100vw - 32px))`。
- 正文优先可读性，不堆图标和动画。
- 动画仅轻微淡入和位移，尊重 `prefers-reduced-motion`。
- 浅色 / 深色跟随系统 `prefers-color-scheme`。
- 样式用 `adoptedStyleSheets` 注入 Shadow Root，**不写内联 `<style>` 字符串**，避免被宿主页 CSP 拦截。
- 键盘可访问：弹窗 `role="dialog"`、`aria-label`、打开时焦点移入、`Escape` 关闭后焦点回到原位置、按钮有清晰标签。

### 2.5 语言规则

- 保留术语原文和英文全称。
- 默认用简体中文解释，方便当前用户学习英文材料。
- 原文主要是中文时仍用中文解释；专业英文缩写不强行翻译掉。
- **所有不常见缩写第一次出现必须写出全称**（代码注释、README、UI 文案、错误提示都算）。这是强制要求。

---

## 3. 首版范围

### 必须完成

- Chrome/Edge Manifest V3 扩展，可通过「加载已解压的扩展程序」安装，**无构建步骤**。
- 普通网页选词 + 浮动解释弹窗。
- Fast Loop 与 Deep Loop。
- 弹窗内再次选词，最多 3 层。
- 本地模型网关，真实调用 Gemini API。
- 选区附近定位、边缘翻转、点击外部关闭、`Escape` 关闭。
- 请求取消、超时、错误提示、缓存。
- 最小设置页：显示服务状态、默认解释语言、测试连接；**浏览器内不保存 Gemini API Key**。
- 极简 DIC 阅读页（粘贴文本 / 打开 `.txt`、`.md`）。
- 清晰的启动和安装说明。

### 暂不完成，但架构不能堵死

- 原生 PDF 注入（不引入 PDF.js）。
- Safari、Firefox、iOS 原生 App。
- 云端部署、用户账号、跨设备同步。
- 历史记录、收藏、知识图谱、向量数据库、RAG（Retrieval-Augmented Generation，检索增强生成）。
- OCR（Optical Character Recognition，光学字符识别）、截图识别、语音。
- 支付、订阅、团队功能、管理后台。

---

## 4. 强制技术路线

```text
dic/
├── CLAUDE.md
├── README.md
├── .gitignore
├── .env.example
├── extension/
│   ├── manifest.json
│   ├── background.js        # MV3 service worker：唯一的网络出口 + 缓存
│   ├── content.js
│   ├── content.css          # 通过 adoptedStyleSheets 注入 Shadow Root
│   ├── options.html
│   ├── options.js
│   ├── reader.html
│   └── reader.js
├── server/
│   └── server.mjs
└── tests/
    └── manual-checklist.md
```

图标**不是**首版阻塞项：MV3 允许没有 `icons` 字段。不要为了凑图标去生成二进制资源。

### 4.1 前端

- 原生 HTML / CSS / JavaScript。禁止 React、Vue、Svelte、Tailwind、状态管理库、组件库。
- 无构建步骤；`extension/` 目录可直接加载。
- 内容脚本用一个小型状态机：`idle → loading → ready|error → deep-loading → deep-ready`。状态转移集中在一个函数里，不要散落在事件回调中。
- Shadow DOM 隔离样式（宿主节点挂在 `document.documentElement` 上，`position: fixed`）。
- **禁止用 `innerHTML` 渲染任何模型输出**；一律 `textContent` + DOM API。
- 内容脚本**不直接发起网络请求**（见 4.2 的原因），统一用 `chrome.runtime.sendMessage` 交给 service worker。

### 4.2 本地模型网关与网络路径（v1 的关键修正）

**为什么必须走 service worker**：内容脚本的 `fetch` 带的是**宿主网页的 Origin**（例如 `https://example.com`），不是 `chrome-extension://`。如果网关只允许 `chrome-extension://` 来源，所有请求都会被 CORS（Cross-Origin Resource Sharing，跨源资源共享）拦掉。MV3 service worker 发出的请求 Origin 才是 `chrome-extension://<id>`。因此：

- **所有对 `127.0.0.1:8787` 的请求只能从 `background.js` 发出。**
- `manifest.json` 中加 `"host_permissions": ["http://127.0.0.1:8787/*"]`。
- 网关 CORS 允许列表：`chrome-extension://*` 与 `http://localhost:*`（供 reader 页面本地调试）。对 `OPTIONS` 预检返回 204。

网关实现约束：

- 使用用户已安装的 Node.js 24。
- **只用 Node 内置模块和原生 `fetch`**，不安装 Express、dotenv、Axios 或任何 npm 包。`package.json` 可以没有，或者只有 `"type": "module"` 和 scripts，**不得有 `dependencies`**。
- 启动方式：

  ```bash
  node --env-file-if-exists=.env.local server/server.mjs
  ```

  用 `--env-file-if-exists` 而不是 `--env-file`，否则文件缺失时 Node 直接崩溃、新用户看不懂报错。启动时自检：缺 `GEMINI_API_KEY` 时**照常启动**，但 `/health` 报告 `apiKeyConfigured: false`，并在终端打印一行中文提示。
- 默认监听 `127.0.0.1:8787`（显式绑定 `127.0.0.1`，不要绑 `0.0.0.0`）。
- 提供 `GET /health` 与 `POST /explain`。
- 请求体最大 16 KB；只接受 `application/json`；逐字段做长度与类型校验，非法输入返回 400 + 错误码。
- 上游超时 15 秒（`AbortSignal.timeout(15000)`）。
- 本地限流：同一进程内每分钟最多 30 次 `/explain`，超出返回 `RATE_LIMITED`，防止 bug 导致 token 失控。
- API Key 只能存在于根目录 `.env.local`，必须在 `.gitignore` 里，**绝不能出现在扩展、提交、日志或错误消息中**。日志只打印方法、路径、状态码、耗时。

**`/health` 响应：**

```json
{ "ok": true, "model": "gemini-3.5-flash-lite", "apiKeyConfigured": true, "uptimeSeconds": 42 }
```

**统一错误结构（`/explain` 与扩展共用，UI 文案与错误码一一对应）：**

```json
{ "ok": false, "code": "RATE_LIMITED", "message": "请求较多，请稍后重试。" }
```

错误码枚举（不得新增未登记的码）：
`BAD_REQUEST` · `NO_API_KEY` · `RATE_LIMITED` · `TIMEOUT` · `UPSTREAM_ERROR` · `BAD_MODEL_OUTPUT` · `SERVICE_DOWN`（仅扩展端在 fetch 失败时本地产生）。

### 4.3 模型选择

`.env.example` 内容：

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=replace_me
GEMINI_MODEL=gemini-3.5-flash-lite
PORT=8787
```

- 模型名**只能**来自环境变量，不得硬编码在多个文件中。缺省值集中在 `server.mjs` 顶部一个常量里。
- 通过 Gemini REST API 直接调用，不安装 Google SDK。
- **不要设置 `temperature` / `topP` / `topK`**：Gemini 3.x 系列已弃用这些采样参数，传入可能报错或被忽略。
- 若 `GEMINI_MODEL` 返回 404，在错误信息里提示用户改用 `gemini-3.1-flash-lite`，不要自动切换模型。
- 首版**不**同时实现 Gemini 和 DeepSeek 双供应商。只有在实测 Gemini 不可用、质量明显不足或成本实质变化时，才加小型 provider adapter（供应商适配器）。保持 `/explain` 内部响应结构稳定，将来换模型不改 UI。
- 定价以 Google 官方页面为准，README 记录链接与核对日期，并注明价格会变化：
  `https://ai.google.dev/gemini-api/docs/pricing`

### 4.4 模型输入最小化

**不得发送整个网页。** 每次只发送：

| 字段 | 说明 | 上限 |
|---|---|---|
| `term` | 选中文字 | 200 字符 |
| `sentence` | 包含选区的句子 | 500 字符 |
| `contextBefore` / `contextAfter` | 前后文 | 合计约 800 字符 |
| `depth` | `fast` 或 `deep` | — |
| `parentTerms` | 仅嵌套查询使用 | 最多 2 个 |
| `language` | 默认 `zh-CN` | — |
| `requestId` | 客户端递增序号，用于丢弃过期响应 | — |

系统提示必须要求模型：基于上下文回答、不确定时明确说不确定、**不编造缩写全称**（不确定就把 `fullForm` 留空）、输出严格 JSON。

**用 Gemini 结构化输出，而不是靠提示词祈祷**——在 `generationConfig` 里设置 `responseMimeType: "application/json"` 和 `responseSchema`。这能消除「模型返回非 JSON」这一整类错误。服务端仍然要做一次校验与规范化兜底。

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

Fast 请求保持 `details` 和列表为空；Deep 请求补充它们。字段缺失时服务端给安全默认值（空字符串 / 空数组），**不让扩展崩溃**，也不把模型原始输出透传给页面。

---

## 5. 性能与成本约束

性能是产品功能，不是最后再优化：

- 弹窗骨架：selection 结束后目标 **< 100 ms**。实现时在内容脚本里用 `performance.now()` 打一条 `console.debug('[DIC] skeleton in Xms')`，让这条指标**可被实测**，而不是口头声称。
- 内容脚本初始注入尽量 **< 30 KB**（未压缩，不含图标）。用 `wc -c extension/content.js extension/content.css` 验证并在验收里写实际数字。
- 页面加载时**不**调用模型。
- 每次选词只允许一个 Fast 请求；Deep 最多一个。
- 用 `AbortController` 取消过期请求，**并且**用 `requestId` 单调递增守卫渲染。
- 缓存键：`sha-256(term + '␟' + sentence + '␟' + depth + '␟' + language)`（`crypto.subtle.digest`）。
- 缓存放在 **service worker**：内存 `Map` + `chrome.storage.session`。默认 TTL 24 小时，最多 100 条，LRU（Least Recently Used，最近最少使用）淘汰。
  > 注意：`chrome.storage.session` 默认对内容脚本不可见，这也是缓存必须放在 service worker 的原因之一。
- 不上传整页 DOM（Document Object Model，文档对象模型）。
- 不记录 API Key、网页全文或用户选词历史。
- 不加入遥测、分析 SDK、崩溃收集 SDK。

---

## 6. 错误与边界体验

| 情况 | 用户看到 | 行为 |
|---|---|---|
| 本地服务未启动 | 「DIC 服务未启动」+「打开设置」按钮 | 不重试 |
| API Key 缺失 | 「尚未配置 API Key，请检查 `.env.local`」 | `/health` 返回未配置状态，**绝不返回 Key 内容** |
| Gemini 限流 | 「请求较多，请稍后重试」 | 不自动重试 |
| 超时 | 「请求超时」+「重试」按钮 | 允许**手动重试一次** |
| Chrome 内置页 / 扩展商店页 | 什么都不发生 | 静默不工作，不制造报错弹窗 |
| 模型返回非 JSON | 「解析失败，请重试」 | 服务端尝试提取校验一次；失败返回 `BAD_MODEL_OUTPUT`，不暴露原始响应 |
| 快速连续选择 | 只显示最后一次结果 | 旧 `requestId` 直接丢弃 |
| 选区在跨域 iframe 中 | 不工作 | 首版不强求，README 中说明限制 |
| service worker 被浏览器休眠 | 首次请求略慢 | 内容脚本对 `sendMessage` 失败做一次重试 |

---

## 7. `CLAUDE.md` 必须写入的长期规则

检查现有 `CLAUDE.md`，保留有用内容并补齐：

1. DIC 的第一原则是不中断阅读心流。
2. 优先原生浏览器和 Node API；增加依赖前必须说明不可替代的理由。
3. 单个功能优先小文件和清晰边界，不为「以后可能需要」建立抽象层。
4. API Key 永不进入客户端或 Git。
5. 每次只实现一个可验证的垂直切片。
6. 修改后必须运行 `node --check` 与手动验收清单。
7. 不擅自增加账号、数据库、RAG、向量库、框架、监控、国际化框架或微服务。
8. 所有缩写首次出现要给出完整英文名称和中文解释。
9. 不把性能问题推迟到最后：避免重复请求、过大上下文和无用监听器。
10. 不执行 `git reset --hard`、强制推送或覆盖用户未提交的修改。
11. **所有网络请求只从 MV3 service worker 发出**，内容脚本一律走消息通道。
12. 新增用户可见文案必须同时登记到错误码枚举，不允许出现散落的硬编码提示。

---

## 8. 实施顺序

严格按顺序完成，每步验证后再继续。**每个切片都要给出「怎么验」和「实测结果」**。

### Slice 1：静态交互

- 建立 Manifest V3 扩展（含空壳 `background.js`）。
- 在测试网页选词后显示使用假数据的弹窗。
- 完成定位、边缘翻转、关闭、Shadow DOM、基础无障碍、骨架计时日志。

**验证**：加载扩展 → 在任意文章页选词 → 看到骨架和假数据 → `Escape` 与点击外部都能关 → 控制台有 `skeleton in Xms`。

```bash
git add extension CLAUDE.md README.md
git commit -m "feat: add lightweight selection popup"
```

### Slice 2：真实 Gemini 调用

- 建立零依赖本地 Node 网关，含 `/health`、`/explain`、CORS、限流、错误码。
- 完成 `.env.example`、`.gitignore`。
- service worker 调网关，内容脚本显示真实 Fast 响应。
- 验证 Key 没有进入扩展文件或 Git diff：

  ```bash
  node --check server/server.mjs
  curl -s http://127.0.0.1:8787/health
  git grep -nI -e 'AIza' -e 'GEMINI_API_KEY=' -- . ':!.env.example'
  ```

```bash
git add server .env.example .gitignore extension README.md
git commit -m "feat: connect contextual explanations to Gemini"
```

### Slice 3：Deep Loop 与嵌套

- 一次性 Deep 预取 + 显式「深入理解」按钮 + 请求取消 + 缓存。
- 弹窗内选词，最大 3 层。
- reader 页面：粘贴文本、打开 `.txt`/`.md`，复用同一套选词体验。

```bash
git add extension tests README.md
git commit -m "feat: add deep exploration and nested lookup"
```

### Slice 4：收尾验证

- 检查浏览器控制台与服务端错误（应为零未处理异常）。
- 跑完 `tests/manual-checklist.md`，**填入真实结果**。
- 检查 Git diff、敏感信息、死代码、无用文件。
- 不做与 MVP 无关的美化或重构。

```bash
git add .
git commit -m "chore: verify usable DIC MVP"
```

提交前必须先展示 `git status` 与 `git diff --staged --stat`。如果没有设置 Git 身份或远程仓库，**只报告并给出命令，不伪造成功**。

---

## 9. 验收标准

每一项都要标注 **通过 / 未通过 / 需人工验证**，并附实测证据（命令输出、控制台数字、截图描述）。**不得声称未测试的内容已通过。**

- [ ] 不运行任何构建命令即可加载 `extension/`。
- [ ] README 从零说明如何创建 `.env.local`、启动服务、加载扩展、测试。
- [ ] 普通网页选词能在 100 ms 目标内看到骨架（附控制台实测毫秒数）。
- [ ] `content.js` + `content.css` 未压缩体积 < 30 KB（附 `wc -c` 输出）。
- [ ] Gemini 返回真实、与上下文相关的解释。
- [ ] 缩写显示英文全称；非缩写时该行不渲染（不是渲染空标签）。
- [ ] 点击外部与 `Escape` 均可关闭；关闭后焦点回到合理位置。
- [ ] 快速连续选词不会出现旧响应覆盖新词。
- [ ] Deep 内容不会因反复 hover 重复请求（附网络面板请求次数）。
- [ ] 弹窗内选词最多可深入 3 层，第 4 层被拒绝且有提示。
- [ ] 服务停止、Key 缺失、超时、限流四种情况各有可理解提示（逐项实测）。
- [ ] `.env.local` 被 Git 忽略；`git grep` 搜不到真实 Key。
- [ ] 没有引入任何 npm 运行时依赖、前端框架或数据库。
- [ ] reader 页面支持粘贴文本与打开 `.txt`/`.md`。
- [ ] `tests/manual-checklist.md` 记录实际测试结果，而不是空模板。
- [ ] 深色模式下弹窗可读。
- [ ] 在至少一个启用严格 CSP（Content Security Policy，内容安全策略）的站点上验证弹窗正常显示。

---

## 10. 明确禁止的过度设计

首版禁止：

- monorepo、微服务、Docker、Kubernetes；
- React / Vue / Svelte / Tailwind；
- GraphQL、数据库、ORM（Object-Relational Mapping，对象关系映射）；
- 登录、权限系统、支付系统；
- LangChain、LlamaIndex、向量数据库、RAG；
- 为未来平台提前创建大量接口、抽象基类或插件系统；
- 同时接入多个模型只为「可扩展」；
- 在没有基准数据时做复杂性能优化；
- 自动收集用户浏览内容或查询历史；
- 单元测试框架（首版用手动清单 + `node --check`，不引入 Jest / Vitest）。

如果你认为必须违反其中一项，先证明当前验收标准无法用更简单方式完成，然后**停止并等待我批准**。

---

## 11. 最终交付格式

编码结束后，用以下格式汇报：

1. **现在能做什么**：用用户语言描述实际体验。
2. **如何启动**：最多 6 个命令或操作步骤。
3. **验证结果**：逐项通过 / 未通过 / 需人工验证，附证据。
4. **文件变化**：每个核心文件一句话职责。
5. **Git 状态**：提交哈希、分支、是否已推送。
6. **已知限制**：最多 3 条，写实话。
7. **唯一下一步**：只给一个最值得做的下一步，不展开路线图。

---

## 12. 现在开始

**先不要写代码。** 先完成第 0 节检查，完整阅读仓库，然后在 Plan Mode 输出：

- 你对 DIC 的一句话理解；
- 现有仓库状态（`git status` / `git log` / Node 版本实际输出）；
- 最多 6 步的实施计划；
- 你发现的冲突或风险；
- 你将明确不做的内容。

计划确认后继续实现，直到验收标准中所有能在本机自动或手动验证的项目都有**真实结果**。只有在需要我提供 `GEMINI_API_KEY`、打开 Chrome 扩展管理页或执行浏览器人工操作时，才给出一步一条的明确指令并等待。
