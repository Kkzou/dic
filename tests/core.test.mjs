// extension/core.js 单元测试：用 Node 内置 node:test，零依赖。运行：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, normalize, parseGeminiResponse, callGemini, upstreamError, RateLimiter, ERROR_CODES, buildRequest, mockExplain } from '../extension/core.js';

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
