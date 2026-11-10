// DIC 共享核心：扩展（background.js）与本地网关（server/server.mjs）共用的纯逻辑。
// 只用标准 JS，不依赖浏览器或 Node 专有 API，两边 import 的是同一个文件。
// 内容：输入校验、系统提示词、结构化输出 schema、请求体构造、响应解析、错误码、滑动窗口限流。

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const LIMITS = { body: 16 * 1024, term: 200, sentence: 500, context: 800, timeoutMs: 15000, perMinute: 30 };
export const MAX_TOKENS = { fast: 400, deep: 900 };

// 用户可见错误码枚举（CLAUDE.md 第 12 条）。所有错误文案必须对应其中之一。
export const ERROR_CODES = ['BAD_REQUEST', 'NO_API_KEY', 'RATE_LIMITED', 'TIMEOUT', 'UPSTREAM_ERROR', 'BAD_MODEL_OUTPUT', 'SERVICE_DOWN'];
export const MESSAGES = {
  NO_API_KEY: '尚未配置 API Key',
  RATE_LIMITED: '请求较多，请稍后重试。',
  TIMEOUT: '请求超时，请重试。',
  BAD_MODEL_OUTPUT: '解析失败，请重试。',
  SERVICE_DOWN: 'DIC 服务未启动',
  UPSTREAM_ERROR: '上游服务出错',
};
export const err = (code, message) => ({ ok: false, code, message: message || MESSAGES[code] || MESSAGES.UPSTREAM_ERROR });

// Gemini 结构化输出 schema：强制模型返回这 8 个字段的 JSON
export const SCHEMA = {
  type: 'OBJECT',
  properties: {
    term: { type: 'STRING' }, fullForm: { type: 'STRING' }, meaningHere: { type: 'STRING' },
    contextLink: { type: 'STRING' }, example: { type: 'STRING' }, details: { type: 'STRING' },
    relatedConcepts: { type: 'ARRAY', items: { type: 'STRING' } },
    followUpQuestions: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['term', 'fullForm', 'meaningHere', 'contextLink', 'example', 'details', 'relatedConcepts', 'followUpQuestions'],
};

export const SYSTEM = `你是 DIC，一个嵌入阅读页面的上下文词典。用户正在阅读英文或中文材料，选中了一个词、缩写或短语。
规则：
1. 只根据给出的句子和上下文解释"这里"的含义，不要泛泛而谈。
2. 缩写必须给出完整英文全称；不确定就把 fullForm 留空，绝不编造。非缩写时 fullForm 为空字符串。
3. 用简体中文解释，保留术语英文原文；专业英文缩写不要翻译掉。
4. fast 模式：meaningHere + contextLink + example 合计 120–220 字，details/relatedConcepts/followUpQuestions 留空。
5. deep 模式：details 给更完整的机制或背景（150–300 字），relatedConcepts 给 2–3 个相邻概念（每项"概念：一句话关系"），followUpQuestions 给最多 3 个值得追问的问题。
6. 不确定时明确说"不确定"，不要猜。只输出 JSON。`;

// 校验并裁剪请求体。返回 { value } 或 { error }
export function validate(b) {
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
  const term = str(b.term, LIMITS.term)?.trim();
  if (!term) return { error: 'term 缺失或超过 200 字符' };
  const sentence = str(b.sentence ?? '', LIMITS.sentence) ?? '';
  const before = str(b.contextBefore ?? '', LIMITS.context) ?? '';
  const after = str(b.contextAfter ?? '', LIMITS.context) ?? '';
  if (before.length + after.length > LIMITS.context) return { error: '上下文超过 800 字符' };
  const depth = b.depth === 'deep' ? 'deep' : 'fast';
  const parents = Array.isArray(b.parentTerms) ? b.parentTerms.filter((p) => typeof p === 'string').slice(0, 2).map((p) => p.slice(0, 200)) : [];
  const language = str(b.language ?? 'zh-CN', 16) ?? 'zh-CN';
  return { value: { term, sentence, before, after, depth, parents, language } };
}

// 把模型输出规范成固定形状，缺字段补默认值，数组最多 3 项
export function normalize(raw, term) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 3) : []);
  return {
    term: s(raw.term) || term, fullForm: s(raw.fullForm), meaningHere: s(raw.meaningHere) || '（模型未给出解释）',
    contextLink: s(raw.contextLink), example: s(raw.example), details: s(raw.details),
    relatedConcepts: arr(raw.relatedConcepts), followUpQuestions: arr(raw.followUpQuestions),
  };
}

export function buildUserPrompt(v) {
  return [
    `模式：${v.depth}`, `解释语言：${v.language}`,
    v.parents.length ? `这是嵌套查询，上级词：${v.parents.join(' > ')}` : '',
    `选中：${v.term}`, `所在句子：${v.sentence || '（无）'}`,
    `前文：${v.before || '（无）'}`, `后文：${v.after || '（无）'}`,
  ].filter(Boolean).join('\n');
}

export function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function buildRequest(v) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(v) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: MAX_TOKENS[v.depth] },
  };
}

// Gemini 非 2xx → 错误对象
export function upstreamError(status, model) {
  if (status === 429) return err('RATE_LIMITED');
  if (status === 404) return err('UPSTREAM_ERROR', `模型 ${model} 不存在，请检查模型名`);
  if (status === 400 || status === 401 || status === 403) return err('NO_API_KEY', 'API Key 无效或没有权限');
  return err('UPSTREAM_ERROR', `Gemini 返回 ${status}`);
}

// Gemini 响应 JSON → 规范化结果；解析失败返回 null
export function parseGeminiResponse(data, term) {
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return normalize(parsed, term);
}

// 完整的一次调用：fetch 由调用方注入（浏览器和 Node 的 fetch 都行）。返回 { ok, result } 或错误对象。
// 对 BAD_MODEL_OUTPUT 自动重试一次（模型偶发截断 JSON）。
export async function callGemini({ apiKey, model, value, fetchFn = fetch, retry = 1 }) {
  let res;
  try {
    res = await fetchFn(geminiUrl(model), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(LIMITS.timeoutMs),
      body: JSON.stringify(buildRequest(value)),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return err('TIMEOUT');
    return err('UPSTREAM_ERROR', '无法连接 Gemini，请检查网络');
  }
  if (!res.ok) return { ...upstreamError(res.status, model), status: res.status };
  let data;
  try { data = await res.json(); } catch { data = null; }
  const result = data ? parseGeminiResponse(data, value.term) : null;
  if (!result) {
    if (retry > 0) return callGemini({ apiKey, model, value, fetchFn, retry: retry - 1 });
    return err('BAD_MODEL_OUTPUT');
  }
  return { ok: true, result };
}

// 滑动窗口限流：每分钟最多 perMinute 次
export class RateLimiter {
  constructor(perMinute = LIMITS.perMinute) { this.perMinute = perMinute; this.hits = []; }
  take(now = Date.now()) {
    while (this.hits.length && this.hits[0] < now - 60000) this.hits.shift();
    if (this.hits.length >= this.perMinute) return false;
    this.hits.push(now); return true;
  }
}

// mock：不联网，返回固定示例（离线演示 / 测试）
export function mockExplain(v) {
  const deep = v.depth === 'deep';
  const isAbbr = /^[A-Z][A-Z0-9.]+$/.test(v.term);
  return normalize({
    term: v.term,
    fullForm: isAbbr ? `（mock）${v.term} 的英文全称` : '',
    meaningHere: `（mock 模式，未调用模型）在这句话里，"${v.term}" 指的是一个示例概念；真实运行时这里会是 Gemini 基于当前句子给出的解释。`,
    contextLink: v.sentence ? `它出现在："${v.sentence.slice(0, 60)}${v.sentence.length > 60 ? '…' : ''}"` : '',
    example: `例：The report explains what ${v.term} means in this context.`,
    details: deep ? '（mock）深入模式会在这里给出机制、背景与边界条件，150–300 字。' : '',
    relatedConcepts: deep ? ['相关概念 A：一句话关系', '相关概念 B：一句话关系'] : [],
    followUpQuestions: deep ? [`${v.term} 和相邻概念的区别是什么？`, `${v.term} 在实际场景中如何使用？`] : [],
  }, v.term);
}
