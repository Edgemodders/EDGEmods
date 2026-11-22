// R4b: the extension's core for browsing: what a link on a mod's page may do, the API calls, downloads checked
// against their SHA-256, and the sign-in's state naming the editor for the site's landing page.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const { Api, ApiError, EDITOR_SCHEMES, imagePath, pageLink, Session } = require('../dist/core.js');

const SITE = 'http://localhost:8800';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('links on a mod\'s page', () => {
  test('the site\'s own links', () => {
    assert.deepEqual(pageLink('edgemods://install/street-cred/1.2.0'), { kind: 'install', url: 'edgemods://install/street-cred/1.2.0' });
    assert.deepEqual(pageLink('/download/street-cred/1.2.0/street-cred%201.2.0.zip'), { kind: 'download', mod: 'street-cred', version: '1.2.0', file: 'street-cred 1.2.0.zip' });
    assert.deepEqual(pageLink('/signin?return=%2Fmods%2Fx'), { kind: 'signIn' });
    assert.deepEqual(pageLink('/mods/core-lib'), { kind: 'mod', id: 'core-lib' });
    assert.deepEqual(pageLink('/mods/core-lib?tab=versions'), { kind: 'mod', id: 'core-lib', tab: 'versions' });
    assert.deepEqual(pageLink('/mods/core-lib?tab=nonsense'), { kind: 'mod', id: 'core-lib' });
    assert.deepEqual(pageLink('/mods?type=clothing&tag=outfits&tag=jackets'), { kind: 'browse', q: '', type: ['clothing'], tag: ['outfits', 'jackets'] });
    assert.deepEqual(pageLink('/mods/core-lib/source/docs/README.md'), { kind: 'source', mod: 'core-lib', path: 'docs/README.md' });
    assert.deepEqual(pageLink('/publish'), { kind: 'site', path: '/publish' });
  });

  test('outside links open in the browser; in-page ones stay put', () => {
    assert.deepEqual(pageLink('https://www.nexusmods.com/cyberpunk2077/mods/1'), { kind: 'external', url: 'https://www.nexusmods.com/cyberpunk2077/mods/1' });
    assert.deepEqual(pageLink('#tabs'), { kind: 'none' });
    assert.deepEqual(pageLink('?tab=files#tabs'), { kind: 'none' });
    assert.deepEqual(pageLink('/mods/core-lib/images/shot.png'), { kind: 'none' });
  });

  test('nothing from a README can run or reach the editor', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'command:workbench.action.terminal.new', 'vscode://file/c:/x', 'file:///C:/Windows', '//evil.test/x', 'data:text/html,x', 'relative/path', '']) {
      assert.deepEqual(pageLink(href), { kind: 'none' }, href);
    }
    // A download path that tries to climb out of its folder is not a download.
    assert.notEqual(pageLink('/download/core-lib/1.2.0/..%2F..%2Fevil.dll').kind, 'download');
    assert.notEqual(pageLink('/download/core-lib/not-a-version/x.zip').kind, 'download');
  });

  test('picture paths are encoded a segment at a time', () => {
    assert.equal(imagePath('core-lib', 'docs/a shot#1.png'), '/mods/core-lib/images/docs/a%20shot%231.png');
  });
});

describe('the API for browsing', () => {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? 'GET', path: `${u.pathname}${u.search}`, auth: new Headers(init.headers).get('authorization'), body: init.body });
    if (u.pathname === '/api/v1/me/likes') return json(200, { cards: [] });
    if (u.pathname.endsWith('/like')) return json(200, { liked: JSON.parse(init.body).like, likes: 3 });
    if (u.pathname.endsWith('/report')) return json(200, { sent: true });
    if (u.pathname.endsWith('/view')) return json(200, { id: 'core-lib', name: 'Core Lib', version: '1.2.0', tab: u.searchParams.get('tab') ?? 'about', html: '<main class="wrap"></main>' });
    return json(200, { total: 0, page: 1, pages: 1, cards: [] });
  };
  const api = new Api(SITE, fetchFn, async () => 'at-1');

  test('search, the Liked list and a mod\'s page ask for what they should', async () => {
    await api.search({ q: ' jackets ', sort: 'relevance', page: 2, type: ['clothing'], tag: ['outfits'] });
    await api.search();
    await api.likes();
    await api.modPage('core-lib', 'versions');
    await api.modPage('core-lib', 'about', 'sent');
    assert.deepEqual(calls.splice(0).map((c) => c.path), [
      '/api/v1/mods?q=jackets&sort=relevance&page=2&type=clothing&tag=outfits',
      '/api/v1/mods',
      '/api/v1/me/likes',
      '/api/v1/mods/core-lib/view?tab=versions',
      '/api/v1/mods/core-lib/view?reported=sent',
    ]);
  });

  test('likes and reports are sent with the token, as JSON', async () => {
    assert.deepEqual(await api.like('core-lib', false), { liked: false, likes: 3 });
    assert.equal(await api.report('core-lib', 'broken', 'Crashes'), true);
    const [like, report] = calls.splice(0);
    assert.deepEqual([like.method, like.path, like.auth, JSON.parse(like.body)], ['POST', '/api/v1/mods/core-lib/like', 'Bearer at-1', { like: false }]);
    assert.deepEqual(JSON.parse(report.body), { reason: 'broken', note: 'Crashes' });
  });
});

describe('downloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edgemods-dl-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const BYTES = Buffer.from('a mod archive, as bytes');
  const SHA = createHash('sha256').update(BYTES).digest('hex');

  /** The site redirects to GitHub, which redirects to its file store. */
  function world({ token = 'at-1', bytes = BYTES } = {}) {
    const w = { seen: [] };
    w.fetch = async (url, init = {}) => {
      const u = new URL(url);
      const auth = new Headers(init.headers).get('authorization');
      w.seen.push(`${u.host}${u.pathname} ${auth ?? '-'}`);
      assert.equal(init.redirect, 'manual');
      if (u.origin === SITE) {
        if (auth !== `Bearer ${token}`) return json(401, { error: 'invalid-token' });
        if (u.pathname.includes('nope')) return json(404, { error: 'not-found' });
        return new Response(null, { status: 302, headers: { location: 'https://github.com/alice/core-lib/releases/download/v1.2.0/core-lib.zip' } });
      }
      if (u.host === 'github.com') return new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/x/core-lib.zip?sig=1' } });
      if (u.host === 'objects.githubusercontent.com') return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
      return json(404, {});
    };
    return w;
  }

  test('follows the redirects, never sending the token past the site, and checks the SHA-256', async () => {
    const w = world();
    const api = new Api(SITE, w.fetch, async () => 'at-1');
    const dest = join(dir, 'core-lib.zip');
    const seen = [];
    const r = await api.download('/download/core-lib/1.2.0/core-lib.zip', dest, { sha256: SHA.toUpperCase(), onProgress: (d, t) => seen.push([d, t]) });
    assert.deepEqual(r, { size: BYTES.length, sha256: SHA });
    assert.deepEqual(readFileSync(dest), BYTES);
    assert.equal(existsSync(`${dest}.part`), false);
    assert.deepEqual(w.seen, ['localhost:8800/download/core-lib/1.2.0/core-lib.zip Bearer at-1', 'github.com/alice/core-lib/releases/download/v1.2.0/core-lib.zip -', 'objects.githubusercontent.com/x/core-lib.zip -']);
    assert.deepEqual(seen.at(-1), [BYTES.length, BYTES.length]);
  });

  test('a file that does not match is deleted, and nothing is left behind', async () => {
    const api = new Api(SITE, world({ bytes: Buffer.from('something else') }).fetch, async () => 'at-1');
    const dest = join(dir, 'bad.zip');
    await assert.rejects(api.download('/download/core-lib/1.2.0/core-lib.zip', dest, { sha256: SHA }), (e) => e instanceof ApiError && e.code === 'checksum');
    assert.equal(existsSync(dest), false);
    assert.equal(existsSync(`${dest}.part`), false);
  });

  test('a refused token is renewed once; the site\'s own errors come back in words', async () => {
    const asked = [];
    const api = new Api(SITE, world({ token: 'at-2' }).fetch, async (fresh) => (asked.push(fresh), fresh ? 'at-2' : 'at-1'));
    await api.download('/download/core-lib/1.2.0/core-lib.zip', join(dir, 'again.zip'));
    assert.deepEqual(asked, [false, true]);
    await assert.rejects(api.download('/download/core-lib/1.2.0/nope.zip', join(dir, 'nope.zip')), (e) => e instanceof ApiError && e.status === 404 && /does not have/.test(e.message));
  });

  test('needs a sign-in, and refuses a redirect away from https', async () => {
    await assert.rejects(new Api(SITE, world().fetch, async () => undefined).download('/download/x/1.0.0/x.zip', join(dir, 'x.zip')), (e) => e.code === 'sign-in');
    const plain = async (url) => (new URL(url).origin === SITE ? new Response(null, { status: 302, headers: { location: 'http://insecure.test/x.zip' } }) : json(200, {}));
    await assert.rejects(new Api(SITE, plain, async () => 'at-1').download('/download/x/1.0.0/x.zip', join(dir, 'y.zip')), (e) => e.code === 'redirect');
  });
});

describe('signing in through the site\'s landing page', () => {
  test('the state starts with the editor\'s scheme, and the code goes back to the landing page address', async () => {
    const store = { m: new Map(), get: async (k) => store.m.get(k), store: async (k, v) => void store.m.set(k, v), delete: async (k) => void store.m.delete(k) };
    const info = { domain: 'tenant.test', clientId: 'vscode-1', audience: 'https://edgemods.ai/api', scope: 'openid', connections: { github: 'github' } };
    const session = new Session(SITE, store, async () => json(200, info));
    const { url, done } = await session.begin(`${SITE}/auth/vscode`, 'github', 'cursor');
    done.catch(() => undefined);
    const q = new URL(url).searchParams;
    assert.match(q.get('state'), /^cursor\.[A-Za-z0-9_-]{32}$/);
    assert.equal(q.get('redirect_uri'), `${SITE}/auth/vscode`);
    session.cancel();
  });

  test('the editors match the server\'s list', () => {
    const app = readFileSync(new URL('../../../packages/server/src/app.ts', import.meta.url), 'utf8');
    const server = /EDITOR_SCHEMES = (\[[^\]]+\])/.exec(app)[1].replaceAll("'", '"');
    assert.deepEqual(EDITOR_SCHEMES, JSON.parse(server));
  });
});
