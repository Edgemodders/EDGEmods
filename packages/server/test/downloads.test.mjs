// R3d: the download link, counts, the Downloaded mods tab and the first Admin page.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../dist/index.js';
import { fakeTenant, ORIGIN, signIn, start } from './helpers.mjs';

const person = (n) => ({ sub: `google-oauth2|${n}`, name: `Player ${n}`, email: `p${n}@example.com`, email_verified: true });
const ADMIN = { sub: 'google-oauth2|900', name: 'Ada', email: 'admin@example.com', email_verified: true };
const post = (t, path, cookie, body = {}, headers = {}) => t.get(path, {
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}), ...headers },
  body: new URLSearchParams(body),
});

describe('downloading', () => {
  let t;
  let tenant;
  before(async () => {
    tenant = fakeTenant();
    t = await start({ tenant, admins: ['admin@example.com'] });
  });
  after(() => t.close());
  const as = async (n) => (await signIn(t, tenant, person(n), { method: 'google', username: `player${n}` })).cookie;

  test('needs a sign-in; visitors come back to the mod\'s files', async () => {
    const res = await t.get('/download/street-cred/1.0.0/street-cred-1.0.0.zip');
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/signin?return=%2Fmods%2Fstreet-cred%3Ftab%3Dfiles');
  });

  test('sends a signed-in person to the file on GitHub, and counts once per file and day', async () => {
    const cookie = await as(1);
    const res = await t.get('/download/street-cred/1.0.0/street-cred-1.0.0.zip', { headers: { cookie } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://github.com/bob/street-cred/releases/download/v1.0.0/street-cred-1.0.0.zip');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    await t.get('/download/street-cred/1.0.0/street-cred-1.0.0.zip', { headers: { cookie } });
    await t.get('/download/street-cred/1.0.0/street-cred-1.0.0.zip', { method: 'HEAD', headers: { cookie } });
    assert.equal(t.site.downloadCount('street-cred'), 1);
    await t.get('/download/street-cred/1.0.0/street-cred-1.0.0.zip', { headers: { cookie: await as(2) } });
    const card = (await t.json('/api/v1/mods?sort=downloads')).cards[0];
    assert.equal(card.id, 'street-cred');
    assert.equal(card.downloads, 2);
    assert.match(await t.text('/mods/street-cred'), /<dt>Downloads<\/dt><dd>2<\/dd>/);
    const browse = await t.text('/mods?sort=downloads');
    assert.match(browse, /<option value="downloads" selected>Most downloaded<\/option>/);
    assert.match(browse, /<option value="likes">Most liked<\/option>/);
    assert.doesNotMatch(browse, /value="relevance"/);
  });

  test('only files of releases that show', async () => {
    const cookie = await as(3);
    for (const path of ['/download/street-cred/1.0.0/other.zip', '/download/core-lib/1.3.0/core-lib-1.3.0.zip', '/download/unchecked/1.0.0/unchecked-1.0.0.zip',
      '/download/spicy/1.0.0/spicy-1.0.0.zip', '/download/nothing/1.0.0/x.zip']) {
      assert.equal((await t.get(path, { headers: { cookie } })).status, 404, path);
    }
    assert.equal(t.site.downloadCount('core-lib'), 0);
  });

  test('Downloaded mods shows the version you got, and when a newer one is out', async () => {
    const cookie = await as(4);
    await t.get('/download/core-lib/1.0.0/core-lib-1.0.0.zip', { headers: { cookie } });
    await t.get('/download/street-cred/1.0.0/street-cred-1.0.0.zip', { headers: { cookie } });
    const page = await (await t.get('/me?tab=downloads', { headers: { cookie } })).text();
    assert.match(page, /Downloaded mods \(2\)/);
    assert.match(page, /<b>Core Lib<\/b><\/a><small>core-lib<\/small><\/td>\s*<td class="n">1\.0\.0<\/td>.*Newer version: 1\.2\.0/s);
    assert.match(page, /<b>Street Cred<\/b>.*Up to date/s);
    assert.match(page, /<a href="\/me\?tab=downloads">Downloaded mods<\/a>/, 'in the account menu');
    const data = await (await t.get('/me/data', { headers: { cookie } })).json();
    assert.deepEqual(data.downloads.map((d) => d.mod).sort(), ['core-lib', 'street-cred']);
  });

  test('a deleted account\'s downloads still count', async () => {
    const { cookie } = await signIn(t, tenant, person(5), { method: 'google', username: 'player5' });
    await t.get('/download/pinned-hud/1.0.0/pinned-hud-1.0.0.zip', { headers: { cookie } });
    assert.equal(t.site.downloadCount('pinned-hud'), 1);
    await post(t, '/me/delete', cookie, { confirm: '1' });
    assert.equal(t.site.user('google-oauth2|5'), undefined);
    assert.equal(t.site.downloadCount('pinned-hud'), 1);
  });

  test('the Admin page is for admins, from the account menu', async () => {
    assert.equal((await t.get('/admin')).status, 303, 'visitors sign in');
    const player = await as(6);
    assert.equal((await t.get('/admin', { headers: { cookie: player } })).status, 403);
    assert.ok(!(await (await t.get('/mods', { headers: { cookie: player } })).text()).includes('href="/admin"'));
    const admin = (await signIn(t, tenant, ADMIN, { method: 'google', username: 'ada' })).cookie;
    t.site.log('ada', 'Hid a mod', 'street-cred');
    const page = await (await t.get('/admin', { headers: { cookie: admin } })).text();
    assert.match(page, /<h1>Ad<span>min<\/span><\/h1>/);
    assert.match(page, /<p class="label">Free speed<\/p><div class="big">3 MB\/s<\/div><small>not applied: this server sends downloads to GitHub<\/small>/);
    assert.match(page, /<td>ada<\/td><td>Hid a mod<\/td><td>street-cred<\/td>/, 'the log');
    assert.ok(!page.includes('freeModsPerMonth'), 'no monthly limit');
    assert.match(await (await t.get('/mods', { headers: { cookie: admin } })).text(), /<a href="\/admin">Admin<\/a>/);
  });

  test('no limit on how many mods: every mod stays free to download', async () => {
    const cookie = await as(7);
    for (const path of ['/download/street-cred/1.0.0/street-cred-1.0.0.zip', '/download/core-lib/1.2.0/core-lib-1.2.0.zip', '/download/core-lib/1.0.0/core-lib-1.0.0.zip', '/download/pinned-hud/1.0.0/pinned-hud-1.0.0.zip']) {
      assert.equal((await t.get(path, { headers: { cookie } })).status, 302, path);
    }
    assert.equal((await t.get('/admin/settings', { method: 'POST', headers: { cookie, origin: ORIGIN } })).status, 404, 'no limit setting');
  });
});

describe('downloads through nginx', () => {
  let t;
  let tenant;
  const asked = [];
  let answer = 'https://objects.githubusercontent.com/github-production-release-asset/123?X-Amz-Signature=abc&response-content-disposition=attachment';
  before(async () => {
    tenant = fakeTenant();
    t = await start({
      tenant,
      downloads: { mode: 'nginx', freeSpeed: 3145728 },
      githubFetch: async (url, init) => {
        asked.push({ url, accept: new Headers(init.headers).get('accept'), redirect: init.redirect });
        return new Response(null, { status: 302, headers: { location: answer } });
      },
    });
  });
  after(() => t.close());

  test('hands GitHub\'s signed address to nginx at the free speed', async () => {
    const { cookie } = await signIn(t, tenant, person(10), { method: 'google', username: 'player10' });
    const res = await t.get('/download/street-cred/1.0.0/street-cred-1.0.0.zip', { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-accel-redirect'), '/_edgemods/github/objects.githubusercontent.com/github-production-release-asset/123?X-Amz-Signature=abc&response-content-disposition=attachment');
    assert.equal(res.headers.get('x-accel-limit-rate'), '3145728');
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="street-cred-1.0.0.zip"');
    assert.deepEqual(asked.at(-1), { url: 'https://api.github.com/repos/bob/street-cred/releases/assets/200', accept: 'application/octet-stream', redirect: 'manual' });
    assert.equal(t.site.downloadCount('street-cred'), 1);
  });

  test('an address on any other host is refused, and not counted', async () => {
    answer = 'https://evil.test/file.zip';
    const { cookie } = await signIn(t, tenant, person(11), { method: 'google', username: 'player11' });
    const res = await t.get('/download/pinned-hud/1.0.0/pinned-hud-1.0.0.zip', { headers: { cookie } });
    assert.equal(res.status, 502);
    assert.match(await res.text(), /Download did not <span>start<\/span>/);
    assert.equal(t.site.downloadCount('pinned-hud'), 0);
  });
});

describe('download settings', () => {
  test('redirect by default, 3 MB/s free; nginx and the speed from the environment', () => {
    assert.deepEqual(loadConfig({}).downloads, { mode: 'redirect', freeSpeed: 3 * 1024 * 1024, githubToken: undefined });
    const set = loadConfig({ EDGEMODS_DOWNLOADS: 'nginx', EDGEMODS_FREE_SPEED: '2.5', EDGEMODS_GITHUB_TOKEN: 'tok' }).downloads;
    assert.deepEqual(set, { mode: 'nginx', freeSpeed: 2621440, githubToken: 'tok' });
    assert.throws(() => loadConfig({ EDGEMODS_DOWNLOADS: 'cdn' }), /redirect or nginx/);
    assert.throws(() => loadConfig({ EDGEMODS_FREE_SPEED: '0' }), /MB a second/);
  });
});
