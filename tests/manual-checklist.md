# DIC 手动验收清单

填写规则：每项写 **通过 / 未通过 / 未测**，附证据（控制台数字、请求次数、现象）。不得声称未测的项已通过。

| # | 项目 | 怎么测 | 结果 | 证据 |
|---|---|---|---|---|
| 1 | 不构建即可加载 `extension/` | chrome://extensions 加载已解压 | 未测 | |
| 2 | 服务未启动时有提示 | 不启动网关，悬停一个词 | 未测 | 应显示「DIC 服务未启动」+ 打开设置 |
| 3 | Key 缺失时有提示 | 启动网关但不建 `.env.local` | 未测 | 设置页显示「未配置」；弹窗有提示 |
| 4 | 骨架 < 100 ms | 打开 DevTools Console，悬停一个词，看 `[DIC] skeleton in Xms` | 未测 | X = |
| 5 | 真实上下文解释 | 在一篇 AI 硬件文章悬停 HBM | 未测 | fullForm = High Bandwidth Memory；meaningHere 提到当前句子 |
| 6 | 非缩写不显示全称行 | 悬停 "latency" | 未测 | 标题旁无灰字 |
| 7 | `Escape` 与点击外部关闭 | 各试一次 | 未测 | |
| 8 | 快速连续悬停不串词 | 0.7 秒内依次停在 3 个词上 | 未测 | 只有最后一个词的解释显示 |
| 9 | Deep 不重复请求 | DevTools → Network 过滤 explain，反复移入移出弹窗 5 次 | 未测 | depth=deep 请求数 = 1 |
| 10 | 嵌套最多 3 层 | 在弹窗里选词 3 次 | 未测 | 第 3 层提示已到上限 |
| 11 | 超时提示 + 手动重试 | 断网后悬停 | 未测 | |
| 12 | 限流提示 | 1 分钟内触发 31 次（可临时改 perMinute=3） | 未测 | 「请求较多，请稍后重试」 |
| 13 | `.env.local` 被 Git 忽略 | `git status` 不出现；`git grep -nI AIza` 无结果 | 未测 | |
| 14 | 无 npm 运行时依赖 | `package.json` 无 `dependencies` 字段，仓库无 `node_modules/` | 通过 | package.json 只有 scripts（2026-11-01） |
| 15 | 阅读页粘贴 / 打开 .md | 设置页 → 阅读页 | 未测 | |
| 16 | 深色模式可读 | 系统切深色 | 未测 | |
| 17 | 严格 CSP 站点可用 | 在 github.com 某 README 页悬停 | 未测 | |
| 18 | 内容脚本体积 < 30 KB | `wc -c extension/content.js extension/content.css` | 通过 | 13.4 KB + 2.7 KB（2026-11-01） |
| 19 | 网关 smoke 测试 | `npm test` | 通过 | 13/13（2026-11-01，mock 模式） |

**已在无浏览器环境验证（2026-09-25）**：`node --check` 全部通过；网关 `/health`、`/explain` 字段校验、CORS 仅放行 `chrome-extension://` 与 localhost、预检 204、缺 Key 返回 `NO_API_KEY`。
