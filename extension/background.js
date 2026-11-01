// DIC service worker：扩展里唯一的网络出口（Origin 才是 chrome-extension://），也是缓存所在。
const GATEWAY = 'http://127.0.0.1:8787';
const CACHE_MAX = 100, CACHE_TTL = 24 * 3600 * 1000;
const mem = new Map(); // key -> { t, value }（Map 保持插入顺序，天然可做 LRU）

async function hashKey(o) {
  const data = new TextEncoder().encode([o.term, o.sentence, o.depth, o.language].join('\u241f'));
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

async function explain(payload) {
  const key = await hashKey(payload);
  const cached = await cacheGet(key);
  if (cached) return { ok: true, cached: true, result: cached };
  let res;
  try {
    res = await fetch(`${GATEWAY}/explain`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(16000),
    });
  } catch (e) {
    return e.name === 'TimeoutError' ? { ok: false, code: 'TIMEOUT', message: '请求超时，请重试。' }
      : { ok: false, code: 'SERVICE_DOWN', message: 'DIC 服务未启动' };
  }
  let data;
  try { data = await res.json(); } catch { return { ok: false, code: 'BAD_MODEL_OUTPUT', message: '解析失败，请重试。' }; }
  if (data.ok) cacheSet(key, data.result);
  return data;
}

async function health() {
  try {
    const r = await fetch(`${GATEWAY}/health`, { signal: AbortSignal.timeout(3000) });
    return await r.json();
  } catch { return { ok: false, code: 'SERVICE_DOWN', message: 'DIC 服务未启动' }; }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'explain') explain(msg.payload).then(reply);
  else if (msg?.type === 'health') health().then(reply);
  else if (msg?.type === 'openOptions') chrome.runtime.openOptionsPage().then(() => reply({ ok: true }));
  else return false;
  return true; // 异步回复
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
