// R4b: what the VS Code extension uses to browse: a mod's page for an editor tab, likes and reports through the API,
// the Liked list, the site's stylesheet and fonts from another origin, and the sign-in's landing page.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { fakeTenant, ORIGIN, start } from './helpers.mjs';

const GITHUB = { sub: 'github|5150', nickname: 'Tabber', name: 'Tab Ber', email: 'tab@example.com', email_verified: true };
const bearer = (token) => ({ authorization: `Bearer ${token}`, accept: 'application/json' });
const json = (token, body) => ({ method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('browsing from VS Code', () => {
  let t;
  let tenant;
  let token;
  before(async () => {
    tenant = fakeTenant();
    tenant.profiles[GITHUB.sub] = GITHUB;
    t = await start({ tenant });
    token = tenant.access(GITHUB.sub);
    // A username first, as the extension asks for one after the first sign-in.
    const res = await t.get('/api/v1/me/username', json(token, { username: 'Tabber' }));
    assert.equal(res.status, 200);
  });
  after(() => t.close());

  test('a mod\'s page for a tab: the website\'s content without its frame, with Install', async () => {
    const res = await t.get('/api/v1/mods/street-cred/view?tab=files', { headers: bearer(token) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const view = await res.json();
    assert.equal(view.id, 'street-cred');
    assert.equal(view.tab, 'files');
    assert.match(view.html, /^<main class="wrap">/);
    assert.doesNotMatch(view.html, /<html|<header class="bar"|<script|<footer/);
    assert.match(view.html, /href="edgemods:\/\/install\/street-cred\/[^"]+"[^>]*>.*Install<\/a>/s);
    assert.doesNotMatch(view.html, /Mod manager/);
    assert.match(view.html, /data-tab="files" aria-selected="true"/);
    // Signed in: download links and the source.
    assert.match(view.html, /href="\/download\/street-cred\//);
    assert.match(view.html, /class="likeform/);
  });

  test('a visitor\'s tab has no download links and nothing that names the repository', async () => {
    const view = await (await t.get('/api/v1/mods/street-cred/view')).json();
    assert.equal(view.tab, 'about');
    assert.doesNotMatch(view.html, /\/download\/|github\.com|edgemods:\/\//);
    assert.match(view.html, /Sign in to download/);
  });

  test('a tab for an unknown or adult mod answers in JSON', async () => {
    const missing = await t.get('/api/v1/mods/nope/view', { headers: bearer(token) });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'not-found' });
    const adult = await t.get('/api/v1/mods/spicy/view', { headers: bearer(token) });
    assert.equal(adult.status, 403);
    assert.equal((await adult.json()).error, 'adult');
  });

  test('likes through a token, and the Liked list', async () => {
    const on = await t.get('/api/v1/mods/core-lib/like', json(token, { like: true }));
    assert.equal(on.status, 200);
    assert.deepEqual(await on.json(), { liked: true, likes: 1 });
    const list = await (await t.get('/api/v1/me/likes', { headers: bearer(token) })).json();
    assert.deepEqual(list.cards.map((c) => c.id), ['core-lib']);
    const off = await (await t.get('/api/v1/mods/core-lib/like', json(token, { like: false }))).json();
    assert.deepEqual(off, { liked: false, likes: 0 });
    assert.equal((await (await t.get('/api/v1/me/likes', { headers: bearer(token) })).json()).cards.length, 0);
  });

  test('likes and the Liked list need a sign-in; a cookie write needs the same origin', async () => {
    const like = await t.get('/api/v1/mods/core-lib/like', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{"like":true}' });
    assert.equal(like.status, 401);
    assert.equal((await t.get('/api/v1/me/likes')).status, 401);
    const cross = await t.get('/api/v1/mods/core-lib/like', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', origin: 'https://evil.test' }, body: '{"like":true}' });
    assert.equal(cross.status, 403);
  });

  test('reports through a token: one open report per person and mod; a reason is needed', async () => {
    const bad = await t.get('/api/v1/mods/street-cred/report', json(token, { reason: 'nonsense' }));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'reason');
    const first = await (await t.get('/api/v1/mods/street-cred/report', json(token, { reason: 'broken', note: 'Crashes\u0007 on load' }))).json();
    assert.deepEqual(first, { sent: true });
    const again = await (await t.get('/api/v1/mods/street-cred/report', json(token, { reason: 'broken' }))).json();
    assert.deepEqual(again, { sent: false });
    const report = t.site.reports('all').find((r) => r.modId === 'street-cred');
    assert.equal(report.note, 'Crashes on load');
    // The tab can say so.
    const view = await (await t.get('/api/v1/mods/street-cred/view?reported=already', { headers: bearer(token) })).json();
    assert.match(view.html, /You already reported this mod/);
  });

  test('the stylesheet and fonts may be used from another origin', async () => {
    const css = await t.get('/assets/site.css');
    assert.equal(css.headers.get('access-control-allow-origin'), '*');
    const font = await t.get('/assets/fonts/rajdhani/rajdhani-latin-400-normal.woff2');
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('access-control-allow-origin'), '*');
    const page = await t.get('/mods');
    assert.equal(page.headers.get('access-control-allow-origin'), null);
  });
});

describe('the VS Code sign-in\'s landing page', () => {
  let t;
  before(async () => {
    t = await start({ tenant: fakeTenant() });
  });
  after(() => t.close());

  const STATE = 'vscode.abcdefghijklmnopqrstuvwxyz012345';
  const handoff = (body) => /<a class="btn go" href="([^"]+)" data-handoff>/.exec(body)?.[1]?.replaceAll('&amp;', '&');

  test('hands the code and state to the editor named in the state', async () => {
    const res = await t.get(`/auth/vscode?code=AbC-123_x&state=${STATE}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.text();
    assert.match(body, /Back to <span>VS Code<\/span>/);
    assert.equal(handoff(body), `vscode://edgemodders.edgemods/auth?code=AbC-123_x&state=${STATE}`);
  });

  test('other editors from the list: Cursor, Insiders', async () => {
    for (const scheme of ['cursor', 'vscode-insiders']) {
      const state = STATE.replace('vscode', scheme);
      const body = await (await t.get(`/auth/vscode?code=c0de&state=${state}`)).text();
      assert.equal(handoff(body), `${scheme}://edgemodders.edgemods/auth?code=c0de&state=${state}`);
    }
  });

  test('a cancelled sign-in goes back too, so VS Code stops waiting and says why', async () => {
    const body = await (await t.get(`/auth/vscode?error=access_denied&error_description=User%20cancelled&state=${STATE}`)).text();
    assert.match(body, /Sign-in did not <span>finish<\/span>/);
    assert.equal(handoff(body), `vscode://edgemodders.edgemods/auth?error=access_denied&state=${STATE}`);
  });

  test('odd values are dropped, never passed on', async () => {
    const body = await (await t.get(`/auth/vscode?code=${encodeURIComponent('a"><script>')}&state=${STATE}`)).text();
    assert.equal(handoff(body), `vscode://edgemodders.edgemods/auth?error=no_code&state=${STATE}`);
  });

  test('refuses a state that names no editor on the list', async () => {
    for (const state of ['javascript.abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyz', 'vscode.short', '']) {
      const res = await t.get(`/auth/vscode?code=c0de&state=${encodeURIComponent(state)}`);
      assert.equal(res.status, 400, state);
      assert.equal(handoff(await res.text()), undefined);
    }
  });
});
