// R4a: the extension's core, with stand-ins for Auth0 and the EDGEmods site.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const { Api, ApiError, authorizeUrl, challengeOf, parseLink, Session, SignedOutError, siteOf, USERNAME_PATTERN } = require('../dist/core.js');

const SITE = 'http://localhost:8800';
const INFO = {
  domain: 'tenant.test', clientId: 'vscode-1', audience: 'https://edgemods.ai/api', scope: 'openid profile email offline_access',
  connections: { github: 'github', google: 'google-oauth2', email: 'Username-Password-Authentication' },
};
const REDIRECT = 'vscode://edgemodders.edgemods/auth';

/** A secret store in memory, shared by "windows" when passed to several sessions. */
function memoryStore() {
  const m = new Map();
  return { m, get: async (k) => m.get(k), store: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
}

/** Auth0 and the site together: codes, rotating refresh tokens, /api/v1/auth and /api/v1/me. */
function world() {
  const w = { codes: new Map(), refresh: new Set(), used: new Set(), revoked: [], calls: [], n: 0, theft: false, username: null };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    w.calls.push(`${init.method ?? 'GET'} ${u.host}${u.pathname}`);
    if (u.host === 'tenant.test' && u.pathname === '/oauth/token') {
      const p = new URLSearchParams(String(init.body));
      if (p.get('client_id') !== 'vscode-1' || p.has('client_secret')) return json(401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code') {
        const c = w.codes.get(p.get('code'));
        w.codes.delete(p.get('code'));
        if (!c || challengeOf(p.get('code_verifier')) !== c.challenge || p.get('redirect_uri') !== c.redirect) return json(403, { error: 'invalid_grant' });
      } else if (p.get('grant_type') === 'refresh_token') {
        const rt = p.get('refresh_token');
        if (w.used.has(rt)) w.theft = true;
        if (!w.refresh.has(rt)) return json(403, { error: 'invalid_grant' });
        w.refresh.delete(rt);
        w.used.add(rt);
      } else return json(400, { error: 'unsupported_grant_type' });
      w.n += 1;
      const rt = `rt-${w.n}`;
      w.refresh.add(rt);
      return json(200, { access_token: `at-${w.n}`, refresh_token: rt, expires_in: 3600, token_type: 'Bearer' });
    }
    if (u.host === 'tenant.test' && u.pathname === '/oauth/revoke') {
      w.revoked.push(JSON.parse(init.body).token);
      return new Response(null, { status: 200 });
    }
    if (u.origin === SITE && u.pathname === '/api/v1/auth') return json(200, INFO);
    if (u.origin === SITE && u.pathname === '/api/v1/me') {
      const auth = new Headers(init.headers).get('authorization');
      if (!auth) return json(200, { signedIn: false, signIn: true });
      if (auth !== `Bearer at-${w.n}`) return json(401, { error: 'invalid-token' });
      return json(200, { signedIn: true, id: 'github|4242', username: w.username, suggestion: 'Nightrunner', name: 'Night Runner', via: 'GitHub', github: 'Nightrunner' });
    }
    if (u.origin === SITE && u.pathname === '/api/v1/me/username') {
      const { username } = JSON.parse(init.body);
      if (username === 'taken') return json(400, { error: 'taken', message: 'Someone already has that username. Pick another.' });
      w.username = username;
      return json(200, { username });
    }
    return json(404, { error: 'not-found' });
  };
  /** What the browser and Auth0 do: the person signs in, and Auth0 sends the link back. */
  w.browser = (url) => {
    const q = new URL(url).searchParams;
    const code = `code-${w.codes.size + 1}`;
    w.codes.set(code, { challenge: q.get('code_challenge'), redirect: q.get('redirect_uri') });
    return new URLSearchParams({ code, state: q.get('state') });
  };
  return w;
}

async function signedIn(w, store = memoryStore(), now = () => Date.now()) {
  const s = new Session(SITE, store, w.fetch, now);
  const { url, done } = await s.begin(REDIRECT, 'github');
  assert.equal(await s.complete(w.browser(url)), true);
  await done;
  return s;
}

describe('signing in', () => {
  test('PKCE matches RFC 7636\'s example', () => {
    assert.equal(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('the sign-in address asks for the API, a refresh token and the chosen connection, with spaces as %20', () => {
    const url = authorizeUrl(INFO, { redirectUri: REDIRECT, state: 'st', challenge: 'ch', method: 'google' });
    assert.ok(url.startsWith('https://tenant.test/authorize?'));
    assert.ok(!url.includes('+'));
    const q = new URL(url).searchParams;
    assert.deepEqual(Object.fromEntries(q), {
      response_type: 'code', client_id: 'vscode-1', redirect_uri: REDIRECT, scope: 'openid profile email offline_access', audience: 'https://edgemods.ai/api',
      state: 'st', code_challenge: 'ch', code_challenge_method: 'S256', connection: 'google-oauth2',
    });
  });

  test('a round trip: the code comes back, tokens are kept together in one secret, and no secret is sent', async () => {
    const w = world();
    const store = memoryStore();
    const s = await signedIn(w, store);
    assert.equal(await s.signedIn(), true);
    assert.equal(await s.accessToken(), 'at-1');
    const saved = JSON.parse(store.m.get(`edgemods.signin:${SITE}`));
    assert.equal(saved.refreshToken, 'rt-1');
    assert.equal(saved.domain, 'tenant.test');
    assert.deepEqual(w.calls, ['GET localhost:8800/api/v1/auth', 'POST tenant.test/oauth/token']);
  });

  test('a link with another state changes nothing; Auth0\'s refusal is said in words', async () => {
    const w = world();
    const s = new Session(SITE, memoryStore(), w.fetch);
    const { url, done } = await s.begin(REDIRECT);
    assert.equal(await s.complete(new URLSearchParams({ code: 'x', state: 'other' })), false);
    const state = new URL(url).searchParams.get('state');
    assert.equal(await s.complete(new URLSearchParams({ error: 'access_denied', state })), true);
    await assert.rejects(done, /cancelled, or the account did not let EDGEmods in/);
    assert.equal(await s.signedIn(), false);
  });

  test('starting again cancels the first sign-in', async () => {
    const w = world();
    const s = new Session(SITE, memoryStore(), w.fetch);
    const first = await s.begin(REDIRECT);
    const second = await s.begin(REDIRECT);
    await assert.rejects(first.done, /cancelled/);
    assert.equal(await s.complete(w.browser(first.url)), false);
    assert.equal(await s.complete(w.browser(second.url)), true);
    await second.done;
  });
});

describe('staying signed in', () => {
  test('an access token near its end is renewed, and the new refresh token replaces the old one', async () => {
    const w = world();
    let clock = Date.now();
    const s = await signedIn(w, memoryStore(), () => clock);
    clock += 3600_000 - 30_000;
    assert.equal(await s.accessToken(), 'at-2');
    assert.ok(w.used.has('rt-1') && w.refresh.has('rt-2'));
    assert.equal(w.theft, false);
  });

  test('two calls at once renew once', async () => {
    const w = world();
    let clock = Date.now();
    const s = await signedIn(w, memoryStore(), () => clock);
    clock += 3600_000;
    const [a, b] = await Promise.all([s.accessToken(), s.accessToken()]);
    assert.equal(a, 'at-2');
    assert.equal(b, 'at-2');
    assert.equal(w.n, 2);
  });

  test('two windows share the secret: the second uses what the first renewed and never reuses a refresh token', async () => {
    const w = world();
    const store = memoryStore();
    let clock = Date.now();
    const one = await signedIn(w, store, () => clock);
    const two = new Session(SITE, store, w.fetch, () => clock);
    clock += 3600_000;
    assert.equal(await one.accessToken(), 'at-2');
    assert.equal(await two.accessToken(), 'at-2');
    assert.equal(await two.accessToken({ fresh: true }), 'at-3');
    assert.equal(await one.accessToken(), 'at-3');
    assert.equal(w.theft, false);
  });

  test('a refused refresh token signs out', async () => {
    const w = world();
    let clock = Date.now();
    const s = await signedIn(w, memoryStore(), () => clock);
    w.refresh.clear();
    clock += 3600_000;
    await assert.rejects(s.accessToken(), SignedOutError);
    assert.equal(await s.signedIn(), false);
  });

  test('signing out forgets the tokens and revokes the refresh token', async () => {
    const w = world();
    const s = await signedIn(w);
    await s.signOut();
    assert.equal(await s.signedIn(), false);
    assert.equal(await s.accessToken(), undefined);
    assert.deepEqual(w.revoked, ['rt-1']);
  });
});

describe('the API', () => {
  test('calls carry the token; a refused token is renewed once and the call tried again', async () => {
    const w = world();
    const s = await signedIn(w);
    const api = new Api(SITE, w.fetch, (fresh) => s.accessToken({ fresh }));
    assert.equal((await api.me()).username, null);
    w.n += 1; // The site now refuses the kept token, as if it had been revoked.
    const me = await api.me();
    assert.equal(me.signedIn, true);
    assert.ok(w.used.has('rt-1'), 'renewed with the refresh token');
    assert.equal(await s.accessToken(), 'at-3');
  });

  test('without a sign-in, calls go without a token', async () => {
    const w = world();
    const api = new Api(SITE, w.fetch, async () => undefined);
    assert.deepEqual(await api.me(), { signedIn: false, signIn: true });
  });

  test('usernames: the site\'s words come back as an ApiError', async () => {
    const w = world();
    const s = await signedIn(w);
    const api = new Api(SITE, w.fetch, (fresh) => s.accessToken({ fresh }));
    await assert.rejects(api.setUsername('taken'), (err) => err instanceof ApiError && err.status === 400 && err.code === 'taken' && /already has/.test(err.message));
    assert.deepEqual(await api.setUsername('Nightrunner'), { username: 'Nightrunner' });
    assert.equal((await api.me()).username, 'Nightrunner');
  });

  test('a site that does not answer is said plainly', async () => {
    const api = new Api('http://localhost:1', async () => { throw new TypeError('fetch failed'); });
    await assert.rejects(api.me(), (err) => err.code === 'offline' && /did not answer/.test(err.message));
  });

  test('the site setting: https, or http on this PC; nothing else', () => {
    assert.equal(siteOf('https://edgemods.ai/'), 'https://edgemods.ai');
    assert.equal(siteOf('http://localhost:8800'), 'http://localhost:8800');
    assert.equal(siteOf('http://127.0.0.1:8800/'), 'http://127.0.0.1:8800');
    for (const bad of ['http://edgemods.ai', 'ftp://x', 'https://u:p@edgemods.ai', 'https://edgemods.ai/?x=1', 'nonsense', '']) assert.equal(siteOf(bad), undefined, bad);
  });

  test('the username rule is the server\'s', () => {
    const server = readFileSync(new URL('../../../packages/server/src/usernames.ts', import.meta.url), 'utf8');
    assert.ok(server.includes(`USERNAME_PATTERN = ${USERNAME_PATTERN.source.replace(/^/, '/')}/`));
  });
});

describe('mod manager links', () => {
  test('reads edgemods://install/<mod>/<version>', () => {
    assert.deepEqual(parseLink('edgemods://install/street-cred/1.0.0'), { action: 'install', mod: 'street-cred', version: '1.0.0' });
    assert.deepEqual(parseLink('edgemods://install/street-cred/1.0.0-beta.2/'), { action: 'install', mod: 'street-cred', version: '1.0.0-beta.2' });
  });

  test('refuses anything else, including a query, a fragment or a server', () => {
    for (const bad of [
      'edgemods://install/street-cred', 'edgemods://remove/street-cred/1.0.0', 'edgemods://install/street-cred/1.0.0/extra',
      'edgemods://install/street-cred/1.0.0?site=https://evil.test', 'edgemods://install/street-cred/1.0.0#x', 'edgemods://install/Street_Cred/1.0.0',
      'edgemods://install/street-cred/latest', 'https://edgemods.ai/mods/street-cred', 'edgemods://install/%E0%A4%A/1.0.0', 'edgemods://install/../1.0.0',
    ]) assert.equal(parseLink(bad), undefined, bad);
  });
});
