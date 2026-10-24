import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { buildIndex, downloadSize, INDEX_SCHEMA_VERSION } from '../dist/index.js';

const example = JSON.parse(readFileSync(new URL('../../../examples/example-mod/edgemods.json', import.meta.url), 'utf8'));
const enc = (text) => new TextEncoder().encode(text);

/** A manifest for one version of a mod, from the example. */
function manifest(id, version, owner, extra = {}) {
  return {
    ...example,
    id,
    version,
    name: `Mod ${id}`,
    author: { name: `Author of ${id}`, github: owner },
    files: example.files.map((f) => ({ ...f, name: f.name.replace('edgemods-example', id).replace('1.0.0', version) })),
    ...extra,
  };
}

/**
 * A fake GitHub. repos: { id, owner, ownerId, name, releases: [{ tag, body?, manifest?, assets?, draft? }], files: { ref: { path: text } } }.
 */
function fakeGitHub(repos) {
  const byName = new Map(repos.map((r) => [`${r.owner}/${r.name}`, r]));
  const at = (fullName, ref) => byName.get(fullName)?.files[ref] ?? {};
  return {
    reads: 0,
    async repoById(id) {
      const r = repos.find((x) => x.id === id);
      if (!r) return undefined;
      return { id: r.id, name: r.name, fullName: `${r.owner}/${r.name}`, owner: { login: r.owner, id: r.ownerId, type: 'User' }, private: false, archived: false, disabled: false, fork: false, defaultBranch: 'main', htmlUrl: `https://github.com/${r.owner}/${r.name}` };
    },
    async releases(fullName) {
      return byName.get(fullName).releases.map((r, i) => ({
        tag: r.tag,
        draft: false,
        prerelease: r.tag.includes('-'),
        publishedAt: r.publishedAt ?? `2026-0${i + 1}-01T00:00:00Z`,
        body: r.body,
        assets: r.assets ?? (r.manifest?.files ?? []).map((f, k) => ({ id: 100 + k, name: f.name, size: 1000 * (k + 1), url: `https://github.com/${fullName}/releases/download/${r.tag}/${f.name}` })),
      }));
    },
    async file(fullName, ref, path) {
      const text = at(fullName, ref)[path];
      return text === undefined ? undefined : enc(text);
    },
    async tree(fullName, ref) {
      return { files: Object.entries(at(fullName, ref)).map(([path, text]) => ({ path, size: text.length })), truncated: false };
    },
  };
}

/** A repository whose tags each hold their own edgemods.json, a README and the card. */
function repo({ id, owner, ownerId = id * 10, name, mod, versions, changelog, readme = '# Hello\n\n![card](images/card.png)', bodies = {}, extraReleases = [] }) {
  const files = { main: { 'CHANGELOG.md': changelog ?? '', 'README.md': readme, 'images/card.png': 'png' } };
  const pictures = { 'images/card.png': 'png', 'images/screenshot-1.png': 'png' };
  if (changelog === undefined) delete files.main['CHANGELOG.md'];
  const releases = [];
  for (const v of versions) {
    const m = manifest(mod, v, owner);
    files[`v${v}`] = { 'edgemods.json': JSON.stringify(m), 'README.md': readme, ...pictures };
    releases.push({ tag: `v${v}`, manifest: m, body: bodies[v] });
  }
  return { id, owner, ownerId, name, files, releases: [...releases, ...extraReleases] };
}

async function build(repos, mods) {
  const out = join(mkdtempSync(join(tmpdir(), 'edgemods-index-')), 'index.db');
  const result = await buildIndex({ github: fakeGitHub(repos), mods, out, registryRef: 'abc123', now: () => new Date('2026-10-23T00:00:00Z') });
  return { result, db: new DatabaseSync(out, { readOnly: true }) };
}

const entry = (owner, id, repoId, ownerId = repoId * 10) => ({ owner, id, entry: { schemaVersion: 1, repo: `https://github.com/${owner}/${id}`, repoId, ownerId } });

test('every usable release is kept; the newest that is not a pre-release is shown', async () => {
  const neon = repo({
    id: 1, owner: 'kvane', name: 'neon-rain', mod: 'neon-rain', versions: ['1.0.0', '1.1.0', '2.0.0-beta.1'],
    changelog: '# Changelog\n\n## Unreleased\n\n- soon\n\n## 1.1.0 (2026-02-01)\n\n**Fixed**\n\n- Rain in the Afterlife.\n',
    bodies: { '1.0.0': 'First release.' },
  });
  const { result, db } = await build([neon], [entry('kvane', 'neon-rain', 1)]);
  assert.deepEqual(result, { mods: 1, releases: 3, problems: [] });

  const mod = db.prepare('SELECT * FROM mods').get();
  assert.equal(mod.latest, '1.1.0');
  assert.equal(mod.repo, 'kvane/neon-rain');
  assert.equal(mod.first_published, '2026-01-01T00:00:00Z');
  assert.equal(mod.last_updated, '2026-02-01T00:00:00Z');
  assert.match(mod.page_html, /<h2>Hello<\/h2>/);
  assert.match(mod.page_html, /src="\/mods\/neon-rain\/images\/images\/card.png"/);

  const releases = db.prepare('SELECT version, rank, prerelease, notes_from, notes_html, size FROM releases ORDER BY rank').all();
  assert.deepEqual(releases.map((r) => [r.version, r.rank, r.prerelease, r.notes_from]), [
    ['2.0.0-beta.1', 0, 1, 'none'],
    ['1.1.0', 1, 0, 'changelog'],
    ['1.0.0', 2, 0, 'release'],
  ]);
  assert.match(releases[1].notes_html, /<strong>Fixed<\/strong>/);
  assert.ok(!releases[1].notes_html.includes('soon'));
  assert.equal(releases[2].notes_html, '<p>First release.</p>');
  // The example's files: one required (1000) and the first of the Body group (2000); Body B and others are left out.
  assert.equal(releases[1].size, 3000);

  assert.deepEqual(db.prepare('SELECT path, ref FROM images').all().map((r) => ({ ...r })), [{ path: 'images/card.png', ref: 'v1.1.0' }, { path: 'images/screenshot-1.png', ref: 'v1.1.0' }]);
  assert.deepEqual(db.prepare("SELECT id FROM mods_search WHERE mods_search MATCH 'author*'").all().map((r) => r.id), ['neon-rain']);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get().value, String(INDEX_SCHEMA_VERSION));
  assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'registryRef'").get().value, 'abc123');
});

test('releases that do not match their tag, or lack files, are left out with a reason', async () => {
  const bad = repo({ id: 2, owner: 'mokafor', name: 'street-cred', mod: 'street-cred', versions: ['1.0.0'] });
  const wrongId = manifest('someone-else', '1.1.0', 'mokafor');
  const missing = manifest('street-cred', '1.2.0', 'mokafor');
  bad.files['v1.1.0'] = { 'edgemods.json': JSON.stringify(wrongId) };
  bad.files['v1.2.0'] = { 'edgemods.json': JSON.stringify(missing) };
  bad.files['v1.3.0'] = { 'edgemods.json': '{ not json' };
  bad.releases.push(
    { tag: 'v1.1.0', manifest: wrongId },
    { tag: 'v1.2.0', manifest: missing, assets: [] },
    { tag: 'v1.3.0' },
    { tag: 'nightly' },
  );
  const { result, db } = await build([bad], [entry('mokafor', 'street-cred', 2)]);
  assert.equal(result.mods, 1);
  assert.equal(db.prepare('SELECT latest FROM mods').get().latest, '1.0.0');
  const problems = result.problems.map((p) => `${p.version}: ${p.message}`);
  assert.equal(problems.length, 3, problems.join('\n'));
  assert.match(problems.find((p) => p.startsWith('1.1.0')), /is for "someone-else"/);
  assert.match(problems.find((p) => p.startsWith('1.2.0')), /not attached/);
  assert.match(problems.find((p) => p.startsWith('1.3.0')), /has problems/);
  assert.equal(db.prepare('SELECT count(*) n FROM problems').get().n, 3);
});

test('a repository that is gone or changed owner drops off; the rest still index', async () => {
  const kept = repo({ id: 3, owner: 'tishikawa', name: 'kabuki', mod: 'kabuki', versions: ['1.0.0'] });
  const moved = repo({ id: 4, owner: 'new-owner', ownerId: 999, name: 'moved', mod: 'moved', versions: ['1.0.0'] });
  const { result, db } = await build([kept, moved], [entry('tishikawa', 'kabuki', 3), entry('old-owner', 'moved', 4), entry('ghost', 'gone', 5)]);
  assert.equal(result.mods, 1);
  assert.deepEqual(db.prepare('SELECT id FROM mods').all().map((r) => r.id), ['kabuki']);
  assert.match(result.problems.find((p) => p.mod === 'moved').message, /now belongs to new-owner/);
  assert.match(result.problems.find((p) => p.mod === 'gone').message, /gone or not public/);
});

test('a missing card leaves the mod out; a missing gallery image is only noted', async () => {
  const r = repo({ id: 6, owner: 'drestrepo', name: 'cars', mod: 'cars', versions: ['1.0.0'], readme: 'No pictures.' });
  const m = JSON.parse(r.files['v1.0.0']['edgemods.json']);
  m.images.gallery = [{ path: 'images/gone.png' }];
  r.files['v1.0.0']['edgemods.json'] = JSON.stringify(m);
  r.releases[0].manifest = m;
  const noCard = repo({ id: 7, owner: 'imoreau', name: 'radio', mod: 'radio', versions: ['1.0.0'] });
  delete noCard.files['v1.0.0']['images/card.png'];
  const { result } = await build([r, noCard], [entry('drestrepo', 'cars', 6), entry('imoreau', 'radio', 7)]);
  assert.equal(result.mods, 1);
  assert.match(result.problems.find((p) => p.mod === 'cars').message, /images\/gone.png is missing/);
  assert.match(result.problems.filter((p) => p.mod === 'radio').at(-1).message, /card image is missing/);
});

test('the download size counts required files and the first of each choose-one group', () => {
  assert.equal(downloadSize([
    { role: 'required', size: 10 },
    { role: 'choose-one', group: 'Body', size: 5 },
    { role: 'choose-one', group: 'Body', size: 7 },
    { role: 'choose-one', group: 'Hair', size: 3 },
    { role: 'optional', size: 100 },
  ]), 18);
});
