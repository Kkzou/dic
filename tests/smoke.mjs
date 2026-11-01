// DIC 网关 smoke 测试：以 mock 模式启动网关，验证 /health、/explain 校验、CORS 与错误码。零依赖。
// 运行：node tests/smoke.mjs   （或 npm test）
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 18787;
const BASE = `http://127.0.0.1:${PORT}`;
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };

const server = spawn(process.execPath, ['server/server.mjs'], {
  env: { ...process.env, LLM_PROVIDER: 'mock', PORT: String(PORT), GEMINI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', () => {});

try {
  let up = false;
  for (let i = 0; i < 30 && !up; i++) { try { up = (await fetch(`${BASE}/health`)).ok; } catch { await sleep(100); } }
  check('网关在 3 秒内启动', up);

  const health = await (await fetch(`${BASE}/health`, { headers: { origin: EXT } })).json();
  check('/health 返回 ok + provider=mock', health.ok === true && health.provider === 'mock', JSON.stringify(health));

  const post = (body, origin = EXT, ct = 'application/json') => fetch(`${BASE}/explain`, {
    method: 'POST', headers: { 'content-type': ct, origin }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  let r = await post({ term: 'HBM', sentence: 'HBM stacks DRAM dies vertically.', contextBefore: '', contextAfter: '', depth: 'fast', requestId: 7 });
  let j = await r.json();
  check('/explain fast 返回 200 且字段齐全', r.status === 200 && j.ok && j.requestId === 7 && j.result.term === 'HBM' && typeof j.result.meaningHere === 'string');
  check('CORS 放行扩展来源', r.headers.get('access-control-allow-origin') === EXT);

  r = await post({ term: 'HBM', sentence: 'x', depth: 'deep' }); j = await r.json();
  check('/explain deep 带 details/relatedConcepts/followUpQuestions', j.ok && j.result.details && j.result.relatedConcepts.length > 0 && j.result.followUpQuestions.length > 0);

  r = await post({ sentence: 'no term' }); j = await r.json();
  check('缺 term → 400 BAD_REQUEST', r.status === 400 && j.code === 'BAD_REQUEST');

  r = await post({ term: 'x'.repeat(201) }); j = await r.json();
  check('term 超长 → 400 BAD_REQUEST', r.status === 400 && j.code === 'BAD_REQUEST');

  r = await post('{not json'); j = await r.json();
  check('非法 JSON → 400 BAD_REQUEST', r.status === 400 && j.code === 'BAD_REQUEST');

  r = await post({ term: 'HBM' }, EXT, 'text/plain'); j = await r.json();
  check('非 JSON content-type → 400', r.status === 400 && j.code === 'BAD_REQUEST');

  r = await post({ term: 'HBM' }, 'https://evil.example');
  check('陌生来源不返回 CORS 头', !r.headers.get('access-control-allow-origin'));

  r = await fetch(`${BASE}/explain`, { method: 'OPTIONS', headers: { origin: EXT } });
  check('预检 OPTIONS → 204', r.status === 204);

  r = await fetch(`${BASE}/nope`); j = await r.json();
  check('未知路径 → 404 BAD_REQUEST', r.status === 404 && j.code === 'BAD_REQUEST');

  const CODES = new Set(['BAD_REQUEST', 'NO_API_KEY', 'RATE_LIMITED', 'TIMEOUT', 'UPSTREAM_ERROR', 'BAD_MODEL_OUTPUT', 'SERVICE_DOWN']);
  check('错误码属于固定枚举', CODES.has(j.code));
} finally {
  server.kill();
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
