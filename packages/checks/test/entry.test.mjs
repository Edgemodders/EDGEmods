import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { blocklistApi, entryPath, sendCheckResult, formatEntry, parseEntry, parseEntryPath, repoFromUrl } from '../dist/index.js';

test('entry paths', () => {
  assert.deepEqual(parseEntryPath('registry/octo-modder/better-car-radio.json'), { owner: 'octo-modder', id: 'better-car-radio' });
  assert.equal(parseEntryPath('registry/octo-modder/Better.json'), undefined);
  assert.equal(parseEntryPath('registry/octo-modder/nested/x-y.json'), undefined);
  assert.equal(parseEntryPath('registry/-bad-/abc.json'), undefined);
  assert.equal(parseEntryPath('registry/README.md'), undefined);
  assert.equal(entryPath('octo-modder', 'abc'), 'registry/octo-modder/abc.json');
});

test('repository addresses', () => {
  assert.equal(repoFromUrl('https://github.com/octo-modder/example-mod'), 'octo-modder/example-mod');
  assert.equal(repoFromUrl('https://github.com/octo-modder/example-mod.git'), undefined);
  assert.equal(repoFromUrl('https://github.com/octo-modder/example-mod/'), undefined);
  assert.equal(repoFromUrl('http://github.com/a/b'), undefined);
  assert.equal(repoFromUrl('https://gitlab.com/a/b'), undefined);
  assert.equal(repoFromUrl('https://github.com/a/..'), undefined);
});

test('entries round-trip', () => {
  const entry = { schemaVersion: 1, repo: 'https://github.com/a/b', repoId: 1, ownerId: 2 };
  assert.deepEqual(parseEntry(formatEntry(entry)), { entry, issues: [] });
  assert.equal(parseEntry('{"schemaVersion":1}').issues.length, 3);
});

test('the blocklist client asks the website, signed with the secret', async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = { url: String(url), method: init.method, body: init.body, sig: init.headers['X-EDGEmods-Signature'] };
    return new Response(JSON.stringify({ blocked: true, github: true, repo: false }), { status: 200 });
  };
  const result = await blocklistApi('https://edgemods.ai', 's3cret', fetchFn).check({ ownerId: 1, login: 'a', repoId: 2 });
  assert.deepEqual(result, { blocked: true });
  assert.equal(seen.url, 'https://edgemods.ai/api/v1/blocklist/check');
  assert.equal(seen.method, 'POST');
  assert.deepEqual(JSON.parse(seen.body), { github: 1, repo: 2 });
  assert.equal(seen.sig, `sha256=${createHmac('sha256', 's3cret').update(seen.body).digest('hex')}`);
  const broken = async () => new Response('{}', { status: 200 });
  await assert.rejects(blocklistApi('https://edgemods.ai', 's', broken).check({ ownerId: 1, login: 'a', repoId: 2 }), /unexpected/);
  await assert.rejects(blocklistApi('https://edgemods.ai', 's', async () => new Response('', { status: 503 })).check({ ownerId: 1, login: 'a', repoId: 2 }), /503/);
});

test('a passing result goes to the website, signed; a failing one never does', async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = { url: String(url), body: init.body, sig: init.headers['X-EDGEmods-Signature'] };
    return new Response(null, { status: 204 });
  };
  const result = { ok: true, steps: [], downloads: [{ name: 'm.zip', size: 1, sha256: 'ab'.repeat(32), contents: {} }], mod: { id: 'm', name: 'M', version: '1.0.0', owner: 'a', repo: 'a/m', repoId: 2 } };
  await sendCheckResult('https://edgemods.ai', 's3cret', result, fetchFn, new Date('2026-11-22T00:00:00Z'));
  assert.equal(seen.url, 'https://edgemods.ai/api/v1/checks');
  assert.deepEqual(JSON.parse(seen.body), { mod: 'm', version: '1.0.0', ok: true, checkedAt: '2026-11-22T00:00:00.000Z', downloads: result.downloads, steps: [] });
  assert.equal(seen.sig, `sha256=${createHmac('sha256', 's3cret').update(seen.body).digest('hex')}`);
  seen = undefined;
  await assert.rejects(sendCheckResult('https://edgemods.ai', 's', { ...result, ok: false }, fetchFn), /only a passing result/);
  assert.equal(seen, undefined);
});
