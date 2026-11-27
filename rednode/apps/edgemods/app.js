// The EDGEmods app's page: browse REDnode mods, a mod's page, Install, Installed, Account. Every call to the site
// goes through the Node mod (mod.mjs) over the channel; this page does REDnode's admin calls, which only a page may
// make: the watched folder (tasks.projectsFolder) and switching a package on (tasks.setOpen). Text from mods is shown
// with textContent only.
import { channel } from 'rednode';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const host = window.rednode;

// ---------- talking to the Node mod ----------
let seq = 0;
const waiting = new Map();
channel.on((m) => {
  if (m?.type === 'reply') {
    const w = waiting.get(m.req);
    if (!w) return;
    waiting.delete(m.req);
    if (m.ok) w.ok(m.data);
    else w.fail(Object.assign(new Error(m.error?.message ?? 'Something went wrong.'), m.error ?? {}));
  } else if (m?.type === 'progress') {
    showProgress(m);
  } else if (m?.type === 'code') {
    showCode(m);
  }
});
const ask = (type, data = {}) => new Promise((ok, fail) => {
  const req = ++seq;
  waiting.set(req, { ok, fail });
  channel.post({ type, req, ...data });
});

// ---------- messages ----------
function say(text, tone = '') {
  const m = $('message');
  m.textContent = text ?? '';
  m.className = `note ${tone}`;
  m.hidden = !text;
}
function showProgress(p) {
  const bar = $('progress');
  bar.hidden = false;
  bar.setAttribute('label', p.text ?? '');
  if (p.total) {
    bar.setAttribute('max', String(p.total));
    bar.setAttribute('value', String(p.done ?? 0));
  } else {
    bar.removeAttribute('value');
  }
}
const hideProgress = () => { $('progress').hidden = true; };

/** A question in the page, with buttons; answers the label pressed, or undefined for Cancel. */
function question(title, lines, buttons) {
  const box = $('asking');
  box.replaceChildren();
  box.append(el('b', 'name', title));
  if (lines?.length) box.append(el('pre', '', lines.join('\n')));
  const row = el('div', 'row');
  box.append(row);
  box.hidden = false;
  return new Promise((done) => {
    for (const [label, variant] of [...buttons, ['Cancel', 'ghost']]) {
      const b = el('rn-button', '', label);
      if (variant) b.setAttribute('variant', variant);
      b.addEventListener('click', () => { box.hidden = true; done(label === 'Cancel' ? undefined : label); });
      row.append(b);
    }
  });
}

// ---------- the folder REDnode watches ----------
let folder = null;
async function getFolder() {
  try {
    folder = await host.tasks.projectsFolder('EDGEmods');
    $('admin').hidden = true;
  } catch (err) {
    folder = null;
    $('admin').textContent = `Browsing works. To install, allow EDGEmods the admin permission in REDnode's Mod Manager, then open this window again. (${String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')})`;
    $('admin').hidden = false;
  }
}

/** Switches the new packages on. REDnode finds a new folder within a second or so; until then it says "No package". */
async function switchOn(ids) {
  const failed = [];
  for (const id of ids) {
    let ok = false;
    for (let i = 0; i < 10 && !ok; i++) {
      try {
        await host.tasks.setOpen(id, true);
        ok = true;
      } catch (err) {
        if (!/No package/.test(String(err?.message))) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!ok) failed.push(id);
  }
  return failed;
}

// ---------- views ----------
const VIEWS = ['browse', 'installed', 'account'];
let view = 'browse';
function show(name) {
  view = name;
  for (const v of [...VIEWS, 'mod']) $(v).hidden = v !== name;
}
$('tabs').addEventListener('change', (e) => {
  const name = VIEWS[e.detail.index];
  show(name);
  if (name === 'installed') drawInstalled();
});

// ---------- browse ----------
const query = { q: '', sort: 'updated', page: 1 };
let state = { installed: [], account: { signedIn: false } };

function tagsOf(c) {
  const row = el('div');
  if (c.installed) row.append(el('span', 'tag y', c.installed === c.version ? 'Installed' : 'Update'));
  if (c.runsCode) row.append(el('span', 'tag r', 'Runs code'));
  return row;
}

async function search() {
  say('');
  $('count').textContent = 'Looking...';
  try {
    const r = await ask('search', query);
    const grid = $('grid');
    grid.replaceChildren();
    for (const c of r.cards) {
      const card = el('div', 'card');
      if (c.image) {
        const img = el('img');
        img.src = c.image;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.loading = 'lazy';
        card.append(img);
      }
      const t = el('div', 't');
      t.append(el('span', 'name', c.name), el('span', 'meta', `${c.author} · v${c.version} · ${c.downloads} downloads`), el('span', 'sum', c.summary), tagsOf(c));
      card.append(t);
      card.addEventListener('click', () => openMod(c.id));
      grid.append(card);
    }
    $('count').textContent = r.total ? `${r.total} REDnode ${r.total === 1 ? 'mod' : 'mods'} that install from the game` : 'No REDnode mods found.';
    $('pageno').textContent = r.pages > 1 ? `Page ${r.page} of ${r.pages}` : '';
    $('prev').toggleAttribute('disabled', r.page <= 1);
    $('next').toggleAttribute('disabled', r.page >= r.pages);
  } catch (err) {
    $('count').textContent = '';
    say(err.message, 'bad');
  }
}
$('q').addEventListener('submit', (e) => { query.q = e.detail.value; query.page = 1; search(); });
$('q').addEventListener('change', (e) => { if (!e.detail.value && query.q) { query.q = ''; query.page = 1; search(); } });
$('sort').addEventListener('change', (e) => { query.sort = e.detail.value; query.page = 1; search(); });
$('prev').addEventListener('click', () => { query.page -= 1; search(); });
$('next').addEventListener('click', () => { query.page += 1; search(); });

// ---------- a mod ----------
let current;
const WHAT = (k) => [k.window && 'a window', k.hud && 'a HUD widget', k.node && 'a Node mod', k.service && 'a service'].filter(Boolean).join(', ') || 'a package';

async function openMod(id) {
  say('');
  show('mod');
  $('detail').replaceChildren(el('p', 'note', 'Loading...'));
  $('modbtns').replaceChildren();
  try {
    const m = await ask('mod', { id });
    current = m;
    const left = el('div');
    if (m.image) {
      const img = el('img');
      img.src = m.image;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      left.append(img);
    }
    left.append(el('p', 'label', 'What it is'));
    const ul = el('ul', 'plain');
    for (const k of m.packages) ul.append(el('li', '', `${k.name}: ${WHAT(k)}${k.permissions.length ? `; asks for ${k.permissions.join(', ')}` : ''}${k.rednode ? `; needs REDnode ${k.rednode}` : ''}`));
    left.append(ul);
    if (m.requirements.length) {
      left.append(el('p', 'label', 'Needs'));
      const req = el('ul', 'plain');
      for (const r of m.requirements) req.append(el('li', '', r.mod ? `${r.mod} ${r.version}${r.exact ? ' exactly' : ' or newer'}` : `${r.name} (get it by hand)`));
      left.append(req);
    }
    left.append(el('p', 'label', 'Licence'), el('p', 'note', m.license ?? ''));
    const right = el('div');
    right.append(el('div', 'name', m.name), el('p', 'meta', `${m.author} · v${m.version}${m.installed ? ` · installed ${m.installed}` : ''}`), tagsOf(m), el('p', 'sum', m.summary));
    right.append(el('p', 'label', 'About'), el('div', 'about', m.about || 'No description.'));
    $('detail').replaceChildren(left, right);

    const btns = $('modbtns');
    const install = el('rn-button', '', m.installed ? (m.installed === m.version ? 'Install again' : `Update to ${m.version}`) : 'Install');
    install.addEventListener('click', () => installMod(m.id, m.version));
    btns.append(install);
    if (m.installed) {
      const remove = el('rn-button', '', 'Remove');
      remove.setAttribute('variant', 'danger');
      remove.addEventListener('click', () => removeModAsk(m.id));
      btns.append(remove);
    }
  } catch (err) {
    $('detail').replaceChildren(el('p', 'note bad', err.message));
  }
}
$('back').addEventListener('click', () => { show('browse'); search(); });

// ---------- install ----------
let busy = false;
async function installMod(id, version) {
  if (busy) return;
  if (!folder) await getFolder();
  if (!folder) { say('Allow EDGEmods the admin permission in the Mod Manager first.', 'warn'); return; }
  busy = true;
  say('');
  try {
    const p = await ask('plan', { id, version });
    if (p.kind === 'sign-in') {
      if (await question('Installing needs a free EDGEmods account.', ['Sign in once with a code on your phone or PC.'], [['Sign in']])) {
        $('tabs').querySelectorAll('rn-tab')[2]?.click();
        show('account');
        signIn();
      }
      return;
    }
    if (p.kind === 'problems') { await question('This mod cannot be installed now.', p.problems, []); return; }
    if (p.kind === 'edgedeck') {
      await question('This mod needs more than REDnode.', [`${p.outside.join(', ')} ${p.outside.length === 1 ? 'has' : 'have'} files that go into the game folder, which needs EDGEdeck and a restart of the game.`, 'Install it from EDGEkit or VS Code with the EDGEmods extension.'], []);
      return;
    }
    if (p.kind === 'nothing') { say(`${p.names.join(', ')}: installed already.`); return; }
    const yes = await question(p.title, [...p.lines, '', 'Packages that run code have the same access to your PC as you do. Install mods from authors you trust.'], [['Install']]);
    if (!yes) return;
    const r = await ask('install');
    hideProgress();
    const failed = await switchOn(r.opened);
    state.installed = r.installed;
    say(failed.length
      ? `Installed ${r.mods.map((m) => m.name).join(', ')}. Switch on ${failed.join(', ')} in the Mod Manager.`
      : `Installed ${r.mods.map((m) => m.name).join(', ')}: it is running. Pin it in the Mod Manager to keep it on screen.`, 'warn');
    if (current) openMod(current.id);
  } catch (err) {
    hideProgress();
    say(`Nothing was installed. ${err.message}`, 'bad');
  } finally {
    busy = false;
  }
}

async function removeModAsk(id) {
  try {
    const info = await ask('removeAsk', { id });
    const lines = [`Its packages stop and their folders are deleted: ${info.packages.map((p) => p.name).join(', ')}.`];
    if (info.needed.length) lines.push(`${info.needed.join(', ')} ${info.needed.length === 1 ? 'needs' : 'need'} it and may stop working.`);
    if (!(await question(`Remove ${info.name}?`, lines, [['Remove', 'danger']]))) return;
    for (const p of info.packages) await host.tasks.setOpen(p.id, false).catch(() => {});
    const r = await ask('remove', { id });
    state.installed = r.installed;
    say(`Removed ${info.name}.`);
    if (view === 'installed') drawInstalled();
    else if (current?.id === id) openMod(id);
  } catch (err) {
    say(err.message, 'bad');
  }
}

// ---------- installed ----------
function drawInstalled() {
  const body = $('list');
  body.replaceChildren();
  if (!state.installed.length) {
    const tr = el('tr');
    tr.append(el('td', 'note', 'Nothing yet. Find a mod on the Browse tab.'));
    body.append(tr);
    return;
  }
  for (const m of state.installed) {
    const tr = el('tr');
    const name = el('td');
    name.append(el('span', 'name', m.name), el('div', 'meta', `v${m.version} · ${m.packages.map((p) => p.name).join(', ')}`));
    const act = el('td');
    const open = el('rn-button', '', 'Page');
    open.setAttribute('variant', 'ghost');
    open.addEventListener('click', () => openMod(m.id));
    const remove = el('rn-button', '', 'Remove');
    remove.setAttribute('variant', 'danger');
    remove.addEventListener('click', () => removeModAsk(m.id));
    act.append(open, remove);
    tr.append(name, act);
    body.append(tr);
  }
}

// ---------- account ----------
function drawAccount(a) {
  state.account = a;
  $('who').textContent = a.signedIn ? `Signed in${a.username ? ` as ${a.username}` : ''} on ${a.site}.` : `Not signed in. Site: ${a.site}.`;
  $('signin').hidden = a.signedIn;
  $('signout').hidden = !a.signedIn;
}
function showCode(c) {
  $('codebox').hidden = false;
  $('uri').textContent = c.uri;
  $('code').textContent = c.userCode;
}
async function signIn() {
  say('');
  $('signin').setAttribute('disabled', '');
  try {
    drawAccount(await ask('signIn'));
    say('Signed in. You can install mods now.');
  } catch (err) {
    if (err.code !== 'cancelled') say(err.message, 'bad');
  } finally {
    $('codebox').hidden = true;
    $('signin').removeAttribute('disabled');
  }
}
$('signin').addEventListener('click', signIn);
$('cancelsignin').addEventListener('click', () => ask('cancel'));
$('signout').addEventListener('click', async () => drawAccount(await ask('signOut')));
$('setsite').addEventListener('click', async () => {
  try {
    drawAccount(await ask('setSite', { address: $('site').value }));
    say('');
    search();
  } catch (err) {
    say(err.message, 'bad');
  }
});

// ---------- start ----------
await getFolder();
// The Node mod may start a moment after the page: ask again until it answers.
let hello;
for (let i = 0; i < 20 && !hello; i++) {
  hello = await Promise.race([ask('hello', { folder }), new Promise((r) => setTimeout(r, 1000))]).catch((err) => { say(err.message, 'bad'); return undefined; });
}
if (hello) {
  state = { ...state, installed: hello.installed };
  drawAccount(hello.account);
  search();
} else {
  say('The EDGEmods mod did not start. Open the Mod log from the launcher to see why.', 'bad');
}
