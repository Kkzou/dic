// DIC 本地模型网关 —— 只用 Node 内置模块。启动：node --env-file-if-exists=.env.local server/server.mjs
import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const PROVIDER = process.env.LLM_PROVIDER === 'mock' ? 'mock' : 'gemini'; // mock：不联网，返回固定示例，用于离线演示与 smoke 测试
const MODEL = PROVIDER === 'mock' ? 'mock' : (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
const API_KEY = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'replace_me' ? process.env.GEMINI_API_KEY : '';
const HAS_KEY = () => PROVIDER === 'mock' || Boolean(API_KEY);
const LIMITS = { body: 16 * 1024, term: 200, sentence: 500, context: 800, timeoutMs: 15000, perMinute: 30 };
const MAX_TOKENS = { fast: 400, deep: 900 };
const startedAt = Date.now();
const hits = []; // 简单滑动窗口限流

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    term: { type: 'STRING' }, fullForm: { type: 'STRING' }, meaningHere: { type: 'STRING' },
    contextLink: { type: 'STRING' }, example: { type: 'STRING' }, details: { type: 'STRING' },
    relatedConcepts: { type: 'ARRAY', items: { type: 'STRING' } },
    followUpQuestions: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['term', 'fullForm', 'meaningHere', 'contextLink', 'example', 'details', 'relatedConcepts', 'followUpQuestions'],
};

const SYSTEM = `你是 DIC，一个嵌入阅读页面的上下文词典。用户正在阅读英文或中文材料，选中了一个词、缩写或短语。
规则：
1. 只根据给出的句子和上下文解释"这里"的含义，不要泛泛而谈。
2. 缩写必须给出完整英文全称；不确定就把 fullForm 留空，绝不编造。非缩写时 fullForm 为空字符串。
3. 用简体中文解释，保留术语英文原文；专业英文缩写不要翻译掉。
4. fast 模式：meaningHere + contextLink + example 合计 120–220 字，details/relatedConcepts/followUpQuestions 留空。
5. deep 模式：details 给更完整的机制或背景（150–300 字），relatedConcepts 给 2–3 个相邻概念（每项"概念：一句话关系"），followUpQuestions 给最多 3 个值得追问的问题。
6. 不确定时明确说"不确定"，不要猜。只输出 JSON。`;

const send = (res, status, obj, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(obj));
};
const fail = (res, status, code, message) => send(res, status, { ok: false, code, message });

function corsHeaders(origin) {
  const ok = origin && (origin.startsWith('chrome-extension://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' } : {};
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > LIMITS.body) { reject(new Error('TOO_LARGE')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validate(b) {
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

function normalize(raw, term) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 3) : []);
  return {
    term: s(raw.term) || term, fullForm: s(raw.fullForm), meaningHere: s(raw.meaningHere) || '（模型未给出解释）',
    contextLink: s(raw.contextLink), example: s(raw.example), details: s(raw.details),
    relatedConcepts: arr(raw.relatedConcepts), followUpQuestions: arr(raw.followUpQuestions),
  };
}

function mockExplain(v) {
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

async function explain(v) {
  if (PROVIDER === 'mock') return mockExplain(v);
  const user = [
    `模式：${v.depth}`, `解释语言：${v.language}`,
    v.parents.length ? `这是嵌套查询，上级词：${v.parents.join(' > ')}` : '',
    `选中：${v.term}`, `所在句子：${v.sentence || '（无）'}`,
    `前文：${v.before || '（无）'}`, `后文：${v.after || '（无）'}`,
  ].filter(Boolean).join('\n');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': API_KEY },
    signal: AbortSignal.timeout(LIMITS.timeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: MAX_TOKENS[v.depth] },
    }),
  });
  if (res.status === 429) throw Object.assign(new Error('rate'), { code: 'RATE_LIMITED' });
  if (res.status === 404) throw Object.assign(new Error('model'), { code: 'UPSTREAM_ERROR', message: `模型 ${MODEL} 不存在，请在 .env.local 改用 gemini-3.1-flash-lite` });
  if (!res.ok) throw Object.assign(new Error('upstream'), { code: 'UPSTREAM_ERROR', message: `Gemini 返回 ${res.status}` });
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object') throw Object.assign(new Error('parse'), { code: 'BAD_MODEL_OUTPUT' });
  return normalize(parsed, v.term);
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const cors = corsHeaders(req.headers.origin);
  const url = new URL(req.url, 'http://127.0.0.1');
  const log = (status) => console.log(`${req.method} ${url.pathname} ${status} ${Date.now() - t0}ms`);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return log(204); }
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true, model: MODEL, provider: PROVIDER, apiKeyConfigured: HAS_KEY(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }, cors);
      return log(200);
    }
    if (req.method === 'POST' && url.pathname === '/explain') {
      if (!(req.headers['content-type'] || '').includes('application/json')) { fail(res, 400, 'BAD_REQUEST', '只接受 JSON'); return log(400); }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { fail(res, 400, 'BAD_REQUEST', e.message === 'TOO_LARGE' ? '请求体超过 16 KB' : 'JSON 无法解析'); return log(400); }
      const { value, error } = validate(body || {});
      if (error) { fail(res, 400, 'BAD_REQUEST', error); return log(400); }
      if (!HAS_KEY()) { send(res, 503, { ok: false, code: 'NO_API_KEY', message: '尚未配置 API Key，请检查 .env.local' }, cors); return log(503); }
      const now = Date.now(); while (hits.length && hits[0] < now - 60000) hits.shift();
      if (hits.length >= LIMITS.perMinute) { send(res, 429, { ok: false, code: 'RATE_LIMITED', message: '请求较多，请稍后重试。' }, cors); return log(429); }
      hits.push(now);
      try {
        const result = await explain(value);
        send(res, 200, { ok: true, requestId: body.requestId ?? null, depth: value.depth, result }, cors);
        return log(200);
      } catch (e) {
        const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
        const code = timeout ? 'TIMEOUT' : e.code || 'UPSTREAM_ERROR';
        const msg = { TIMEOUT: '请求超时，请重试。', RATE_LIMITED: '请求较多，请稍后重试。', BAD_MODEL_OUTPUT: '解析失败，请重试。' }[code] || e.message || '上游服务出错';
        send(res, timeout ? 504 : 502, { ok: false, code, message: msg }, cors);
        return log(timeout ? 504 : 502);
      }
    }
    fail(res, 404, 'BAD_REQUEST', 'Not found'); log(404);
  } catch (e) {
    fail(res, 500, 'UPSTREAM_ERROR', '服务内部错误'); log(500);
  }
});

server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `端口 ${PORT} 已被占用：可能 DIC 已在运行，或改 .env.local 里的 PORT。` : e.message); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`DIC 网关已启动：http://127.0.0.1:${PORT}  模型：${MODEL}${PROVIDER === 'mock' ? '（mock 模式，不联网）' : ''}`);
  if (!HAS_KEY()) console.log('提示：未检测到 GEMINI_API_KEY，请在根目录创建 .env.local（参考 .env.example）后重启。');
});
