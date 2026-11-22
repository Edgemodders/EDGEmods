// The index handover: POST /api/v1/admin/index, from the rebuild on the owner's runner (docs/design.md, "Runners").
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { MODS, start, testIndex } from './helpers.mjs';

const SECRET = 'index-secret-for-tests';

const send = (t, body, { secret = SECRET, ts = Math.floor(Date.now() / 1000), type = 'application/vnd.sqlite3', sig } = {}) => t.get('/api/v1/admin/index', {
  method: 'POST',
  body,
  headers: {
    'content-type': type,
    'x-edgemods-timestamp': String(ts),
    'x-edgemods-signature': sig ?? `sha256=${createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex')}`,
  },
});

describe('the index handover', () => {
  let t;
  before(async () => { t = await start({ indexSecret: SECRET }); });
  after(() => t.close());

  const uploads = () => readdirSync(t.dir).filter((f) => f.startsWith('index.db.upload-'));
  const shown = async () => (await t.json('/healthz')).mods;

  test('swaps in a signed index, and logs it', async () => {
    const all = await shown();
    const out = join(t.dir, 'next.db');
    await testIndex(out, MODS.map((m) => m.id).filter((id) => id !== 'street-cred'));
    const res = await send(t, readFileSync(out));
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json();
    assert.equal(body.before, all);
    assert.equal(body.mods, all - 1);
    assert.equal(await shown(), all - 1);
    assert.equal((await t.get('/mods/street-cred')).status, 404);
    assert.deepEqual(uploads(), []);
    assert.equal(t.site.auditLog(1)[0].action, 'index replaced');
    // And back, so the other tests see every mod.
    await testIndex(out);
    assert.equal((await send(t, readFileSync(out))).status, 200);
    assert.equal(await shown(), all);
  });

  test('refuses a bad signature, an old timestamp, another type, and keeps the index', async () => {
    const all = await shown();
    const out = join(t.dir, 'next.db');
    await testIndex(out, ['street-cred']);
    const file = readFileSync(out);
    assert.equal((await send(t, file, { secret: 'wrong' })).status, 401);
    assert.equal((await send(t, file, { sig: 'sha256=' + '0'.repeat(64) })).status, 401);
    assert.equal((await send(t, file, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401, 'an hour old');
    assert.equal((await send(t, file, { type: 'application/octet-stream' })).status, 415);
    assert.equal(await shown(), all);
    assert.deepEqual(uploads(), []);
  });

  test('refuses a file that is not an index, or one that lost most of the mods', async () => {
    const all = await shown();
    assert.ok(all >= 4, 'enough test mods for the half rule');
    const junk = await send(t, Buffer.from('not a database at all'));
    assert.equal(junk.status, 422);
    const out = join(t.dir, 'next.db');
    await testIndex(out, ['street-cred']);
    const few = await send(t, readFileSync(out));
    assert.equal(few.status, 422);
    assert.match((await few.json()).message, /more than half/);
    assert.equal(await shown(), all);
    assert.equal((await t.get('/mods/core-lib')).status, 200);
    assert.deepEqual(uploads(), []);
  });

  test('is off without its secret', async () => {
    const off = await start();
    try {
      const out = join(off.dir, 'next.db');
      writeFileSync(out, 'x');
      assert.equal((await send(off, readFileSync(out))).status, 503);
    } finally {
      await off.close();
    }
  });
});
