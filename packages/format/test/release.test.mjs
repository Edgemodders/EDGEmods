import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRelease, formatBytes, validateManifest } from '../dist/index.js';
import { example } from './helpers.mjs';

const manifest = validateManifest(example()).manifest;
const assets = () => manifest.files.map((f) => ({ name: f.name, size: 1000 }));

test('a matching release has no issues', () => {
  assert.deepEqual(checkRelease(manifest, { tag: 'v1.0.0', assets: assets() }), []);
});

test('the tag must be v<version>', () => {
  const [issue] = checkRelease(manifest, { tag: '1.0.0', assets: assets() });
  assert.equal(issue.level, 'error');
  assert.match(issue.message, /must be "v1.0.0"/);
});

test('a missing file, and one with different capitals', () => {
  const list = assets();
  list[0].name = list[0].name.toUpperCase();
  list.pop();
  const issues = checkRelease(manifest, { tag: 'v1.0.0', assets: list });
  assert.match(issues.find((i) => i.path === 'files[0].name').message, /including capitals/);
  assert.match(issues.find((i) => i.path === 'files[3].name').message, /not attached/);
  assert.ok(issues.some((i) => i.level === 'warning' && /does not list/.test(i.message)));
});

test('empty and oversized files', () => {
  const list = assets();
  list[0].size = 0;
  list[1].size = 2 * 1024 ** 3;
  const issues = checkRelease(manifest, { tag: 'v1.0.0', assets: list });
  assert.match(issues.find((i) => i.path === 'files[0].name').message, /empty/);
  assert.match(issues.find((i) => i.path === 'files[1].name').message, /under 2 GiB/);
});

test('sizes in plain units', () => {
  assert.equal(formatBytes(500), '500 bytes');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(150 * 1024 ** 2), '150 MB');
});
