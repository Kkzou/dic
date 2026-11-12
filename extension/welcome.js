// 三步配置引导页：安装后自动打开；也可从设置页重新进入。
const $ = (id) => document.getElementById(id);
const done = (id, on = true) => $(id).classList.toggle('done', on);
const say = (text, cls = '') => { $('msg').textContent = text; $('msg').className = cls; };

// 错误码 → 这一页上该怎么提示（文案对应 CLAUDE.md 第 12 条的错误码枚举）
const TIPS = {
  NO_API_KEY: '这个密钥无效或没有权限。请回到 Google AI Studio 重新复制完整的密钥再试。',
  UPSTREAM_ERROR: null, // 用后台返回的具体说明（如"无法连接 Gemini，请检查网络"）
  RATE_LIMITED: '请求太频繁，请稍等几秒再试。',
  TIMEOUT: '连接超时，请检查网络后重试。',
};

async function connect() {
  const key = $('key').value.trim();
  if (!key) { say('请先粘贴 API Key。', 'bad'); $('key').focus(); return; }
  if (/\s/.test(key)) { say('密钥中间不应有空格或换行，请重新复制。', 'bad'); return; }
  $('connect').disabled = true; say('正在连接 Gemini…');
  await chrome.storage.local.set({ mode: 'byok', geminiApiKey: key });
  let r;
  try { r = await chrome.runtime.sendMessage({ type: 'health' }); } catch { r = null; }
  $('connect').disabled = false;
  if (r?.ok) {
    done('s1'); done('s2'); done('s3'); say('已连接 Gemini ✓', 'ok');
    $('success').classList.add('show'); $('success').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    done('s3', false); $('success').classList.remove('show');
    say(TIPS[r?.code] || r?.message || '连接失败，请重试。', 'bad');
  }
}

$('open').addEventListener('click', () => done('s1'));
$('key').addEventListener('paste', () => { done('s1'); done('s2'); setTimeout(connect, 0); }); // 粘贴即连接，少点一次
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
$('connect').addEventListener('click', connect);

// 已经配置过（从设置页重新进入）：直接显示当前状态
chrome.storage.local.get({ geminiApiKey: '' }).then((s) => { if (s.geminiApiKey) { $('key').value = s.geminiApiKey; connect(); } });
