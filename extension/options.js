const $ = (id) => document.getElementById(id);
const defaults = { mode: 'byok', geminiApiKey: '', geminiModel: '', trigger: 'hover', dwell: 600, language: 'zh-CN' };

chrome.storage.local.get(defaults).then((s) => {
  $('mode').value = s.mode; $('apiKey').value = s.geminiApiKey; $('model').value = s.geminiModel;
  $('trigger').value = s.trigger; $('dwell').value = s.dwell; $('language').value = s.language;
  showMode(s.mode); check();
});

function showMode(mode) {
  $('byokBox').classList.toggle('hidden', mode !== 'byok');
  $('gatewayBox').classList.toggle('hidden', mode !== 'gateway');
}
$('mode').addEventListener('change', async () => { await chrome.storage.local.set({ mode: $('mode').value }); showMode($('mode').value); check(); });
$('apiKey').addEventListener('change', async () => { await chrome.storage.local.set({ geminiApiKey: $('apiKey').value.trim() }); check(); });
$('model').addEventListener('change', async () => { await chrome.storage.local.set({ geminiModel: $('model').value.trim() }); check(); });
$('toggleKey').addEventListener('click', () => {
  const pw = $('apiKey').type === 'password'; $('apiKey').type = pw ? 'text' : 'password'; $('toggleKey').textContent = pw ? '隐藏' : '显示';
});
for (const id of ['trigger', 'language']) $(id).addEventListener('change', () => chrome.storage.local.set({ [id]: $(id).value }));
$('dwell').addEventListener('change', () => chrome.storage.local.set({ dwell: Math.min(2000, Math.max(200, Number($('dwell').value) || 600)) }));

async function check() {
  const st = $('status'); st.className = ''; st.textContent = '检查中…';
  const r = await chrome.runtime.sendMessage({ type: 'health' });
  if (r?.ok) {
    st.className = 'ok';
    st.textContent = r.mode === 'gateway'
      ? `已连接本机网关 ✓  模型：${r.model}\nAPI Key：${r.apiKeyConfigured ? '已配置' : '未配置 —— 请创建 .env.local 并重启网关'}`
      : `已连接 Gemini ✓  模型：${r.model}`;
    return;
  }
  st.className = 'bad';
  const tips = {
    NO_API_KEY: r?.mode === 'gateway' ? '网关未配置 Key —— 请创建 .env.local 并重启' : (r?.apiKeyConfigured ? 'API Key 无效或没有权限，请重新粘贴' : '请在上方粘贴你的 Gemini API Key'),
    SERVICE_DOWN: '未连接 —— 本机网关未启动，请在仓库目录运行 npm start',
  };
  st.textContent = tips[r?.code] || r?.message || '未连接';
}
$('check').addEventListener('click', check);
