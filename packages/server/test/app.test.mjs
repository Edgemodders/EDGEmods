import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ftsQuery } from '../dist/index.js';
import { PNG, sign, start } from './helpers.mjs';

describe('as a visitor', () => {
  let t;
  before(async () => (t = await start()));
  after(() => t.close());

  test('only releases that passed their checks show; the newest passed one is shown', async () => {
    const { cards, total } = await t.json('/api/v1/mods');
    assert.deepEqual(cards.map((c) => c.id).sort(), ['core-lib', 'pinned-hud', 'street-cred']);
    assert.equal(total, 3);
    // core-lib 1.3.0 failed its checks, so 1.2.0 is what players see.
    assert.equal(cards.find((c) => c.id === 'core-lib').version, '1.2.0');
    assert.equal((await t.get('/mods/unchecked')).status, 404);
    const core = await t.json('/api/v1/mods/core-lib');
    assert.deepEqual(core.releases.map((r) => r.version), ['1.2.0', '1.0.0']);
  });

  test('adult mods are left out for visitors, in pages and the API', async () => {
    assert.ok(!(await t.text('/mods')).includes('spicy'));
    assert.match(await t.text('/'), /<b>3<\/b>mods/, 'the home page counts what a visitor can see');
    const page = await t.get('/mods/spicy');
    assert.equal(page.status, 403);
    assert.match(await page.text(), /for <span>adults<\/span>/);
    assert.equal((await t.get('/api/v1/mods/spicy')).status, 404);
  });

  test('nothing a visitor gets gives a repository away', async () => {
    for (const path of ['/', '/mods', '/mods/street-cred', '/mods/street-cred?tab=files', '/mods/street-cred?tab=versions', '/api/v1/mods', '/api/v1/mods/street-cred', '/api/v1/mods/street-cred/install-plan']) {
      const body = await t.text(path);
      assert.ok(!/github\.com\/bob|bob\/street-cred|releases\/download|"repo"|ownerLogin/.test(body), `${path} leaks the repository`);
    }
    const plan = await t.json('/api/v1/mods/street-cred/install-plan');
    assert.ok(plan.mods.every((m) => m.files.every((f) => !f.download)), 'download links need sign-in');
    const source = await t.get('/mods/street-cred/source/README.md');
    assert.equal(source.status, 403);
  });

  test('pages are safe: the policy, no scripts from READMEs, escaped values', async () => {
    const res = await t.get('/mods/street-cred');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'.*script-src 'self'.*frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const body = await res.text();
    assert.ok(!body.includes('<script>alert'), 'the README\'s script is gone');
    assert.match(body, /<h1>Street Cred<\/h1>/);
    const search = await t.text('/mods?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    assert.ok(!search.includes('<img src=x'), 'the search words are escaped');
    assert.match(search, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  test('search, facets and filters', async () => {
    const hit = await t.json('/api/v1/mods?q=street');
    assert.deepEqual(hit.cards.map((c) => c.id), ['street-cred']);
    const syntax = await t.json('/api/v1/mods?q=street%22*%20(');
    assert.deepEqual(syntax.cards.map((c) => c.id), ['street-cred'], 'search syntax is not passed through');

    const all = await t.json('/api/v1/mods');
    assert.deepEqual(all.facets.type.map((f) => [f.value, f.count]), [['gameplay', 1], ['ui', 1], ['utility', 1]]);
    assert.deepEqual(all.facets.needs.find((f) => f.value === 'core-lib'), { value: 'core-lib', label: 'Core Lib', count: 2 });
    assert.equal(all.facets.nocode, 2, 'core-lib runs code');

    const needs = await t.json('/api/v1/mods?needs=core-lib&tag=balance');
    assert.deepEqual(needs.cards.map((c) => c.id).sort(), ['pinned-hud', 'street-cred']);
    const anyType = await t.json('/api/v1/mods?type=ui&type=utility');
    assert.deepEqual(anyType.cards.map((c) => c.id).sort(), ['core-lib', 'pinned-hud']);
    const nocode = await t.json('/api/v1/mods?nocode=1');
    assert.ok(!nocode.cards.some((c) => c.id === 'core-lib'));
    assert.equal(ftsQuery('a"b OR c*'), '"a"* "b"* "OR"* "c"*');
  });

  test('the install plan resolves the chain from checked releases', async () => {
    const plan = await t.json('/api/v1/mods/pinned-hud/install-plan');
    assert.deepEqual(plan.mods.map((m) => `${m.id}@${m.version}`), ['core-lib@1.2.0', 'pinned-hud@1.0.0']);
    assert.deepEqual(plan.problems, []);
    const missing = await t.get('/api/v1/mods/unchecked/install-plan');
    assert.equal(missing.status, 404);
  });

  test('the mod page: tabs, versions, requirements and what installing brings', async () => {
    const page = await t.text('/mods/street-cred?tab=needs');
    assert.match(page, /data-panel="needs">/);
    assert.match(page, /data-panel="about" hidden/);
    assert.match(page, /What installing brings/);
    assert.match(page, /<b>Core Lib<\/b> 1.2.0/);
    assert.match(page, /nexusmods.com.*not checked by EDGEmods/s);
    const versions = await t.text('/mods/core-lib?tab=versions');
    assert.match(versions, /Notes for 1.2.0/);
    assert.ok(!versions.includes('Notes for 1.3.0'), 'the failed release is not listed');
    assert.match(await t.text('/mods/core-lib'), /game plugin or program/);
  });

  test('images: only paths in the index, checked as images, from the cache after the first time', async () => {
    const one = await t.get('/mods/street-cred/images/images/card.png');
    assert.equal(one.status, 200);
    assert.equal(one.headers.get('content-type'), 'image/png');
    assert.equal(one.headers.get('content-security-policy'), "default-src 'none'");
    assert.deepEqual(Buffer.from(await one.arrayBuffer()), PNG);
    assert.equal((await t.get('/mods/street-cred/images/images/card.png')).status, 200);
    assert.equal(t.fetched.length, 1, 'fetched from GitHub once');
    assert.match(t.fetched[0], /^https:\/\/raw\.githubusercontent\.com\/bob\/street-cred\/v1\.0\.0\/images\/card\.png$/);
    assert.equal((await t.get('/mods/street-cred/images/edgemods.json')).status, 404);
    assert.equal((await t.get('/mods/unchecked/images/images/card.png')).status, 404);
  });

  test('the schema, health and assets', async () => {
    const schema = await t.get('/schema/edgemods-1.json');
    assert.match(schema.headers.get('content-type'), /^application\/schema\+json/);
    assert.equal((await schema.json()).$id, 'https://edgemods.ai/schema/edgemods-1.json');
    assert.deepEqual(await t.json('/healthz').then((h) => [h.ok, h.mods]), [true, 4], 'health counts every mod that shows, adult ones too');
    assert.equal((await t.get('/assets/fonts/rajdhani/rajdhani-latin-400-normal.woff2')).status, 200);
    assert.equal((await t.get('/assets/fonts/rajdhani/../../../../package.json')).status, 404);
    assert.equal((await t.get('/nope')).status, 404);
    assert.equal((await t.get('/api/v1/nope')).status, 404);
  });
});

describe('moderation, adult opt-in and check results', () => {
  test('a hidden mod does not show anywhere', async () => {
    const t = await start();
    try {
      t.site.setModeration('street-cred', 'hidden', 'admin@example.com', 'test');
      assert.equal((await t.get('/mods/street-cred')).status, 404);
      assert.ok(!(await t.json('/api/v1/mods')).cards.some((c) => c.id === 'street-cred'));
      const plan = await t.json('/api/v1/mods/pinned-hud/install-plan');
      assert.deepEqual(plan.problems, []);
      const needsHidden = await t.json('/api/v1/mods/street-cred/install-plan');
      assert.match(needsHidden.problems[0], /not on EDGEmods/);
    } finally {
      await t.close();
    }
  });

  test('signed-in people who opted in see adult mods, the repository and download links', async () => {
    const t = await start({ viewer: { name: 'Vee', admin: false, adult: true } });
    try {
      assert.equal((await t.get('/mods/spicy')).status, 200);
      const api = await t.json('/api/v1/mods/street-cred');
      assert.equal(api.repo, 'bob/street-cred');
      const plan = await t.json('/api/v1/mods/street-cred/install-plan');
      assert.equal(plan.mods[0].files[0].download, 'https://edgemods.test/download/core-lib/1.2.0/core-lib-1.2.0.zip');
      const source = await t.get('/mods/street-cred/source/docs/a%20b.md');
      assert.equal(source.status, 302);
      assert.equal(source.headers.get('location'), 'https://github.com/bob/street-cred/blob/v1.0.0/docs/a%20b.md');
    } finally {
      await t.close();
    }
  });

  test('check results are accepted only with the right signature, and then the release shows', async () => {
    const off = await start();
    try {
      assert.equal((await off.get('/api/v1/checks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 503);
    } finally {
      await off.close();
    }
    const secret = 'a-test-secret';
    const t = await start({ checksSecret: secret });
    try {
      const body = JSON.stringify({ mod: 'unchecked', version: '1.0.0', ok: true, checkedAt: '2026-10-21T00:00:00Z', downloads: [], steps: [] });
      const post = (sig, b = body) => t.get('/api/v1/checks', { method: 'POST', headers: { 'content-type': 'application/json', 'x-edgemods-signature': sig }, body: b });
      assert.equal((await post('sha256=' + '0'.repeat(64))).status, 401);
      assert.equal((await post(sign('wrong', body))).status, 401);
      assert.equal((await post(undefined)).status, 401);
      assert.equal((await t.get('/mods/unchecked')).status, 404);
      assert.equal((await post(sign(secret, body))).status, 204);
      assert.equal((await t.get('/mods/unchecked')).status, 200);
      const bad = JSON.stringify({ mod: 'x', version: 'not-a-version', ok: true, downloads: [] });
      assert.equal((await post(sign(secret, bad), bad)).status, 400);
      // An older result does not replace a newer one.
      const older = JSON.stringify({ mod: 'unchecked', version: '1.0.0', ok: false, checkedAt: '2026-10-01T00:00:00Z', downloads: [] });
      assert.equal((await post(sign(secret, older), older)).status, 204);
      assert.equal((await t.get('/mods/unchecked')).status, 200);
    } finally {
      await t.close();
    }
  });

  test('a developer can show releases with no check result', async () => {
    const t = await start({ showUnchecked: true });
    try {
      assert.equal((await t.get('/mods/unchecked')).status, 200);
      // Showing unchecked releases includes the newest, even the one that failed: it has a result, but this mode ignores results.
      assert.equal((await t.json('/api/v1/mods/core-lib')).version, '1.3.0');
    } finally {
      await t.close();
    }
  });

  test('an index in another format is refused and the old one kept', async () => {
    const t = await start();
    try {
      assert.throws(() => t.catalog.reload(`${t.dir}/missing.db`), /no index/);
      assert.equal((await t.json('/healthz')).mods, 4);
    } finally {
      await t.close();
    }
  });
});
