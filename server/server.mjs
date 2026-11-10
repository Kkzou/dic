// DIC 本地模型网关（进阶模式）：只用 Node 内置模块。启动：npm start
// 业务逻辑（校验、提示词、schema、解析、限流）全部来自 ../extension/core.js，与扩展共用同一份代码。
import http from 'node:http';
import { DEFAULT_MODEL, LIMITS, RateLimiter, validate, callGemini, mockExplain, err } from '../extension/core.js';

const PORT = Number(process.env.PORT || 8787);
const PROVIDER = process.env.LLM_PROVIDER === 'mock' ? 'mock' : 'gemini'; // mock：不联网，返回固定示例
const MODEL = PROVIDER === 'mock' ? 'mock' : (process.env.GEMINI_MODEL || DEFAULT_MODEL);
const API_KEY = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'replace_me' ? process.env.GEMINI_API_KEY : '';
const hasKey = () => PROVIDER === 'mock' || Boolean(API_KEY);
const startedAt = Date.now();
const limiter = new RateLimiter(LIMITS.perMinute);

const send = (res, status, obj, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(obj));
};

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

const STATUS = { BAD_REQUEST: 400, NO_API_KEY: 503, RATE_LIMITED: 429, TIMEOUT: 504, UPSTREAM_ERROR: 502, BAD_MODEL_OUTPUT: 502 };

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const cors = corsHeaders(req.headers.origin);
  const url = new URL(req.url, 'http://127.0.0.1');
  const log = (status, extra = '') => console.log(`${req.method} ${url.pathname} ${status} ${Date.now() - t0}ms${extra ? '  ' + extra : ''}`);
  const fail = (e) => { send(res, STATUS[e.code] || 502, e, cors); log(STATUS[e.code] || 502, `${e.code}${e.status ? ' gemini=' + e.status : ''} ${e.message}`); };
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return log(204); }
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true, model: MODEL, provider: PROVIDER, apiKeyConfigured: hasKey(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }, cors);
      return log(200);
    }
    if (req.method === 'POST' && url.pathname === '/explain') {
      if (!(req.headers['content-type'] || '').includes('application/json')) return fail(err('BAD_REQUEST', '只接受 JSON'));
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return fail(err('BAD_REQUEST', e.message === 'TOO_LARGE' ? '请求体超过 16 KB' : 'JSON 无法解析')); }
      const { value, error } = validate(body || {});
      if (error) return fail(err('BAD_REQUEST', error));
      if (!hasKey()) return fail(err('NO_API_KEY', '尚未配置 API Key，请检查 .env.local'));
      if (!limiter.take()) return fail(err('RATE_LIMITED'));
      const r = PROVIDER === 'mock' ? { ok: true, result: mockExplain(value) } : await callGemini({ apiKey: API_KEY, model: MODEL, value });
      if (!r.ok) return fail(r);
      send(res, 200, { ok: true, requestId: body.requestId ?? null, depth: value.depth, result: r.result }, cors);
      return log(200, value.depth);
    }
    send(res, 404, err('BAD_REQUEST', 'Not found'), cors); log(404);
  } catch (e) {
    send(res, 500, err('UPSTREAM_ERROR', '服务内部错误'), cors); log(500, e.message);
  }
});

server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `端口 ${PORT} 已被占用：可能 DIC 已在运行，或改 .env.local 里的 PORT。` : e.message); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`DIC 网关已启动：http://127.0.0.1:${PORT}  模型：${MODEL}${PROVIDER === 'mock' ? '（mock 模式，不联网）' : ''}`);
  if (!hasKey()) console.log('提示：未检测到 GEMINI_API_KEY，请在根目录创建 .env.local（参考 .env.example）后重启。');
});
