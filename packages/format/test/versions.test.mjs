import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changelogSection, compareVersions, parseChangelog, satisfies } from '../dist/index.js';

test('versions sort by semantic versioning precedence', () => {
  const sorted = ['1.0.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '0.9.0', '1.10.0', '1.2.0']
    .sort(compareVersions);
  assert.deepEqual(sorted, ['0.9.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.2.0', '1.10.0']);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
});

test('a requirement allows its version or newer, or exactly it when pinned', () => {
  assert.ok(satisfies('1.3.0', { version: '1.2.0' }));
  assert.ok(satisfies('1.2.0', { version: '1.2.0' }));
  assert.ok(!satisfies('1.1.9', { version: '1.2.0' }));
  assert.ok(!satisfies('1.3.0', { version: '1.2.0', exact: true }));
  assert.ok(satisfies('1.2.0', { version: '1.2.0', exact: true }));
});

const CHANGELOG = `# Changelog

How to keep it: a line under Unreleased.

## Unreleased

**New**

- Something not released yet.

## 1.2.0 (2026-10-19)

**Fixed**

- Rain inside the Afterlife.

\`\`\`
## not a heading inside a fence
\`\`\`

## [1.1.0] - 2026-09-01

- Older style heading.

## Notes

Not a version: left out.
`;

test('a changelog splits into sections by version', () => {
  const sections = parseChangelog(CHANGELOG);
  assert.deepEqual(sections.map((s) => [s.version, s.date]), [[undefined, undefined], ['1.2.0', '2026-10-19'], ['1.1.0', '2026-09-01']]);
  assert.match(sections[1].body, /^\*\*Fixed\*\*/);
  assert.match(sections[1].body, /## not a heading inside a fence/);
  assert.equal(sections[2].body, '- Older style heading.');
});

test('one version\'s section, or nothing', () => {
  assert.equal(changelogSection(CHANGELOG, '1.1.0').body, '- Older style heading.');
  assert.equal(changelogSection(CHANGELOG, '9.9.9'), undefined);
  assert.equal(changelogSection('﻿## v2.0.0\r\n- BOM and CRLF\r\n', '2.0.0').body, '- BOM and CRLF');
});
