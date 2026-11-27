// The EDGEmods app's Node mod: every network call, download, check and file for the page (index.html), over
// REDnode's channel. The page does what only a page may: REDnode's admin calls (the watched folder, switching a
// package on). docs/design.md, "REDnode mods and the in-game browser".

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { channel, pkg, secrets } from 'rednode';
import { carryOut, dependents, describe, Installed, prepare, removeMod } from './lib/install.mjs';
import { Account } from './lib/signin.mjs';
import { DEFAULT_SITE, Site, siteAddress } from './lib/site.mjs';
import { htmlToText } from './lib/text.mjs';

const settingsFile = join(pkg.dataDir, 'settings.json');
const work = join(pkg.dataDir, 'work');
await mkdir(pkg.dataDir, { recursive: true });
const installed = await new Installed(join(pkg.dataDir, 'installed.json')).load();

let settings = {};
try {
  settings = JSON.parse(await readFile(settingsFile, 'utf8'));
} catch {
  settings = {};
}

/** Where installs go: Documents\REDnode\EDGEmods, which the page asks REDnode for (admin.projectsFolder). */
let target;
let site;
let account;
let signingIn;
let installing;
let pending;

function connect() {
  const base = siteAddress(settings.site) ?? DEFAULT_SITE;
  site = new Site({ base, token: (renew) => account.token(renew) });
  account = new Account({ site, store: { get: (n) => secrets.get(n), set: (n, v) => secrets.set(n, v), delete: (n) => secrets.delete(n) } });
}
connect();

const post = (msg) => channel.post(msg);
const words = (err) => String(err?.message ?? err).slice(0, 400);

/** A package with this id in one of REDnode's other folders: the game's apps folder (EDGEdeck) or a development folder. */
function elsewhere(id) {
  const ours = target && resolve(target).toLowerCase();
  if (id === pkg.id) return true;
  return (pkg.appsDirs ?? []).some((dir) => (!ours || resolve(dir).toLowerCase() !== ours) && existsSync(join(dir, id, 'rednode-app.json')));
}

async function accountState() {
  const signedIn = await account.signedIn();
  let username;
  if (signedIn) {
    try {
      username = (await site.me()).username ?? undefined;
    } catch {
      // Offline: still signed in.
    }
  }
  return { site: site.base, signedIn, username };
}

function card(c) {
  return {
    id: c.id, name: c.name, summary: c.summary, author: c.author, version: c.version, type: c.type, tags: c.tags,
    runsCode: c.runsCode, likes: c.likes, downloads: c.downloads, lastUpdated: c.lastUpdated,
    image: c.card ? site.imageUrl(c.id, c.card) : undefined,
    installed: installed.get(c.id)?.version,
  };
}

const handlers = {
  async hello({ folder }) {
    if (typeof folder === 'string' && folder) target = folder;
    return { account: await accountState(), installed: installed.list(), target: target ?? null };
  },

  async search({ q, sort, page }) {
    const r = await site.search({ q: String(q ?? '').slice(0, 100), sort: ['updated', 'new', 'downloads', 'likes', 'name'].includes(sort) ? sort : 'updated', page: Number(page) || 1 });
    return { total: r.total, page: r.page, pages: r.pages, cards: r.cards.map(card) };
  },

  async mod({ id }) {
    const m = await site.mod(String(id));
    const shown = m.shown ?? m.releases?.[0];
    const packages = (shown?.check?.downloads ?? []).flatMap((d) => d.contents?.rednode?.packages ?? []);
    return {
      ...card(m),
      license: m.license,
      about: htmlToText(m.pageHtml),
      credits: m.credits ?? [],
      packages,
      requirements: shown?.requirements ?? [],
      releases: (m.releases ?? []).map((r) => ({ version: r.version, publishedAt: r.publishedAt, prerelease: r.prerelease })),
      installedPackages: installed.get(m.id)?.packages ?? [],
    };
  },

  /** Step one: the plan and the question. Nothing is downloaded. */
  async plan({ id, version }) {
    if (!(await account.signedIn())) return { kind: 'sign-in' };
    const r = await prepare(site, { mod: String(id), version: version ? String(version) : undefined }, installed, elsewhere);
    if (r.kind === 'ready') {
      pending = r;
      return { kind: 'ready', ...describe(r) };
    }
    if (r.kind === 'nothing') return { kind: 'nothing', names: r.kept.map((m) => m.name) };
    if (r.kind === 'edgedeck') return { kind: 'edgedeck', outside: r.outside };
    return r;
  },

  /** Step two, after the player said Install: download, check, unpack, put in place. */
  async install() {
    if (!pending) throw new Error('Ask for the plan first.');
    if (!target) throw new Error('REDnode has not given EDGEmods its folder yet: allow the admin permission in the Mod Manager.');
    if (installing) throw new Error('An install is already running.');
    const ready = pending;
    pending = undefined;
    installing = new AbortController();
    try {
      const result = await carryOut(site, ready, { target, work, installed, signal: installing.signal, progress: (p) => post({ type: 'progress', ...p }) });
      console.log(`Installed ${result.mods.map((m) => `${m.id} ${m.version}`).join(', ')}`);
      return { ...result, installed: installed.list() };
    } catch (err) {
      console.log(`Install failed (${err.step ?? 'error'}): ${words(err)}`);
      throw err;
    } finally {
      installing = undefined;
    }
  },

  async cancel() {
    installing?.abort();
    signingIn?.abort();
    return {};
  },

  async removeAsk({ id }) {
    const m = installed.get(String(id));
    if (!m) throw new Error('EDGEmods did not install that mod in the game.');
    return { name: m.name, packages: m.packages, needed: dependents(installed, String(id)) };
  },

  async remove({ id }) {
    if (!target) throw new Error('REDnode has not given EDGEmods its folder yet.');
    const closed = await removeMod(installed, target, String(id));
    console.log(`Removed ${id}`);
    return { closed, installed: installed.list() };
  },

  async signIn() {
    if (signingIn) throw new Error('A sign-in is already waiting for its code.');
    signingIn = new AbortController();
    try {
      await account.signIn((code) => post({ type: 'code', ...code }), signingIn.signal);
      return await accountState();
    } finally {
      signingIn = undefined;
    }
  },

  async signOut() {
    await account.signOut();
    return accountState();
  },

  /** The site address, for testing against EDGEmods on this PC (http://localhost:8800). Empty is edgemods.ai. */
  async setSite({ address }) {
    const text = String(address ?? '').trim();
    const base = text ? siteAddress(text) : DEFAULT_SITE;
    if (!base) throw new Error('Give an https address, or http://localhost while testing.');
    settings = { ...settings, site: base === DEFAULT_SITE ? undefined : base };
    await writeFile(settingsFile, JSON.stringify(settings, null, 2));
    connect();
    return accountState();
  },
};

channel.on(async (msg) => {
  if (!msg || typeof msg.type !== 'string' || !Object.hasOwn(handlers, msg.type)) return;
  try {
    post({ type: 'reply', req: msg.req, ok: true, data: await handlers[msg.type](msg) });
  } catch (err) {
    post({ type: 'reply', req: msg.req, ok: false, error: { message: words(err), code: err?.code, step: err?.step } });
  }
});

console.log(`EDGEmods ready, site ${site.base}`);
