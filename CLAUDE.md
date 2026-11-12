# DIC — Claude Code 长期规则

1. 第一原则：不中断阅读心流。任何改动先问"会不会让弹窗更慢、更吵、更抢焦点"。
2. 优先原生浏览器和 Node API；增加依赖前必须说明不可替代的理由。当前运行时依赖为 0，保持。
3. 小文件、清晰边界；不为"以后可能需要"建抽象层。
4. Key 永不进入 Git、永不进入内容脚本（网页上下文）。BYOK 模式下用户自己的 Key 只存 `chrome.storage.local`、只在 service worker 里使用、只发往 Google；网关模式下作者的 Key 只在根目录 `.env.local`。
5. 每次只实现一个可验证的垂直切片：计划 → 实现 → `node --check` → 手动清单 → 展示 diff → 提交。
6. 修改后必须运行 `npm test`（`node --check` + `tests/core.test.mjs` + `tests/smoke.mjs`）并过一遍 `tests/manual-checklist.md`。
7. 不擅自增加账号、数据库、RAG、向量库、前端框架、监控、国际化框架、微服务、测试框架。
8. 所有缩写首次出现要给出完整英文名称和中文解释（代码注释、文案、README 都算）。
9. 性能不是最后再做：避免重复请求、过大上下文、无用监听器。内容脚本 + CSS 保持 < 30 KB。
10. 不执行 `git reset --hard`、强制推送或覆盖用户未提交的修改。
11. 所有网络请求只从 MV3 service worker（`background.js`）发出；内容脚本一律走 `chrome.runtime.sendMessage`。模型相关逻辑（校验、提示词、schema、流式与解析、限流）只写在 `extension/core.js`，扩展与网关共用，不复制。解释请求走长连接 port（才能推流式片段、才能取消）；流式失败必须能退回非流式。
12. 用户可见错误文案必须对应错误码枚举：`BAD_REQUEST NO_API_KEY RATE_LIMITED TIMEOUT UPSTREAM_ERROR BAD_MODEL_OUTPUT SERVICE_DOWN`，不允许散落的硬编码提示。
13. 不用 `innerHTML` 渲染任何模型输出。

总控任务书在 `docs/DIC_CLAUDE_MASTER_PROMPT_v2.md`。可用技能在 `.claude/skills/`（来自 quangpl/browser-extension-skills，MIT）：extension-dev（跨上下文调试）、extension-manifest（权限）、extension-test、extension-ui。

上架材料在 `store/`：`privacy-policy.html`（英文隐私政策，需发布到公开网址）与 `SUBMISSION.md`（商店后台各栏的填写内容）。**改动权限、网络请求目的地或发送给模型的数据范围时，必须同步修改这两份文件和引导页里的数据处理说明**，三者与代码不一致会导致拒审。
