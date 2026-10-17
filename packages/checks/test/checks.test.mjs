import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReport, runChecks } from '../dist/index.js';
import { fakeGitHub, fakeScanner, goodWorld, makeZip, REGISTRY } from './helpers.mjs';

function run(world, extra = {}) {
  return runChecks({ github: fakeGitHub(world), registry: REGISTRY, baseRef: 'main', pullRequest: 7, scanner: fakeScanner, ...extra });
}

/** Expects the checks to fail at `stepId` with a problem containing `words`, and every later step skipped. */
async function expectFail(change, stepId, words, extra) {
  const w = goodWorld();
  change(w);
  const result = await run(w, extra);
  assert.equal(result.ok, false);
  const index = result.steps.findIndex((s) => s.status === 'fail');
  const step = result.steps[index];
  assert.equal(step?.id, stepId, `failed at ${step?.id}: ${JSON.stringify(step?.issues)}`);
  assert.ok(
    step.issues.some((i) => i.level === 'error' && i.message.includes(words)),
    `no problem containing "${words}" in ${JSON.stringify(step.issues, null, 2)}`,
  );
  assert.ok(result.steps.slice(index + 1).every((s) => s.status === 'skip'));
  return result;
}

function setManifest(w, change, refs = ['main', 'v1.0.0']) {
  for (const ref of refs) {
    const m = JSON.parse(w.refs[ref].get('edgemods.json'));
    change(m);
    w.refs[ref].set('edgemods.json', Buffer.from(JSON.stringify(m)));
  }
}

test('a correct publish pull request passes every step', async () => {
  const result = await run(goodWorld());
  assert.equal(result.ok, true, JSON.stringify(result.steps.filter((s) => s.issues.length), null, 2));
  assert.deepEqual(result.steps.map((s) => s.status), ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
  assert.deepEqual(result.mod, {
    id: 'edgemods-example', name: 'EDGEmods Example', version: '1.0.0', owner: 'octo-modder',
    repo: 'https://github.com/octo-modder/example-mod', repoId: 5005,
  });
  assert.equal(result.downloads.length, 4);
  assert.match(result.downloads[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.downloads[0].contents.kinds, { archive: 1, tweak: 1 });
  assert.equal(result.downloads[0].scan.clean, true);
});

test('the pull request: one added file in the right place, by its owner', async () => {
  await expectFail((w) => w.changed.push({ path: 'README.md', status: 'modified' }), 'pull-request', 'exactly one file');
  await expectFail((w) => { w.changed[0].status = 'removed'; }, 'pull-request', 'done by EDGEmods admins');
  await expectFail((w) => { w.changed[0].status = 'modified'; }, 'pull-request', 'not edited after publishing');
  await expectFail((w) => { w.changed[0].path = 'registry/octo-modder/Bad Id.json'; }, 'pull-request', 'not a registry file');
  await expectFail((w) => { w.changed[0].path = 'mods/edgemods-example.json'; }, 'pull-request', 'not a registry file');
  await expectFail((w) => {
    w.changed[0].path = 'registry/someone-else/edgemods-example.json';
  }, 'pull-request', 'only into their own folder');
  await expectFail((w) => { w.pr.state = 'closed'; }, 'pull-request', 'not open');
});

test('the registry file itself', async () => {
  const put = (w, entry) => w.prFiles.set(w.changed[0].path, Buffer.from(typeof entry === 'string' ? entry : JSON.stringify(entry)));
  await expectFail((w) => put(w, '{nope'), 'pull-request', 'not valid JSON');
  await expectFail((w) => put(w, { schemaVersion: 1, repo: 'github.com/x/y', repoId: 5005, ownerId: 1001 }), 'pull-request', 'repository\'s address');
  await expectFail((w) => put(w, { schemaVersion: 1, repo: 'https://github.com/octo-modder/example-mod', repoId: 5005, ownerId: 1001, extra: 1 }), 'pull-request', 'does not belong');
  await expectFail((w) => put(w, { schemaVersion: 1, repo: 'https://github.com/octo-modder/example-mod', repoId: 5005, ownerId: 42 }), 'pull-request', "GitHub id (1001)");
});

test('the repository: exists, public, owned by the author, not already listed', async () => {
  await expectFail((w) => { w.repo = undefined; }, 'repository', 'was not found');
  await expectFail((w) => { w.repo.id = 6006; }, 'repository', 'repoId (5005)');
  await expectFail((w) => { w.repo.owner = { login: 'thief', id: 3003, type: 'User' }; }, 'repository', 'belongs to thief');
  await expectFail((w) => { w.repo.private = true; }, 'repository', 'is private');
  await expectFail((w) => { w.repo.archived = true; }, 'repository', 'archived');
  await expectFail((w) => {
    w.registryFiles.set('registry/someone-else/edgemods-example.json', Buffer.from('{}'));
  }, 'repository', 'already used');
  await expectFail((w) => {
    w.registryFiles.set('registry/octo-modder/old-name.json', Buffer.from(JSON.stringify({ schemaVersion: 1, repo: 'https://github.com/octo-modder/example-mod', repoId: 5005, ownerId: 1001 })));
  }, 'repository', 'already on EDGEmods as "old-name"');
});

test('advice about edgemods.json is given once, not again under the page and images', async () => {
  const w = goodWorld();
  setManifest(w, (m) => delete m.images.gallery);
  const result = await run(w);
  assert.equal(result.ok, true);
  const gallery = (id) => result.steps.find((s) => s.id === id).issues.filter((i) => i.path === 'images.gallery');
  assert.equal(gallery('metadata').length, 1);
  assert.equal(gallery('files').length, 0);
});

test('a fork and a near-identical id are advice, not failures', async () => {
  const w = goodWorld();
  w.repo.fork = true;
  w.registryFiles.set('registry/someone-else/edgemods-exampl.json', Buffer.from('{}'));
  const result = await run(w);
  assert.equal(result.ok, true);
  const repoStep = result.steps.find((s) => s.id === 'repository');
  assert.ok(repoStep.issues.some((i) => i.level === 'warning' && i.message.includes('fork')));
  assert.ok(repoStep.issues.some((i) => i.level === 'warning' && i.message.includes('very close')));
});

test('the blocklist', async () => {
  const blocked = { async check() { return { blocked: true }; } };
  await expectFail(() => {}, 'repository', 'cannot publish on EDGEmods', { blocklist: blocked });
  const open = { async check(q) { assert.deepEqual(q, { ownerId: 1001, login: 'octo-modder', repoId: 5005 }); return { blocked: false }; } };
  assert.equal((await run(goodWorld(), { blocklist: open })).ok, true);
});

test('edgemods.json in the repository', async () => {
  await expectFail((w) => w.refs.main.delete('edgemods.json'), 'metadata', 'There is no edgemods.json');
  await expectFail((w) => setManifest(w, (m) => { m.version = 'v1'; }), 'metadata', 'starts with "v"');
  await expectFail((w) => setManifest(w, (m) => { m.id = 'other-id'; }), 'metadata', 'must match');
  await expectFail((w) => setManifest(w, (m) => { m.author.github = 'somebody'; }), 'metadata', 'belongs to octo-modder');
});

test('requirements on EDGEmods: on the registry, at a release that exists', async () => {
  const ok = await run(goodWorld());
  assert.deepEqual(ok.steps.find((s) => s.id === 'requirements').notes, [
    'The mod needs edgemods-example-core 1.2.0 or newer.',
    '"edgemods-example-body-b-1.0.0.zip" needs edgemods-example-body-kit exactly 2.0.0.',
    '2 link(s) outside EDGEmods, not checked.',
  ]);
  await expectFail((w) => setManifest(w, (m) => { m.requirements[1].mod = 'no-such-mod'; }), 'requirements', 'no mod with that id');
  await expectFail((w) => setManifest(w, (m) => { m.requirements[1].version = '1.1.0'; }), 'requirements', 'has no release 1.1.0');
  await expectFail((w) => setManifest(w, (m) => { m.files[2].requirements[0].version = '2.1.0'; }), 'requirements', '"edgemods-example-body-b-1.0.0.zip" needs');
});

test('the release', async () => {
  await expectFail((w) => { w.release = undefined; }, 'release', 'no published release tagged "v1.0.0"');
  await expectFail((w) => { w.release.draft = true; }, 'release', 'no published release');
  await expectFail((w) => w.release.assets.pop(), 'release', 'not attached');
  await expectFail((w) => setManifest(w, (m) => { m.version = '0.9.0'; }, ['v1.0.0']), 'release', 'Tag the commit that has the new version');
  await expectFail((w) => w.refs['v1.0.0'].delete('edgemods.json'), 'release', 'tagged v1.0.0 has no edgemods.json');
});

test('the page and images at the release', async () => {
  await expectFail((w) => w.refs['v1.0.0'].delete('README.md'), 'files', 'not in the mod\'s repository');
  await expectFail((w) => {
    const card = w.refs['v1.0.0'].get('images/card.png');
    w.refs['v1.0.0'].delete('images/card.png');
    w.refs['v1.0.0'].set('images/Card.png', card);
  }, 'files', 'spelled "images/Card.png"');
  await expectFail((w) => w.refs['v1.0.0'].set('images/card.png', Buffer.from('not a picture')), 'files', 'not a PNG');
});

test('the downloads: unsafe paths, passwords, empty files and malware fail', async () => {
  const replace = (w, entries) => {
    const bytes = makeZip(entries);
    Object.assign(w.release.assets[0], { bytes, size: bytes.length });
  };
  await expectFail((w) => replace(w, [{ path: '../../Windows/evil.dll', data: 'x' }]), 'downloads', 'climbs out');
  await expectFail((w) => replace(w, [{ path: 'C:/evil.dll', data: 'x' }]), 'downloads', 'absolute path');
  await expectFail((w) => replace(w, [{ path: 'archive/pc/mod/a.archive', data: 'x', encrypted: true }]), 'downloads', 'password');
  await expectFail((w) => replace(w, []), 'downloads', 'is empty');
  await expectFail((w) => replace(w, [{ path: 'bin/x64/plugins/bad.dll', data: 'EICAR' }]), 'downloads', 'Eicar-Test-Signature');
  await expectFail((w) => {
    const bytes = Buffer.from('this is not a zip');
    Object.assign(w.release.assets[0], { bytes, size: bytes.length });
  }, 'downloads', 'not a zip file');
  await expectFail(() => {}, 'downloads', 'scanner is not available', { scanner: undefined });
});

test('a game plugin passes, and the report says it runs code', async () => {
  const w = goodWorld();
  const bytes = makeZip([{ path: 'red4ext/plugins/mymod/mymod.dll', data: 'MZ plugin' }, { path: 'r6/scripts/mymod.reds', data: 'func' }]);
  Object.assign(w.release.assets[0], { bytes, size: bytes.length });
  const result = await run(w);
  assert.equal(result.ok, true);
  assert.deepEqual(result.downloads[0].contents.runsCode, ['red4ext/plugins/mymod/mymod.dll']);
  const report = renderReport(result);
  assert.match(report, /passed the EDGEmods checks/);
  assert.match(report, /game plugins/);
  assert.match(report, /run code with the player's permissions/);
});

test('the report on failure explains what to do and keeps mod text from becoming markup', async () => {
  const w = goodWorld();
  setManifest(w, (m) => { m.name = 'Evil <img src=x> @everyone *bold*'; });
  w.release.assets.pop();
  const result = await run(w);
  const report = renderReport(result);
  assert.match(report, /is not ready for EDGEmods yet/);
  assert.match(report, /\*\*Problem:\*\*/);
  assert.match(report, /⏸️ The mod page and images/);
  assert.doesNotMatch(report, /<img/);
  assert.doesNotMatch(report, /@everyone/);
});

test('an unexpected error in a step fails it with a plain message', async () => {
  const w = goodWorld();
  const github = fakeGitHub(w);
  github.repo = async () => { throw new Error('GitHub answered 502'); };
  const result = await runChecks({ github, registry: REGISTRY, baseRef: 'main', pullRequest: 7, scanner: fakeScanner });
  const step = result.steps.find((s) => s.status === 'fail');
  assert.equal(step.id, 'repository');
  assert.match(step.issues[0].message, /could not finish: GitHub answered 502/);
});
