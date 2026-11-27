// REDnode packages in a download: reading their rednode-app.json, and whether the download can go straight into
// REDnode's app folders (the in-game browser, docs/design.md "REDnode mods and the in-game browser").
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { listZip, readSmallFiles, rednodeContents, rednodeManifests, summarize, withRednode } from '../dist/index.js';
import { makeZip } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'edgemods-rednode-'));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const zip = (entries) => {
  const path = join(dir, `z${n++}.zip`);
  writeFileSync(path, makeZip(entries));
  return path;
};
const app = (o) => JSON.stringify({ id: 'radio', name: 'Radio', version: '1.0.0', entry: 'index.html', width: 400, height: 300, ...o });

async function contents(entries) {
  const file = zip(entries);
  const list = await listZip(file);
  const rednode = rednodeContents(list, await readSmallFiles(file, 'a.zip', rednodeManifests(list)));
  return { rednode, summary: withRednode(summarize(list), list, rednode) };
}

test('reads small files out of a zip, stored or deflated, and leaves out larger ones', async () => {
  const file = zip([
    { path: 'a.json', data: '{"a":1}' },
    { path: 'b.json', data: '{"b":2}'.repeat(50), deflate: true },
    { path: 'big.bin', data: 'x'.repeat(5000) },
  ]);
  const got = await readSmallFiles(file, 'a.zip', ['a.json', 'b.json', 'big.bin', 'missing'], 4096);
  assert.equal(got.get('a.json').toString(), '{"a":1}');
  assert.equal(got.get('b.json').toString(), '{"b":2}'.repeat(50));
  assert.equal(got.has('big.bin'), false);
  assert.equal(got.has('missing'), false);
});

test('a download with no rednode-app.json has no REDnode contents', async () => {
  const { rednode, summary } = await contents([{ path: 'archive/pc/mod/a.archive', data: 'x' }]);
  assert.equal(rednode, undefined);
  assert.equal(summary.rednode, undefined);
});

test('a package laid out as the game folder is REDnode only; its files are REDnode files', async () => {
  const { rednode, summary } = await contents([
    { path: 'red4ext/plugins/REDnode/apps/radio/rednode-app.json', data: app({ permissions: ['agent'], requires: { rednode: '>=0.56.0' } }), deflate: true },
    { path: 'red4ext/plugins/REDnode/apps/radio/index.html', data: '<p>hi</p>' },
    { path: 'red4ext/plugins/REDnode/apps/radio/app.js', data: '1' },
    { path: 'LICENSE.txt', data: 'MIT' },
  ]);
  assert.equal(rednode.only, true);
  assert.deepEqual(rednode.packages, [{
    id: 'radio', name: 'Radio', version: '1.0.0', folder: 'red4ext/plugins/REDnode/apps/radio',
    window: true, hud: false, node: false, service: false, permissions: ['agent'], rednode: '>=0.56.0',
  }]);
  assert.equal(summary.kinds.rednode, 3);
  assert.deepEqual(summary.runsCode, [], 'a page alone runs in REDnode\'s sandbox');
});

test('a package at the top, or in a folder at the top, is REDnode only', async () => {
  assert.equal((await contents([{ path: 'rednode-app.json', data: app() }, { path: 'index.html', data: '' }])).rednode.only, true);
  assert.equal((await contents([{ path: 'radio/rednode-app.json', data: app() }, { path: 'radio/index.html', data: '' }])).rednode.only, true);
});

test('a Node mod or a service runs code, so the page warns', async () => {
  const { rednode, summary } = await contents([
    { path: 'radio/rednode-app.json', data: app({ entry: 'hud.html', kind: 'hud', main: 'mod.js', service: 'svc.js' }) },
    { path: 'radio/mod.js', data: '' },
  ]);
  assert.deepEqual([rednode.packages[0].hud, rednode.packages[0].window, rednode.packages[0].node, rednode.packages[0].service], [true, false, true, true]);
  assert.deepEqual(summary.runsCode, ['radio/rednode-app.json']);
});

test('anything outside the packages, or a plugin inside one, needs EDGEdeck', async () => {
  const withArchive = await contents([
    { path: 'radio/rednode-app.json', data: app() },
    { path: 'archive/pc/mod/radio.archive', data: 'x' },
  ]);
  assert.equal(withArchive.rednode.only, false);
  const withDll = await contents([{ path: 'radio/rednode-app.json', data: app() }, { path: 'radio/native.dll', data: 'x' }]);
  assert.equal(withDll.rednode.only, false);
  assert.equal(withDll.summary.kinds.plugin, 1);
  const elsewhere = await contents([{ path: 'mods/radio/rednode-app.json', data: app() }]);
  assert.equal(elsewhere.rednode.only, false, 'a package folder that is not at the top nor in the apps folder');
});

test('a broken manifest is a problem, named', async () => {
  const bad = await contents([{ path: 'radio/rednode-app.json', data: '{ nope' }]);
  assert.match(bad.rednode.problems[0], /could not be read as JSON/);
  assert.equal(bad.rednode.only, false);
  const noId = await contents([{ path: 'radio/rednode-app.json', data: app({ id: 'Bad Id' }) }]);
  assert.match(noId.rednode.problems[0], /no valid id/);
});
