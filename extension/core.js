// DIC 共享核心：扩展（background.js）与本地网关（server/server.mjs）共用的纯逻辑。
// 只用标准 JS，不依赖浏览器或 Node 专有 API，两边 import 的是同一个文件。
// 内容：输入校验、系统提示词、结构化输出 schema、请求体构造、流式/非流式调用、响应解析、错误码、限流。

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const LIMITS = { body: 16 * 1024, term: 200, sentence: 500, context: 800, timeoutMs: 15000, perMinute: 30 };
export const MAX_TOKENS = { fast: 400, deep: 900, answer: 700 };

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

// Gemini 结构化输出 schema：强制模型返回这些字段的 JSON。字段顺序即生成顺序，meaningHere 靠前以便流式时最先显示。
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
const STRING_FIELDS = ['term', 'fullForm', 'meaningHere', 'contextLink', 'example', 'details'];

export const SYSTEM = `你是 DIC，一个嵌入阅读页面的上下文词典。用户正在阅读英文或中文材料，选中了一个词、缩写或短语，或者针对某个词提出了追问。
规则：
1. 只根据给出的句子和上下文解释"这里"的含义，不要泛泛而谈。
2. 缩写必须给出完整英文全称；不确定就把 fullForm 留空，绝不编造。非缩写时 fullForm 为空字符串。
3. 用简体中文解释，保留术语英文原文；专业英文缩写不要翻译掉。
4. fast 模式：meaningHere + contextLink + example 合计 120–220 字，details/relatedConcepts/followUpQuestions 留空。
5. deep 模式：界面上已经显示了短解释，不要重复。meaningHere、contextLink、example、fullForm 一律留空字符串；只写 details（更完整的机制或背景，150–300 字）、relatedConcepts（2–3 个相邻概念，每项"概念：一句话关系"）、followUpQuestions（最多 3 个值得追问的问题）。
6. answer 模式：用户在追问一个问题。term 原样返回这个问题；meaningHere 直接、完整地回答这个问题（150–260 字），结合给出的原文语境；contextLink 用一句话说明答案与原文的联系，可留空；fullForm、example、details、relatedConcepts 留空；followUpQuestions 给最多 2 个更进一步的问题。不要把问题当成词来解释。
7. 不确定时明确说"不确定"，不要猜。只输出 JSON。`;

// 校验并裁剪请求体。返回 { value } 或 { error }。kind：term（解释一个词）| question（回答一个追问）
export function validate(b) {
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
  const term = str(b.term, LIMITS.term)?.trim();
  if (!term) return { error: 'term 缺失或超过 200 字符' };
  const sentence = str(b.sentence ?? '', LIMITS.sentence) ?? '';
  const before = str(b.contextBefore ?? '', LIMITS.context) ?? '';
  const after = str(b.contextAfter ?? '', LIMITS.context) ?? '';
  if (before.length + after.length > LIMITS.context) return { error: '上下文超过 800 字符' };
  const kind = b.kind === 'question' ? 'question' : 'term';
  const depth = kind === 'question' ? 'answer' : b.depth === 'deep' ? 'deep' : 'fast';
  const parents = Array.isArray(b.parentTerms) ? b.parentTerms.filter((p) => typeof p === 'string').slice(0, 2).map((p) => p.slice(0, 200)) : [];
  const language = str(b.language ?? 'zh-CN', 16) ?? 'zh-CN';
  return { value: { term, sentence, before, after, depth, kind, parents, language } };
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
  const q = v.kind === 'question';
  return [
    `模式：${v.depth}`, `解释语言：${v.language}`,
    q ? `用户的追问：${v.term}` : `选中：${v.term}`,
    v.parents.length ? (q ? `这个追问针对的词：${v.parents.join(' > ')}` : `这是嵌套查询，上级词：${v.parents.join(' > ')}`) : '',
    `${q ? '原文句子' : '所在句子'}：${v.sentence || '（无）'}`,
    `前文：${v.before || '（无）'}`, `后文：${v.after || '（无）'}`,
  ].filter(Boolean).join('\n');
}

export function geminiUrl(model, stream = false) {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`;
  return stream ? `${base}:streamGenerateContent?alt=sse` : `${base}:generateContent`;
}

export function buildRequest(v) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(v) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: MAX_TOKENS[v.depth] },
  };
}

// Gemini 非 2xx → 错误对象。detail 是 Gemini 返回的错误说明（用于区分"Key 无效"与"请求本身有问题"，两者都是 400）
export function upstreamError(status, model, detail = '') {
  if (status === 429) return err('RATE_LIMITED');
  if (status === 404) return err('UPSTREAM_ERROR', `模型 ${model} 不存在，请检查模型名`);
  if (status === 401 || status === 403 || (status === 400 && (!detail || /api.?key/i.test(detail)))) return err('NO_API_KEY', 'API Key 无效或没有权限');
  if (status === 503) return err('UPSTREAM_ERROR', 'Gemini 暂时繁忙，请重试');
  return err('UPSTREAM_ERROR', `Gemini 返回 ${status}`);
}
async function errorFromResponse(res, model) {
  let detail = '';
  try { detail = (await res.json())?.error?.message || ''; } catch {}
  return { ...upstreamError(res.status, model, detail), status: res.status };
}

// 模型输出的文本 → 规范化结果；解析失败返回 null
export function parseText(text, term) {
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return normalize(parsed, term);
}
export function parseGeminiResponse(data, term) {
  return parseText(data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '', term);
}

// 流式过程中 JSON 还没写完：用正则把已经出现的字符串字段（哪怕只写了一半）抠出来，供界面边生成边显示
export function partialFromText(text) {
  const out = {};
  for (const f of STRING_FIELDS) {
    const m = text.match(new RegExp(`"${f}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
    if (!m) continue;
    const raw = m[1].replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/\\$/, ''); // 去掉结尾被截断的转义
    try { out[f] = JSON.parse(`"${raw}"`); } catch {}
  }
  return out;
}

const withTimeout = (signal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(LIMITS.timeoutMs)]) : AbortSignal.timeout(LIMITS.timeoutMs));
const headers = (apiKey) => ({ 'content-type': 'application/json', 'x-goog-api-key': apiKey });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 非流式调用：fetch 由调用方注入（浏览器和 Node 的 fetch 都行）。返回 { ok, result } 或错误对象。
// 自动重试一次的两种情况：模型输出坏 JSON（偶发截断）；Gemini 返回 500/503（瞬时过载）。
export async function callGemini({ apiKey, model, value, fetchFn = fetch, retry = 1, signal, _attempt = 0 }) {
  const again = () => callGemini({ apiKey, model, value, fetchFn, retry: retry - 1, signal, _attempt: _attempt + 1 });
  let res;
  try {
    res = await fetchFn(geminiUrl(model), { method: 'POST', headers: headers(apiKey), signal: withTimeout(signal), body: JSON.stringify(buildRequest(value)) });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return err('TIMEOUT');
    return err('UPSTREAM_ERROR', '无法连接 Gemini，请检查网络');
  }
  if (!res.ok) {
    if ((res.status === 500 || res.status === 503) && retry > 0) { await sleep(400); return again(); }
    return errorFromResponse(res, model);
  }
  let data;
  try { data = await res.json(); } catch { data = null; }
  const result = data ? parseGeminiResponse(data, value.term) : null;
  if (!result) return retry > 0 ? again() : err('BAD_MODEL_OUTPUT');
  return { ok: true, result, retried: _attempt > 0 };
}

// 流式调用（SSE，Server-Sent Events，服务器逐块推送）：每收到一块就调用 onPartial(已出现的字段)。
// 只在"确定该报错"时返回错误（限流、Key 无效、被取消）；其余任何异常都返回 null，让调用方退回 callGemini。
export async function streamGemini({ apiKey, model, value, fetchFn = fetch, onPartial, signal }) {
  let res;
  try {
    res = await fetchFn(geminiUrl(model, true), { method: 'POST', headers: headers(apiKey), signal: withTimeout(signal), body: JSON.stringify(buildRequest(value)) });
  } catch { return signal?.aborted ? err('TIMEOUT') : null; }
  if (!res.ok) {
    if (res.status === 429 || res.status === 401 || res.status === 403) return errorFromResponse(res, model);
    return null;
  }
  if (!res.body?.getReader) return null;
  let text = '', buf = '';
  try {
    const reader = res.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      buf += dec.decode(chunk, { stream: true });
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        const add = ev?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        if (add) { text += add; onPartial?.(partialFromText(text)); }
      }
    }
  } catch { return signal?.aborted ? err('TIMEOUT') : null; }
  const result = parseText(text, value.term);
  return result ? { ok: true, result, streamed: true } : null;
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
  if (v.kind === 'question') return normalize({
    term: v.term, meaningHere: `（mock 模式，未调用模型）这是对追问"${v.term}"的示例回答；真实运行时这里是 Gemini 结合原文给出的完整回答。`,
    contextLink: v.parents.length ? `这个问题是针对 ${v.parents.at(-1)} 提出的。` : '', followUpQuestions: ['更进一步的示例追问？'],
  }, v.term);
  const deep = v.depth === 'deep';
  const isAbbr = /^[A-Z][A-Z0-9.]+$/.test(v.term);
  return normalize({
    term: v.term,
    fullForm: isAbbr ? `（mock）${v.term} 的英文全称` : '',
    meaningHere: `（mock 模式，未调用模型）在这句话里，"${v.term}" 指的是一个示例概念；真实运行时这里会是 Gemini 基于当前句子给出的解释。`,
    contextLink: v.sentence ? `它出现在："${v.sentence.slice(0, 60)}${v.sentence.length > 60 ? '…' : ''}"` : '',
    example: `例：The report explains what ${v.term} means in this context.`,
    details: deep ? '（mock）深入模式会在这里给出机制、背景与边界条件，150–300 字。这段文字故意写得长一些，用来验证弹窗在内容变长之后不会跑出屏幕，而是在自己内部滚动。机制、背景、边界条件、典型误解、与相邻概念的差别都会写在这里。' : '',
    relatedConcepts: deep ? ['相关概念 A：一句话关系', '相关概念 B：一句话关系'] : [],
    followUpQuestions: deep ? [`${v.term} 和相邻概念的区别是什么？`, `${v.term} 在实际场景中如何使用？`] : [],
  }, v.term);
}
