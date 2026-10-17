import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocklistApi, entryPath, formatEntry, parseEntry, parseEntryPath, repoFromUrl } from '../dist/index.js';

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

test('the blocklist client asks the server with the secret', async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = { url: String(url), auth: init.headers.Authorization };
    return new Response(JSON.stringify({ blocked: true }), { status: 200 });
  };
  const result = await blocklistApi('https://edgemods.ai', 's3cret', fetchFn).check({ ownerId: 1, login: 'a', repoId: 2 });
  assert.deepEqual(result, { blocked: true });
  assert.equal(seen.url, 'https://edgemods.ai/api/v1/registry/blocked?ownerId=1&login=a&repoId=2');
  assert.equal(seen.auth, 'Bearer s3cret');
  const broken = async () => new Response('{}', { status: 200 });
  await assert.rejects(blocklistApi('https://edgemods.ai', 's', broken).check({ ownerId: 1, login: 'a', repoId: 2 }), /unexpected/);
});
