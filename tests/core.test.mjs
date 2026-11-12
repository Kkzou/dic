// extension/core.js 单元测试：用 Node 内置 node:test，零依赖。运行：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, normalize, parseGeminiResponse, callGemini, streamGemini, partialFromText, buildUserPrompt, upstreamError, RateLimiter, ERROR_CODES, buildRequest, mockExplain } from '../extension/core.js';

const gemini = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const fakeFetch = (responses) => { let i = 0; const calls = []; const fn = async (url, init) => { calls.push({ url, init }); const r = responses[Math.min(i++, responses.length - 1)]; return typeof r === 'function' ? r() : r; }; fn.calls = calls; return fn; };
const okRes = (body) => ({ ok: true, status: 200, json: async () => body });
const badRes = (status) => ({ ok: false, status, json: async () => ({}) });

test('validate：正常输入被裁剪为固定形状', () => {
  const { value } = validate({ term: ' HBM ', sentence: 'x', depth: 'deep', parentTerms: ['a', 'b', 'c'], language: 'zh-CN' });
  assert.equal(value.term, 'HBM'); assert.equal(value.depth, 'deep'); assert.deepEqual(value.parents, ['a', 'b']);
});
test('validate：缺 term / 超长 / 上下文超限 → error', () => {
  assert.ok(validate({}).error); assert.ok(validate({ term: 'x'.repeat(201) }).error);
  assert.ok(validate({ term: 'x', contextBefore: 'a'.repeat(500), contextAfter: 'b'.repeat(400) }).error);
  assert.equal(validate({ term: 'x', depth: 'weird' }).value.depth, 'fast');
});
test('normalize：缺字段补默认、数组截到 3 项、去空白', () => {
  const r = normalize({ meaningHere: '  m ', relatedConcepts: ['a', '', 'b', 'c', 'd'], followUpQuestions: 'nope' }, 'T');
  assert.equal(r.term, 'T'); assert.equal(r.meaningHere, 'm'); assert.deepEqual(r.relatedConcepts, ['a', 'b', 'c']); assert.deepEqual(r.followUpQuestions, []);
  assert.equal(normalize({}, 'T').meaningHere, '（模型未给出解释）');
});
test('parseGeminiResponse：能从带杂质的文本里抠出 JSON；完全不是 JSON → null', () => {
  const dirty = { candidates: [{ content: { parts: [{ text: '```json\n{"term":"X","meaningHere":"ok"}\n```' }] } }] };
  assert.equal(parseGeminiResponse(dirty, 'X').meaningHere, 'ok');
  assert.equal(parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }, 'X'), null);
  assert.equal(parseGeminiResponse({}, 'X'), null);
});
test('buildRequest：带 schema 与 JSON mime，fast/deep token 上限不同', () => {
  const f = buildRequest(validate({ term: 'x' }).value), d = buildRequest(validate({ term: 'x', depth: 'deep' }).value);
  assert.equal(f.generationConfig.responseMimeType, 'application/json'); assert.ok(f.generationConfig.responseSchema.required.includes('meaningHere'));
  assert.ok(d.generationConfig.maxOutputTokens > f.generationConfig.maxOutputTokens);
});
test('upstreamError：状态码映射到固定错误码', () => {
  assert.equal(upstreamError(429).code, 'RATE_LIMITED'); assert.equal(upstreamError(404, 'm').code, 'UPSTREAM_ERROR');
  assert.equal(upstreamError(403).code, 'NO_API_KEY'); assert.equal(upstreamError(500).code, 'UPSTREAM_ERROR');
  assert.equal(upstreamError(400, 'm', 'API key not valid. Please pass a valid API key.').code, 'NO_API_KEY');
  assert.equal(upstreamError(400, 'm', 'Invalid JSON payload received.').code, 'UPSTREAM_ERROR');
  for (const s of [400, 401, 403, 404, 429, 500, 503]) assert.ok(ERROR_CODES.includes(upstreamError(s).code));
});
test('callGemini：成功路径，Key 放在 header 不在 URL', async () => {
  const fetchFn = fakeFetch([okRes(gemini({ term: 'HBM', fullForm: 'High Bandwidth Memory', meaningHere: 'm' }))]);
  const r = await callGemini({ apiKey: 'K', model: 'm', value: validate({ term: 'HBM' }).value, fetchFn });
  assert.equal(r.ok, true); assert.equal(r.result.fullForm, 'High Bandwidth Memory');
  assert.equal(fetchFn.calls[0].init.headers['x-goog-api-key'], 'K'); assert.ok(!fetchFn.calls[0].url.includes('K'));
});
test('callGemini：模型输出坏 JSON 时自动重试一次，第二次成功', async () => {
  const fetchFn = fakeFetch([okRes({ candidates: [{ content: { parts: [{ text: '{"term":"X","meaningHere":"trunc' }] } }] }), okRes(gemini({ term: 'X', meaningHere: 'ok' }))]);
  const r = await callGemini({ apiKey: 'K', model: 'm', value: validate({ term: 'X' }).value, fetchFn });
  assert.equal(r.ok, true); assert.equal(fetchFn.calls.length, 2);
});
test('callGemini：连续两次坏输出 → BAD_MODEL_OUTPUT，不无限重试', async () => {
  const fetchFn = fakeFetch([okRes({ candidates: [{ content: { parts: [{ text: 'junk' }] } }] })]);
  const r = await callGemini({ apiKey: 'K', model: 'm', value: validate({ term: 'X' }).value, fetchFn });
  assert.equal(r.code, 'BAD_MODEL_OUTPUT'); assert.equal(fetchFn.calls.length, 2);
});
test('callGemini：上游 429 / 网络异常 / 超时 → 对应错误码', async () => {
  assert.equal((await callGemini({ apiKey: 'K', model: 'm', value: validate({ term: 'X' }).value, fetchFn: fakeFetch([badRes(429)]) })).code, 'RATE_LIMITED');
  assert.equal((await callGemini({ apiKey: 'K', model: 'm', value: validate({ term: 'X' }).value, fetchFn: async () => { throw new TypeError('fetch failed'); } })).code, 'UPSTREAM_ERROR');
  const timeout = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
  assert.equal((await callGemini({ apiKey: 'K', model: 'm', value: validate({ term: 'X' }).value, fetchFn: timeout })).code, 'TIMEOUT');
});
test('RateLimiter：每分钟 N 次，窗口滑动后恢复', () => {
  const l = new RateLimiter(3); const t = 1_000_000;
  assert.ok(l.take(t)); assert.ok(l.take(t + 1)); assert.ok(l.take(t + 2)); assert.ok(!l.take(t + 3));
  assert.ok(l.take(t + 60_001));
});
test('mockExplain：deep 带追问，fast 不带', () => {
  assert.ok(mockExplain(validate({ term: 'HBM', depth: 'deep' }).value).followUpQuestions.length > 0);
  assert.equal(mockExplain(validate({ term: 'HBM' }).value).followUpQuestions.length, 0);
});

// ---- v0.4：流式、追问、5xx 重试 ----
const enc = new TextEncoder();
const sseRes = (chunks) => ({ ok: true, status: 200, body: { getReader() { let i = 0; return { read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }) }; } } });
const sse = (text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;

test('validate：kind=question → depth 固定为 answer；默认 kind=term', () => {
  const q = validate({ term: '为什么？', kind: 'question', depth: 'deep', parentTerms: ['Geos'] }).value;
  assert.equal(q.kind, 'question'); assert.equal(q.depth, 'answer');
  assert.equal(validate({ term: 'x' }).value.kind, 'term');
  assert.match(buildUserPrompt(q), /用户的追问：为什么？/); assert.match(buildUserPrompt(q), /针对的词：Geos/);
  assert.doesNotMatch(buildUserPrompt(q), /选中：/);
});
test('partialFromText：JSON 没写完也能抠出已有字段，含半截字符串和转义', () => {
  assert.deepEqual(partialFromText('{"term":"HBM","fullForm":"High Band'), { term: 'HBM', fullForm: 'High Band' });
  assert.equal(partialFromText('{"meaningHere":"第一行\\n第二"').meaningHere, '第一行\n第二');
  assert.equal(partialFromText('{"meaningHere":"引号\\"里\\').meaningHere, '引号"里');
  assert.deepEqual(partialFromText('{"ter'), {});
});
test('streamGemini：逐块回调 onPartial，最终结果完整；走的是 streamGenerateContent', async () => {
  const full = JSON.stringify({ term: 'HBM', fullForm: 'High Bandwidth Memory', pronunciation: '/eɪtʃ biː em/', meaningHere: '高带宽内存', contextLink: '', example: '', details: '', relatedConcepts: [], followUpQuestions: [] });
  const cut = [full.slice(0, 30), full.slice(30, 90), full.slice(90)];
  const fetchFn = fakeFetch([sseRes([sse(cut[0]), sse(cut[1]).slice(0, 20), sse(cut[1]).slice(20) + sse(cut[2])])]); // 故意把一个 SSE 事件劈成两个网络包
  const seen = [];
  const r = await streamGemini({ apiKey: 'K', model: 'm', value: validate({ term: 'HBM' }).value, fetchFn, onPartial: (p) => seen.push(p) });
  assert.equal(r.ok, true); assert.equal(r.result.fullForm, 'High Bandwidth Memory'); assert.equal(r.result.pronunciation, '/eɪtʃ biː em/');
  assert.equal(seen.length, 3); assert.equal(seen[0].term, 'HBM'); assert.equal(seen.at(-1).meaningHere, '高带宽内存');
  assert.match(fetchFn.calls[0].url, /:streamGenerateContent\?alt=sse$/);
});
test('streamGemini：流式出意外（5xx / 无 body / 坏 JSON）返回 null 交给非流式兜底；429 与 403 直接报错', async () => {
  const v = validate({ term: 'X' }).value;
  assert.equal(await streamGemini({ apiKey: 'K', model: 'm', value: v, fetchFn: fakeFetch([badRes(503)]) }), null);
  assert.equal(await streamGemini({ apiKey: 'K', model: 'm', value: v, fetchFn: fakeFetch([{ ok: true, status: 200 }]) }), null);
  assert.equal(await streamGemini({ apiKey: 'K', model: 'm', value: v, fetchFn: fakeFetch([sseRes([sse('{"term":"X","meaningHere":"断')])]) }), null);
  assert.equal(await streamGemini({ apiKey: 'K', model: 'm', value: v, fetchFn: async () => { throw new TypeError('net'); } }), null);
  assert.equal((await streamGemini({ apiKey: 'K', model: 'm', value: v, fetchFn: fakeFetch([badRes(429)]) })).code, 'RATE_LIMITED');
  assert.equal((await streamGemini({ apiKey: 'K', model: 'm', value: v, fetchFn: fakeFetch([badRes(403)]) })).code, 'NO_API_KEY');
});
test('streamGemini：被取消（signal aborted）不回退、不重复请求', async () => {
  const ac = new AbortController(); ac.abort();
  const r = await streamGemini({ apiKey: 'K', model: 'm', value: validate({ term: 'X' }).value, signal: ac.signal, fetchFn: async () => { const e = new Error('a'); e.name = 'AbortError'; throw e; } });
  assert.equal(r.code, 'TIMEOUT');
});
test('callGemini：503 自动重试一次后成功；连续 503 报"暂时繁忙"', async () => {
  const ok = fakeFetch([badRes(503), okRes(gemini({ term: 'X', meaningHere: 'ok' }))]);
  const r = await callGemini({ apiKey: 'K', model: 'm', value: validate({ term: 'X' }).value, fetchFn: ok });
  assert.equal(r.ok, true); assert.equal(r.retried, true); assert.equal(ok.calls.length, 2);
  const bad = fakeFetch([badRes(503)]);
  const r2 = await callGemini({ apiKey: 'K', model: 'm', value: validate({ term: 'X' }).value, fetchFn: bad });
  assert.equal(r2.code, 'UPSTREAM_ERROR'); assert.match(r2.message, /繁忙/); assert.equal(bad.calls.length, 2);
});
test('mockExplain：追问返回的 term 是问题本身，且不给全称/音标', () => {
  const r = mockExplain(validate({ term: '为什么要分散？', kind: 'question', parentTerms: ['Geos'] }).value);
  assert.equal(r.term, '为什么要分散？'); assert.equal(r.fullForm, ''); assert.equal(r.pronunciation, ''); assert.ok(r.meaningHere.length > 10);
});
