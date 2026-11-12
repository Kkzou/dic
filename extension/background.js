// DIC service worker：扩展里唯一的网络出口，也是缓存所在。
// 两种模式（设置页切换）：
//   byok    —— Bring Your Own Key：用户把自己的 Gemini API Key 填在设置页，这里直接调用 Gemini。默认，无需本地网关。
//   gateway —— 进阶：请求发给本机 127.0.0.1:8787 的 Node 网关，Key 存在电脑的 .env.local 里。
import { DEFAULT_MODEL, LIMITS, RateLimiter, validate, callGemini, streamGemini, err } from './core.js';

const GATEWAY = 'http://127.0.0.1:8787';
const CACHE_MAX = 100, CACHE_TTL = 24 * 3600 * 1000;
const mem = new Map(); // key -> { t, value }（Map 保持插入顺序，天然可做 LRU）
const limiter = new RateLimiter(LIMITS.perMinute);

const SETTINGS = { mode: 'byok', geminiApiKey: '', geminiModel: DEFAULT_MODEL };
const settings = () => chrome.storage.local.get(SETTINGS);

async function hashKey(o) {
  const data = new TextEncoder().encode([o.term, o.sentence, o.depth, o.language].join('␟'));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function cacheGet(key) {
  let hit = mem.get(key);
  if (!hit) { const s = await chrome.storage.session.get(key); hit = s[key]; if (hit) mem.set(key, hit); }
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL) { mem.delete(key); chrome.storage.session.remove(key); return null; }
  mem.delete(key); mem.set(key, hit); // LRU：命中即移到末尾
  return hit.value;
}
async function cacheSet(key, value) {
  const hit = { t: Date.now(), value };
  mem.set(key, hit);
  while (mem.size > CACHE_MAX) { const old = mem.keys().next().value; mem.delete(old); chrome.storage.session.remove(old); }
  chrome.storage.session.set({ [key]: hit });
}

// 模式 byok：在 service worker 里直接调 Gemini（逻辑与网关完全相同，来自 core.js）。
// 先走流式（边生成边把片段交给 onPartial）；流式出任何意外都退回已验证的非流式调用。
async function explainDirect(payload, s, onPartial, signal) {
  const { value, error } = validate(payload);
  if (error) return err('BAD_REQUEST', error);
  if (!s.geminiApiKey) return err('NO_API_KEY', '请在设置页填入你的 Gemini API Key');
  if (!limiter.take()) return err('RATE_LIMITED');
  const args = { apiKey: s.geminiApiKey, model: s.geminiModel || DEFAULT_MODEL, value, signal };
  let r = await streamGemini({ ...args, onPartial });
  if (!r && !signal?.aborted) r = { ...(await callGemini(args)), fellBack: true };
  if (!r) return err('TIMEOUT');
  return r.ok ? { ...r, depth: value.depth } : r;
}

// 模式 gateway：转发给本地网关（不流式）
async function explainViaGateway(payload, signal) {
  let res;
  try {
    res = await fetch(`${GATEWAY}/explain`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.any([signal, AbortSignal.timeout(LIMITS.timeoutMs + 1000)]),
    });
  } catch (e) {
    return e.name === 'TimeoutError' || e.name === 'AbortError' ? err('TIMEOUT') : err('SERVICE_DOWN');
  }
  try { return await res.json(); } catch { return err('BAD_MODEL_OUTPUT'); }
}

async function explain(payload, onPartial, signal) {
  const t0 = performance.now();
  const ms = () => `${(performance.now() - t0).toFixed(0)}ms`;
  const tag = `[DIC] ${payload.kind === 'question' ? 'Q:' : ''}${String(payload.term).slice(0, 30)} ${payload.depth || ''}`;
  const key = await hashKey(payload);
  const cached = await cacheGet(key);
  if (cached) { console.debug(`${tag} cache ${ms()}`); return { ok: true, cached: true, result: cached }; }
  const s = await settings();
  let first = '';
  const data = s.mode === 'gateway' ? await explainViaGateway(payload, signal)
    : await explainDirect(payload, s, (p) => { if (!first && p.meaningHere) first = ` 首字 ${ms()}`; onPartial?.(p); }, signal);
  if (data.ok) cacheSet(key, data.result);
  console.debug(`${tag} ${s.mode}${first} 完成 ${ms()}${data.fellBack ? ' 非流式回退' : ''}${data.retried ? ' retried' : ''}${data.ok ? '' : ' ' + data.code}`);
  return { ...data, requestId: payload.requestId ?? null };
}

// 健康检查：byok 模式用一次极轻的 GET models/{model} 验证 Key 和模型名；gateway 模式问网关
async function health() {
  const s = await settings();
  if (s.mode === 'gateway') {
    try {
      const r = await fetch(`${GATEWAY}/health`, { signal: AbortSignal.timeout(3000) });
      return { ...(await r.json()), mode: 'gateway' };
    } catch { return { ...err('SERVICE_DOWN'), mode: 'gateway' }; }
  }
  const model = s.geminiModel || DEFAULT_MODEL;
  if (!s.geminiApiKey) return { ok: false, code: 'NO_API_KEY', mode: 'byok', model, apiKeyConfigured: false };
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
      headers: { 'x-goog-api-key': s.geminiApiKey }, signal: AbortSignal.timeout(6000),
    });
    if (r.ok) return { ok: true, mode: 'byok', model, apiKeyConfigured: true };
    const e = r.status === 404 ? err('UPSTREAM_ERROR', `模型 ${model} 不存在，请检查模型名`) : err('NO_API_KEY', 'API Key 无效或没有权限');
    return { ...e, mode: 'byok', model, apiKeyConfigured: true, status: r.status };
  } catch { return { ...err('UPSTREAM_ERROR', '无法连接 Gemini，请检查网络'), mode: 'byok', model, apiKeyConfigured: true }; }
}

// 解释请求走长连接（port）：这样才能把流式片段一块块推给页面；页面断开连接（鼠标移走、关闭弹窗）时取消请求，不浪费额度。
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'explain') return;
  const ac = new AbortController(); let open = true;
  const post = (m) => { if (open) { try { port.postMessage(m); } catch {} } };
  port.onDisconnect.addListener(() => { open = false; ac.abort(); });
  port.onMessage.addListener(async (msg) => {
    const data = await explain(msg.payload, (partial) => post({ partial }), ac.signal);
    post({ done: true, data });
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'ping') reply({ ok: true }); // 预热：内容脚本在悬停早期发来，只为唤醒 worker
  else if (msg?.type === 'health') health().then(reply);
  else if (msg?.type === 'openOptions') chrome.runtime.openOptionsPage().then(() => reply({ ok: true }));
  else return false;
  return true; // 异步回复
});
// 首次安装：打开三步配置引导页。点工具栏图标：还没配置 Key 就去引导页，配置过了去设置页。
const openWelcome = () => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
chrome.runtime.onInstalled.addListener((d) => { if (d.reason === 'install') openWelcome(); });
chrome.action.onClicked.addListener(async () => {
  const s = await settings();
  if (s.mode === 'byok' && !s.geminiApiKey) openWelcome(); else chrome.runtime.openOptionsPage();
});
