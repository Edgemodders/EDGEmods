// The deploy files (deploy/, .github/workflows/index.yml) agree with the code, and the index rebuild's send script
// works against a real service.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import { blocklistApi, sendCheckResult } from '@edgemodders/edgemods-checks';
import { MODS, start, testIndex } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('the deploy files', () => {
  test('the env example names every setting the service reads, and nothing else', () => {
    const code = ['packages/server/src/config.ts', 'packages/server/src/downloads.ts'].map(read).join('\n');
    const read_ = new Set([...code.matchAll(/(?:env\.|get\(')(EDGEMODS_[A-Z0-9_]+)/g)].map((m) => m[1]));
    // Set by the unit, or for a PC only.
    for (const own of ['EDGEMODS_DATA', 'EDGEMODS_INDEX', 'EDGEMODS_SHOW_UNCHECKED', 'EDGEMODS_AUTH0_MANAGEMENT_DOMAIN']) read_.delete(own);
    const example = new Set([...read('deploy/edgemods.env.example').matchAll(/^(EDGEMODS_[A-Z0-9_]+)=/gm)].map((m) => m[1]));
    assert.deepEqual([...read_].filter((n) => !example.has(n)), [], 'read by the service, missing from the example');
    assert.deepEqual([...example].filter((n) => !read_.has(n)), [], 'in the example, never read');
    assert.match(read('deploy/edgemods.env.example'), /^EDGEMODS_DOWNLOADS=nginx$/m);
  });

  test('the scripts read the port the code defaults to', () => {
    const port = /EDGEMODS_PORT \?\? (\d{2,5})/.exec(read('packages/server/src/config.ts'))?.[1];
    assert.equal(port, '8800');
    assert.match(read('deploy/edgemods.env.example'), new RegExp(`^EDGEMODS_PORT=${port}$`, 'm'));
    for (const s of ['deploy/setup-edgemods.sh', 'deploy/add-domain.sh']) assert.match(read(s), /EDGEMODS_PORT \?\? \\\(\[0-9\]/, s);
    assert.match(read('deploy/nginx/edgemods.ai.conf'), /proxy_pass http:\/\/127\.0\.0\.1:__PORT__;/);
  });

  test('nginx takes an index as large as the service does', async () => {
    const { INDEX_MAX_BYTES } = await import('../dist/app.js');
    const mb = Number(/location = \/api\/v1\/admin\/index \{\s*client_max_body_size (\d+)m;/.exec(read('deploy/nginx/edgemods.ai.conf'))?.[1]);
    assert.equal(mb * 1024 * 1024, INDEX_MAX_BYTES);
  });

  test('the unit runs the server with its data in the state directory', () => {
    const unit = read('deploy/systemd/edgemods.service');
    assert.match(unit, /^ExecStart=\/usr\/bin\/node .*packages\/server\/bin\/edgemods-server\.mjs$/m);
    assert.match(unit, /^Environment=EDGEMODS_DATA=\/var\/lib\/edgemods$/m);
    assert.match(unit, /^StateDirectory=edgemods$/m);
    assert.match(unit, /^ExecReload=\/bin\/kill -HUP \$MAINPID$/m);
    assert.match(read('deploy/setup-litestream.sh'), /^DB=\/var\/lib\/edgemods\/site\.db$/m);
  });

  test('the deploy files keep LF line endings', () => {
    assert.match(read('.gitattributes'), /^deploy\/\*\* text eol=lf$/m);
    for (const f of ['setup-edgemods.sh', 'add-domain.sh', 'setup-litestream.sh']) assert.match(read(`deploy/${f}`), /^#!\/usr\/bin\/env bash\n/, f);
  });

  test('no workflow that can run on a self-hosted runner has a pull request trigger', () => {
    const dir = join(ROOT, '.github/workflows');
    for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      const text = readFileSync(join(dir, f), 'utf8');
      if (!/self-hosted|EDGEMODS_INDEX_RUNS_ON/.test(text)) continue;
      assert.doesNotMatch(text, /^\s*(pull_request|pull_request_target|workflow_run)\s*:/m, f);
    }
    assert.match(read('.github/workflows/index.yml'), /EDGEMODS_INDEX_RUNS_ON/, 'index.yml is among those checked');
  });
});

describe('the index rebuild sends its index', () => {
  const SECRET = 'send-secret';
  let t;
  before(async () => { t = await start({ indexSecret: SECRET }); });
  after(() => t.close());
  const send = (file, env) => promisify(execFile)(process.execPath, [join(ROOT, 'packages/indexer/bin/edgemods-index-send.mjs'), file, t.base], {
    env: { ...process.env, ...env },
  });

  test('the site takes it, and refuses it with the wrong secret', async () => {
    const out = join(t.dir, 'sent.db');
    await testIndex(out, MODS.map((m) => m.id));
    const { stdout } = await send(out, { EDGEMODS_INDEX_SECRET: SECRET });
    assert.match(stdout, /took the index: \d+ mod\(s\) shown/);
    await assert.rejects(send(out, { EDGEMODS_INDEX_SECRET: 'wrong' }), (err) => /refused the index \(401\)/.test(err.stderr));
  });
});

describe('the merge checks and the website agree', () => {
  const SECRET = 'checks-secret';
  let t;
  before(async () => { t = await start({ checksSecret: SECRET }); });
  after(() => t.close());

  test('the blocklist question, and a passing result making a release show', async () => {
    const ask = (secret) => blocklistApi(t.base, secret).check({ ownerId: 777, login: 'eve', repoId: 888 });
    assert.deepEqual(await ask(SECRET), { blocked: false });
    t.site.block('github', 777, 'eve', 'admin@test');
    assert.deepEqual(await ask(SECRET), { blocked: true });
    await assert.rejects(ask('wrong'), /401/);

    // "unchecked" has no check result in the test site, so it does not show until one passes.
    assert.equal((await t.get('/mods/unchecked')).status, 404);
    const result = { ok: true, steps: [], downloads: [{ name: 'unchecked-1.0.0.zip', size: 1000, sha256: 'cd'.repeat(32), contents: { files: 1, size: 10, kinds: {}, runsCode: [] } }],
      mod: { id: 'unchecked', name: 'Unchecked', version: '1.0.0', owner: 'x', repo: 'x/unchecked', repoId: 9 } };
    await sendCheckResult(t.base, SECRET, result);
    assert.equal((await t.get('/mods/unchecked')).status, 200);
  });
});
