// DIC 内容脚本。状态机：idle → loading → ready|error → deep-loading → deep-ready
(() => {
  if (window.__dicLoaded) return; window.__dicLoaded = true;
  const rt = globalThis.chrome?.runtime; if (!rt?.id) return;

  const cfg = { trigger: 'hover', dwell: 450, language: 'zh-CN' };
  chrome.storage.local.get(cfg).then((s) => Object.assign(cfg, s));
  chrome.storage.onChanged.addListener((c) => { for (const k in c) if (k in cfg) cfg[k] = c[k].newValue; });

  const STOP = new Set('the and for that with this from have were been they their there what when which will would about into more than then them these those some such also only over your just like could other after before because through where while these each most'.split(' '));
  const MAX_DEPTH = 3;

  // ---------- 弹窗（Shadow DOM） ----------
  const host = document.createElement('dic-popup');
  const root = host.attachShadow({ mode: 'open' });
  const box = document.createElement('div');
  box.className = 'dic'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'DIC 解释'); box.tabIndex = -1;
  root.append(box);
  fetch(rt.getURL('content.css')).then((r) => r.text()).then((css) => {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(css); root.adoptedStyleSheets = [sheet];
  });

  // 一次查询 q 的形状：{ term, kind:'term'|'question', sentence, contextBefore, contextAfter, parentTerms, fast, deep, _rect }
  let state = 'idle', seq = 0, cur = null, stack = [], pinned = false, lastFocus = null, side = 'below', live = null;
  let hoverTimer = 0, leaveTimer = 0, deepTimer = 0, hoverWord = '';

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // ---------- 与 service worker 通信 ----------
  // 扩展被重载/更新后，旧页面里的内容脚本成为"孤儿"：调用 chrome.runtime 会同步抛出 "Extension context invalidated"，必须捕获。
  const STALE = { ok: false, code: 'SERVICE_DOWN', message: 'DIC 已更新，请刷新此页面' };
  const DOWN = { ok: false, code: 'SERVICE_DOWN', message: 'DIC 服务未启动' };
  const send = (msg) => new Promise((res) => {
    try { rt.sendMessage(msg, (r) => res(chrome.runtime.lastError || !r ? DOWN : r)); } catch { res(STALE); }
  });
  // 解释请求走长连接（port）：worker 边收到模型输出边推 partial 过来；同一时间只保留一个请求，新的会取消旧的。
  function cancelLive() { const l = live; live = null; l?.finish({ ok: false, code: 'TIMEOUT', cancelled: true }); }
  function ask(payload, onPartial) {
    cancelLive();
    return new Promise((res) => {
      let port, settled = false;
      const me = { finish(v) { if (settled) return; settled = true; if (live === me) live = null; try { port?.disconnect(); } catch {} res(v); } };
      try { port = rt.connect({ name: 'explain' }); } catch { return res(STALE); }
      live = me;
      port.onMessage.addListener((m) => { if (m.partial) onPartial?.(m.partial); else if (m.done) me.finish(m.data || DOWN); });
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; me.finish(DOWN); });
      try { port.postMessage({ payload }); } catch { me.finish(STALE); }
    });
  }
  const pay = (q, depth, id) => ({ term: q.term, kind: q.kind || 'term', sentence: q.sentence, contextBefore: q.contextBefore, contextAfter: q.contextAfter, parentTerms: q.parentTerms, depth, language: cfg.language, requestId: id });

  // ---------- 定位 ----------
  // 打开时决定一次放在词的下方还是上方（哪边放得下放哪边），之后内容变长也不再翻面，只在自己内部滚动，所以不会闪、不会跑出屏幕。
  function place(rect, fresh) {
    const gap = 8, m = 12, w = Math.min(360, innerWidth - 32);
    const below = innerHeight - rect.bottom - gap - m, above = rect.top - gap - m;
    if (fresh) side = below >= 440 || below >= above ? 'below' : 'above';
    box.style.left = Math.min(Math.max(16, rect.left), innerWidth - w - 16) + 'px';
    box.style.maxHeight = Math.max(120, side === 'below' ? below : above) + 'px';
    if (side === 'below') { box.style.top = rect.bottom + gap + 'px'; box.style.bottom = ''; }
    else { box.style.top = ''; box.style.bottom = innerHeight - rect.top + gap + 'px'; }
    if (!host.isConnected) document.documentElement.append(host);
  }
  function close() {
    if (state === 'idle') return;
    state = 'idle'; seq++; cancelLive(); box.classList.remove('in'); host.remove(); stack = []; cur = null; pinned = false;
    clearTimeout(deepTimer); clearTimeout(leaveTimer);
    try { speechSynthesis.cancel(); } catch {}
    if (lastFocus?.focus) lastFocus.focus({ preventScroll: true }); lastFocus = null;
  }

  // ---------- 渲染（全部用 textContent / DOM API，不用 innerHTML） ----------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // 朗读按钮：用浏览器自带的语音合成（Web Speech API），不联网、不花额度。第一次正常语速，再点一次慢速，交替。
  function speaker(q, text) {
    const b = el('button', 'say'); b.title = '朗读（再点一次慢速）'; b.setAttribute('aria-label', '朗读');
    const s = document.createElementNS(SVG_NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '15'); s.setAttribute('height', '15'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('fill', 'currentColor');
    p.setAttribute('d', 'M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z');
    s.append(p); b.append(s);
    b.onclick = () => {
      try { const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = q._slow ? 0.6 : 0.95; q._slow = !q._slow; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
    };
    return b;
  }
  function crumb() {
    const c = el('div', 'crumb');
    const prev = stack[stack.length - 1].term;
    const b = el('button', '', '← ' + (prev.length > 24 ? prev.slice(0, 24) + '…' : prev)); b.onclick = back; c.append(b);
    c.append(document.createTextNode(`  第 ${stack.length + 1} 层 / ${MAX_DEPTH}`));
    return c;
  }
  function header(q, r) {
    const h = el('div', 'head');
    if (q.kind === 'question') { h.append(el('div', 'term question', q.term)); return h; } // 追问：标题始终是问题本身
    const term = r?.term || q.term;
    h.append(el('div', 'term', term));
    if (/[A-Za-z]/.test(term) && 'speechSynthesis' in window) h.append(speaker(q, term));
    if (r?.pronunciation) h.append(el('div', 'pron', r.pronunciation));
    if (r?.fullForm) h.append(el('div', 'full', r.fullForm));
    return h;
  }
  const skeleton = (...ws) => ws.map((c) => el('div', 'sk ' + c));
  // mode：'partial' 正在流式生成 | 'fast' 短解释完成 | 'deep-loading' 正在取深入内容 | 'deep' 深入内容完成
  function render(q, r, mode) {
    box.replaceChildren();
    if (stack.length) box.append(crumb());
    box.append(header(q, r));
    if (!r?.meaningHere) { box.append(...skeleton('w2', 'w3', 'w2')); return; }
    box.append(el('div', 'meaning', r.meaningHere));
    if (r.contextLink) box.append(el('div', 'link', r.contextLink));
    if (r.example) box.append(el('div', 'example', r.example));
    if (r.details) box.append(el('div', 'details', r.details));
    if (r.relatedConcepts?.length) { const d = el('div', 'related', '相关：'); r.relatedConcepts.forEach((c, i) => { d.append(el('span', '', c)); if (i < r.relatedConcepts.length - 1) d.append(document.createTextNode('　')); }); box.append(d); }
    if (r.followUpQuestions?.length) { const qs = el('div', 'qs'); r.followUpQuestions.forEach((t) => { const b = el('button', '', '↳ ' + t); b.onclick = () => nested(t, q, 'question'); qs.append(b); }); box.append(qs); }
    if (mode === 'partial') box.append(...skeleton('w3'));
    if (q.kind !== 'question' && (mode === 'fast' || mode === 'deep-loading')) {
      const f = el('div', 'foot');
      const b = el('button', '', mode === 'deep-loading' ? '正在深入…' : '深入理解'); b.disabled = mode === 'deep-loading'; b.onclick = () => deepen(q);
      f.append(b); box.append(f);
    }
  }
  function renderError(q, e) {
    box.replaceChildren();
    if (stack.length) box.append(crumb());
    box.append(header(q, null));
    const d = el('div', 'err'); d.append(el('div', 'msg', e.message || '出错了'));
    const f = el('div', 'foot');
    if (e.code === 'SERVICE_DOWN' || e.code === 'NO_API_KEY') { const b = el('button', '', '打开设置'); b.onclick = () => send({ type: 'openOptions' }); f.append(b); }
    if (e.code === 'TIMEOUT' || e.code === 'BAD_MODEL_OUTPUT' || e.code === 'UPSTREAM_ERROR' || e.code === 'RATE_LIMITED') { const b = el('button', '', '重试'); b.onclick = () => run(q, q._rect, false); f.append(b); }
    d.append(f); box.append(d);
  }

  // ---------- 查询 ----------
  async function run(q, rect, fresh) {
    const t0 = performance.now(); const id = ++seq; cur = q; q._rect = rect; state = 'loading';
    render(q, null, 'partial'); box.scrollTop = 0; place(rect, fresh);
    requestAnimationFrame(() => box.classList.add('in'));
    console.debug(`[DIC] skeleton in ${(performance.now() - t0).toFixed(1)}ms`);
    const r = await ask(pay(q, 'fast', id), (p) => { if (id === seq && p.meaningHere) render(q, p, 'partial'); });
    if (id !== seq) return; // 过期响应
    if (r?.ok) { state = 'ready'; q.fast = r.result; render(q, q.fast, 'fast'); }
    else { state = 'error'; renderError(q, r || DOWN); }
  }
  async function deepen(q) {
    if (q.kind === 'question' || q.deep || q._deepPending || state !== 'ready' || !q.fast) return;
    q._deepPending = true; state = 'deep-loading'; render(q, q.fast, 'deep-loading');
    const id = seq, f = q.fast;
    // 深入内容只取新增的三项，短解释部分沿用已有的（界面不跳动，模型也不用重写一遍）
    const merge = (d) => ({ ...f, fullForm: f.fullForm || d.fullForm || '', pronunciation: f.pronunciation || d.pronunciation || '', details: d.details || '', relatedConcepts: d.relatedConcepts || [], followUpQuestions: d.followUpQuestions || [] });
    const r = await ask(pay(q, 'deep', id), (p) => { if (id === seq && p.details) render(q, merge({ details: p.details }), 'partial'); });
    q._deepPending = false;
    if (id !== seq) return;
    if (r?.ok) { q.deep = merge(r.result); state = 'deep-ready'; render(q, q.deep, 'deep'); }
    else { state = 'ready'; render(q, f, 'fast'); }
  }
  // 往下一层：kind='term' 解释弹窗里选中的词；kind='question' 回答一个追问
  function nested(term, parent, kind = 'term') {
    if (stack.length + 1 >= MAX_DEPTH) { if (!box.querySelector('.hint')) box.append(el('div', 'hint', `已到第 ${MAX_DEPTH} 层，请回到页面重新选词。`)); return; }
    stack.push(parent); pinned = true;
    run({ term: term.slice(0, 200), kind, sentence: parent.sentence, contextBefore: parent.contextBefore, contextAfter: parent.contextAfter, parentTerms: stack.slice(-2).map((p) => p.term) }, parent._rect || box.getBoundingClientRect(), false);
  }
  // 返回上一层：上一层如果已经取过深入内容，原样恢复（不退化成短解释）
  function back() {
    const q = stack.pop(); if (!q) return;
    seq++; cancelLive(); cur = q; box.scrollTop = 0;
    if (q.deep) { state = 'deep-ready'; render(q, q.deep, 'deep'); }
    else if (q.fast) { state = 'ready'; render(q, q.fast, 'fast'); }
    else run(q, q._rect, false);
  }

  // ---------- 取词与上下文 ----------
  const BLOCK = 'p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,dd,dt,figcaption,article,section,div,body';
  function isEditable(n) { const e = n?.nodeType === 1 ? n : n?.parentElement; return !!e?.closest('input,textarea,[contenteditable=""],[contenteditable="true"]'); }
  function contextOf(node, offset, len) {
    const block = (node.nodeType === 1 ? node : node.parentElement)?.closest(BLOCK) || document.body;
    const full = block.textContent.replace(/\s+/g, ' ');
    // 定位选区在 block 文本中的位置
    let pos = 0; const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) { if (t === node) { pos += offset; break; } pos += t.textContent.length; }
    const compact = block.textContent.slice(0, pos).replace(/\s+/g, ' ').length;
    const s = Math.max(0, full.lastIndexOf('. ', compact), full.lastIndexOf('。', compact), full.lastIndexOf('! ', compact), full.lastIndexOf('? ', compact));
    const eCand = [full.indexOf('. ', compact + len), full.indexOf('。', compact + len), full.indexOf('! ', compact + len), full.indexOf('? ', compact + len)].filter((i) => i >= 0);
    const e = eCand.length ? Math.min(...eCand) + 1 : full.length;
    const sentence = full.slice(s ? s + 1 : 0, e).trim().slice(0, 500);
    return { sentence, contextBefore: full.slice(Math.max(0, s - 400), s).trim(), contextAfter: full.slice(e, e + 400).trim() };
  }
  const wordRe = /[A-Za-z][A-Za-z0-9.\-']*[A-Za-z0-9]|[A-Za-z]/g;
  function candidate(w) {
    if (w.length < 2 || w.length > 40) return false;
    if (/^[A-Z][A-Z0-9.]+$/.test(w)) return true; // 缩写
    if (/[a-z][A-Z]|[A-Z]{2}|[A-Za-z]\d/.test(w)) return true; // 大小写混排或带数字的术语：CoWoS、eVTOL、GPUs、EaaS、HBM3E
    if (/^[A-Z][a-z]+$/.test(w) && w.length >= 5) return true; // 专名/首字母大写词
    return /^[a-z][a-z\-']+$/.test(w) && w.length >= 5 && !STOP.has(w.toLowerCase());
  }
  function wordAt(x, y) {
    const p = document.caretPositionFromPoint?.(x, y) || (() => { const r = document.caretRangeFromPoint?.(x, y); return r && { offsetNode: r.startContainer, offset: r.startOffset }; })();
    if (!p || p.offsetNode.nodeType !== 3 || isEditable(p.offsetNode)) return null;
    const text = p.offsetNode.textContent; let m;
    wordRe.lastIndex = 0;
    while ((m = wordRe.exec(text))) if (m.index <= p.offset && p.offset <= m.index + m[0].length) {
      const range = document.createRange(); range.setStart(p.offsetNode, m.index); range.setEnd(p.offsetNode, m.index + m[0].length);
      return { word: m[0], node: p.offsetNode, offset: m.index, rect: range.getBoundingClientRect() };
    }
    return null;
  }
  function trigger(word, node, offset, rect, sel) {
    if (!word || word.length > 200 || /^[\s\p{P}\d]+$/u.test(word)) return;
    lastFocus = document.activeElement; stack = []; pinned = !!sel;
    run({ term: word, kind: 'term', ...contextOf(node, offset, word.length) }, rect, true);
  }

  // ---------- 事件 ----------
  // 预热：MV3 service worker 空闲 30 s 会被杀，唤醒要 100–300 ms。鼠标在候选词上停 200 ms 就先 ping 一下，
  // 等 600 ms 真正触发时 worker 已经醒了。20 s 内只 ping 一次。
  let warmTimer = 0, lastWarm = 0;
  const prewarm = (x, y) => {
    if (Date.now() - lastWarm < 20000) return;
    const w = wordAt(x, y); if (!w || !candidate(w.word)) return;
    lastWarm = Date.now(); send({ type: 'ping' });
  };
  document.addEventListener('pointermove', (e) => {
    if (cfg.trigger === 'select') return;
    if (cfg.trigger === 'alt' && !e.altKey) { clearTimeout(hoverTimer); clearTimeout(warmTimer); return; }
    if (e.composedPath().includes(host)) { clearTimeout(hoverTimer); clearTimeout(warmTimer); return; }
    clearTimeout(hoverTimer); clearTimeout(warmTimer);
    if (state === 'idle') warmTimer = setTimeout(() => prewarm(e.clientX, e.clientY), 200);
    hoverTimer = setTimeout(() => {
      const w = wordAt(e.clientX, e.clientY);
      if (!w || !candidate(w.word)) return;
      if (state !== 'idle' && cur?.term === w.word) return;
      if (pinned) return;
      hoverWord = w.word; trigger(w.word, w.node, w.offset, w.rect, false);
    }, cfg.trigger === 'alt' ? 150 : cfg.dwell);
  }, { passive: true });

  function readSelection() {
    const sel = root.getSelection ? root.getSelection() : document.getSelection();
    const insidePopup = sel && sel.rangeCount && host.isConnected && box.contains(sel.anchorNode);
    const s = insidePopup ? sel : document.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const text = s.toString().trim(); if (!text || text.length > 200) return;
    const r = s.getRangeAt(0);
    if (insidePopup) { if (cur) nested(text, cur); s.removeAllRanges(); return; }
    if (isEditable(r.startContainer)) return;
    trigger(text, r.startContainer, r.startOffset, r.getBoundingClientRect(), true);
  }
  document.addEventListener('pointerup', () => requestAnimationFrame(readSelection), true);
  document.addEventListener('keyup', (e) => { if (e.key?.startsWith('Arrow') && e.shiftKey) readSelection(); });

  document.addEventListener('pointerdown', (e) => {
    if (e.composedPath().includes(host)) { pinned = true; return; }
    if (state !== 'idle') close();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state !== 'idle') { e.stopPropagation(); close(); } }, true);
  window.addEventListener('scroll', () => { if (state !== 'idle' && !pinned) close(); }, { passive: true });

  // 悬停模式：指针离开词和弹窗一段时间后自动收起；进入弹窗 500ms 后预取 Deep（每个查询一次）
  const cancelClose = () => { clearTimeout(leaveTimer); leaveTimer = 0; };
  const scheduleClose = () => { if (pinned || leaveTimer) return; leaveTimer = setTimeout(() => { leaveTimer = 0; if (!pinned && !box.matches(':hover')) close(); }, 900); };
  box.addEventListener('pointerenter', () => {
    cancelClose();
    deepTimer = setTimeout(() => { if (cur?.fast && state === 'ready') deepen(cur); }, 500);
  });
  box.addEventListener('pointerleave', () => {
    clearTimeout(deepTimer); scheduleClose();
  });
  document.addEventListener('pointermove', (e) => {
    if (state === 'idle' || pinned || e.composedPath().includes(host)) return;
    const w = wordAt(e.clientX, e.clientY);
    if (w && w.word === hoverWord) cancelClose(); else scheduleClose();
  }, { passive: true });
})();
