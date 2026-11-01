const src = document.getElementById('src'), doc = document.getElementById('doc');
function render() {
  const text = src.value; doc.replaceChildren();
  for (const para of text.split(/\n{2,}|\r\n\r\n/)) { if (!para.trim()) continue; const p = document.createElement('p'); p.textContent = para.replace(/^#+\s*/gm, '').trim(); doc.append(p); }
  src.hidden = doc.childElementCount > 0;
}
document.getElementById('render').addEventListener('click', render);
document.getElementById('clear').addEventListener('click', () => { src.value = ''; doc.replaceChildren(); src.hidden = false; });
document.getElementById('file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) { src.value = await f.text(); render(); } });
