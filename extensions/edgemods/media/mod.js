// A mod's page in an editor tab. Tabs and pictures switch here; every link, button and form goes to the extension as
// a message, written as it is in the page, and the extension decides what it may do. Nothing is followed in here.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const mod = document.body.dataset.mod;

  function showTab(key) {
    const tabs = document.querySelectorAll('[data-tab]');
    if (![].some.call(tabs, (t) => t.dataset.tab === key)) return;
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === key)));
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== key; });
    vscode.setState({ id: mod, tab: key });
  }
  // The tab the extension asked for, or the one this tab showed last (after Refresh, or when VS Code reopens it).
  const saved = vscode.getState();
  const wanted = document.body.dataset.tab || (saved && saved.id === mod ? saved.tab : undefined);
  if (wanted) showTab(wanted);
  else vscode.setState({ id: mod });

  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) {
      e.preventDefault();
      vscode.postMessage({ type: 'act', act: act.dataset.act, version: act.dataset.version });
      return;
    }
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      e.preventDefault();
      showTab(tab.dataset.tab);
      return;
    }
    const shot = e.target.closest('[data-shot]');
    if (shot) {
      e.preventDefault();
      const main = document.getElementById('galleryMain');
      const caption = document.getElementById('galleryCaption');
      if (main) main.src = shot.dataset.shot;
      if (caption) caption.textContent = shot.dataset.caption || '';
      document.querySelectorAll('[data-shot]').forEach((t) => t.setAttribute('aria-current', String(t === shot)));
      return;
    }
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    // In-page: the Files tab from Manual download, and anchors.
    if (href.startsWith('?')) {
      e.preventDefault();
      const key = new URLSearchParams(href.split('#')[0]).get('tab');
      if (key) showTab(key);
      return;
    }
    if (href.startsWith('#')) return;
    e.preventDefault();
    vscode.postMessage({ type: 'link', href });
  });

  // Middle clicks and the like would open links in a browser of their own; send them the same way.
  document.addEventListener('auxclick', (e) => {
    const a = e.target.closest('a[href]');
    if (a) e.preventDefault();
  });

  document.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.classList.contains('likeform')) {
      const button = form.querySelector('button');
      if (button) button.disabled = true;
      vscode.postMessage({ type: 'like', like: form.querySelector('input[name=like]').value !== '0' });
      return;
    }
    if (/\/report$/.test(form.getAttribute('action') || '')) {
      const reason = form.querySelector('input[name=reason]:checked');
      if (!reason) return;
      const note = form.querySelector('textarea[name=note]');
      vscode.postMessage({ type: 'report', reason: reason.value, note: note ? note.value : '' });
    }
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'tab') showTab(m.tab);
    if (m.type === 'liked') {
      document.querySelectorAll('form.likeform').forEach((form) => {
        const button = form.querySelector('button');
        if (button) button.disabled = false;
        if (m.failed) return;
        form.querySelector('input[name=like]').value = m.liked ? '0' : '1';
        if (button) {
          button.setAttribute('aria-pressed', String(m.liked));
          button.title = m.liked ? 'Unlike' : 'Like';
        }
        const n = form.querySelector('.n');
        if (n) n.textContent = m.likes.toLocaleString('en');
        const w = form.querySelector('.w');
        if (w) w.textContent = m.liked ? 'Liked' : 'Like';
      });
    }
  });
})();
