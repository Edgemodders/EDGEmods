// The EDGEmods app for REDnode, outside the game: its zip reader, the site client, the device sign-in and the install
// steps, against a stand-in site, a stand-in Auth0 and real zip files. mod.mjs and app.js need REDnode and are
// covered by the hand test (docs/design.md, "RN4 hand test").
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { accepts, carryOut, compareVersions, dependents, describe, Installed, prepare, removeMod } from '../apps/edgemods/lib/install.mjs';
import { Account } from '../apps/edgemods/lib/signin.mjs';
import { Site, siteAddress } from '../apps/edgemods/lib/site.mjs';
import { htmlToText } from '../apps/edgemods/lib/text.mjs';
import { unsafePath, unzip, ZipError } from '../apps/edgemods/lib/zip.mjs';
import { makeZip } from '../../packages/checks/test/helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'edgemods-rednode-app-'));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const fresh = (name = 'd') => { const p = join(dir, `${name}${n++}`); mkdirSync(p, { recursive: true }); return p; };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const SITE = 'https://edgemods.test';
const manifest = (id, o = {}) => JSON.stringify({ id, name: id, version: '1.0.0', entry: 'index.html', width: 300, height: 200, ...o });

/** A stand-in EDGEmods: mods with zips, a plan, downloads that redirect to "GitHub", and Auth0's device flow. */
function standIn({ mods, plans, token = 'tok', authorized = () => true }) {
  const seen = [];
  const files = new Map();
  for (const m of Object.values(mods)) for (const [name, bytes] of Object.entries(m.zips ?? {})) files.set(`${m.id}/${name}`, bytes);
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const auth = init.headers?.authorization;
    seen.push({ url: u.href, auth });
    if (u.origin === 'https://files.example') {
      const bytes = files.get(u.pathname.slice(1));
      return bytes ? new Response(bytes, { headers: { 'content-length': String(bytes.length) } }) : json({}, 404);
    }
    if (u.host === 'tenant.test') {
      const form = new URLSearchParams(init.body);
      if (u.pathname === '/oauth/device/code') return json({ device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_uri: 'https://tenant.test/activate', verification_uri_complete: 'https://tenant.test/activate?user_code=ABCD-EFGH', expires_in: 60, interval: 1 });
      if (form.get('grant_type') === 'refresh_token') return form.get('refresh_token') === 'refresh-1' ? json({ access_token: 'tok2', expires_in: 3600 }) : json({ error: 'invalid_grant' }, 403);
      return authorized() ? json({ access_token: token, refresh_token: 'refresh-1', expires_in: 3600 }) : json({ error: 'authorization_pending' }, 403);
    }
    if (u.pathname === '/api/v1/auth') return json({ domain: 'tenant.test', clientId: 'vscode-1', audience: 'https://edgemods.ai/api', scope: 'openid profile email offline_access', device: { clientId: 'rednode-1' } });
    const plan = /^\/api\/v1\/mods\/([^/]+)\/install-plan$/.exec(u.pathname);
    if (plan) {
      const p = plans[plan[1]];
      if (!p) return json({ error: 'not-found' }, 404);
      const signed = auth === `Bearer ${token}`;
      return json(signed ? p : { ...p, mods: p.mods.map((m) => ({ ...m, files: m.files.map(({ download, ...f }) => f) })) });
    }
    const dl = /^\/download\/([^/]+)\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (dl) {
      if (auth !== `Bearer ${token}`) return json({ error: 'sign-in' }, 401);
      return new Response(null, { status: 302, headers: { location: `https://files.example/${dl[1]}/${dl[3]}` } });
    }
    if (u.pathname === '/api/v1/mods') return json({ total: 1, page: 1, pages: 1, cards: [] });
    return json({ error: 'not-found' }, 404);
  };
  return { fetch, seen };
}

/** A plan mod with one REDnode-only zip. */
function planMod(id, version, packages, { neededBy = [], wants = [], extra = [] } = {}) {
  const entries = [...packages.map((p) => ({ path: `red4ext/plugins/REDnode/apps/${p}/rednode-app.json`, data: manifest(p), deflate: true })),
    ...packages.map((p) => ({ path: `red4ext/plugins/REDnode/apps/${p}/index.html`, data: `<p>${p}</p>` })), ...extra];
  const zip = makeZip(entries);
  const name = `${id}-${version}.zip`;
  return {
    zips: { [name]: zip },
    mod: {
      id, name: id, version, neededBy, wants, inGame: true, offered: [],
      files: [{ name, role: 'required', size: zip.length, sha256: sha(zip), download: `${SITE}/download/${id}/${version}/${name}`,
        rednode: { only: true, packages: packages.map((p) => ({ id: p, name: p, version, folder: `red4ext/plugins/REDnode/apps/${p}`, window: true, hud: false, node: p.includes('mod'), service: false, permissions: [] })) } }],
    },
  };
}

function world(extra = {}) {
  const core = planMod('core-lib', '1.2.0', ['core-svc'], { neededBy: ['radio'] });
  const radio = planMod('radio', '1.0.0', ['radio-win', 'radio-mod']);
  const plans = { radio: { mod: 'radio', mods: [{ ...core.mod, wants: [{ version: '1.0.0', by: 'radio' }] }, radio.mod], links: [{ name: 'CET', url: 'https://example.com/cet', neededBy: ['radio'] }], problems: [], size: 0, inGame: true }, ...extra.plans };
  const s = standIn({ mods: { core: { id: 'core-lib', zips: core.zips }, radio: { id: 'radio', zips: radio.zips }, ...extra.mods }, plans });
  const site = new Site({ base: SITE, fetch: s.fetch, token: async () => 'tok' });
  return { site, seen: s.seen, plans };
}

test('version rules: newer accepted, exact pinned, pre-releases first', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1);
  assert.equal(accepts('1.3.0', [{ version: '1.2.0' }]), true);
  assert.equal(accepts('1.3.0', [{ version: '1.2.0', exact: true }]), false);
});

test('the zip reader refuses paths that escape and passwords, before writing anything', async () => {
  assert.match(unsafePath('../x'), /climbs out/);
  assert.match(unsafePath('C:/x'), /absolute/);
  const evil = join(fresh(), 'evil.zip');
  writeFileSync(evil, makeZip([{ path: 'ok.txt', data: 'x' }, { path: 'a/../../x.txt', data: 'y' }]));
  const out = fresh();
  await assert.rejects(unzip(evil, join(out, 'u')), ZipError);
  assert.equal(existsSync(join(out, 'u', 'ok.txt')), false, 'nothing written');
  const locked = join(fresh(), 'locked.zip');
  writeFileSync(locked, makeZip([{ path: 'a.txt', data: 'x', encrypted: true }]));
  await assert.rejects(unzip(locked, join(fresh(), 'u')), /password/);
  const good = join(fresh(), 'good.zip');
  writeFileSync(good, makeZip([{ path: 'a/b.txt', data: 'hello '.repeat(100), deflate: true }, { path: 'empty.txt', data: '' }]));
  const to = join(fresh(), 'u');
  await unzip(good, to);
  assert.equal(readFileSync(join(to, 'a', 'b.txt'), 'utf8'), 'hello '.repeat(100));
  assert.equal(readFileSync(join(to, 'empty.txt'), 'utf8'), '');
});

test('the site address: https, or http on this PC only', () => {
  assert.equal(siteAddress('https://edgemods.ai/x'), 'https://edgemods.ai');
  assert.equal(siteAddress('http://localhost:8800'), 'http://localhost:8800');
  assert.equal(siteAddress('http://evil.test'), undefined);
  assert.equal(siteAddress('javascript:alert(1)'), undefined);
});

test('a mod page as plain text: no tags, entities decoded', () => {
  assert.equal(htmlToText('<h2>Radio</h2><p>Plays <b>music</b> &amp; news</p><ul><li>One</li><li>Two</li></ul><script>x()</script>'), 'Radio\n\nPlays music & news\n\n• One\n\n• Two');
});

test('signing in with a code: shown, polled until confirmed, kept, renewed', async () => {
  let polls = 0;
  const s = standIn({ mods: {}, plans: {}, authorized: () => ++polls >= 2 });
  const site = new Site({ base: SITE, fetch: s.fetch });
  const kept = new Map();
  const store = { get: async (k) => kept.get(k) ?? null, set: async (k, v) => { kept.set(k, v); }, delete: async (k) => { kept.delete(k); } };
  let clock = 1_000_000;
  const account = new Account({ site, store, fetch: s.fetch, now: () => clock, sleep: async (ms) => { clock += ms; } });
  let shown;
  await account.signIn((c) => { shown = c; });
  assert.deepEqual([shown.userCode, shown.uri], ['ABCD-EFGH', 'https://tenant.test/activate']);
  assert.equal(polls, 2);
  assert.equal(await account.token(), 'tok');
  clock += 3600 * 1000;
  assert.equal(await account.token(), 'tok2', 'renewed with the refresh token near the end');
  const sent = s.seen.filter((x) => x.url.startsWith('https://tenant.test/'));
  assert.ok(sent.every((x) => !x.auth), 'nothing sent to Auth0 carries a token header');
  await account.signOut();
  assert.equal(await account.token(), undefined);
});

test('a code that runs out stops the sign-in in words', async () => {
  const s = standIn({ mods: {}, plans: {}, authorized: () => false });
  let clock = 0;
  const account = new Account({ site: new Site({ base: SITE, fetch: s.fetch }), store: { get: async () => null, set: async () => {}, delete: async () => {} }, fetch: s.fetch, now: () => clock, sleep: async (ms) => { clock += ms; } });
  await assert.rejects(account.signIn(() => {}), /ran out/);
});

test('install: everything checked and unpacked first, then moved into the folder; GitHub never gets the token', async () => {
  const { site, seen } = world();
  const target = fresh('target');
  const installed = await new Installed(join(fresh(), 'installed.json')).load();
  const ready = await prepare(site, { mod: 'radio' }, installed);
  assert.equal(ready.kind, 'ready');
  const q = describe(ready);
  assert.equal(q.title, 'Install radio 1.0.0 and 1 mod it needs?');
  assert.ok(q.lines.some((l) => /radio-mod: a window, a Node mod; runs code on your PC/.test(l)));
  assert.ok(q.lines.some((l) => /Get by hand: CET/.test(l)));
  const steps = [];
  const r = await carryOut(site, ready, { target, work: fresh('work'), installed, progress: (p) => steps.push(p.step) });
  assert.deepEqual(r.opened.sort(), ['core-svc', 'radio-mod', 'radio-win']);
  for (const id of r.opened) assert.ok(existsSync(join(target, id, 'rednode-app.json')), id);
  assert.deepEqual(installed.get('core-lib').needs, [], 'core-lib needs nothing');
  assert.deepEqual(installed.get('radio').needs, ['core-lib']);
  assert.ok(steps.indexOf('install') > steps.lastIndexOf('unpack'));
  for (const s of seen.filter((x) => x.url.startsWith('https://files.example/'))) assert.equal(s.auth, undefined);

  // Again: nothing to do. The requirement is kept at an accepted release.
  assert.equal((await prepare(site, { mod: 'radio' }, installed)).kind, 'nothing');
  assert.deepEqual(dependents(installed, 'core-lib'), ['radio']);

  // Remove: its folders go; the requirement stays.
  assert.deepEqual((await removeMod(installed, target, 'radio')).sort(), ['radio-mod', 'radio-win']);
  assert.equal(existsSync(join(target, 'radio-win')), false);
  assert.ok(existsSync(join(target, 'core-svc')));
});

test('a file that is not the one EDGEmods checked stops the install with the folder unchanged', async () => {
  const { site, plans } = world();
  plans.radio.mods[1].files[0].sha256 = 'f'.repeat(64);
  const target = fresh('target');
  const installed = await new Installed(join(fresh(), 'installed.json')).load();
  const ready = await prepare(site, { mod: 'radio' }, installed);
  await assert.rejects(carryOut(site, ready, { target, work: fresh('work'), installed }), /not the one EDGEmods checked/);
  assert.deepEqual(readdir(target), []);
  assert.deepEqual(installed.list(), []);
});

test('what the game cannot install: problems, files outside REDnode, a package EDGEdeck has', async () => {
  const { site, plans } = world({ plans: { bad: { mod: 'bad', mods: [], links: [], problems: ['"bad" is not on EDGEmods.'], size: 0, inGame: false } } });
  const installed = await new Installed(join(fresh(), 'installed.json')).load();
  assert.deepEqual(await prepare(site, { mod: 'bad' }, installed), { kind: 'problems', problems: ['"bad" is not on EDGEmods.'] });
  plans.radio.mods[0].inGame = false;
  plans.radio.inGame = false;
  const outside = await prepare(site, { mod: 'radio' }, installed);
  assert.deepEqual([outside.kind, outside.outside], ['edgedeck', ['core-lib']]);
  plans.radio.mods[0].inGame = true;
  plans.radio.inGame = true;
  const clash = await prepare(site, { mod: 'radio' }, installed, (id) => id === 'radio-win');
  assert.equal(clash.kind, 'problems');
  assert.match(clash.problems[0], /already has a package called "radio-win", installed by EDGEdeck/);
});

test('an update replaces the packages and drops the ones the new release no longer has', async () => {
  const v1 = planMod('radio', '1.0.0', ['radio-win', 'radio-old']);
  const v2 = planMod('radio', '2.0.0', ['radio-win']);
  const plans = { radio: { mod: 'radio', mods: [v1.mod], links: [], problems: [], size: 0, inGame: true } };
  const s = standIn({ mods: { radio: { id: 'radio', zips: { ...v1.zips, ...v2.zips } } }, plans });
  const site = new Site({ base: SITE, fetch: s.fetch, token: async () => 'tok' });
  const target = fresh('target');
  const installed = await new Installed(join(fresh(), 'installed.json')).load();
  await carryOut(site, await prepare(site, { mod: 'radio' }, installed), { target, work: fresh('work'), installed });
  plans.radio.mods = [v2.mod];
  const r = await carryOut(site, await prepare(site, { mod: 'radio' }, installed), { target, work: fresh('work'), installed });
  assert.deepEqual(r.closed, ['radio-old']);
  assert.deepEqual(readdir(target), ['radio-win']);
  assert.equal(installed.get('radio').version, '2.0.0');
});

function readdir(d) {
  return existsSync(d) ? readdirSync(d).sort() : [];
}
