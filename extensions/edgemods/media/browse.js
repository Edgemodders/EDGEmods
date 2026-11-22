// The EDGEmods side panel. It draws what the extension sends, with textContent only (mod names and summaries come
// from strangers), and asks the extension for everything else: it calls no site itself.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = (s) => document.querySelector(s);
  const q = $('#q');
  const pills = $('.pills');
  const chips = $('.chips');
  const count = $('.count');
  const rows = $('.rows');
  const more = $('.more');

  const LISTS = [
    ['relevance', 'Best match'],
    ['updated', 'Updated'],
    ['new', 'New'],
    ['downloads', 'Most downloaded'],
    ['likes', 'Most liked'],
    ['liked', 'Your likes'],
  ];
  // The site's words for the types (packages/server/src/words.ts).
  const TYPES = {
    gameplay: 'Gameplay', visual: 'Visual', characters: 'Characters', clothing: 'Clothing', weapons: 'Weapons', vehicles: 'Vehicles',
    audio: 'Audio', ui: 'UI', world: 'World', quests: 'Quests', utility: 'Utility', 'modding-resource': 'Modding resource', other: 'Other',
  };

  let filters = { q: '', list: 'updated', type: [], tag: [] };
  let timer;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function send(moreToo) {
    vscode.postMessage({ type: 'search', filters, more: Boolean(moreToo) });
  }

  function drawPills() {
    pills.replaceChildren();
    for (const [key, label] of LISTS) {
      if (key === 'relevance' && !filters.q.trim()) continue;
      const b = el('button', 'pill', label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(filters.list === key));
      b.addEventListener('click', () => {
        filters.list = key;
        drawPills();
        send();
      });
      pills.append(b);
    }
  }

  function drawChips() {
    chips.replaceChildren();
    const add = (label, drop) => {
      const c = el('button', 'chip', label + ' ×');
      c.type = 'button';
      c.title = 'Remove';
      c.addEventListener('click', () => { drop(); drawChips(); send(); });
      chips.append(c);
    };
    filters.type.forEach((t) => add(TYPES[t] || t, () => { filters.type = filters.type.filter((x) => x !== t); }));
    filters.tag.forEach((t) => add(t, () => { filters.tag = filters.tag.filter((x) => x !== t); }));
  }

  function ago(iso) {
    const d = Date.parse(iso || '');
    if (isNaN(d)) return '';
    const days = Math.floor((Date.now() - d) / 86400000);
    if (days < 1) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 30) return days + ' days ago';
    if (days < 365) return Math.floor(days / 30) + ' mo ago';
    return Math.floor(days / 365) + ' y ago';
  }

  function row(c) {
    const a = el('a', 'row');
    a.href = '#';
    a.title = c.name;
    a.addEventListener('click', (e) => { e.preventDefault(); vscode.postMessage({ type: 'open', id: c.id }); });
    const thumb = el('span', 'thumb');
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = c.image;
    img.addEventListener('error', () => img.remove());
    thumb.append(img);
    const txt = el('span', 'txt');
    const name = el('b', 'nm', c.name);
    const by = el('small', 'by', 'by ' + c.author);
    const sum = el('span', 'sum', c.summary);
    const stats = el('span', 'stats');
    const flags = [];
    if (c.runsCode) flags.push(el('span', 'tag r', 'Runs code'));
    if (c.adult) flags.push(el('span', 'tag r', '18+'));
    stats.append(...flags, el('span', '', 'v' + c.version), el('span', '', '↓ ' + c.downloads.toLocaleString('en')), el('span', '', '♥ ' + c.likes.toLocaleString('en')), el('span', '', ago(c.lastUpdated)));
    txt.append(name, by, sum, stats);
    a.append(thumb, txt);
    return a;
  }

  function note(text, button) {
    const p = el('p', 'empty', text);
    if (button) {
      const b = el('button', 'btn sm go', button.label);
      b.type = 'button';
      b.addEventListener('click', button.run);
      p.append(document.createElement('br'), b);
    }
    rows.replaceChildren(p);
    count.textContent = '';
    more.hidden = true;
  }

  q.addEventListener('input', () => {
    clearTimeout(timer);
    const had = filters.q.trim();
    filters.q = q.value;
    // Words typed: best match first, unless another list was picked; words gone: back from best match.
    if (!had && filters.q.trim() && filters.list === 'updated') filters.list = 'relevance';
    if (!filters.q.trim() && filters.list === 'relevance') filters.list = 'updated';
    drawPills();
    timer = setTimeout(send, 250);
  });
  more.addEventListener('click', () => send(true));
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act="site"]');
    if (a) { e.preventDefault(); vscode.postMessage({ type: 'site' }); }
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'filters') {
      filters = { q: m.filters.q || '', list: m.filters.list || 'updated', type: m.filters.type || [], tag: m.filters.tag || [] };
      q.value = filters.q;
      drawPills();
      drawChips();
    } else if (m.type === 'busy') {
      if (!m.more) count.textContent = 'Looking…';
      more.disabled = true;
    } else if (m.type === 'results') {
      more.disabled = false;
      count.textContent = m.total === 1 ? '1 mod' : m.total.toLocaleString('en') + ' mods';
      if (!m.cards.length && !m.append) return note(m.empty);
      const items = m.cards.map(row);
      if (m.append) rows.append(...items);
      else rows.replaceChildren(...items);
      more.hidden = m.page >= m.pages;
    } else if (m.type === 'signedOut') {
      note('Sign in to see the mods you like.', { label: 'Sign in', run: () => vscode.postMessage({ type: 'signIn' }) });
    } else if (m.type === 'error') {
      more.disabled = false;
      note(m.message, { label: 'Try again', run: () => send() });
    }
  });

  drawPills();
  vscode.postMessage({ type: 'ready' });
})();
