import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ArchiveError, kindOf, list7z, listArchive, listZip, sha256, summarize, unsafePaths } from '../dist/index.js';
import { makeZip } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'edgemods-archive-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const put = (name, bytes) => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

test('lists a zip from its central directory, without folders', async () => {
  const file = put('a.zip', makeZip([
    { path: 'archive/', data: '' },
    { path: 'archive/pc/mod/a.archive', data: 'abc' },
    { path: 'r6/scripts/ünïcode.reds', data: 'func' },
  ]));
  assert.deepEqual(await listZip(file), [
    { path: 'archive/pc/mod/a.archive', size: 3, encrypted: false },
    { path: 'r6/scripts/ünïcode.reds', size: 4, encrypted: false },
  ]);
});

test('a zip comment after the end record is fine', async () => {
  const zip = makeZip([{ path: 'a.txt', data: 'x' }]);
  const comment = Buffer.from('a comment');
  zip.writeUInt16LE(comment.length, zip.length - 2);
  assert.equal((await listZip(put('c.zip', Buffer.concat([zip, comment])))).length, 1);
});

test('damaged or wrong files are explained', async () => {
  await assert.rejects(listZip(put('bad.zip', Buffer.from('hello'))), ArchiveError);
  const zip = makeZip([{ path: 'a.txt', data: 'x' }]);
  zip.writeUInt32LE(0xffffff, zip.length - 6); // central directory offset beyond the file
  await assert.rejects(listZip(put('cut.zip', zip)), /points outside itself/);
  await assert.rejects(listArchive(put('x.rar', Buffer.from('Rar!')), 'x.rar'), /not a \.zip or \.7z/);
});

test('sha256', async () => {
  assert.equal(await sha256(put('h.txt', 'abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('kinds of files', () => {
  assert.equal(kindOf('red4ext/plugins/x/x.DLL'), 'plugin');
  assert.equal(kindOf('bin/x64/plugins/cyber_engine_tweaks/mods/x/init.lua'), 'cet');
  assert.equal(kindOf('archive/pc/mod/x.archive'), 'archive');
  assert.equal(kindOf('r6/tweaks/x.yaml'), 'tweak');
  assert.equal(kindOf('setup.exe'), 'program');
  assert.equal(kindOf('readme.txt'), 'other');
  const s = summarize([
    { path: 'a.dll', size: 10, encrypted: false },
    { path: 'b.reds', size: 5, encrypted: false },
  ]);
  assert.deepEqual(s, { files: 2, size: 15, kinds: { plugin: 1, redscript: 1 }, runsCode: ['a.dll'] });
});

test('unsafe paths', () => {
  const e = (path) => ({ path, size: 0, encrypted: false });
  assert.deepEqual(unsafePaths([e('archive/pc/mod/a.archive'), e('r6/..hidden/ok.reds')]), []);
  assert.equal(unsafePaths([e('../a')]).length, 1);
  assert.equal(unsafePaths([e('/etc/a')]).length, 1);
  assert.equal(unsafePaths([e('D:/a')]).length, 1);
  assert.equal(unsafePaths([e('mod\u202egpj.exe')]).length, 1);
});

// The 7z tool is on the CI runner; on a machine without it, these two are skipped.
const has7z = (() => {
  try { execFileSync('7z', ['i'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

test('lists a .7z with the 7z tool', { skip: !has7z && '7z is not installed' }, async () => {
  const src = join(dir, 'src');
  execFileSync('node', ['-e', `const fs=require('fs');fs.mkdirSync(${JSON.stringify(join(src, 'r6/scripts'))},{recursive:true});fs.writeFileSync(${JSON.stringify(join(src, 'r6/scripts/a.reds'))},'func')`]);
  const archive = join(dir, 'a.7z');
  execFileSync('7z', ['a', archive, 'r6'], { cwd: src, stdio: 'ignore' });
  assert.deepEqual(await list7z(archive), [{ path: 'r6/scripts/a.reds', size: 4, encrypted: false }]);
});

test('a password-protected .7z is refused', { skip: !has7z && '7z is not installed' }, async () => {
  const archive = join(dir, 'locked.7z');
  const src = put('secret.txt', 'secret');
  execFileSync('7z', ['a', '-psecret', '-mhe=on', archive, src], { stdio: 'ignore' });
  await assert.rejects(list7z(archive), /password/);
});
