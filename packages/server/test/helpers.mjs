// A small EDGEmods for tests: an index built by the real indexer from a fake GitHub, a real site.db, and the app
// listening on a free port.
import { createHash, createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIndex } from '@edgemodders/edgemods-indexer';
import { Accounts, Auth0, Catalog, createApp, ImageCache, SiteStore } from '../dist/index.js';

const enc = (t) => new TextEncoder().encode(t);

/** A PNG's first bytes: enough for readImageInfo. */
export const PNG = (() => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(1280, 16);
  b.writeUInt32BE(640, 20);
  return b;
})();

/** The mods: id, owner, type, tags, versions (newest last) with requirements, and options. */
export const MODS = [
  { id: 'core-lib', owner: 'alice', type: 'utility', tags: ['framework'], versions: { '1.0.0': [], '1.2.0': [], '1.3.0': [] } },
  { id: 'street-cred', owner: 'bob', type: 'gameplay', tags: ['balance', 'progression'], versions: { '1.0.0': [{ mod: 'core-lib', version: '1.2.0' }, { name: 'ArchiveXL', url: 'https://www.nexusmods.com/cyberpunk2077/mods/4198' }] } },
  { id: 'pinned-hud', owner: 'carol', type: 'ui', tags: ['balance'], versions: { '1.0.0': [{ mod: 'core-lib', version: '1.2.0', exact: true }] } },
  { id: 'spicy', owner: 'dave', type: 'clothing', tags: ['outfits'], adult: true, versions: { '1.0.0': [] } },
  { id: 'unchecked', owner: 'erin', type: 'world', tags: ['night-city'], versions: { '1.0.0': [] } },
];

function manifest(m, version) {
  return {
    schemaVersion: 1, id: m.id, name: m.id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
    summary: `The ${m.id} mod, for testing the website.`, version, author: { name: `${m.owner} the modder`, github: m.owner },
    license: 'MIT', type: m.type, tags: m.tags, gameVersion: '2.31', ...(m.adult ? { adult: true } : {}),
    images: { card: 'images/card.png' }, files: [{ name: `${m.id}-${version}.zip`, role: 'required', title: 'Main file' }],
    requirements: m.versions[version],
  };
}

function fakeGitHub() {
  const repos = MODS.map((m, i) => {
    const id = i + 1;
    const files = { main: { 'README.md': `# ${m.id}\n\n![card](images/card.png)\n\n<script>alert(1)</script>` } };
    const releases = Object.keys(m.versions).map((v, k) => {
      files[`v${v}`] = { 'edgemods.json': JSON.stringify(manifest(m, v)), 'README.md': files.main['README.md'], 'images/card.png': 'png' };
      return { tag: `v${v}`, draft: false, prerelease: false, publishedAt: `2026-10-0${k + 1}T00:00:00Z`, body: `Notes for ${v}.`,
        assets: [{ id: id * 100 + k, name: `${m.id}-${v}.zip`, size: 1000, url: `https://github.com/${m.owner}/${m.id}/releases/download/v${v}/${m.id}-${v}.zip` }] };
    }).reverse();
    return { id, m, files, releases };
  });
  const byName = (n) => repos.find((r) => `${r.m.owner}/${r.m.id}` === n);
  return {
    async repoById(id) {
      const r = repos.find((x) => x.id === id);
      return r && { id, name: r.m.id, fullName: `${r.m.owner}/${r.m.id}`, owner: { login: r.m.owner, id: id * 10, type: 'User' }, private: false, archived: false, disabled: false, fork: false, defaultBranch: 'main', htmlUrl: '' };
    },
    async releases(n) { return byName(n).releases; },
    async file(n, ref, path) { const t = byName(n)?.files[ref]?.[path]; return t === undefined ? undefined : enc(t); },
    async tree(n, ref) { return { files: Object.entries(byName(n)?.files[ref] ?? {}).map(([path, t]) => ({ path, size: t.length })), truncated: false }; },
  };
}

/** Starts a test EDGEmods. Every release passes its checks except core-lib 1.3.0 (failed) and "unchecked" (none). */
export async function start({ showUnchecked = false, viewer, checksSecret, fetchImage, tenant, admins = [], downloads = { mode: 'redirect', freeSpeed: 3 * 1024 * 1024 }, githubFetch } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'edgemods-server-'));
  const indexPath = join(dir, 'index.db');
  await buildIndex({ github: fakeGitHub(), mods: MODS.map((m, i) => ({ owner: m.owner, id: m.id, entry: { schemaVersion: 1, repo: `https://github.com/${m.owner}/${m.id}`, repoId: i + 1, ownerId: (i + 1) * 10 } })), out: indexPath });
  const site = new SiteStore(join(dir, 'site.db'));
  for (const m of MODS.filter((x) => x.id !== 'unchecked')) {
    for (const v of Object.keys(m.versions)) {
      const ok = !(m.id === 'core-lib' && v === '1.3.0');
      const runsCode = m.id === 'core-lib' ? ['red4ext/plugins/core/core.dll'] : [];
      site.recordCheck({ mod: m.id, version: v, ok, checkedAt: '2026-10-20T00:00:00Z', report: [],
        downloads: [{ name: `${m.id}-${v}.zip`, size: 1000, sha256: 'ab'.repeat(32), contents: { files: 2, size: 5000, kinds: { archive: 1, plugin: runsCode.length }, runsCode }, scan: { scanner: 'ClamAV', clean: true, findings: [] } }] });
    }
  }
  const catalog = new Catalog(indexPath, site.path, { showUnchecked });
  const fetched = [];
  const images = new ImageCache(join(dir, 'images'), async (url) => {
    fetched.push(url);
    return fetchImage ? fetchImage(url) : new Response(PNG, { headers: { 'content-type': 'image/png' } });
  });
  const auth = tenant && {
    domain: tenant.domain, clientId: 'client-1', clientSecret: 'secret-1', sessionSecret: 's'.repeat(43),
    management: { domain: tenant.domain, clientId: 'mgmt-1', clientSecret: 'mgmt-secret' },
  };
  const config = { host: '127.0.0.1', port: 0, dataDir: dir, indexPath, publicUrl: 'https://edgemods.test', checksSecret, showUnchecked, imageMaxAge: 60, auth, authProblems: [], admins, downloads };
  const accounts = new Accounts(config, site, auth && new Auth0(auth, `${config.publicUrl}/auth/callback`, (url, init) => tenant.fetch(url, init)));
  const app = createApp({ config, catalog, site, images, accounts, githubFetch, ...(viewer ? { viewer: () => viewer } : {}) });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, catalog, site, fetched, dir,
    get: (path, init) => fetch(base + path, { redirect: 'manual', ...init }),
    text: async (path) => (await fetch(base + path)).text(),
    json: async (path) => (await fetch(base + path)).json(),
    async close() { await new Promise((r) => server.close(r)); catalog.close(); site.close(); },
  };
}

/**
 * A stand-in for the Auth0 tenant: its keys, the token endpoint, the Management API and the password email. Set
 * `claims` before a callback to choose who signs in; `token` replaces the ID token outright.
 */
export function fakeTenant(domain = 'tenant.test') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = {
    domain, claims: {}, token: undefined, challenge: undefined, deleted: [], resets: [], failDelete: false, exchanges: [],
    jwt(claims, { alg = 'RS256', kid = 'k1', key = privateKey } = {}) {
      const body = `${b64({ alg, typ: 'JWT', kid })}.${b64(claims)}`;
      const sig = alg === 'none' ? '' : createSign('RSA-SHA256').update(body).sign(key).toString('base64url');
      return `${body}.${sig}`;
    },
    /** Claims for a good ID token: this tenant, this app, an hour to live. */
    good(nonce, extra = {}) {
      const now = Math.floor(Date.now() / 1000);
      return { iss: `https://${domain}/`, aud: 'client-1', iat: now, exp: now + 3600, nonce, ...extra };
    },
    otherKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey,
    async fetch(url, init = {}) {
      const u = new URL(url);
      if (u.host !== domain) throw new Error(`unexpected host ${u.host}`);
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (u.pathname === '/.well-known/jwks.json') return json(200, { keys: [jwk] });
      if (u.pathname === '/oauth/token') {
        const p = new URLSearchParams(String(init.body));
        if (p.get('grant_type') === 'client_credentials') {
          return p.get('client_secret') === 'mgmt-secret' && p.get('audience') === `https://${domain}/api/v2/` ? json(200, { access_token: 'mgmt-token', expires_in: 86400 }) : json(401, { error: 'access_denied' });
        }
        t.exchanges.push(Object.fromEntries(p));
        const pkce = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === t.challenge;
        if (p.get('client_secret') !== 'secret-1' || !pkce || p.get('code') !== 'good-code') return json(403, { error: 'invalid_grant' });
        return json(200, { id_token: t.token ?? t.jwt(t.claims), access_token: 'opaque', token_type: 'Bearer' });
      }
      if (u.pathname.startsWith('/api/v2/users/') && init.method === 'DELETE') {
        if (new Headers(init.headers).get('authorization') !== 'Bearer mgmt-token') return json(401, {});
        if (t.failDelete) return json(500, {});
        t.deleted.push(decodeURIComponent(u.pathname.slice('/api/v2/users/'.length)));
        return new Response(null, { status: 204 });
      }
      if (u.pathname === '/dbconnections/change_password') {
        t.resets.push(JSON.parse(String(init.body)));
        return new Response('Sent you an email to reset your password.', { status: 200 });
      }
      return json(404, {});
    },
  };
  return t;
}

/**
 * Signs in through /auth/signin and /auth/callback as the person `who` names, then picks a username on /welcome the
 * first time (`username: false` skips that); returns the session cookie and the callback.
 */
export async function signIn(t, tenant, who, { username, ...rest } = {}) {
  const r = await signInOnly(t, tenant, who, rest);
  if (r.cookie && username !== false) {
    const name = username ?? (/^[A-Za-z0-9-]{3,20}$/.test(who?.nickname ?? '') ? who.nickname : `u${(who?.sub ?? 'x').replace(/[^A-Za-z0-9]/g, '').slice(-15)}`);
    await t.get('/welcome', { method: 'POST', headers: { origin: ORIGIN, cookie: r.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: name }) });
  }
  return r;
}

async function signInOnly(t, tenant, who, { method = 'github', returnTo = '/mods/street-cred', claims } = {}) {
  const begin = await t.get(`/auth/signin?method=${method}&return=${encodeURIComponent(returnTo)}`);
  const authorize = new URL(begin.headers.get('location'));
  const login = begin.headers.getSetCookie().find((c) => c.startsWith('edgemods_login=')).split(';')[0];
  tenant.challenge = authorize.searchParams.get('code_challenge');
  tenant.claims = claims ? claims(authorize.searchParams.get('nonce')) : tenant.good(authorize.searchParams.get('nonce'), who);
  const callback = await t.get(`/auth/callback?code=good-code&state=${authorize.searchParams.get('state')}`, { headers: { cookie: login } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith('edgemods_session=') && !c.includes('Max-Age=0'));
  return { begin, authorize, login, callback, cookie: session?.split(';')[0], setCookie: session };
}

export const ORIGIN = 'https://edgemods.test';

export const sign = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
