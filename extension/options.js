const $ = (id) => document.getElementById(id);
const defaults = { trigger: 'hover', dwell: 600, language: 'zh-CN' };
chrome.storage.local.get(defaults).then((s) => { $('trigger').value = s.trigger; $('dwell').value = s.dwell; $('language').value = s.language; });
for (const id of ['trigger', 'language']) $(id).addEventListener('change', () => chrome.storage.local.set({ [id]: $(id).value }));
$('dwell').addEventListener('change', () => chrome.storage.local.set({ dwell: Math.min(2000, Math.max(200, Number($('dwell').value) || 600)) }));
async function check() {
  $('status').textContent = '检查中…';
  const r = await chrome.runtime.sendMessage({ type: 'health' });
  $('status').textContent = r?.ok
    ? `已连接 ✓  模型：${r.model}\nAPI Key：${r.apiKeyConfigured ? '已配置' : '未配置 —— 请创建 .env.local 并重启服务'}`
    : '未连接 —— DIC 服务未启动';
}
$('check').addEventListener('click', check); check();
