import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { checkModFolder } from '../dist/folder.js';
import { exampleDir, messages } from './helpers.mjs';

const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A copy of the example to break. */
function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'edgemods-format-'));
  made.push(dir);
  cpSync(exampleDir, dir, { recursive: true });
  return dir;
}

function edit(dir, change) {
  const path = join(dir, 'edgemods.json');
  const m = JSON.parse(readFileSync(path, 'utf8'));
  change(m);
  writeFileSync(path, JSON.stringify(m));
}

async function expectError(dir, path, words) {
  const result = await checkModFolder(dir);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((i) => i.level === 'error' && i.path === path && i.message.includes(words)),
    `no error at ${path} containing "${words}". Got:\n${messages(result).join('\n')}`,
  );
}

test('the example folder is ready', async () => {
  const result = await checkModFolder(exampleDir);
  assert.equal(result.ok, true, messages(result).join('\n'));
  assert.deepEqual(messages(result, 'warning'), []);
});

test('no edgemods.json', async () => {
  const dir = copy();
  rmSync(join(dir, 'edgemods.json'));
  await expectError(dir, '', 'no edgemods.json');
});

test('no README', async () => {
  const dir = copy();
  rmSync(join(dir, 'README.md'));
  await expectError(dir, '', 'not in the mod');
});

test('an image whose capitals differ from the manifest', async () => {
  const dir = copy();
  renameSync(join(dir, 'images/card.png'), join(dir, 'images/Card.png'));
  await expectError(dir, 'images.card', 'spelled "images/Card.png"');
});

test('a card that is not 2:1', async () => {
  const dir = copy();
  edit(dir, (m) => { m.images.card = 'images/screenshot-1.png'; m.images.gallery = [{ path: 'images/card.png' }]; });
  await expectError(dir, 'images.card', '2560 × 640');
});

test('an image whose extension lies', async () => {
  const dir = copy();
  renameSync(join(dir, 'images/screenshot-1.png'), join(dir, 'images/screenshot-1.jpg'));
  edit(dir, (m) => { m.images.gallery[0].path = 'images/screenshot-1.jpg'; });
  await expectError(dir, 'images.gallery[0].path', 'really a PNG');
});

test('a file that is not an image', async () => {
  const dir = copy();
  writeFileSync(join(dir, 'images/card.png'), 'not an image');
  await expectError(dir, 'images.card', 'not a PNG, JPEG or WebP');
});

test('a download committed to the repository is a warning', async () => {
  const dir = copy();
  writeFileSync(join(dir, 'edgemods-example-1.0.0.zip'), 'zip');
  const result = await checkModFolder(dir);
  assert.equal(result.ok, true);
  assert.ok(messages(result, 'warning').some((w) => w.includes('belong on the release')));
});
