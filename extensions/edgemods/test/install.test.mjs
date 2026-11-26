// R4c: installing a mod with its requirements, against a stand-in EDGEmods site and a stand-in EDGEdeck.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const { Api, carryOut, describe: words, failureWords, installUri, parseInstallPath, prepare, requestInstall, sortOut } = require('../dist/core.js');

const SITE = 'http://localhost:8800';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const CONTENT = { 'core-lib-1.3.0.zip': 'core bytes', 'street-cred-1.2.0.zip': 'street bytes', 'street-cred-hud.zip': 'hud bytes' };
const file = (name, role = 'required', extra = {}) => ({ name, role, size: CONTENT[name]?.length ?? 1, sha256: sha(CONTENT[name] ?? ''), ...extra });

/** The plan the site makes for street-cred: core-lib first, wanted at 1.2.0 or newer. */
function planFor(files = []) {
  const hud = files.includes('street-cred-hud.zip');
  return {
    mod: 'street-cred', problems: [], size: 0,
    mods: [
      { id: 'core-lib', name: 'Core Lib', version: '1.3.0', files: [file('core-lib-1.3.0.zip')], offered: [], neededBy: ['street-cred'], wants: [{ version: '1.2.0', by: 'street-cred' }] },
      {
        id: 'street-cred', name: 'Street Cred Overhaul', version: '1.2.0', neededBy: [], wants: [],
        files: [file('street-cred-1.2.0.zip'), ...(hud ? [file('street-cred-hud.zip', 'optional')] : [])],
        offered: hud ? [] : [file('street-cred-hud.zip', 'optional')],
      },
    ],
    links: [{ name: 'Cyber Engine Tweaks', url: 'https://www.nexusmods.com/cyberpunk2077/mods/107', neededBy: ['street-cred'] }],
  };
}

/** The site: install plans, and downloads that redirect to a file store, as GitHub does. */
function site({ plan = planFor, corrupt = '', problems } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: `${u.pathname}${u.search}`, auth: init.headers?.authorization });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/api/v1/mods/street-cred/install-plan') {
      if (problems) return json(200, { ...plan([]), problems });
      return json(200, plan(u.searchParams.getAll('files')));
    }
    if (u.pathname === '/api/v1/mods/nope/install-plan') return json(404, { mod: 'nope', mods: [], links: [], problems: ['"nope" is not on EDGEmods.'], size: 0 });
    const dl = /^\/download\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(u.pathname);
    if (dl) {
      if (!init.headers?.authorization) return json(401, { error: 'sign-in' });
      return new Response(null, { status: 302, headers: { location: `https://files.example/${dl[3]}` } });
    }
    if (u.host === 'files.example') {
      const name = u.pathname.slice(1);
      if (init.headers?.authorization) throw new Error('the token went to GitHub');
      return new Response(name === corrupt ? 'something else' : CONTENT[name], { status: 200 });
    }
    return json(404, { error: 'not-found' });
  };
  return { calls, api: new Api(SITE, fetch, async () => 'token-1') };
}

/** EDGEdeck: what the library has, and the lists it was handed. */
function deck(have = [], answer) {
  const d = { have, handed: [] };
  d.edgemodsMods = () => d.have;
  d.installMods = async (items, options) => {
    // EDGEdeck copies the files into its library; check they are whole while they are there.
    d.handed.push({ items: items.map((i) => ({ ...i, bytes: i.files.map((f) => readFileSync(f, 'utf8')) })), options });
    return answer ?? { ok: true, installed: items.map((i) => ({ modId: i.modId, id: `${i.modId}-${i.version}`, version: i.version })), skipped: [] };
  };
  return d;
}

const noChoice = async () => [];
const folder = () => join(mkdtempSync(join(tmpdir(), 'edgemods-install-')), 'run');

describe('what EDGEdeck has already', () => {
  test('a requirement is kept at any release that is on and that every mod needing it accepts', () => {
    const plan = planFor();
    const kept = sortOut(plan, [{ modId: 'core-lib', version: '1.2.5', id: 'cl', on: true, deployed: true }]);
    assert.deepEqual(kept.get.map((m) => m.id), ['street-cred']);
    assert.equal(kept.kept[0].have.version, '1.2.5');
    // Too old, or there but off: installed (EDGEdeck turns it on).
    assert.deepEqual(sortOut(plan, [{ modId: 'core-lib', version: '1.1.0', id: 'cl', on: true, deployed: true }]).get.map((m) => m.id), ['core-lib', 'street-cred']);
    assert.deepEqual(sortOut(plan, [{ modId: 'core-lib', version: '1.3.0', id: 'cl', on: false, deployed: false }]).get.map((m) => m.id), ['core-lib', 'street-cred']);
  });

  test('the mod asked for counts only at the release asked for', () => {
    const plan = planFor();
    const have = [{ modId: 'street-cred', version: '1.1.0', id: 'sc', on: true, deployed: true }, { modId: 'core-lib', version: '1.3.0', id: 'cl', on: true, deployed: false }];
    assert.deepEqual(sortOut(plan, have).get.map((m) => m.id), ['street-cred']);
    have[0].version = '1.2.0';
    assert.deepEqual(sortOut(plan, have).get, []);
  });

  test('without wants (an older site), only the plan\'s own release counts', () => {
    const plan = planFor();
    delete plan.mods[0].wants;
    assert.deepEqual(sortOut(plan, [{ modId: 'core-lib', version: '1.2.5', id: 'cl', on: true, deployed: true }]).get.map((m) => m.id), ['core-lib', 'street-cred']);
  });

  test('the question says what comes, why, what is kept and what to get by hand', () => {
    const plan = planFor();
    const w = words(plan, sortOut(plan, [{ modId: 'core-lib', version: '1.2.5', id: 'cl', on: true, deployed: true }]));
    assert.equal(w.message, 'Install Street Cred Overhaul 1.2.0?');
    assert.match(w.detail, /In EDGEdeck already, kept as they are:\n• Core Lib 1\.2\.5/);
    assert.match(w.detail, /Get these yourself, from outside EDGEmods .*\n• Cyber Engine Tweaks/);
    assert.match(w.detail, /Nothing goes into the game until you deploy\./);
    const all = words(plan, sortOut(plan, []));
    assert.equal(all.message, 'Install Street Cred Overhaul 1.2.0 and 1 mod it needs?');
    assert.match(all.detail, /• Core Lib 1\.3\.0, needed by Street Cred Overhaul/);
  });
});

describe('installing', () => {
  test('downloads every file, checks it, and hands the mods to EDGEdeck in order, requirements first', async () => {
    const s = site();
    const d = deck();
    const ready = await prepare(s.api, d, { mod: 'street-cred', version: '1.2.0' }, noChoice);
    assert.equal(ready.kind, 'ready');
    const dir = folder();
    const done = await carryOut(s.api, d, ready, { folder: dir });
    assert.equal(done.kind, 'done');
    const [call] = d.handed;
    assert.deepEqual(call.items.map((i) => [i.modId, i.version, i.name, i.requires, i.source]), [
      ['core-lib', '1.3.0', 'Core Lib', [], 'edgemods'],
      ['street-cred', '1.2.0', 'Street Cred Overhaul', ['core-lib'], 'edgemods'],
    ]);
    assert.deepEqual(call.items.map((i) => i.bytes), [['core bytes'], ['street bytes']]);
    assert.equal(call.options.title, 'Installing Street Cred Overhaul 1.2.0');
    // The run's folder is gone afterwards; EDGEdeck keeps its own copies.
    assert.equal(existsSync(dir), false);
    assert.ok(s.calls.filter((c) => c.path.startsWith('/download/')).every((c) => c.auth === 'Bearer token-1'));
  });

  test('a file that does not match its SHA-256 stops everything before EDGEdeck, naming the requirement', async () => {
    const s = site({ corrupt: 'core-lib-1.3.0.zip' });
    const d = deck();
    const ready = await prepare(s.api, d, { mod: 'street-cred' }, noChoice);
    const done = await carryOut(s.api, d, ready, { folder: folder() });
    assert.equal(done.kind, 'failed');
    assert.equal(done.step, 'check');
    assert.equal(done.mod.id, 'core-lib');
    assert.equal(d.handed.length, 0);
    assert.match(failureWords(done), /^Nothing was installed\. Core Lib 1\.3\.0 failed its check: core-lib-1\.3\.0\.zip: The file that came down is not the one EDGEmods checked/);
  });

  test('EDGEdeck\'s failure names the mod it failed on, with what it undid', async () => {
    const s = site();
    const d = deck([], { ok: false, failed: { modId: 'core-lib', step: 'files', reason: 'Nothing in core-lib-1.3.0.zip looks like a Cyberpunk mod file.' }, undone: [] });
    const done = await carryOut(s.api, d, await prepare(s.api, d, { mod: 'street-cred' }, noChoice), { folder: folder() });
    assert.equal(done.kind, 'failed');
    assert.equal(done.step, 'install');
    assert.equal(done.code, 'files');
    assert.match(failureWords(done), /^Nothing was installed\. EDGEdeck could not add Core Lib 1\.3\.0: Nothing in core-lib/);
  });

  test('picking an optional file asks the site again, so its own requirements join the plan', async () => {
    const s = site();
    let asked;
    const ready = await prepare(s.api, deck(), { mod: 'street-cred', version: '1.2.0' }, async (mod, choices) => {
      asked = choices;
      return ['street-cred-hud.zip'];
    });
    assert.deepEqual(asked.optional.map((f) => f.name), ['street-cred-hud.zip']);
    assert.equal(s.calls.at(-1).path, '/api/v1/mods/street-cred/install-plan?version=1.2.0&files=street-cred-hud.zip');
    assert.deepEqual(ready.root.files.map((f) => f.name), ['street-cred-1.2.0.zip', 'street-cred-hud.zip']);
  });

  test('closing a choice, problems in the plan and a mod EDGEmods lacks all stop before any download', async () => {
    const cancelled = await prepare(site().api, deck(), { mod: 'street-cred' }, async () => undefined);
    assert.equal(cancelled.kind, 'cancelled');
    const problems = await prepare(site({ problems: ['Skin needs Core Lib exactly 1.2.0.'] }).api, deck(), { mod: 'street-cred' }, noChoice);
    assert.deepEqual(problems, { kind: 'problems', problems: ['Skin needs Core Lib exactly 1.2.0.'] });
    const missing = await prepare(site().api, deck(), { mod: 'nope' }, noChoice);
    assert.deepEqual(missing, { kind: 'problems', problems: ['"nope" is not on EDGEmods.'] });
  });

  test('everything there already and on: nothing to do', async () => {
    const have = [{ modId: 'core-lib', version: '1.3.0', id: 'cl', on: true, deployed: true }, { modId: 'street-cred', version: '1.2.0', id: 'sc', on: true, deployed: false }];
    const r = await prepare(site().api, deck(have), { mod: 'street-cred', version: '1.2.0' }, noChoice);
    assert.equal(r.kind, 'nothing');
    assert.equal(r.sorted.kept.length, 2);
  });
});

describe('the MCP server\'s mods_install', () => {
  test('hands this editor a link to the plan\'s release, and nothing when the plan has problems', async () => {
    const opened = [];
    const r = await requestInstall(site().api, { id: 'street-cred' }, 'vscode', async (uri) => void opened.push(uri));
    assert.equal(r.sent, true);
    assert.deepEqual(opened, ['vscode://edgemodders.edgemods/install/street-cred/1.2.0']);
    assert.match(r.text, /^Installing Street Cred Overhaul 1\.2\.0 brings 2 mods/);
    assert.match(r.text, /Sent to VS Code\. .* asks before anything is downloaded or installed/);
    const stopped = await requestInstall(site({ problems: ['No release of Core Lib fits.'] }).api, { id: 'street-cred' }, 'vscode', async (uri) => void opened.push(uri));
    assert.equal(stopped.sent, false);
    assert.equal(opened.length, 1);
    assert.match(stopped.text, /Nothing was sent to VS Code/);
  });

  test('the link is built only from a mod id, a version and a known editor, and read back the same way', () => {
    assert.equal(installUri('cursor', 'core-lib', '1.3.0-beta.1'), 'cursor://edgemodders.edgemods/install/core-lib/1.3.0-beta.1');
    assert.throws(() => installUri('javascript', 'core-lib', '1.0.0'));
    assert.throws(() => installUri('vscode', '../admin', '1.0.0'));
    assert.deepEqual(parseInstallPath('/install/core-lib/1.3.0'), { action: 'install', mod: 'core-lib', version: '1.3.0' });
    for (const bad of ['/install/core-lib', '/install/Core_Lib/1.0.0', '/install/core-lib/1.0.0/extra', '/auth']) assert.equal(parseInstallPath(bad), undefined);
  });
});
