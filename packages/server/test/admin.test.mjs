// R3e: the Admin page's mods, users, blocklist, reports, spot review and log, and the merge checks' blocklist question.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { fakeTenant, ORIGIN, sign, signIn, start } from './helpers.mjs';

const ADMIN = { sub: 'google-oauth2|900', name: 'Ada', email: 'admin@example.com', email_verified: true };
const post = (t, path, cookie, body = {}, headers = {}) => t.get(path, {
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}), ...headers },
  body: new URLSearchParams(body),
});

/** GitHub's public API, for looking up names to block. */
async function fakeGitHub(url) {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const path = new URL(url).pathname;
  if (path === '/users/bob') return json(200, { id: 20, login: 'bob' });
  if (path === '/repos/carol/pinned-hud') return json(200, { id: 3, full_name: 'carol/pinned-hud' });
  if (path === '/users/down') return json(500, {});
  return json(404, { message: 'Not Found' });
}

describe('the Admin page', () => {
  let t;
  let tenant;
  let admin;
  let player;
  const visible = async () => (await t.json('/api/v1/mods')).cards.map((c) => c.id).sort();
  const page = async (tab, q = '') => (await t.get(`/admin?tab=${tab}${q ? `&q=${q}` : ''}`, { headers: { cookie: admin } })).text();
  before(async () => {
    tenant = fakeTenant();
    t = await start({ tenant, admins: ['admin@example.com'], githubFetch: fakeGitHub, checksSecret: 'check-secret' });
    admin = (await signIn(t, tenant, ADMIN, { method: 'google', username: 'ada' })).cookie;
    player = (await signIn(t, tenant, { sub: 'google-oauth2|1', name: 'Pat', email: 'pat@example.com', email_verified: true }, { method: 'google', username: 'pat' })).cookie;
  });
  after(() => t.close());

  test('only admins, and only from EDGEmods pages', async () => {
    for (const [path, body] of [['/admin/mods/street-cred', { action: 'hide' }], ['/admin/users/google-oauth2%7C1', { action: 'block' }], ['/admin/blocklist', { action: 'add', kind: 'github', name: 'bob' }], ['/admin/reports/1', { action: 'close' }]]) {
      assert.equal((await post(t, path, player, body)).status, 403, `${path} as a player`);
      assert.equal((await post(t, path, admin, body, { origin: 'https://evil.test' })).status, 403, `${path} from another site`);
    }
    assert.deepEqual(await visible(), ['core-lib', 'pinned-hud', 'street-cred'], 'nothing changed');
    const tabs = await page('overview');
    for (const label of ['Overview', 'Mods', 'Users', 'Reports (0)', 'Blocklist (0)', 'Log']) assert.ok(tabs.includes(`>${label}</a>`), label);
  });

  test('hide, block and show a mod again, with a private reason, logged', async () => {
    let res = await post(t, '/admin/mods/street-cred', admin, { action: 'hide', reason: 'Checking a report' });
    assert.equal(res.headers.get('location'), '/admin?tab=mods&note=hidden');
    assert.deepEqual(await visible(), ['core-lib', 'pinned-hud']);
    assert.equal((await t.get('/mods/street-cred')).status, 404);
    assert.match(await page('mods'), /<span class="st off">Hidden<\/span><small>Checking a report<\/small>/);
    await post(t, '/admin/mods/street-cred', admin, { action: 'block' });
    assert.match(await page('mods', 'street'), /<span class="st off">Blocked<\/span>/);
    res = await post(t, '/admin/mods/street-cred', admin, { action: 'show' });
    assert.equal(res.headers.get('location'), '/admin?tab=mods&note=shown');
    assert.deepEqual(await visible(), ['core-lib', 'pinned-hud', 'street-cred']);
    const log = await page('log');
    assert.match(log, /<td>ada<\/td><td>Hid a mod<\/td><td>street-cred: Checking a report<\/td>/);
    assert.match(log, /<td>ada<\/td><td>Showed a mod again<\/td><td>street-cred<\/td>/);
    assert.equal((await post(t, '/admin/mods/nothing', admin, { action: 'hide' })).headers.get('location'), '/admin?tab=mods&note=unknown');
  });

  test('the adult flag: an admin can mark a mod 18+ or not, or hand it back to the modder', async () => {
    await post(t, '/admin/mods/pinned-hud', admin, { action: 'adult-yes' });
    assert.deepEqual(await visible(), ['core-lib', 'street-cred'], 'visitors no longer see it');
    assert.equal((await t.get('/mods/pinned-hud', { headers: { cookie: player } })).status, 403);
    assert.match(await page('mods', 'pinned'), /18\+ \(admin\)/);
    await post(t, '/admin/mods/pinned-hud', admin, { action: 'adult-auto' });
    await post(t, '/admin/mods/spicy', admin, { action: 'adult-no' });
    assert.deepEqual(await visible(), ['core-lib', 'pinned-hud', 'spicy', 'street-cred'], 'spicy is not 18+ by the admin\'s word');
    await post(t, '/admin/mods/spicy', admin, { action: 'adult-auto' });
    assert.deepEqual(await visible(), ['core-lib', 'pinned-hud', 'street-cred']);
  });

  test('a blocked GitHub account: its mods hide, its sessions end, and it cannot sign in', async () => {
    const alice = await signIn(t, tenant, { sub: 'github|10', nickname: 'alice', name: 'Alice', email: 'alice@example.com', email_verified: true });
    assert.equal((await (await t.get('/api/v1/me', { headers: { cookie: alice.cookie } })).json()).signedIn, true);
    const res = await post(t, '/admin/mods/core-lib', admin, { action: 'block-github', reason: 'Malware' });
    assert.equal(res.headers.get('location'), '/admin?tab=mods&note=github-blocked');
    assert.deepEqual(await visible(), ['pinned-hud', 'street-cred']);
    assert.equal((await (await t.get('/api/v1/me', { headers: { cookie: alice.cookie } })).json()).signedIn, false);
    assert.equal((await signIn(t, tenant, { sub: 'github|10', nickname: 'alice', name: 'Alice', email: 'alice@example.com', email_verified: true })).callback.status, 403);
    const list = await page('blocklist');
    assert.match(list, /<td>GitHub account<\/td><td><b>alice<\/b><small>id 10<\/small><\/td><td>Malware<\/td><td>ada<\/td>/);
    assert.match(await page('mods', 'core'), /Blocked account/);
    await post(t, '/admin/blocklist', admin, { action: 'remove', kind: 'github', value: '10' });
    assert.deepEqual(await visible(), ['core-lib', 'pinned-hud', 'street-cred']);
    assert.equal((await signIn(t, tenant, { sub: 'github|10', nickname: 'alice', name: 'Alice', email: 'alice@example.com', email_verified: true })).callback.status, 303);
  });

  test('the blocklist by name: GitHub gives the id, so renames change nothing', async () => {
    let res = await post(t, '/admin/blocklist', admin, { action: 'add', kind: 'github', name: 'bob', reason: 'Stolen mods' });
    assert.equal(res.headers.get('location'), '/admin?tab=blocklist&note=github-blocked');
    assert.deepEqual(await visible(), ['core-lib', 'pinned-hud']);
    res = await post(t, '/admin/blocklist', admin, { action: 'add', kind: 'repo', name: 'https://github.com/carol/pinned-hud.git' });
    assert.equal(res.headers.get('location'), '/admin?tab=blocklist&note=repo-blocked');
    assert.deepEqual(await visible(), ['core-lib']);
    assert.equal((await post(t, '/admin/blocklist', admin, { action: 'add', kind: 'github', name: 'nobody-here' })).headers.get('location'), '/admin?tab=blocklist&note=not-found');
    assert.equal((await post(t, '/admin/blocklist', admin, { action: 'add', kind: 'github', name: 'down' })).headers.get('location'), '/admin?tab=blocklist&note=github-down');
    assert.equal((await post(t, '/admin/blocklist', admin, { action: 'add', kind: 'github', name: 'bad name!' })).headers.get('location'), '/admin?tab=blocklist&note=not-found');

    // The merge checks' private question, signed with the shared secret.
    const ask = (body, secret = 'check-secret') => t.get('/api/v1/blocklist/check', { method: 'POST', headers: { 'content-type': 'application/json', 'x-edgemods-signature': sign(secret, body) }, body });
    assert.equal((await ask('{"github":20}', 'wrong')).status, 401);
    assert.deepEqual(await (await ask('{"github":20,"repo":99}')).json(), { blocked: true, github: true, repo: false });
    assert.deepEqual(await (await ask('{"github":30,"repo":3}')).json(), { blocked: true, github: false, repo: true });
    assert.deepEqual(await (await ask('{"github":30}')).json(), { blocked: false, github: false, repo: false });

    await post(t, '/admin/blocklist', admin, { action: 'remove', kind: 'github', value: '20' });
    await post(t, '/admin/blocklist', admin, { action: 'remove', kind: 'repo', value: '3' });
    assert.deepEqual(await visible(), ['core-lib', 'pinned-hud', 'street-cred']);
    assert.match(await page('log'), /Unblocked a repository<\/td><td>id 3<\/td>/);
  });

  test('blocking an account signs it out everywhere; admins cannot block themselves', async () => {
    const mo = await signIn(t, tenant, { sub: 'auth0|55', name: 'Mo', email: 'mo@example.com', email_verified: true }, { method: 'email', username: 'moe' });
    const res = await post(t, '/admin/users/auth0%7C55', admin, { action: 'block', reason: 'Spam reports' });
    assert.equal(res.headers.get('location'), '/admin?tab=users&note=user-blocked');
    assert.equal((await (await t.get('/api/v1/me', { headers: { cookie: mo.cookie } })).json()).signedIn, false);
    assert.equal((await signIn(t, tenant, { sub: 'auth0|55', name: 'Mo', email: 'mo@example.com', email_verified: true }, { method: 'email', username: false })).callback.status, 403);
    assert.match(await page('blocklist'), /<td>EDGEmods account<\/td><td><b>moe<\/b><\/td><td>Spam reports<\/td>/);
    assert.match(await page('users', 'mo'), /<span class="st off">Blocked<\/span><small>Spam reports<\/small>/);
    assert.equal((await post(t, '/admin/users/google-oauth2%7C900', admin, { action: 'block' })).headers.get('location'), '/admin?tab=users&note=not-yourself');
    assert.equal((await post(t, '/admin/users/auth0%7C55', admin, { action: 'unblock' })).headers.get('location'), '/admin?tab=users&note=user-unblocked');
    assert.equal((await signIn(t, tenant, { sub: 'auth0|55', name: 'Mo', email: 'mo@example.com', email_verified: true }, { method: 'email', username: false })).callback.status, 303);
  });

  test('reports: players send them from a mod page; admins close them', async () => {
    const modPage = await (await t.get('/mods/street-cred', { headers: { cookie: player } })).text();
    assert.match(modPage, /<summary>Report this mod<\/summary>/);
    assert.ok(!(await t.text('/mods/street-cred')).includes('Report this mod'), 'not for visitors');
    let res = await post(t, '/mods/street-cred/report', player, { reason: 'broken', note: 'Crashes on load\n<b>since 2.31</b>' });
    assert.equal(res.headers.get('location'), '/mods/street-cred?reported=1');
    assert.match(await (await t.get('/mods/street-cred?reported=1', { headers: { cookie: player } })).text(), /your report went to the EDGEmods admins/);
    res = await post(t, '/mods/street-cred/report', player, { reason: 'other' });
    assert.equal(res.headers.get('location'), '/mods/street-cred?reported=already', 'one open report per person and mod');
    assert.equal((await post(t, '/mods/street-cred/report', player, { reason: 'because' })).status, 404);
    assert.equal((await post(t, '/mods/street-cred/report', undefined, { reason: 'broken' })).status, 303, 'visitors sign in');

    const reports = await page('reports');
    assert.match(reports, />Reports \(1\)<\/a>/);
    assert.match(reports, /<b>Street Cred<\/b><\/a><small>street-cred<\/small><\/td><td>pat<\/td>\s*<td><b>Does not work<\/b><small class="wrapnote">Crashes on load\n&lt;b&gt;since 2\.31&lt;\/b&gt;<\/small>/);
    const id = /action="\/admin\/reports\/(\d+)"/.exec(reports)[1];
    res = await post(t, `/admin/reports/${id}`, admin, { action: 'close', note: 'Asked the modder' });
    assert.equal(res.headers.get('location'), '/admin?tab=reports&note=closed');
    const after = await page('reports');
    assert.match(after, />Reports \(0\)<\/a>/);
    assert.match(after, /<td>Street Cred<\/td><td>Does not work<\/td><td class="n left">just now<\/td><td>ada<\/td><td>Asked the modder<\/td>/);
    assert.equal((await post(t, '/mods/street-cred/report', player, { reason: 'other' })).headers.get('location'), '/mods/street-cred?reported=1', 'a new one once the last is closed');
  });

  test('spot review: the newest releases until an admin marks each reviewed', async () => {
    const overview = await page('overview');
    assert.match(overview, /<b>Street Cred<\/b><small>street-cred · 1\.0\.0/);
    assert.match(overview, /<b>Core Lib<\/b><small>core-lib · 1\.2\.0/);
    const res = await post(t, '/admin/mods/street-cred', admin, { action: 'reviewed', version: '1.0.0' });
    assert.equal(res.headers.get('location'), '/admin?tab=overview&note=reviewed');
    assert.ok(!(await page('overview')).includes('<b>Street Cred</b><small>street-cred'), 'reviewed releases leave the list');
    assert.match(await page('log'), /Reviewed a release<\/td><td>street-cred 1\.0\.0<\/td>/);
  });
});
