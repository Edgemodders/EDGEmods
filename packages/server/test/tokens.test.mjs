// R4a: the VS Code extension's access tokens on the API and downloads.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../dist/index.js';
import { API, fakeTenant, ORIGIN, signIn, start } from './helpers.mjs';

const GITHUB = { sub: 'github|4242', nickname: 'Nightrunner', name: 'Night Runner', email: 'nr@example.com', email_verified: false };
const bearer = (token) => ({ authorization: `Bearer ${token}`, accept: 'application/json' });

describe('the extension\'s sign-in', () => {
  let t;
  let tenant;
  before(async () => {
    tenant = fakeTenant();
    tenant.profiles[GITHUB.sub] = GITHUB;
    t = await start({ tenant });
  });
  after(() => t.close());

  const me = async (token) => (await t.get('/api/v1/me', { headers: bearer(token) })).json();
  const pick = (token, username, headers = {}) => t.get('/api/v1/me/username', {
    method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json', ...headers }, body: JSON.stringify({ username }),
  });

  test('tells the extension how to sign in', async () => {
    const res = await t.get('/api/v1/auth');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      domain: tenant.domain, clientId: 'vscode-1', audience: API, scope: 'openid profile email offline_access',
      connections: { github: 'github', google: 'google-oauth2', email: 'Username-Password-Authentication' },
    });
  });

  test('a first token asks Auth0 who it is once, then keeps the person; a username comes next', async () => {
    const token = tenant.access(GITHUB.sub);
    const first = await me(token);
    assert.equal(first.signedIn, true);
    assert.equal(first.username, null);
    assert.equal(first.suggestion, 'Nightrunner');
    assert.equal(first.github, 'Nightrunner');
    await me(token);
    assert.deepEqual(tenant.userinfo, [GITHUB.sub]);
    assert.equal(t.site.user(GITHUB.sub).githubId, 4242);
  });

  test('a download through a token waits for the username, and says so', async () => {
    const res = await t.get('/download/street-cred/1.0.0/street-cred-1.0.0.zip', { headers: bearer(tenant.access(GITHUB.sub)) });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'username' });
  });

  test('picks a username without an Origin header; problems come back in words', async () => {
    const token = tenant.access(GITHUB.sub);
    const bad = await pick(token, 'x');
    assert.equal(bad.status, 400);
    const problem = await bad.json();
    assert.equal(problem.error, 'invalid');
    assert.match(problem.message, /3 to 20/);
    const good = await pick(token, 'Nightrunner');
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { username: 'Nightrunner' });
    const after = await me(token);
    assert.equal(after.username, 'Nightrunner');
    assert.equal(after.suggestion, undefined);
  });

  test('downloads through a token count like the website\'s; a missing file answers in JSON', async () => {
    const token = tenant.access(GITHUB.sub);
    const before = t.site.downloadCount('core-lib');
    const res = await t.get('/download/core-lib/1.2.0/core-lib-1.2.0.zip', { headers: bearer(token) });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://github.com/alice/core-lib/releases/download/v1.2.0/core-lib-1.2.0.zip');
    assert.equal(t.site.downloadCount('core-lib'), before + 1);
    const missing = await t.get('/download/core-lib/9.9.9/nope.zip', { headers: bearer(token) });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'not-found' });
  });

  test('the install plan carries download links for a token', async () => {
    const plan = await (await t.get('/api/v1/mods/street-cred/install-plan', { headers: bearer(tenant.access(GITHUB.sub)) })).json();
    assert.ok(plan.mods.every((m) => m.files.every((f) => f.download?.startsWith('https://edgemods.test/download/'))));
  });

  test('refuses tokens that are not the extension\'s, not this tenant\'s or out of date', async () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      tenant.access(GITHUB.sub, { azp: 'client-1' }),
      tenant.access(GITHUB.sub, { aud: 'client-1' }),
      tenant.access(GITHUB.sub, { iss: 'https://evil.test/' }),
      tenant.access(GITHUB.sub, { exp: now - 5 }),
      tenant.jwt({ iss: `https://${tenant.domain}/`, sub: GITHUB.sub, aud: API, azp: 'vscode-1', iat: now, exp: now + 3600 }, { key: tenant.otherKey }),
    ];
    for (const token of bad) {
      const res = await t.get('/api/v1/me', { headers: bearer(token) });
      assert.equal(res.status, 401);
      assert.match(res.headers.get('www-authenticate'), /invalid_token/);
      assert.deepEqual(await res.json(), { error: 'invalid-token' });
    }
  });

  test('a person Auth0 does not know is not let in', async () => {
    const res = await t.get('/api/v1/me', { headers: bearer(tenant.access('auth0|ghost')) });
    assert.equal(res.status, 502);
    assert.equal(t.site.user('auth0|ghost'), undefined);
  });

  test('a blocked account\'s token is refused', async () => {
    const sub = 'google-oauth2|77';
    tenant.profiles[sub] = { name: 'Blocked', email: 'b@example.com', email_verified: true };
    assert.equal((await t.get('/api/v1/me', { headers: bearer(tenant.access(sub)) })).status, 200);
    t.site.setStatus(sub, 'blocked', 'test', 'spam');
    const res = await t.get('/api/v1/me', { headers: bearer(tenant.access(sub)) });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'blocked' });
  });

  test('pages go by the cookie only; a token there signs nobody in', async () => {
    const res = await t.get('/me', { headers: bearer(tenant.access(GITHUB.sub)) });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /^\/signin/);
  });

  test('a cookie still needs the same origin to write through the API', async () => {
    const { cookie } = await signIn(t, tenant, { sub: 'google-oauth2|55', name: 'Cookie', email: 'c@example.com', email_verified: true }, { method: 'google', username: false });
    const post = (headers) => t.get('/api/v1/me/username', { method: 'POST', headers: { cookie, 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify({ username: 'cookieperson' }) });
    assert.equal((await post({ origin: 'https://evil.test' })).status, 403);
    assert.equal((await post({ origin: ORIGIN })).status, 200);
  });
});

describe('without the extension\'s application', () => {
  let t;
  let tenant;
  before(async () => {
    tenant = fakeTenant();
    t = await start({ tenant, tokens: false });
  });
  after(() => t.close());

  test('there is no VS Code sign-in, and tokens are refused', async () => {
    assert.equal((await t.get('/api/v1/auth')).status, 404);
    const res = await t.get('/api/v1/me', { headers: bearer(tenant.access('github|1')) });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'no-tokens' });
  });

  test('the settings name what is missing', () => {
    const base = { EDGEMODS_AUTH0_DOMAIN: 'x.auth0.com', EDGEMODS_AUTH0_CLIENT_ID: 'a', EDGEMODS_AUTH0_CLIENT_SECRET: 'b', EDGEMODS_SESSION_SECRET: 's'.repeat(40) };
    const without = loadConfig({ ...base, EDGEMODS_AUTH0_EXTENSION_CLIENT_ID: 'v' });
    assert.equal(without.auth.extensionClientId, undefined);
    assert.ok(without.authProblems.some((p) => /needs EDGEMODS_AUTH0_AUDIENCE/.test(p)));
    const both = loadConfig({ ...base, EDGEMODS_AUTH0_EXTENSION_CLIENT_ID: 'v', EDGEMODS_AUTH0_AUDIENCE: API });
    assert.equal(both.auth.extensionClientId, 'v');
    assert.ok(!both.authProblems.some((p) => /VS Code/.test(p)));
  });
});
