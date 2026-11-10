// DIC 内容脚本。状态机：idle → loading → ready|error → deep-loading → deep-ready
(() => {
  if (window.__dicLoaded) return; window.__dicLoaded = true;
  const rt = globalThis.chrome?.runtime; if (!rt?.id) return;

  const cfg = { trigger: 'hover', dwell: 600, language: 'zh-CN' };
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

  let state = 'idle', seq = 0, cur = null, stack = [], deepDone = new Map(), pinned = false, lastFocus = null;
  let hoverTimer = 0, leaveTimer = 0, deepTimer = 0, hoverWord = '';

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  // 扩展被重载/更新后，旧页面里的内容脚本成为"孤儿"：sendMessage 会同步抛出 "Extension context invalidated"。
  // 必须捕获，否则 Promise 永远不 resolve，骨架屏永远不消失。
  const STALE = { ok: false, code: 'SERVICE_DOWN', message: 'DIC 已更新，请刷新此页面' };
  const DOWN = { ok: false, code: 'SERVICE_DOWN', message: 'DIC 服务未启动' };
  const send = (msg) => new Promise((res) => {
    const once = (cb) => { try { rt.sendMessage(msg, cb); } catch { res(STALE); } };
    once((r) => {
      if (!chrome.runtime.lastError && r) return res(r);
      once((r2) => res(chrome.runtime.lastError || !r2 ? DOWN : r2)); // worker 被唤醒后重试一次
    });
  });

  function place(rect) {
    const w = Math.min(340, innerWidth - 32), gap = 8;
    let x = Math.min(Math.max(16, rect.left), innerWidth - w - 16);
    let y = rect.bottom + gap;
    box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.bottom = '';
    if (!host.isConnected) document.documentElement.append(host);
    const h = box.offsetHeight;
    if (y + h > innerHeight - 8 && rect.top - gap - h > 0) { box.style.top = ''; box.style.bottom = (innerHeight - rect.top + gap) + 'px'; }
  }
  function open(rect) {
    place(rect); requestAnimationFrame(() => box.classList.add('in'));
  }
  function close() {
    if (state === 'idle') return;
    state = 'idle'; seq++; box.classList.remove('in'); host.remove(); stack = []; cur = null; pinned = false;
    clearTimeout(deepTimer); clearTimeout(leaveTimer);
    if (lastFocus?.focus) lastFocus.focus({ preventScroll: true }); lastFocus = null;
  }

  // ---------- 渲染 ----------
  function renderSkeleton(q) {
    box.replaceChildren();
    if (stack.length) box.append(crumb());
    const h = el('div', 'head'); h.append(el('div', 'term', q.term)); box.append(h);
    for (const c of ['w1', 'w2', 'w3', 'w2']) box.append(el('div', 'sk ' + c));
  }
  function crumb() {
    const c = el('div', 'crumb');
    const b = el('button', '', '← ' + stack[stack.length - 1].q.term); b.onclick = back; c.append(b);
    c.append(document.createTextNode(`  第 ${stack.length + 1} 层 / ${MAX_DEPTH}`));
    return c;
  }
  function renderResult(q, r, deep) {
    box.replaceChildren();
    if (stack.length) box.append(crumb());
    const h = el('div', 'head'); h.append(el('div', 'term', r.term || q.term));
    if (r.fullForm) h.append(el('div', 'full', r.fullForm));
    box.append(h, el('div', 'meaning', r.meaningHere));
    if (r.contextLink) box.append(el('div', 'link', r.contextLink));
    if (r.example) box.append(el('div', 'example', r.example));
    if (deep) {
      if (r.details) box.append(el('div', 'details', r.details));
      if (r.relatedConcepts?.length) { const d = el('div', 'related', '相关：'); r.relatedConcepts.forEach((c, i) => { d.append(el('span', '', c)); if (i < r.relatedConcepts.length - 1) d.append(document.createTextNode('　')); }); box.append(d); }
      if (r.followUpQuestions?.length) { const qs = el('div', 'qs'); r.followUpQuestions.forEach((t) => { const b = el('button', '', '↳ ' + t); b.onclick = () => nested(t, q); qs.append(b); }); box.append(qs); }
    } else {
      const f = el('div', 'foot');
      const b = el('button', '', state === 'deep-loading' ? '正在深入…' : '深入理解'); b.disabled = state === 'deep-loading'; b.onclick = () => deepen(q, r);
      f.append(b); box.append(f);
    }
  }
  function renderError(q, e) {
    box.replaceChildren();
    if (stack.length) box.append(crumb());
    const h = el('div', 'head'); h.append(el('div', 'term', q.term)); box.append(h);
    const d = el('div', 'err'); d.append(el('div', 'msg', e.message || '出错了'));
    const f = el('div', 'foot');
    if (e.code === 'SERVICE_DOWN' || e.code === 'NO_API_KEY') { const b = el('button', '', '打开设置'); b.onclick = () => send({ type: 'openOptions' }); f.append(b); }
    if (e.code === 'TIMEOUT' || e.code === 'BAD_MODEL_OUTPUT' || e.code === 'UPSTREAM_ERROR') { const b = el('button', '', '重试'); b.onclick = () => run(q, q._rect, true); f.append(b); }
    d.append(f); box.append(d);
  }

  // ---------- 查询 ----------
  async function run(q, rect, retry) {
    const t0 = performance.now(); const id = ++seq; cur = q; q._rect = rect;
    if (!retry) { state = 'loading'; renderSkeleton(q); open(rect); console.debug(`[DIC] skeleton in ${(performance.now() - t0).toFixed(1)}ms`); }
    else { state = 'loading'; renderSkeleton(q); }
    const r = await send({ type: 'explain', payload: { ...q, depth: 'fast', language: cfg.language, requestId: id } });
    if (id !== seq) return; // 过期响应
    if (r?.ok) { state = 'ready'; q.fast = r.result; renderResult(q, r.result, false); }
    else { state = 'error'; renderError(q, r || { code: 'SERVICE_DOWN', message: 'DIC 服务未启动' }); }
    place(rect);
  }
  async function deepen(q, fast) {
    const key = q.term + '\u241f' + q.sentence;
    if (deepDone.get(key) === 'pending' || state !== 'ready') return;
    deepDone.set(key, 'pending'); state = 'deep-loading'; renderResult(q, fast, false);
    const id = seq;
    const r = await send({ type: 'explain', payload: { ...q, depth: 'deep', language: cfg.language, requestId: id } });
    if (id !== seq) return;
    if (r?.ok) { deepDone.set(key, 'done'); state = 'deep-ready'; renderResult(q, { ...r.result, term: fast.term, meaningHere: fast.meaningHere, contextLink: fast.contextLink, example: fast.example, fullForm: fast.fullForm || r.result.fullForm }, true); }
    else { deepDone.delete(key); state = 'ready'; renderResult(q, fast, false); }
    place(q._rect);
  }
  function nested(term, parent) {
    if (stack.length + 1 >= MAX_DEPTH) { const h = el('div', 'hint', `已到第 ${MAX_DEPTH} 层，请回到页面重新选词。`); box.append(h); return; }
    stack.push({ q: parent, state });
    const parentTerms = stack.slice(-2).map((s) => s.q.term);
    pinned = true;
    run({ term: term.slice(0, 200), sentence: parent.sentence, contextBefore: parent.contextBefore, contextAfter: parent.contextAfter, parentTerms }, parent._rect || box.getBoundingClientRect());
  }
  function back() {
    const prev = stack.pop(); if (!prev) return;
    seq++; state = prev.state === 'deep-ready' ? 'deep-ready' : 'ready'; cur = prev.q;
    renderResult(prev.q, prev.q.fast, state === 'deep-ready'); place(prev.q._rect);
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
    run({ term: word, ...contextOf(node, offset, word.length) }, rect);
  }

  // ---------- 事件 ----------
  document.addEventListener('pointermove', (e) => {
    if (cfg.trigger === 'select') return;
    if (cfg.trigger === 'alt' && !e.altKey) { clearTimeout(hoverTimer); return; }
    if (e.composedPath().includes(host)) { clearTimeout(hoverTimer); return; }
    clearTimeout(hoverTimer);
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
    deepTimer = setTimeout(() => { if (cur?.fast && state === 'ready') deepen(cur, cur.fast); }, 500);
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
