import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePlan } from '../dist/index.js';

/** A release as the catalog gives it. */
const rel = (version, { requirements = [], files } = {}) => ({
  version,
  tag: `v${version}`,
  prerelease: version.includes('-'),
  notesHtml: '',
  files: files ?? [{ name: `f-${version}.zip`, role: 'required', size: 10, assetId: 1 }],
  requirements,
  size: 10,
});

/** A source from { id: [releases newest first] }. */
const source = (mods) => (id) => (mods[id] ? { name: id.toUpperCase(), releases: mods[id] } : undefined);
const order = (plan) => plan.mods.map((m) => `${m.id}@${m.version}`);

test('requirements come first, each at the newest release allowed', () => {
  const plan = resolvePlan(source({
    app: [rel('1.0.0', { requirements: [{ mod: 'core', version: '1.2.0' }, { name: 'ArchiveXL', url: 'https://example.com/axl' }] })],
    core: [rel('2.0.0-beta.1'), rel('1.3.0', { requirements: [{ mod: 'base', version: '1.0.0' }] }), rel('1.2.0'), rel('1.1.0')],
    base: [rel('1.0.0')],
  }), { mod: 'app' }, (m, v, f) => `/download/${m}/${v}/${f}`);
  assert.deepEqual(plan.problems, []);
  // A pre-release is chosen only when nothing else fits.
  assert.deepEqual(order(plan), ['base@1.0.0', 'core@1.3.0', 'app@1.0.0']);
  assert.deepEqual(plan.mods.find((m) => m.id === 'core').neededBy, ['app']);
  assert.deepEqual(plan.links, [{ name: 'ArchiveXL', url: 'https://example.com/axl', neededBy: ['app'] }]);
  assert.equal(plan.mods[0].files[0].download, '/download/base/1.0.0/f-1.0.0.zip');
  assert.equal(plan.size, 30);
});

test('a pinned requirement holds everyone to that release', () => {
  const plan = resolvePlan(source({
    app: [rel('1.0.0', { requirements: [{ mod: 'core', version: '1.0.0' }, { mod: 'skin', version: '1.0.0' }] })],
    skin: [rel('1.0.0', { requirements: [{ mod: 'core', version: '1.2.0', exact: true }] })],
    core: [rel('1.3.0'), rel('1.2.0'), rel('1.0.0')],
  }), { mod: 'app' });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.mods.find((m) => m.id === 'core').version, '1.2.0');
  assert.equal(plan.mods.at(-1).id, 'app');
  assert.ok(order(plan).indexOf('core@1.2.0') < order(plan).indexOf('skin@1.0.0'));
});

test('requirements that cannot all hold are a problem, named in plain words', () => {
  const plan = resolvePlan(source({
    app: [rel('1.0.0', { requirements: [{ mod: 'core', version: '1.3.0' }, { mod: 'skin', version: '1.0.0' }] })],
    skin: [rel('1.0.0', { requirements: [{ mod: 'core', version: '1.2.0', exact: true }] })],
    core: [rel('1.3.0'), rel('1.2.0')],
  }), { mod: 'app' });
  assert.equal(plan.problems.length, 1);
  assert.match(plan.problems[0], /No release of CORE fits every mod that needs it: APP needs 1.3.0 or newer; SKIN needs exactly 1.2.0/);
});

test('a missing mod, a missing release and a loop are problems, not followed', () => {
  const missing = resolvePlan(source({ app: [rel('1.0.0', { requirements: [{ mod: 'gone', version: '1.0.0' }] })] }), { mod: 'app' });
  assert.match(missing.problems[0], /APP needs "gone", which is not on EDGEmods any more/);

  const tooNew = resolvePlan(source({ app: [rel('1.0.0', { requirements: [{ mod: 'core', version: '2.0.0' }] })], core: [rel('1.0.0')] }), { mod: 'app' });
  assert.match(tooNew.problems[0], /APP needs CORE 2.0.0 or newer, and EDGEmods has no such release/);

  const loop = resolvePlan(source({
    a: [rel('1.0.0', { requirements: [{ mod: 'b', version: '1.0.0' }] })],
    b: [rel('1.0.0', { requirements: [{ mod: 'a', version: '1.0.0' }] })],
  }), { mod: 'a' });
  assert.match(loop.problems[0], /B needs A, which needs B in turn/);
  assert.deepEqual(order(loop), ['b@1.0.0', 'a@1.0.0']);

  assert.match(resolvePlan(source({}), { mod: 'nope' }).problems[0], /"nope" is not on EDGEmods/);
  assert.match(resolvePlan(source({ app: [rel('1.0.0')] }), { mod: 'app', version: '9.0.0' }).problems[0], /APP has no release 9.0.0/);
});

test('a chain deeper than 20 mods stops', () => {
  const mods = {};
  for (let i = 0; i < 25; i++) mods[`m${i}`] = [rel('1.0.0', { requirements: i < 24 ? [{ mod: `m${i + 1}`, version: '1.0.0' }] : [] })];
  const plan = resolvePlan(source(mods), { mod: 'm0' });
  assert.match(plan.problems.join(' '), /deeper than 20/);
});

test('files: required and the first of each group by default; a file\'s requirements only when it is chosen', () => {
  const files = [
    { name: 'main.zip', role: 'required', size: 5, assetId: 1 },
    { name: 'body-a.zip', role: 'choose-one', group: 'Body', size: 2, assetId: 2 },
    { name: 'body-b.zip', role: 'choose-one', group: 'Body', size: 3, assetId: 3, requirements: [{ mod: 'kit', version: '1.0.0' }] },
    { name: 'extra.zip', role: 'optional', size: 7, assetId: 4 },
  ];
  const mods = { app: [rel('1.0.0', { files })], kit: [rel('1.0.0')] };
  const plain = resolvePlan(source(mods), { mod: 'app' });
  assert.deepEqual(plain.mods.map((m) => m.id), ['app']);
  assert.deepEqual(plain.mods[0].files.map((f) => f.name), ['main.zip', 'body-a.zip']);
  assert.deepEqual(plain.mods[0].offered.map((f) => f.name), ['body-b.zip', 'extra.zip']);

  const picked = resolvePlan(source(mods), { mod: 'app', files: ['body-b.zip', 'extra.zip'] });
  assert.deepEqual(order(picked), ['kit@1.0.0', 'app@1.0.0']);
  assert.deepEqual(picked.mods[1].files.map((f) => f.name), ['main.zip', 'body-b.zip', 'extra.zip']);
  assert.deepEqual(picked.mods[0].neededBy, ['app']);
});

test('an older release brings its own requirements', () => {
  const mods = {
    app: [rel('2.0.0', { requirements: [{ mod: 'core', version: '2.0.0' }] }), rel('1.0.0', { requirements: [{ mod: 'old', version: '1.0.0' }] })],
    core: [rel('2.0.0')],
    old: [rel('1.0.0')],
  };
  assert.deepEqual(order(resolvePlan(source(mods), { mod: 'app' })), ['core@2.0.0', 'app@2.0.0']);
  assert.deepEqual(order(resolvePlan(source(mods), { mod: 'app', version: '1.0.0' })), ['old@1.0.0', 'app@1.0.0']);
});
