// EDGEmods website prototype: renders every page from assets/data.js. No server: the "view as" strip at the top
// switches between a visitor, a player, a modder and an admin, and likes are kept in this browser only.
(function () {
  'use strict';
  const D = window.EDGEMODS_DATA;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const params = new URLSearchParams(location.search);

  // ---- storage (prototype conveniences only; a real site keeps these on the server) ----
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(`edgemods-proto:${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(`edgemods-proto:${key}`, JSON.stringify(value)); } catch { /* private window */ } },
  };

  // ---- who is looking ----
  const PERSONAS = {
    visitor: null,
    player: { key: 'player', name: 'Vee Morales', via: 'Email', email: 'vee.morales@example.com', github: null, admin: false, since: '2026-03-02' },
    modder: { key: 'modder', name: 'Nyx Calloway', via: 'GitHub', email: 'nyx@example.com', github: 'octo-modder', admin: false, since: '2025-11-19' },
    admin: { key: 'admin', name: 'EDGEmods admin', via: 'Email', email: 'admin@example.com', github: null, admin: true, since: '2025-10-01' },
  };
  const ROLE_LABELS = { visitor: 'Visitor', player: 'Player', modder: 'Modder', admin: 'Admin' };
  let role = params.get('as') in PERSONAS ? params.get('as') : store.get('role', 'visitor');
  if (!(role in PERSONAS)) role = 'visitor';
  const me = () => PERSONAS[role];
  const setRole = (r) => { role = r; store.set('role', r); render(); };

  const likes = new Set(store.get('likes', ['clean-hud', 'neon-rain-weather']));
  const settings = store.get('settings', { adult: false });
  // The subscription, per persona: free, active, or ending (cancelled, full speed until the period ends).
  const subs = store.get('subs', { player: 'free', modder: 'active', admin: 'free' });
  const sub = () => (me() ? subs[role] ?? 'free' : 'free');
  const setSub = (v) => { subs[role] = v; store.set('subs', subs); };
  const FREE_SPEED = '2 MB/s';
  const periodEnd = () => date(new Date(D.NOW + 23 * 86400000).toISOString());

  // ---- formatting ----
  const num = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
  const bytes = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const ago = (iso) => {
    const d = (D.NOW - Date.parse(iso)) / 86400000;
    if (d < 1 / 24) return 'just now';
    if (d < 1) return `${Math.round(d * 24)} h ago`;
    if (d < 2) return 'yesterday';
    if (d < 30) return `${Math.round(d)} days ago`;
    if (d < 365) return `${Math.round(d / 30)} months ago`;
    return `${Math.round(d / 365)} years ago`;
  };
  const date = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const daysOld = (iso) => (D.NOW - Date.parse(iso)) / 86400000;

  const TYPES = {
    gameplay: ['Gameplay', '#fcee0a'], visual: ['Visual', '#19f3ff'], characters: ['Characters', '#ff9ad5'], clothing: ['Clothing', '#ffb86b'],
    weapons: ['Weapons', '#ff2a52'], vehicles: ['Vehicles', '#fcee0a'], audio: ['Audio', '#5dffa1'], ui: ['UI', '#19f3ff'],
    world: ['World', '#5dffa1'], quests: ['Quests', '#ff9ad5'], utility: ['Utility', '#c3c9d8'], 'modding-resource': ['Modding resource', '#ffb86b'], other: ['Other', '#8a93a8'],
  };
  const KIND_LABELS = {
    plugin: 'Game plugins (.dll)', program: 'Programs (.exe and similar)', redscript: 'redscript scripts', cet: 'Cyber Engine Tweaks scripts',
    archive: 'Game archives', tweak: 'Tweaks', audio: 'Sound files', 'nested-archive': 'Archives inside the download', other: 'Other files',
  };
  const ICON = {
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v12M6 11l6 6 6-6M5 20h14"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>',
    vscode: '<svg viewBox="0 0 24 24"><path d="M17 3l4 2v14l-4 2-10-9 10-9z M17 3v18 M3 9l4 3-4 3"/></svg>',
    git: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 8v8M8 6h4a6 6 0 0 1 6 3"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };

  // ---- card art: a deterministic Night City skyline per mod, in its type's colour ----
  function rng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }
  function art(mod, variant = 0, ratio = 2) {
    const W = 400, H = Math.round(W / ratio);
    const r = rng(`${mod.id}:${variant}`);
    const c = TYPES[mod.type]?.[1] ?? '#19f3ff';
    const gid = `g${Math.floor(r() * 1e9)}`;
    const horizon = H * (0.56 + r() * 0.12);
    let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`;
    s += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0d13"/><stop offset="1" stop-color="${c}" stop-opacity=".22"/></linearGradient></defs>`;
    s += `<rect width="${W}" height="${H}" fill="url(#${gid})"/>`;
    const sunX = W * (0.25 + r() * 0.5), sunR = H * (0.16 + r() * 0.12);
    s += `<circle cx="${sunX}" cy="${horizon - sunR * 0.35}" r="${sunR}" fill="${c}" fill-opacity=".18"/>`;
    for (let i = 0; i < 4; i++) s += `<rect x="${sunX - sunR}" y="${horizon - sunR * 0.35 + i * sunR * 0.22}" width="${sunR * 2}" height="${sunR * 0.07}" fill="#0b0d13" fill-opacity=".9"/>`;
    let x = -10;
    while (x < W) {
      const bw = 14 + r() * 34, bh = H * (0.12 + r() * 0.5) * (r() < 0.12 ? 1.5 : 1);
      s += `<rect x="${x}" y="${horizon - bh}" width="${bw}" height="${bh + H}" fill="#0b0d13" stroke="${c}" stroke-opacity=".25" stroke-width=".6"/>`;
      for (let wy = horizon - bh + 5; wy < horizon - 4; wy += 7) {
        for (let wx = x + 4; wx < x + bw - 4; wx += 6) if (r() < 0.16) s += `<rect x="${wx}" y="${wy}" width="2.2" height="2.2" fill="${c}" fill-opacity="${0.35 + r() * 0.6}"/>`;
      }
      x += bw + 2 + r() * 6;
    }
    for (let i = 1; i <= 6; i++) { const y = horizon + (H - horizon) * (i / 6) ** 1.6; s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c}" stroke-opacity=".22"/>`; }
    for (let i = -8; i <= 8; i++) s += `<line x1="${W / 2 + i * 22}" y1="${horizon}" x2="${W / 2 + i * 120}" y2="${H}" stroke="${c}" stroke-opacity=".16"/>`;
    s += `<rect y="${horizon}" width="${W}" height="1.5" fill="${c}" fill-opacity=".7"/>`;
    const b = 16, m = 10;
    s += `<path d="M${m} ${m + b}V${m}H${m + b} M${W - m - b} ${H - m}H${W - m}V${H - m - b}" fill="none" stroke="${c}" stroke-width="2"/>`;
    return s + '</svg>';
  }

  // ---- the page frame ----
  function shell(page) {
    const who = me();
    const nav = [['browse.html', 'Browse', 'browse'], ['browse.html?sort=new', 'New', 'new'], ['browse.html?sort=updated', 'Updated', 'updated'], ['publish.html', 'Publish', 'publish']];
    const current = page === 'browse' ? (params.get('sort') === 'new' ? 'new' : params.get('sort') === 'updated' ? 'updated' : 'browse') : page;
    const account = who
      ? `<button class="who" aria-haspopup="true" aria-expanded="false" id="whoBtn"><span class="avatar">${esc(who.name[0])}</span>${esc(who.name.split(' ')[0])}</button>
         <div class="menu" id="whoMenu" role="menu">
           <div class="head"><b>${esc(who.name)}</b>Signed in with ${esc(who.via)}${who.github ? ` · ${esc(who.github)}` : ''}<br>${sub() === 'free' ? 'Free' : '<span style="color:var(--green)">Full speed</span>'}</div>
           <a href="me.html#profile" role="menuitem">Profile</a>
           <a href="me.html#likes" role="menuitem">Liked mods</a>
           <a href="me.html#mods" role="menuitem">${who.github ? 'My mods' : 'Publishing'}</a>
           <a href="me.html#subscription" role="menuitem">Subscription</a>
           <a href="me.html#settings" role="menuitem">Settings</a>
           ${who.admin ? '<a href="admin.html" role="menuitem">Admin</a>' : ''}
           <button data-signout role="menuitem">Sign out</button>
         </div>`
      : '<button class="btn sm go" data-signin>Sign in</button>';
    $('#shell-top').innerHTML = `
      <div class="proto"><div class="wrap"><b>Prototype</b><span>View as</span>
        <span class="roles">${Object.keys(PERSONAS).map((k) => `<button data-role="${k}" aria-pressed="${k === role}">${ROLE_LABELS[k]}</button>`).join('')}</span>
        <span class="note">Invented data. Nothing here talks to a server.</span></div></div>
      <header class="bar"><div class="wrap">
        <a class="logo" href="index.html"><span class="dot"></span>EDGE<span>mods</span></a>
        <nav aria-label="Main">${nav.map(([href, label, key]) => `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
        <form action="browse.html" role="search"><label class="sr" for="topq">Search mods</label>
          <input class="search" id="topq" name="q" type="search" placeholder="Search mods" value="${page === 'browse' ? esc(params.get('q') ?? '') : ''}"></form>
        <div class="account">${account}</div>
      </div></header>`;
    $('#shell-bottom').innerHTML = `
      <footer class="wrap"><span>EDGEMODS · THE EDGE MOD REGISTRY FOR CYBERPUNK 2077</span>
        <nav><a href="publish.html">Publish</a><a href="https://edgemodders.github.io/EDGEmods/">Docs</a><a href="#" data-toast="The privacy page: no tracking; what is stored for an account.">Privacy</a><a href="#" data-toast="The terms page.">Terms</a></nav>
        <span>Mods live in their authors' repositories. Not affiliated with CD Projekt RED.</span></footer>
      <div class="toast" id="toast" role="status"></div>
      <div id="modal"></div>`;
  }

  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3800);
  }

  function signInModal() {
    $('#modal').innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(8,9,13,.8);z-index:50;display:grid;place-items:center;padding:16px" data-close>
        <div class="panel" style="width:min(420px,100%);padding:26px" role="dialog" aria-label="Sign in">
          <p class="label">Auth0 · Universal Login</p>
          <h2 style="margin-bottom:6px">Sign in to <span style="color:var(--yellow)">EDGEmods</span></h2>
          <p class="dim" style="font-size:16px">Sign in to download, like and install mods. Publishing needs GitHub.</p>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
            <button class="btn go" data-as="modder">${ICON.git} Continue with GitHub</button>
            <button class="btn" data-as="player">Continue with Google</button>
            <button class="btn" data-as="player">Continue with email</button>
          </div>
          <p class="dim mono" style="font-size:11px;margin:16px 0 0">In the prototype, GitHub signs you in as the modder, the others as a player.</p>
        </div></div>`;
  }

  function likeButton(m) {
    const on = Boolean(me()) && likes.has(m.id);
    return `<button class="like" data-like="${esc(m.id)}" aria-pressed="${on}" title="${me() ? (on ? 'Unlike' : 'Like') : 'Sign in to like'}">${ICON.heart}${num(m.likes + (on ? 1 : 0))}</button>`;
  }

  function card(m) {
    const fresh = daysOld(m.publishedAt) < 7;
    const updated = !fresh && daysOld(m.updatedAt) < 7;
    return `<article class="card">
      <div class="img">${art(m)}<div class="flags"><span class="tag solid y">${esc(TYPES[m.type][0])}</span>
        <span class="right">${fresh ? '<span class="tag solid g">New</span>' : ''}${updated ? '<span class="tag solid c">Updated</span>' : ''}${m.runsCode.length ? '<span class="tag solid r" title="Contains a game plugin that runs code">Runs code</span>' : ''}${m.adult ? '<span class="tag solid r">18+</span>' : ''}</span></div></div>
      <div class="body">
        <a class="name" href="mod.html?id=${esc(m.id)}">${esc(m.name)}</a>
        <span class="by">by ${esc(m.author.name)}</span>
        <p class="sum">${esc(m.summary)}</p>
        <div class="tags">${m.tags.slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>
      <div class="foot">
        <span class="stat" title="Downloads">${ICON.down}${num(m.downloads)}</span>
        <span class="stat" title="Size">${ICON.box}${bytes(m.size)}</span>
        <span class="stat" title="Version">v${esc(m.version)}</span>
        <span class="stat" title="Updated ${esc(date(m.updatedAt))}">${ICON.clock}${ago(m.updatedAt)}</span>
        ${likeButton(m)}
      </div></article>`;
  }

  /** What anyone may see: adult mods only for signed-in people who turned them on. */
  const visibleMods = () => D.mods.filter((m) => m.status === 'visible' && (!m.adult || (me() && settings.adult)));
  const byId = (id) => D.mods.find((m) => m.id === id);
  const SORTS = {
    new: ['Newest', (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)],
    updated: ['Recently updated', (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)],
    downloads: ['Most downloaded', (a, b) => b.downloads - a.downloads],
    likes: ['Most liked', (a, b) => b.likes - a.likes],
    name: ['Name A–Z', (a, b) => a.name.localeCompare(b.name)],
  };

  // ---- pages ----
  const pages = {
    home() {
      const mods = visibleMods();
      const rail = (title, id, sort, n = 4) => `<section><div class="sechead"><h2><span class="id">${id}</span>${title}</h2><a href="browse.html?sort=${sort}">See all →</a></div><div class="rule"></div>
        <div class="cards">${[...mods].sort(SORTS[sort][1]).slice(0, n).map(card).join('')}</div></section>`;
      const counts = Object.keys(TYPES).map((t) => [t, mods.filter((m) => m.type === t).length]).filter(([, n]) => n);
      const modders = new Set(mods.map((m) => m.author.github)).size;
      const downloads = mods.reduce((n, m) => n + m.downloads, 0);
      return `<header class="hero wrap">
          <div class="eyebrow">The EDGE mod registry for Cyberpunk 2077</div>
          <h1>Open-source <span>modding</span></h1>
          <p class="lede">Find, install and share mods. Every mod lives in its author's own repository: EDGEmods checks it, lists it, and installs it through EDGEdeck in one click.</p>
          <div class="cta"><a class="btn go" href="browse.html">Browse mods</a><a class="btn" href="publish.html">Publish a mod</a></div>
          <div class="stats"><span><b>${mods.length}</b>mods</span><span><b>${modders}</b>modders</span><span><b>${num(downloads)}</b>downloads</span></div>
        </header>
        <main class="wrap">
          <section style="margin-top:8px"><div class="sechead"><h2><span class="id">00</span>Types</h2></div><div class="rule"></div>
            <div class="types">${counts.map(([t, n]) => `<a class="typetile" href="browse.html?type=${t}">${esc(TYPES[t][0])}<small>${n}</small></a>`).join('')}</div></section>
          ${rail('New mods', '01', 'new')}
          ${rail('Recently updated', '02', 'updated')}
          ${rail('Most liked', '03', 'likes')}
        </main>`;
    },

    browse() {
      return `<main class="wrap"><div class="browse">
        <aside class="facets" id="facets" aria-label="Filters"></aside>
        <div>
          <div class="toolbar">
            <label class="sr" for="q">Search</label><input class="search" id="q" type="search" placeholder="Search names, descriptions, tags, authors" value="${esc(params.get('q') ?? '')}">
            <button class="btn sm filters-toggle" id="filtersToggle" aria-controls="facets" aria-expanded="false">Filters</button>
            <span class="count" id="count"></span>
            <label class="sr" for="sort">Sort</label>
            <select class="sort" id="sort">${Object.entries(SORTS).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('')}</select>
          </div>
          <div class="chips" id="chips"></div>
          <div class="cards" id="results"></div>
          <div class="loadmore" id="more"></div>
        </div></div></main>`;
    },

    mod() {
      const m = byId(params.get('id') ?? '') ?? D.mods[0];
      const who = me();
      if (m.adult && !(who && settings.adult)) {
        return `<main class="wrap"><div class="pagehead"><div class="eyebrow">Adult content</div><h1>This mod is for <span>adults</span></h1>
          <p class="lede">${who ? 'Turn on adult mods in your settings to see it.' : 'Sign in, then turn on adult mods in your settings, to see it.'}</p>
          <div class="cta">${who ? '<a class="btn go" href="me.html#settings">Settings</a>' : '<button class="btn go" data-signin>Sign in</button>'}<a class="btn" href="browse.html">Back to mods</a></div></div></main>`;
      }
      const own = who?.github === m.author.github;
      const latest = m.releases[0];
      return `<main class="wrap">
        <div class="crumbs"><a href="browse.html">Mods</a> / <a href="browse.html?type=${m.type}">${esc(TYPES[m.type][0])}</a> / ${esc(m.name)}</div>
        ${who?.admin ? `<div class="adminstrip">Admin <span class="spacer"></span>
          <button class="btn sm" data-toast="The mod is hidden from the site; its registry file stays.">Hide</button>
          <button class="btn sm" data-toast="Tags EDGEmods adds sit beside the author's and cannot be removed by them.">Edit EDGEmods tags</button>
          <button class="btn sm" data-toast="The mod is featured on the home page.">Feature</button>
          <button class="btn sm danger" data-toast="The owner's GitHub account is blocked: no new mods, and this one is hidden.">Block owner</button></div>` : ''}
        ${own ? `<div class="panel note" style="margin-top:18px"><p class="label">Your mod</p><p style="margin:0">This is your mod. Update it, change files or the version from VS Code: <b>EDGEmods › My mods</b>. ${num(m.downloads)} downloads, ${num(m.likes)} likes.</p></div>` : ''}
        <div class="modhead">
          <div>
            <div class="modmeta" style="margin-top:0"><a class="tag y" href="browse.html?type=${m.type}">${esc(TYPES[m.type][0])}</a>${m.runsCode.length ? '<span class="tag r">Runs code</span>' : ''}${m.adult ? '<span class="tag r">18+</span>' : ''}</div>
            <h1>${esc(m.name)}</h1>
            <p class="lede">${esc(m.summary)}</p>
            <div class="byline" style="margin-top:12px">by ${esc(m.author.name)}${who ? ` · <a href="${esc(m.repo)}">${ICON.git.replace('<svg', '<svg style="width:12px;height:12px;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:2"')} ${esc(m.author.github)}/${esc(m.id)}</a>` : ''}</div>
            <div class="modmeta">${m.tags.map((t) => `<a class="tag" href="browse.html?tag=${esc(t)}">${esc(t)}</a>`).join('')}</div>
            <div class="gallery"><div class="main" id="galleryMain">${art(m, 1, 16 / 9)}</div><div class="caption" id="galleryCaption">Screenshot 1 of ${m.gallery}</div>
              <div class="thumbs">${Array.from({ length: m.gallery }, (_, i) => `<button data-shot="${i + 1}" aria-current="${i === 0}" aria-label="Screenshot ${i + 1}">${art(m, i + 1, 16 / 9)}</button>`).join('')}</div></div>
          </div>
          <aside class="side">
            <div class="panel">
              <div class="actions">${who
                ? `<button class="btn go" data-install>${ICON.vscode} Install in VS Code</button>
                   <button class="btn" data-tab-open="files">${ICON.down} Download files</button>
                   <p class="gate">${sub() === 'free' ? `Free speed, up to ${FREE_SPEED}. <a href="me.html#subscription">Full speed</a> with a subscription.` : 'Full speed, with your subscription.'}</p>`
                : `<button class="btn go" data-signin>${ICON.lock} Sign in to download</button>
                   <p class="gate">Downloading, installing and seeing where a mod comes from need a free account.</p>`}
                ${likeButton(m).replace('class="like"', 'class="like" style="justify-content:center;padding:9px"')}
              </div>
            </div>
            <div class="panel"><dl class="kv">
              <dt>Version</dt><dd>${esc(m.version)}</dd>
              <dt>Updated</dt><dd>${esc(date(m.updatedAt))}</dd>
              <dt>Published</dt><dd>${esc(date(m.publishedAt))}</dd>
              <dt>Downloads</dt><dd>${m.downloads.toLocaleString('en')}</dd>
              <dt>Size</dt><dd>${bytes(m.size)}</dd>
              <dt>Game</dt><dd>Tested with ${esc(m.game)}</dd>
              <dt>License</dt><dd>${esc(m.license)}</dd>
              <dt>Source</dt><dd>${who ? `<a href="${esc(m.repo)}">GitHub</a>` : '<span class="dim">Sign in to see</span>'}</dd>
            </dl></div>
            <div class="panel ${m.runsCode.length ? 'warn' : ''}">
              <p class="label">What's in the download</p>
              ${m.runsCode.length ? '<p style="font-size:16px">It has a <b>game plugin</b>: code that runs inside the game with your permissions. That is normal for frameworks; install mods like this from authors you trust.</p>' : ''}
              <ul class="contents">${Object.entries(m.kinds).map(([k, n]) => `<li>${n} × ${esc(KIND_LABELS[k] ?? k)}</li>`).join('')}</ul>
              <p class="dim mono" style="font-size:11px;margin:10px 0 0">Checked and scanned (ClamAV) ${esc(ago(m.scannedAt))}</p>
              <details class="raw"><summary>Raw values</summary><pre>${esc(`sha256 ${m.sha256}\n${m.runsCode.map((p) => `runs code: ${p}`).join('\n')}`)}</pre></details>
            </div>
            ${who ? '<button class="btn sm" data-toast="A report goes to the EDGEmods admins with your account.">Report this mod</button>' : ''}
          </aside>
        </div>
        <div class="tabs" role="tablist">${[['about', 'About'], ['files', `Files (${m.files.length})`], ['versions', `Versions (${m.releases.length})`], ['needs', `Requirements (${m.requirements.length})`],
          ['comments', `Comments (${talk(m).comments.length})`], ['discussions', `Discussions (${talk(m).discussions.length})`], ['issues', `Issues (${talk(m).issues.filter((x) => x.open).length} open)`]]
          .map(([k, l], i) => `<button role="tab" data-tab="${k}" aria-selected="${i === 0}">${l}</button>`).join('')}</div>
        <div class="tabpanel" data-panel="about">${readme(m)}</div>
        <div class="tabpanel" data-panel="files" hidden>${filesPanel(m, latest)}</div>
        <div class="tabpanel" data-panel="versions" hidden><div class="versions">${m.releases.map((r, i) => `
          <div class="panel version"><div class="v">${esc(r.version)}<small>${esc(date(r.date))}${i === 0 ? ' · latest' : ''}</small></div>
            <ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
            <div>${who ? `<button class="btn sm" data-toast="Installs ${esc(r.version)} through EDGEdeck, which keeps versions side by side.">${i === 0 ? 'Install' : 'Install this version'}</button>` : '<span class="dim mono" style="font-size:11px">Sign in to install</span>'}</div></div>`).join('')}</div></div>
        <div class="tabpanel" data-panel="needs" hidden><p class="dim">Installing in VS Code brings the EDGEmods requirements along, and theirs in turn: EDGEmods works out the chain, and EDGEdeck installs each mod into your loadout. Get the links outside EDGEmods yourself; EDGEmods does not check them.</p>
          <div class="reqs">${m.requirements.map((r) => {
            if (r.mod) {
              const dep = byId(r.mod);
              return dep ? `<a class="panel req" href="mod.html?id=${esc(dep.id)}" style="text-decoration:none;color:inherit"><span class="thumb">${art(dep)}</span><span><b>${esc(dep.name)}</b><small>On EDGEmods · ${esc(needs(r))}</small></span></a>` : '';
            }
            return `<a class="panel req" href="${esc(r.url)}" style="text-decoration:none;color:inherit"><span class="ext">External</span><span><b>${esc(r.name)}</b><small>${esc(new URL(r.url).hostname)} · not checked by EDGEmods</small></span></a>`;
          }).join('')}</div></div>
        <div class="tabpanel" data-panel="comments" hidden>${commentsPanel(m)}</div>
        <div class="tabpanel" data-panel="discussions" hidden>${githubPanel(m, 'discussions')}</div>
        <div class="tabpanel" data-panel="issues" hidden>${githubPanel(m, 'issues')}</div>
      </main>`;
    },

    me() {
      const who = me();
      if (!who) return signInPage('Your account');
      const mine = D.mods.filter((m) => m.author.github === who.github);
      return `<main class="wrap"><div class="pagehead"><div class="eyebrow">Signed in with ${esc(who.via)}${who.github ? ` · ${esc(who.github)}` : ''}</div><h1>${esc(who.name)}</h1></div>
        <div class="tabs" role="tablist">${[['profile', 'Profile'], ['likes', 'Liked mods'], ['mods', who.github ? `My mods (${mine.length})` : 'Publishing'], ['subscription', 'Subscription'], ['settings', 'Settings']]
          .map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="false">${l}</button>`).join('')}</div>
        <div class="tabpanel" data-panel="profile" hidden>${profilePanel(who)}</div>
        <div class="tabpanel" data-panel="subscription" hidden>${subscriptionPanel()}</div>
        <div class="tabpanel" data-panel="likes" hidden>${(() => {
          const liked = D.mods.filter((m) => likes.has(m.id));
          return liked.length ? `<div class="cards">${liked.map(card).join('')}</div>` : '<p class="empty">Mods you like show up here.</p>';
        })()}</div>
        <div class="tabpanel" data-panel="mods" hidden>${who.github ? `
          <div class="row" style="margin-bottom:14px"><p class="dim" style="margin:0">Publish and update mods from VS Code: EDGEmods › My mods, or the Publish button in REDcode.</p>
            <a class="btn sm go" href="publish.html" style="margin-left:auto">How to publish</a></div>
          <div class="tw"><table><thead><tr><th>Mod</th><th>Status</th><th>Version</th><th>Downloads</th><th>Likes</th><th>Updated</th><th></th></tr></thead><tbody>
          ${mine.map((m) => `<tr><td><b>${esc(m.name)}</b><small>${esc(m.author.github)}/${esc(m.id)}</small></td><td><span class="st on">Live</span></td>
            <td class="n">${esc(m.version)}</td><td class="n">${m.downloads.toLocaleString('en')}</td><td class="n">${m.likes.toLocaleString('en')}</td><td class="n">${esc(ago(m.updatedAt))}</td>
            <td class="acts"><a class="btn sm" href="mod.html?id=${esc(m.id)}">Page</a><button class="btn sm" data-toast="Opens EDGEmods › My mods in VS Code on this mod.">Open in VS Code</button></td></tr>`).join('')}
          <tr><td><b>Chrome Pack Prototype</b><small>octo-modder/chrome-pack</small></td><td><span class="st off">Checks failed</span></td><td class="n">0.1.0</td><td class="n">—</td><td class="n">—</td><td class="n">2 h ago</td>
            <td class="acts"><button class="btn sm" data-toast="Opens the pull request's report: the card image must be 2:1.">See why</button></td></tr>
          </tbody></table></div>`
        : `<div class="panel note"><p class="label">Publishing</p><p>Publishing a mod needs a GitHub sign-in: your mod lives in your own GitHub repository, and EDGEmods checks that it is yours.</p>
            <p style="margin:0">You are signed in with ${esc(who.via)}. Sign in with GitHub to publish; your mods belong to that account.</p></div>`}</div>
        <div class="tabpanel" data-panel="settings" hidden><div class="panel" style="max-width:640px">
          <p class="label">Content</p>
          <label class="toggle"><input type="checkbox" id="adultToggle" ${settings.adult ? 'checked' : ''}> Show adult mods (18+)</label>
          <p class="dim" style="font-size:15px;margin:6px 0 0">Off by default. Adult mods never show to visitors who are not signed in.</p>
        </div></div></main>`;
    },

    admin() {
      const who = me();
      if (!who?.admin) return who ? '<main class="wrap"><div class="pagehead"><div class="eyebrow">Admin</div><h1>Admins <span>only</span></h1><p class="lede">Admins are the email accounts listed in the server\'s settings.</p></div></main>' : signInPage('Admin');
      const recent = [...D.mods].sort(SORTS.new[1]).slice(0, 5);
      return `<main class="wrap"><div class="pagehead"><div class="eyebrow">Signed in as ${esc(who.name)}</div><h1>Ad<span>min</span></h1></div>
        <div class="tabs" role="tablist">${[['overview', 'Overview'], ['mods', 'Mods'], ['users', 'Users'], ['reports', `Reports (${D.reports.length})`], ['blocklist', 'Blocklist'], ['audit', 'Audit log']]
          .map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="false">${l}</button>`).join('')}</div>
        <div class="tabpanel" data-panel="overview" hidden>
          <div class="tiles">
            <div class="panel tile"><p class="label">Mods live</p><div class="big">${D.mods.length}</div><small>${D.mods.filter((m) => daysOld(m.publishedAt) < 7).length} new this week</small></div>
            <div class="panel tile"><p class="label">Accounts</p><div class="big">${D.users.length}</div><small>${D.users.filter((u) => u.role === 'modder').length} modders</small></div>
            <div class="panel tile ${D.reports.length ? 'warn' : ''}"><p class="label">Open reports</p><div class="big">${D.reports.length}</div><small>from signed-in players</small></div>
            <div class="panel tile"><p class="label">Blocked</p><div class="big">${D.blocklist.length}</div><small>accounts and repositories</small></div>
          </div>
          <section style="margin-top:28px"><div class="sechead"><h2><span class="id">01</span>Spot review</h2></div><div class="rule"></div>
            <p class="dim">Mods merge by themselves when every check passes. Look over the newest ones here.</p>
            <div class="tw"><table><thead><tr><th>Mod</th><th>Owner</th><th>Merged</th><th>Contents</th><th></th></tr></thead><tbody>
            ${recent.map((m) => `<tr><td><b>${esc(m.name)}</b><small>${esc(m.id)} · ${esc(m.version)}</small></td><td>${esc(m.author.github)}</td><td class="n">${esc(ago(m.publishedAt))}</td>
              <td>${m.runsCode.length ? '<span class="st off">Runs code</span>' : '<span class="st on">No code</span>'} ${m.adult ? '<span class="st wip">Adult</span>' : ''}</td>
              <td class="acts"><a class="btn sm" href="mod.html?id=${esc(m.id)}">Look</a><button class="btn sm" data-toast="Marked as reviewed.">Reviewed</button></td></tr>`).join('')}
            </tbody></table></div></section>
        </div>
        <div class="tabpanel" data-panel="mods" hidden><div class="tw"><table><thead><tr><th>Mod</th><th>Owner</th><th>Status</th><th>Downloads</th><th>Reports</th><th></th></tr></thead><tbody>
          ${D.mods.map((m) => `<tr><td><b>${esc(m.name)}</b><small>${esc(TYPES[m.type][0])} · ${esc(m.version)}${m.adult ? ' · adult' : ''}${m.runsCode.length ? ' · runs code' : ''}</small></td><td>${esc(m.author.github)}</td>
            <td><span class="st on">Visible</span></td><td class="n">${m.downloads.toLocaleString('en')}</td><td class="n">${m.reports || '—'}</td>
            <td class="acts"><button class="btn sm" data-toast="Edit the tags EDGEmods adds, the type, featured.">Edit</button><button class="btn sm" data-toast="Hidden from the site; the registry file stays.">Hide</button><button class="btn sm danger" data-toast="Removing opens a pull request that deletes the registry file.">Remove</button></td></tr>`).join('')}
        </tbody></table></div></div>
        <div class="tabpanel" data-panel="users" hidden><div class="tw"><table><thead><tr><th>User</th><th>Sign-in</th><th>Role</th><th>Joined</th><th>Last seen</th><th>Status</th><th></th></tr></thead><tbody>
          ${D.users.map((u) => `<tr><td><b>${esc(u.name)}</b><small>${esc(u.email)}</small></td><td>${esc(u.via)}</td><td>${esc(u.role)}</td><td class="n">${esc(ago(u.joined))}</td><td class="n">${esc(ago(u.seen))}</td>
            <td>${u.status === 'blocked' ? '<span class="st off">Blocked</span>' : '<span class="st on">Active</span>'}</td>
            <td class="acts">${u.status === 'blocked' ? '<button class="btn sm" data-toast="Unblocked.">Unblock</button>' : '<button class="btn sm danger" data-toast="Blocked: sessions ended, sign-in refused, and, for a modder, publishing stopped.">Block</button>'}</td></tr>`).join('')}
        </tbody></table></div></div>
        <div class="tabpanel" data-panel="reports" hidden><div class="tw"><table><thead><tr><th>Mod</th><th>From</th><th>Reason</th><th>When</th><th></th></tr></thead><tbody>
          ${D.reports.map((r) => `<tr><td><b>${esc(byId(r.mod)?.name)}</b></td><td>${esc(r.by)}</td><td>${esc(r.reason)}</td><td class="n">${esc(ago(r.at))}</td>
            <td class="acts"><a class="btn sm" href="mod.html?id=${esc(r.mod)}">Look</a><button class="btn sm" data-toast="Closed, with a note to the reporter.">Close</button></td></tr>`).join('')}
        </tbody></table></div></div>
        <div class="tabpanel" data-panel="blocklist" hidden>
          <form class="panel row" style="margin-bottom:14px" data-block>
            <select class="sort" style="margin-left:0" aria-label="What to block"><option>GitHub account</option><option>Repository</option><option>Site account</option></select>
            <input class="search" style="max-width:260px" placeholder="login, owner/repo or email" aria-label="Who">
            <input class="search" style="max-width:320px" placeholder="Reason (kept private)" aria-label="Reason">
            <button class="btn sm danger">Block</button></form>
          <p class="dim">The blocklist is private. The registry's merge checks ask the server about it; blocking takes effect at once.</p>
          <div class="tw"><table><thead><tr><th>What</th><th>Who</th><th>Reason</th><th>By</th><th>When</th><th></th></tr></thead><tbody>
          ${D.blocklist.map((b) => `<tr><td>${esc(b.what)}</td><td><b>${esc(b.who)}</b></td><td>${esc(b.reason)}</td><td>${esc(b.by)}</td><td class="n">${esc(ago(b.at))}</td><td class="acts"><button class="btn sm" data-toast="Unblocked.">Unblock</button></td></tr>`).join('')}
          </tbody></table></div></div>
        <div class="tabpanel" data-panel="audit" hidden><div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
          ${D.audit.map((a) => `<tr><td class="n" style="text-align:left">${esc(ago(a.at))}</td><td>${esc(a.who)}</td><td>${esc(a.what)}</td></tr>`).join('')}
        </tbody></table></div></div></main>`;
    },

    publish() {
      return `<header class="hero wrap"><div class="eyebrow">Publish a mod</div><h1>Your repo is the <span>page</span></h1>
          <p class="lede">Publish from VS Code in one guided step. Your mod lives in your own GitHub repository; EDGEmods checks it and lists it. Nothing is uploaded twice, and you keep everything.</p></header>
        <main class="wrap"><div class="types" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))">
          ${[['01', 'Make it in REDcode', 'Build your mod as a REDcode project.'], ['02', 'Press Publish', 'REDcode\'s Publish button opens the EDGEmods form: name, description, version, page, images, files and requirements.'],
            ['03', 'Sign in with GitHub', 'EDGEmods creates your mod\'s repository, pushes it and makes the release, with your account.'], ['04', 'Checks, then live', 'The registry checks your repository, release and downloads. When everything passes, your mod is on EDGEmods.']]
            .map(([n, t, d]) => `<div class="panel" style="position:relative;padding-top:52px"><span style="position:absolute;top:14px;left:20px;font-family:var(--display);font-weight:700;font-size:30px;line-height:1;color:var(--yellow)">${n}</span><h3>${t}</h3><p style="margin:0;color:var(--soft)">${d}</p></div>`).join('')}
        </div>
        <section><div class="panel note"><p class="label">New versions</p><p style="margin:0">Update from VS Code: EDGEmods › My mods. A new version is a new release in your repository; EDGEmods picks it up by itself.</p></div></section>
        <div class="cta"><a class="btn go" href="https://edgemodders.github.io/EDGEmods/manifest.html">The mod format</a><a class="btn" href="https://edgemodders.github.io/EDGEmods/registry.html">How the checks work</a></div></main>`;
    },
  };

  function signInPage(title) {
    return `<main class="wrap"><div class="pagehead"><div class="eyebrow">${esc(title)}</div><h1>Sign <span>in</span></h1><p class="lede">Sign in to see your likes, settings and mods.</p>
      <div class="cta"><button class="btn go" data-signin>Sign in</button></div></div></main>`;
  }

  function readme(m) {
    return `<div class="readme">
      <h2>${esc(m.name)}</h2><p>${esc(m.summary)}</p>
      <p>This text comes from the mod's <code>README.md</code>, rendered and cleaned by EDGEmods. Authors write it in the EDGEmods publishing form, or in their repository.</p>
      <h2>Features</h2><ul><li>Works with game ${esc(m.game)}.</li><li>Tags: ${m.tags.map(esc).join(', ')}.</li><li>Settings in the game's mod menu.</li></ul>
      <h2>Installing</h2><ol><li>Install the requirements.</li><li>Install in VS Code, or download the files and add them to EDGEdeck.</li>${m.files.some((f) => f.role === 'choose-one') ? '<li>Choose one file from each group in the Files tab.</li>' : ''}</ol>
      <h2>Credits</h2><p>Thanks to the Cyberpunk 2077 modding community.</p></div>`;
  }

  function filesPanel(m, latest) {
    const who = me();
    const groups = [];
    const req = m.files.filter((f) => f.role === 'required');
    if (req.length) groups.push(['Required', 'always installed', req.map((f) => fileRow(f, 'checkbox', true))]);
    const named = [...new Set(m.files.filter((f) => f.role === 'choose-one').map((f) => f.group))];
    for (const g of named) groups.push([`Choose one: ${g}`, 'these replace each other, so only one is installed', m.files.filter((f) => f.group === g).map((f, i) => fileRow(f, 'radio', i === 0, g))]);
    const opt = m.files.filter((f) => f.role === 'optional');
    if (opt.length) groups.push(['Optional', 'add any of these on top', opt.map((f) => fileRow(f, 'checkbox', false))]);
    return `<p class="dim">Version ${esc(latest.version)}, released ${esc(date(latest.date))}.</p>
      <div class="files" id="files">${groups.map(([title, hint, rows]) => `<div class="panel filegroup"><p class="label">${esc(title)} <em>${esc(hint)}</em></p>${rows.join('')}</div>`).join('')}</div>
      <div class="installbar" style="margin-top:14px">${who
        ? `<button class="btn go" data-install>${ICON.vscode} Install selected in VS Code</button><span class="sum" id="selSum"></span>`
        : `<button class="btn go" data-signin>${ICON.lock} Sign in to download</button>`}</div>`;
  }

  function fileRow(f, kind, checked, group) {
    const who = me();
    const input = f.role === 'required'
      ? `<input type="checkbox" checked disabled aria-label="${esc(f.title)} (required)">`
      : `<input type="${kind}" ${group ? `name="g-${esc(group)}"` : ''} ${checked ? 'checked' : ''} data-size="${f.size}" aria-label="${esc(f.title)}">`;
    return `<div class="file">${input}<div><div class="t">${esc(f.title)}</div><div class="n">${esc(f.name)}</div></div>
      <div class="sz">${bytes(f.size)}${who ? `<br><a href="#" data-toast="${sub() === 'free' ? `Counted as a download, then streamed by EDGEmods at up to ${FREE_SPEED}.` : 'Counted as a download, then sent to the file on GitHub at full speed.'}">Download</a>` : ''}</div>${f.note ? `<p class="note">${esc(f.note)}</p>` : ''}${fileNeeds(f)}</div>`;
  }

  /** A requirement's version in words: "1.2.0 or newer", or "exactly 1.4.0" when pinned. */
  function needs(r) {
    return r.exact ? `exactly ${r.version}` : `${r.version} or newer`;
  }

  /** What one file needs on top of the whole mod, shown under the file. */
  function fileNeeds(f) {
    if (!f.requirements?.length) return '';
    return `<p class="note">This file needs ${f.requirements.map((r) => {
      if (!r.mod) return `<a href="${esc(r.url)}">${esc(r.name)}</a> (outside EDGEmods)`;
      const dep = byId(r.mod);
      return `<a href="mod.html?id=${esc(r.mod)}">${esc(dep?.name ?? r.mod)}</a> ${esc(needs(r))}`;
    }).join(', ')}.</p>`;
  }

  // ---- the account page: profile from Auth0, the subscription from Stripe ----
  function profilePanel(who) {
    const social = who.via !== 'Email';
    const linked = [
      ['Email and password', who.via === 'Email' ? who.email : null],
      ['Google', who.via === 'Google' ? who.email : null],
      ['GitHub', who.github],
    ];
    return `<div class="acct">
      <div class="panel"><p class="label">Profile</p>
        <div class="row" style="margin-bottom:14px"><span class="avatar big">${esc(who.name[0])}</span><div><b style="font-family:var(--display);font-size:20px">${esc(who.name)}</b><br><span class="dim">${esc(who.email)}</span></div></div>
        <dl class="kv"><dt>Email</dt><dd>${esc(who.email)} <span class="tag g">Verified</span></dd><dt>Signed in with</dt><dd>${esc(who.via)}</dd><dt>Member since</dt><dd>${esc(date(who.since))}</dd><dt>Plan</dt><dd>${sub() === 'free' ? 'Free' : 'Full speed'}</dd></dl>
        <div class="row" style="margin-top:16px">
          <button class="btn sm" data-toast="Your display name on EDGEmods, saved to your Auth0 profile.">Edit name</button>
          ${social ? `<span class="dim" style="font-size:14px">Email and password are managed by ${esc(who.via)}.</span>`
            : `<button class="btn sm" data-toast="Sends a link to the new address; the change applies once it is confirmed.">Change email</button>
               <button class="btn sm" data-toast="Auth0 emails you a link to set a new password.">Change password</button>`}
        </div></div>
      <div class="panel"><p class="label">Sign-in methods</p>
        <p class="dim" style="font-size:15px;margin-top:0">Linked sign-ins share one EDGEmods account: likes, comments, downloads and the subscription.</p>
        <div class="links">${linked.map(([name, v]) => `<div class="row"><b>${esc(name)}</b><span class="dim">${v ? esc(v) : 'Not linked'}</span>${v ? '<span class="tag g" style="margin-left:auto">Linked</span>'
          : `<button class="btn sm" style="margin-left:auto" ${name === 'GitHub' ? 'data-gh-link' : `data-toast="Signs in with ${esc(name)} once and links it to this account."`}>Link</button>`}</div>`).join('')}</div>
        ${who.github ? `<p class="label" style="margin-top:18px">Posting to GitHub</p>
          <div class="row"><span>${ghConnected() ? `Connected: Discussions and Issues posts go to GitHub as <b>${esc(who.github)}</b>.` : 'Not connected. Connect it from any post box, or here.'}</span>
          <button class="btn sm${ghConnected() ? ' danger' : ' go'}" style="margin-left:auto" data-gh-toggle>${ghConnected() ? 'Disconnect' : 'Connect'}</button></div>` : ''}
      </div>
      <div class="panel"><p class="label">Your data</p>
        <div class="row"><button class="btn sm" data-toast="Downloads a copy of everything EDGEmods keeps for your account.">Download my data</button>
          <button class="btn sm danger" data-toast="Cancels your subscription in Stripe, then deletes your account, likes, comments and settings. Your mods stay in your repositories.">Delete account</button></div></div>
    </div>`;
  }

  function subscriptionPanel() {
    const s = sub();
    const plan = `<div class="panel plan${s === 'free' ? '' : ' on'}"><p class="label">Full speed</p>
      <div class="price">$4.99<small> / month · example price</small></div>
      <ul><li>Downloads and installs at full speed, straight from GitHub</li><li>The same in VS Code: installs with all their requirements, fast</li><li>Supports EDGEmods' servers and checks</li></ul>
      <p class="dim" style="font-size:14px;margin:0">Every mod stays free to download and install. The subscription buys speed, not access.</p></div>`;
    if (s === 'free') {
      return `<div class="acct"><div class="panel"><p class="label">Your plan</p><div class="price">Free</div>
        <dl class="kv"><dt>Download speed</dt><dd>Up to ${FREE_SPEED}</dd><dt>Installs in VS Code</dt><dd>Same speed</dd></dl></div>
        ${plan}<div class="row"><button class="btn go" data-sub="subscribe">Subscribe</button><span class="dim" style="font-size:14px">Payment on Stripe's secure page; EDGEmods never sees your card.</span></div></div>`;
    }
    const ending = s === 'ending';
    return `<div class="acct">${plan}
      <div class="panel"><p class="label">Billing</p>
        <dl class="kv"><dt>Status</dt><dd>${ending ? `<span class="tag y">Ends ${esc(periodEnd())}</span>` : '<span class="tag g">Active</span>'}</dd>
          <dt>${ending ? 'Full speed until' : 'Renews on'}</dt><dd>${esc(periodEnd())}</dd><dt>Payment</dt><dd>Visa ending 4242</dd></dl>
        <div class="row" style="margin-top:16px">
          <button class="btn sm go" data-toast="Opens Stripe's customer portal: change the card, see and download invoices, change or cancel the plan. You come back here after.">Manage billing and invoices</button>
          ${ending ? '<button class="btn sm" data-sub="resume">Keep my subscription</button>' : '<button class="btn sm danger" data-sub="cancel">Cancel subscription</button>'}
        </div>
        <p class="dim" style="font-size:14px;margin:12px 0 0">${ending ? 'Cancelled: no more payments. Downloads go back to free speed after this date.' : 'Cancel any time; full speed lasts until the end of the period you paid for.'}</p></div></div>`;
  }

  // ---- talking about a mod: EDGEmods comments (any account), and the repository's Discussions and Issues (GitHub) ----
  const PEOPLE = [['Vee Morales', 'vmorales'], ['Jackie Welles', 'jwelles'], ['Panam Palmer', 'panam-p'], ['Kerry Eurodyne', 'keuro'], ['Misty Olszewski', 'misty-o'], ['River Ward', 'rward']];
  const talkCache = new Map();
  /** Invented comments, discussions and issues for a mod, the same on every visit. */
  function talk(m) {
    if (talkCache.has(m.id)) return talkCache.get(m.id);
    const i = D.mods.indexOf(m);
    const p = (k) => PEOPLE[(i + k) % PEOPLE.length];
    const a = m.author.github;
    const t = {
      comments: [
        { who: p(0)[0], text: `Installed in one click with its requirements. ${m.name} is exactly what I wanted.`, ago: 2, likes: 14 + i },
        { who: p(1)[0], text: 'Works on 2.31 with my other mods, no conflicts that EDGEdeck could see.', ago: 6, likes: 5 },
        { who: p(2)[0], text: 'Any chance of a version for the console look? Lovely work either way.', ago: 19, likes: 2 },
      ].slice(0, 1 + (i % 3)),
      discussions: [
        { n: 12 + i, cat: 'Ideas', title: `Ideas for the next version of ${m.name}`, who: p(3)[1], ago: 4, posts: [
          [p(3)[1], 'It would be great to have a settings page to tune this in game.', 4], [a, 'Planned for the next release. Thanks!', 3]] },
        { n: 9 + i, cat: 'Q&A', title: 'Does it work alongside other mods of the same type?', who: p(4)[1], ago: 21, answered: true, posts: [
          [p(4)[1], 'I have two other mods that touch the same things. Is that a problem?', 21], [a, 'They load fine together; mine wins where both change the same file.', 20]] },
      ].slice(0, 1 + (i % 2)),
      issues: [
        { n: 31 + i, open: true, labels: ['bug'], title: 'Flickers after loading a save', who: p(5)[1], ago: 3, posts: [
          [p(5)[1], 'After loading a save made before installing, things flicker for a few seconds. Game 2.31.', 3]] },
        { n: 27 + i, open: true, labels: ['question'], title: 'Steam Deck support?', who: p(1)[1], ago: 9, posts: [[p(1)[1], 'Has anyone tried this on the Deck?', 9]] },
        { n: 18 + i, open: false, labels: ['bug', 'fixed'], title: 'Crash at the main menu with an old Codeware', who: p(2)[1], ago: 40, posts: [
          [p(2)[1], 'Crashes at the main menu.', 40], [a, `Fixed in ${m.version}: it now says which Codeware it needs.`, 35]] },
      ].slice(0, 1 + (i % 3)),
    };
    talkCache.set(m.id, t);
    return t;
  }
  const commentLikes = new Set(store.get('comment-likes', []));
  const ghConnected = () => store.get('gh-posting', false);
  const daysAgo = (d) => ago(new Date(D.NOW - d * 86400000).toISOString());

  function commentsPanel(m) {
    const who = me();
    const list = talk(m).comments.map((c, k) => {
      const key = `${m.id}:${k}`;
      const on = Boolean(who) && commentLikes.has(key);
      return `<div class="post"><div class="who"><span class="avatar">${esc(c.who[0])}</span><b>${esc(c.who)}</b><span class="dim">${esc(daysAgo(c.ago))}</span></div>
        <p>${esc(c.text)}</p><button class="like" data-clike="${esc(key)}" aria-pressed="${on}" title="${who ? (on ? 'Unlike' : 'Like') : 'Sign in to like'}">${ICON.heart}${c.likes + (on ? 1 : 0)}</button></div>`;
    }).join('');
    const box = who
      ? `<div class="composer"><textarea rows="3" placeholder="Say something about ${esc(m.name)}" aria-label="Your comment"></textarea>
          <div class="row"><span class="dim">Posted on EDGEmods as ${esc(who.name)}</span><button class="btn sm go" data-post="comment">Post comment</button></div></div>`
      : '<div class="composer gated"><span>Sign in to comment and like comments. Any account works.</span><button class="btn sm go" data-signin>Sign in</button></div>';
    return `<p class="dim">Comments live on EDGEmods: anyone with an account can join in. For bug reports and longer threads, see Discussions and Issues.</p><div class="posts">${list}</div>${box}`;
  }

  function githubPanel(m, kind) {
    const who = me();
    const title = kind === 'issues' ? 'Issues' : 'Discussions';
    if (!who) {
      return `<div class="panel note"><p class="label">${title}</p><p>The mod's ${title.toLowerCase()} live on its GitHub repository. Sign in to read them here.</p><button class="btn go" data-signin>Sign in</button></div>`;
    }
    const own = who.github === m.author.github;
    const rows = talk(m)[kind].map((x) => {
      const head = kind === 'issues'
        ? `<span class="tag ${x.open ? 'g' : ''}">${x.open ? 'Open' : 'Closed'}</span>${x.labels.map((l) => `<span class="tag">${esc(l)}</span>`).join('')}`
        : `<span class="tag c">${esc(x.cat)}</span>${x.answered ? '<span class="tag g">Answered</span>' : ''}`;
      const posts = x.posts.map(([u, text, d]) => `<div class="post"><div class="who"><span class="avatar">${esc(u[0].toUpperCase())}</span><b>${esc(u)}</b>${u === m.author.github ? '<span class="tag y">Author</span>' : ''}<span class="dim">${esc(daysAgo(d))}</span></div><p>${esc(text)}</p></div>`).join('');
      const replies = x.posts.length - 1;
      const tools = own
        ? `<div class="row owner"><span class="dim">Your mod:</span><button class="btn sm" data-toast="Done on GitHub, and shown here at once.">${kind === 'issues' ? (x.open ? 'Close' : 'Reopen') : 'Mark answered'}</button><button class="btn sm" data-toast="Locked: only you can reply now.">Lock</button></div>`
        : '';
      return `<details class="thread" data-thread="${kind}-${x.n}"><summary><span class="num">#${x.n}</span><span class="title">${esc(x.title)}</span><span class="meta">${head}<span class="dim">${esc(x.who)} · ${esc(daysAgo(x.ago))} · ${replies} ${replies === 1 ? 'reply' : 'replies'}</span></span></summary>
        <div class="body"><div class="posts">${posts}</div>${tools}${ghComposer(kind === 'issues' ? 'Comment' : 'Reply')}</div></details>`;
    }).join('');
    const start = kind === 'issues' ? 'Open an issue' : 'Start a discussion';
    return `<p class="dim">From the mod's GitHub repository, read live. ${kind === 'issues' ? 'Report a bug or ask for a feature.' : 'Ideas, questions and help.'}</p>
      <div class="row" style="margin-bottom:12px"><button class="btn sm${who.github && ghConnected() ? ' go' : ''}" data-gh-start="${kind}">${start}</button></div>
      <div class="threads">${rows}</div>`;
  }

  /** The post box for GitHub: needs a GitHub account, then a one-time "connect GitHub for posting". */
  function ghComposer(verb) {
    const who = me();
    if (!who.github) {
      return '<div class="composer gated"><span>Posting here needs a GitHub account: your post appears on GitHub under it. EDGEmods comments work with any account.</span><button class="btn sm" data-gh-link>Link a GitHub account</button></div>';
    }
    if (!ghConnected()) {
      return `<div class="composer gated"><span>Your post goes to GitHub as <b>${esc(who.github)}</b>. Connect GitHub for posting once; signing in alone never lets EDGEmods post.</span><button class="btn sm go" data-gh-connect>Connect GitHub for posting</button></div>`;
    }
    return `<div class="composer"><textarea rows="3" placeholder="Markdown works, as on GitHub" aria-label="Your ${verb.toLowerCase()}"></textarea>
      <div class="row"><span class="dim">Posts to GitHub as ${esc(who.github)}</span><button class="btn sm go" data-post="github">${verb}</button></div></div>`;
  }

  /** Re-renders the page, keeping the open tab and threads. */
  function rerenderMod() {
    const tab = $('.tabs [aria-selected="true"]')?.dataset.tab;
    const open = $$('details.thread[open]').map((d) => d.dataset.thread);
    render();
    if (tab) pages._showTab?.(tab);
    for (const id of open) { const d = $(`details.thread[data-thread="${id}"]`); if (d) d.open = true; }
  }

  // ---- browse: search, facets, sort, all in the address bar ----
  const FACETS = [
    ['type', 'Type', (m) => [m.type], (v) => TYPES[v]?.[0] ?? v],
    ['tag', 'Tags', (m) => m.tags, (v) => v],
    ['needs', 'Needs', (m) => m.requirements.map((r) => r.name ?? byId(r.mod)?.name ?? r.mod), (v) => v],
  ];
  function browseState() {
    const p = new URLSearchParams(location.search);
    const list = (k) => (p.get(k) ? p.get(k).split(',').filter(Boolean) : []);
    return { q: p.get('q') ?? '', type: list('type'), tag: list('tag'), needs: list('needs'), nocode: p.get('nocode') === '1', sort: p.get('sort') in SORTS ? p.get('sort') : 'updated', shown: Number(p.get('shown')) || 12 };
  }
  function writeState(s) {
    const p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    for (const k of ['type', 'tag', 'needs']) if (s[k].length) p.set(k, s[k].join(','));
    if (s.nocode) p.set('nocode', '1');
    if (s.sort !== 'updated') p.set('sort', s.sort);
    history.replaceState(null, '', `browse.html${p.toString() ? `?${p}` : ''}`);
  }
  function matches(m, s, skip) {
    const q = s.q.trim().toLowerCase();
    if (q && ![m.name, m.summary, m.author.name, ...(me() ? [m.author.github] : []), ...m.tags].join(' ').toLowerCase().includes(q)) return false;
    // A mod has one type, so several types mean "any of these"; tags and requirements mean "all of these".
    for (const [key, , values] of FACETS) {
      if (key === skip || !s[key].length) continue;
      const has = (v) => values(m).includes(v);
      if (key === 'type' ? !s[key].some(has) : !s[key].every(has)) return false;
    }
    if (s.nocode && m.runsCode.length) return false;
    return true;
  }
  function renderBrowse() {
    const s = browseState();
    const mods = visibleMods();
    const hits = mods.filter((m) => matches(m, s)).sort(SORTS[s.sort][1]);
    $('#sort').value = s.sort;
    $('#count').textContent = `${hits.length} mod${hits.length === 1 ? '' : 's'}`;
    $('#results').innerHTML = hits.length ? hits.slice(0, s.shown).map(card).join('') : '<p class="empty" style="grid-column:1/-1">No mods match. Try fewer filters.</p>';
    $('#more').innerHTML = hits.length > s.shown ? `<button class="btn" data-more>Show more (${hits.length - s.shown})</button>` : '';

    const facetHtml = FACETS.map(([key, title, values, label]) => {
      const counts = new Map();
      for (const m of mods.filter((x) => matches(x, s, key))) for (const v of new Set(values(m))) counts.set(v, (counts.get(v) ?? 0) + 1);
      for (const v of s[key]) if (!counts.has(v)) counts.set(v, 0);
      const sorted = [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0]));
      const open = store.get(`facet-open-${key}`, false);
      const limit = key === 'type' || open ? sorted.length : 8;
      return `<div class="facet"><h3>${title}</h3>${sorted.slice(0, limit).map(([v, n]) => `<label><input type="checkbox" data-facet="${key}" value="${esc(v)}" ${s[key].includes(v) ? 'checked' : ''}>${esc(label(v))}<small>${n}</small></label>`).join('')}
        ${sorted.length > limit ? `<button class="more" data-facet-more="${key}">Show all ${sorted.length}</button>` : ''}</div>`;
    }).join('');
    const nocodeCount = mods.filter((m) => matches(m, { ...s, nocode: false }) && !m.runsCode.length).length;
    $('#facets').innerHTML = facetHtml + `<div class="facet"><h3>Contents</h3><label><input type="checkbox" data-nocode ${s.nocode ? 'checked' : ''}>No game plugins<small>${nocodeCount}</small></label></div>
      <div class="facet"><h3>Adult mods</h3>${me() ? `<p class="locked">${settings.adult ? 'Shown, as your settings say.' : 'Hidden. Change it in <a href="me.html#settings">settings</a>.'}</p>` : '<p class="locked">Hidden. Sign in to choose.</p>'}</div>`;

    const chips = [];
    if (s.q) chips.push(['q', s.q, `“${s.q}”`]);
    for (const [key, , , label] of FACETS) for (const v of s[key]) chips.push([key, v, label(v)]);
    if (s.nocode) chips.push(['nocode', '1', 'No game plugins']);
    $('#chips').innerHTML = chips.map(([k, v, l]) => `<button class="chip" data-unchip="${esc(k)}" data-value="${esc(v)}">${esc(l)} <span aria-label="Remove">×</span></button>`).join('')
      + (chips.length > 1 ? '<button class="chip clear" data-clear>Clear all</button>' : '');
    writeState(s);
  }
  function updateBrowse(change) {
    const s = browseState();
    change(s);
    s.shown = 12;
    writeState(s);
    renderBrowse();
  }

  // ---- events ----
  function wire(page) {
    document.addEventListener('click', onClick);
    $('#whoBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('#whoMenu');
      menu.classList.toggle('open');
      e.currentTarget.setAttribute('aria-expanded', menu.classList.contains('open'));
    });
    if (page === 'browse') {
      let timer;
      $('#q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => updateBrowse((s) => { s.q = e.target.value; }), 150); });
      $('#sort').addEventListener('change', (e) => updateBrowse((s) => { s.sort = e.target.value; }));
      $('#facets').addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.facet) updateBrowse((s) => { s[t.dataset.facet] = t.checked ? [...s[t.dataset.facet], t.value] : s[t.dataset.facet].filter((v) => v !== t.value); });
        if (t.hasAttribute('data-nocode')) updateBrowse((s) => { s.nocode = t.checked; });
      });
      renderBrowse();
    }
    if (page === 'mod' || page === 'me' || page === 'admin') setupTabs(page);
    if (page === 'mod') {
      $('#files')?.addEventListener('change', updateSelection);
      updateSelection();
    }
    $('#adultToggle')?.addEventListener('change', (e) => { settings.adult = e.target.checked; store.set('settings', settings); toast(settings.adult ? 'Adult mods are shown.' : 'Adult mods are hidden.'); });
    $('[data-block]')?.addEventListener('submit', (e) => { e.preventDefault(); toast('Added to the private blocklist. The registry checks see it at once.'); });
  }

  function setupTabs(page) {
    const tabs = $$('[data-tab]');
    if (!tabs.length) return;
    const show = (key) => {
      for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === key));
      for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== key;
      if (page !== 'mod') history.replaceState(null, '', `#${key}`);
    };
    for (const t of tabs) t.addEventListener('click', () => show(t.dataset.tab));
    const wanted = location.hash.slice(1);
    show(tabs.some((t) => t.dataset.tab === wanted) ? wanted : tabs[0].dataset.tab);
    pages._showTab = show;
  }

  function updateSelection() {
    const sum = $('#selSum');
    if (!sum) return;
    const chosen = $$('#files input:checked');
    const total = chosen.reduce((n, i) => n + Number(i.dataset.size || 0), 0) + byIdFromPage().files.filter((f) => f.role === 'required').reduce((n, f) => n + f.size, 0);
    sum.textContent = `${chosen.length} file${chosen.length === 1 ? '' : 's'} · ${bytes(total)}`;
  }
  const byIdFromPage = () => byId(params.get('id') ?? '') ?? D.mods[0];

  function onClick(e) {
    const t = e.target.closest('button, a');
    if (!$('#whoMenu')?.contains(e.target)) $('#whoMenu')?.classList.remove('open');
    if (e.target.matches('[data-close]')) { $('#modal').innerHTML = ''; return; }
    if (!t) return;
    const d = t.dataset;
    if (d.role) return setRole(d.role);
    if ('signin' in d) { e.preventDefault(); return signInModal(); }
    if (d.as) { $('#modal').innerHTML = ''; setRole(d.as); return toast(`Signed in as ${PERSONAS[d.as].name} (${PERSONAS[d.as].via}).`); }
    if ('signout' in d) { setRole('visitor'); return toast('Signed out.'); }
    if (d.like) {
      e.preventDefault();
      if (!me()) return signInModal();
      likes.has(d.like) ? likes.delete(d.like) : likes.add(d.like);
      store.set('likes', [...likes]);
      return render();
    }
    if (d.clike) {
      if (!me()) return signInModal();
      commentLikes.has(d.clike) ? commentLikes.delete(d.clike) : commentLikes.add(d.clike);
      store.set('comment-likes', [...commentLikes]);
      return rerenderMod();
    }
    if (d.sub) {
      if (!me()) return signInModal();
      const next = { subscribe: 'active', cancel: 'ending', resume: 'active' }[d.sub];
      setSub(next);
      rerenderMod();
      return toast({
        subscribe: 'In the real site this opens Stripe Checkout; Stripe tells EDGEmods when you have paid. Full speed now.',
        cancel: 'In the real site this happens in Stripe\'s portal. Full speed until the end of the period.',
        resume: 'Your subscription carries on, as before.',
      }[d.sub]);
    }
    if ('ghToggle' in d) { store.set('gh-posting', !ghConnected()); rerenderMod(); return toast(ghConnected() ? 'Connected: one GitHub approval.' : 'Disconnected: EDGEmods deleted its GitHub token for you.'); }
    if ('ghLink' in d) return toast('Adds a GitHub sign-in to your EDGEmods account (Auth0 links the two). Your likes, comments and downloads stay with it. To see the next step, view as Modder.');
    if ('ghConnect' in d) { store.set('gh-posting', true); rerenderMod(); return toast('One GitHub approval, then you post from EDGEmods. Disconnect any time in your settings.'); }
    if (d.ghStart) {
      const who = me();
      const what = d.ghStart === 'issues' ? 'Opening an issue' : 'Starting a discussion';
      if (!who.github) return toast(`${what} needs a GitHub account. Link one from any post box.`);
      if (!ghConnected()) return toast('Connect GitHub for posting first, from any post box.');
      return toast(`Opens a form: title, ${d.ghStart === 'issues' ? 'what happened and your game version' : 'category'} and text. It posts to the mod's repository as ${who.github}.`);
    }
    if (d.post) {
      const box = t.closest('.composer');
      const text = box.querySelector('textarea').value.trim();
      if (!text) return toast('Write something first.');
      const who = me();
      const name = d.post === 'github' ? who.github : who.name;
      const post = document.createElement('div');
      post.className = 'post';
      post.innerHTML = `<div class="who"><span class="avatar">${esc(name[0].toUpperCase())}</span><b>${esc(name)}</b><span class="dim">just now</span></div><p>${esc(text)}</p>`;
      box.parentElement.querySelector('.posts')?.append(post);
      box.querySelector('textarea').value = '';
      return toast(d.post === 'github' ? `Posted to GitHub as ${who.github}. It shows here and on GitHub.` : 'Posted on EDGEmods.');
    }
    if ('install' in d) {
      const m = byIdFromPage();
      return toast(`Opens VS Code: vscode://edgemodders.edgemods/install?mod=${m.id}&version=${m.version}. EDGEmods works out the requirements, downloads every file (${sub() === 'free' ? `free speed, up to ${FREE_SPEED}` : 'full speed'}) and hands each mod to EDGEdeck for your loadout.`);
    }
    if (d.tabOpen) { pages._showTab?.(d.tabOpen); $('.tabs')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (d.shot) {
      const m = byIdFromPage();
      $('#galleryMain').innerHTML = art(m, Number(d.shot), 16 / 9);
      $('#galleryCaption').textContent = `Screenshot ${d.shot} of ${m.gallery}`;
      for (const b of $$('[data-shot]')) b.setAttribute('aria-current', String(b === t));
      return;
    }
    if (d.toast) { e.preventDefault(); return toast(d.toast); }
    if (d.unchip) return updateBrowse((s) => { if (d.unchip === 'q') s.q = ''; else if (d.unchip === 'nocode') s.nocode = false; else s[d.unchip] = s[d.unchip].filter((v) => v !== d.value); if (d.unchip === 'q') $('#q').value = ''; });
    if ('clear' in d) { $('#q').value = ''; return updateBrowse((s) => { s.q = ''; s.type = []; s.tag = []; s.needs = []; s.nocode = false; }); }
    if (d.facetMore) { store.set(`facet-open-${d.facetMore}`, true); return renderBrowse(); }
    if ('more' in d) { const s = browseState(); s.shown += 12; const p = new URLSearchParams(location.search); p.set('shown', String(s.shown)); history.replaceState(null, '', `?${p}`); return renderBrowse(); }
    if (t.id === 'filtersToggle') { const f = $('#facets'); f.classList.toggle('open'); t.setAttribute('aria-expanded', f.classList.contains('open')); }
  }

  function render() {
    const page = document.body.dataset.page;
    document.removeEventListener('click', onClick);
    shell(page);
    $('#main').innerHTML = pages[page]();
    wire(page);
  }

  render();
})();
