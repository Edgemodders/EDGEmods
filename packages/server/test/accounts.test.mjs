// R3c: sign-in through a stand-in Auth0 tenant, sessions, likes and the Account page.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig, safeReturn } from '../dist/index.js';
import { fakeTenant, ORIGIN, signIn, start } from './helpers.mjs';

const BOB = { sub: 'github|20', nickname: 'bob', name: 'Bob Builder', email: 'bob@example.com', email_verified: true };
const post = (t, path, cookie, body = {}, headers = {}) => t.get(path, {
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}), ...headers },
  body: new URLSearchParams(body),
});

describe('signing in', () => {
  let t;
  let tenant;
  before(async () => {
    tenant = fakeTenant();
    t = await start({ tenant, admins: ['admin@example.com'] });
  });
  after(() => t.close());

  test('starts with PKCE, a state and a nonce, in a short signed cookie', async () => {
    const res = await t.get('/auth/signin?method=github&return=/mods/core-lib');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const url = new URL(res.headers.get('location'));
    assert.equal(url.origin, 'https://tenant.test');
    assert.equal(url.pathname, '/authorize');
    const p = url.searchParams;
    assert.equal(p.get('response_type'), 'code');
    assert.equal(p.get('client_id'), 'client-1');
    assert.equal(p.get('redirect_uri'), 'https://edgemods.test/auth/callback');
    assert.equal(p.get('scope'), 'openid profile email');
    assert.equal(p.get('code_challenge_method'), 'S256');
    assert.equal(p.get('connection'), 'github');
    assert.ok(p.get('state').length >= 32 && p.get('nonce').length >= 32 && p.get('code_challenge').length === 43);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('edgemods_login='));
    assert.match(cookie, /Path=\/auth; HttpOnly; SameSite=Lax; Secure; Max-Age=600/);
    assert.ok(!cookie.includes(p.get('code_challenge')), 'the cookie carries the verifier, not the challenge');
  });

  test('a good sign-in starts a session and returns to the page; the soft gate lifts', async () => {
    const { callback, setCookie, cookie } = await signIn(t, tenant, BOB);
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('location'), '/mods/street-cred');
    assert.match(setCookie, /^edgemods_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000$/);
    assert.equal(tenant.exchanges.at(-1).client_secret, 'secret-1', 'the code is exchanged with the client secret');
    const me = await (await t.get('/api/v1/me', { headers: { cookie } })).json();
    assert.deepEqual({ ...me, likes: undefined }, { signedIn: true, name: 'Bob Builder', via: 'GitHub', github: 'bob', admin: false, adult: false, likes: undefined });
    const page = await (await t.get('/mods/street-cred', { headers: { cookie } })).text();
    assert.match(page, /<summary class="who">/);
    assert.match(page, /GitHub · bob<small class="since">Logged in since <time datetime="\d{4}-\d\d-\d\dT[^"]+Z" data-local>\d+ \w+ \d{4}, \d\d:\d\d UTC<\/time><\/small>/);
    assert.match(page, /github\.com\/bob\/street-cred/, 'signed in, the repository shows');
    const user = t.site.user('github|20');
    assert.equal(user.githubId, 20);
    assert.equal(user.githubLogin, 'bob');
    // Only the session id's hash is stored.
    const sid = cookie.split('=')[1];
    assert.equal(t.site.db.prepare('SELECT count(*) AS n FROM sessions WHERE id = ?').get(sid).n, 0);
  });

  test('a session cookie that is made up or malformed is a visitor', async () => {
    for (const cookie of ['edgemods_session=' + 'A'.repeat(43), 'edgemods_session=%E0%A4%A', 'edgemods_session=../../x']) {
      const me = await (await t.get('/api/v1/me', { headers: { cookie } })).json();
      assert.equal(me.signedIn, false);
    }
  });

  test('the callback refuses what it did not start, and tokens that are not right', async () => {
    const statusOf = async (opts) => (await signIn(t, tenant, BOB, opts)).callback.status;
    const cases = {
      'the wrong nonce': (n) => tenant.good(`${n}x`, BOB),
      'another application': (n) => tenant.good(n, { ...BOB, aud: 'someone-else' }),
      'another issuer': (n) => tenant.good(n, { ...BOB, iss: 'https://evil.test/' }),
      'an expired token': (n) => tenant.good(n, { ...BOB, exp: Math.floor(Date.now() / 1000) - 3600 }),
      'issued 10 minutes ahead of our clock': (n) => tenant.good(n, { ...BOB, iat: Math.floor(Date.now() / 1000) + 600 }),
    };
    // A clock a few minutes slow, as on the owner's PC on 2026-11-21, still signs in.
    const slow = await signIn(t, tenant, BOB, { claims: (n) => tenant.good(n, { ...BOB, iat: Math.floor(Date.now() / 1000) + 270 }) });
    assert.equal(slow.callback.status, 303);
    for (const [what, claims] of Object.entries(cases)) assert.equal(await statusOf({ claims }), 502, what);
    const begin = await t.get('/auth/signin');
    const authorize = new URL(begin.headers.get('location'));
    const login = begin.headers.getSetCookie().find((c) => c.startsWith('edgemods_login=')).split(';')[0];
    const nonce = authorize.searchParams.get('nonce');
    tenant.challenge = authorize.searchParams.get('code_challenge');
    const tryToken = async (token) => {
      tenant.token = token;
      const r = await t.get(`/auth/callback?code=good-code&state=${authorize.searchParams.get('state')}`, { headers: { cookie: login } });
      tenant.token = undefined;
      return r.status;
    };
    assert.equal(await tryToken(tenant.jwt(tenant.good(nonce, BOB), { alg: 'none' })), 502, 'alg none');
    assert.equal(await tryToken(tenant.jwt(tenant.good(nonce, BOB), { alg: 'HS256' })), 502, 'HS256');
    assert.equal(await tryToken(tenant.jwt(tenant.good(nonce, BOB), { key: tenant.otherKey })), 502, 'signed with another key');
    assert.equal(await tryToken(tenant.jwt(tenant.good(nonce, BOB), { kid: 'unknown' })), 502, 'an unknown key id');

    const state = authorize.searchParams.get('state');
    assert.equal((await t.get(`/auth/callback?code=good-code&state=${state}`)).status, 400, 'no login cookie');
    assert.equal((await t.get(`/auth/callback?code=good-code&state=other`, { headers: { cookie: login } })).status, 400, 'another state');
    const [payload] = login.split('=')[1].split('.');
    assert.equal((await t.get(`/auth/callback?code=good-code&state=${state}`, { headers: { cookie: `edgemods_login=${payload}.forged` } })).status, 400, 'a forged cookie');
    assert.equal((await t.get(`/auth/callback?code=bad-code&state=${state}`, { headers: { cookie: login } })).status, 502, 'a code Auth0 refuses');
    const cancelled = await t.get(`/auth/callback?error=access_denied&error_description=%3Cb%3Ehi%3C%2Fb%3E&state=${state}`, { headers: { cookie: login } });
    assert.equal(cancelled.status, 400);
    const text = await cancelled.text();
    assert.match(text, /cancelled/);
    assert.ok(!text.includes('<b>hi</b>'), 'Auth0\'s description is not shown');
  });

  test('returns only to paths on this site', () => {
    for (const bad of ['https://evil.test/', '//evil.test/', '/\\evil.test', '/auth/callback', 'mods', '/x\ny']) assert.equal(safeReturn(bad), '/', bad);
    assert.equal(safeReturn('/mods?q=hud&sort=new'), '/mods?q=hud&sort=new');
  });

  test('Sign out ends the session here and at Auth0', async () => {
    const { cookie } = await signIn(t, tenant, BOB);
    assert.equal((await t.get('/auth/signout', { method: 'POST', headers: { cookie } })).status, 403, 'not from an EDGEmods page');
    const res = await post(t, '/auth/signout', cookie);
    assert.equal(res.status, 303);
    const logout = new URL(res.headers.get('location'));
    assert.equal(`${logout.origin}${logout.pathname}`, 'https://tenant.test/v2/logout');
    assert.equal(logout.searchParams.get('returnTo'), 'https://edgemods.test/');
    assert.equal(logout.searchParams.get('client_id'), 'client-1');
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('edgemods_session=;') && c.includes('Max-Age=0')));
    assert.equal((await (await t.get('/api/v1/me', { headers: { cookie } })).json()).signedIn, false, 'the old cookie no longer works');
  });

  test('pages allow Sign out\'s form to end at the tenant, and nothing else new', async () => {
    const csp = (await t.get('/')).headers.get('content-security-policy');
    assert.match(csp, /form-action 'self' https:\/\/tenant\.test(;|$)/);
    assert.match(csp, /connect-src 'self'/);
  });

  test('admins are verified emails on the list', async () => {
    const admin = await signIn(t, tenant, { sub: 'google-oauth2|1', name: 'Ada', email: 'Admin@Example.com', email_verified: true }, { method: 'google' });
    assert.equal((await (await t.get('/api/v1/me', { headers: { cookie: admin.cookie } })).json()).admin, true);
    const unverified = await signIn(t, tenant, { sub: 'auth0|2', name: 'Not Ada', email: 'admin@example.com', email_verified: false }, { method: 'email' });
    assert.equal((await (await t.get('/api/v1/me', { headers: { cookie: unverified.cookie } })).json()).admin, false);
  });

  test('blocking ends every session and refuses the next sign-in', async () => {
    const mallory = { sub: 'github|999', nickname: 'mallory', name: 'Mallory', email: 'm@example.com', email_verified: true };
    const { cookie } = await signIn(t, tenant, mallory);
    t.site.setStatus('github|999', 'blocked');
    assert.equal((await (await t.get('/api/v1/me', { headers: { cookie } })).json()).signedIn, false);
    const again = await signIn(t, tenant, mallory);
    assert.equal(again.callback.status, 403);
    assert.equal(again.cookie, undefined);
  });
});

describe('likes', () => {
  let t;
  let tenant;
  let cookie;
  before(async () => {
    tenant = fakeTenant();
    t = await start({ tenant });
    ({ cookie } = await signIn(t, tenant, BOB));
  });
  after(() => t.close());

  test('a like is a form that works without JavaScript, from EDGEmods pages only', async () => {
    assert.equal((await post(t, '/mods/core-lib/like', cookie, { like: '1', return: '/mods' }, { origin: 'https://evil.test' })).status, 403);
    const res = await post(t, '/mods/core-lib/like', cookie, { like: '1', return: '/mods?sort=likes' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/mods?sort=likes');
    const page = await (await t.get('/mods/core-lib', { headers: { cookie } })).text();
    assert.match(page, /aria-pressed="true" title="Unlike">.*<span class="n">1<\/span>/s);
    const { cards } = await (await t.get('/api/v1/mods?sort=likes')).json();
    assert.equal(cards[0].id, 'core-lib');
    assert.equal(cards[0].likes, 1);
  });

  test('site.js asks for JSON; liking twice counts once; unliking', async () => {
    const send = async (like) => (await post(t, '/mods/street-cred/like', cookie, { like }, { accept: 'application/json' })).json();
    assert.deepEqual(await send('1'), { liked: true, likes: 1 });
    assert.deepEqual(await send('1'), { liked: true, likes: 1 });
    assert.deepEqual(await send('0'), { liked: false, likes: 0 });
  });

  test('visitors are asked to sign in; mods that do not show cannot be liked', async () => {
    const visitor = await post(t, '/mods/core-lib/like', undefined, { like: '1', return: '/mods/core-lib' });
    assert.equal(visitor.status, 303);
    assert.equal(visitor.headers.get('location'), '/signin?return=%2Fmods%2Fcore-lib');
    assert.equal((await post(t, '/mods/core-lib/like', undefined, { like: '1' }, { accept: 'application/json' })).status, 401);
    assert.equal((await post(t, '/mods/spicy/like', cookie, { like: '1' }, { accept: 'application/json' })).status, 404, 'adult, not opted in');
    assert.equal((await post(t, '/mods/unchecked/like', cookie, { like: '1' }, { accept: 'application/json' })).status, 404, 'not checked');
    const card = await t.text('/mods');
    assert.match(card, /<a class="like" href="\/signin\?return=%2Fmods" title="Sign in to like">/);
  });
});

describe('the Account page', () => {
  let t;
  let tenant;
  before(async () => {
    tenant = fakeTenant();
    t = await start({ tenant });
  });
  after(() => t.close());

  test('needs a sign-in', async () => {
    const res = await t.get('/me?tab=likes');
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/signin?return=%2Fme%3Ftab%3Dlikes');
    const signin = await t.text('/signin?return=%2Fme');
    assert.match(signin, /href="\/auth\/signin\?method=github&amp;return=%2Fme"/);
    assert.match(signin, /href="\/auth\/signin\?method=google&amp;return=%2Fme"/);
    assert.match(signin, /href="\/auth\/signin\?method=email&amp;return=%2Fme"/);
  });

  test('a modder sees their mods, live or waiting; likes and settings work', async () => {
    const { cookie } = await signIn(t, tenant, BOB);
    const mods = await (await t.get('/me?tab=mods', { headers: { cookie } })).text();
    assert.match(mods, /<b>Street Cred<\/b><small>street-cred<\/small><\/td><td><span class="st on">Live<\/span>/);
    const erin = await signIn(t, tenant, { sub: 'github|50', nickname: 'erin', name: 'Erin', email: 'erin@example.com', email_verified: true });
    const waiting = await (await t.get('/me?tab=mods', { headers: { cookie: erin.cookie } })).text();
    assert.match(waiting, /Waiting for checks/);

    await post(t, '/mods/pinned-hud/like', cookie, { like: '1' });
    assert.match(await (await t.get('/me?tab=likes', { headers: { cookie } })).text(), /href="\/mods\/pinned-hud">Pinned Hud</);

    assert.equal((await t.get('/mods/spicy', { headers: { cookie } })).status, 403);
    const saved = await post(t, '/me/settings', cookie, { adult: '1' });
    assert.equal(saved.headers.get('location'), '/me?tab=settings&note=settings');
    assert.equal((await t.get('/mods/spicy', { headers: { cookie } })).status, 200, 'adult mods show once opted in');
    await post(t, '/me/settings', cookie, {});
    assert.equal((await t.get('/mods/spicy', { headers: { cookie } })).status, 403);
  });

  test('the name shown can be changed, and cleared back to the sign-in\'s', async () => {
    const { cookie } = await signIn(t, tenant, BOB);
    await post(t, '/me/name', cookie, { name: '  Bob\u0000 the   <b>Great</b> ' });
    const page = await (await t.get('/me', { headers: { cookie } })).text();
    assert.match(page, /<h1>Bob the &lt;b&gt;Great&lt;\/b&gt;<\/h1>/);
    await post(t, '/me/name', cookie, { name: '' });
    assert.match(await (await t.get('/me', { headers: { cookie } })).text(), /<h1>Bob Builder<\/h1>/);
  });

  test('Download my data has the account and likes, and no session ids', async () => {
    const { cookie } = await signIn(t, tenant, BOB);
    await post(t, '/mods/core-lib/like', cookie, { like: '1' });
    const res = await t.get('/me/data', { headers: { cookie } });
    assert.match(res.headers.get('content-disposition'), /attachment; filename="edgemods-my-data.json"/);
    const data = await res.json();
    assert.equal(data.account.id, 'github|20');
    assert.ok(data.likes.some((l) => l.mod === 'core-lib'));
    assert.ok(data.sessions.length >= 1 && data.sessions.every((s) => !('id' in s)));
  });

  test('the password email is for email-and-password accounts', async () => {
    const gh = await signIn(t, tenant, BOB);
    assert.equal((await post(t, '/me/password', gh.cookie)).headers.get('location'), '/me?tab=profile&note=password-failed');
    const mail = await signIn(t, tenant, { sub: 'auth0|7', name: 'Mae', email: 'mae@example.com', email_verified: true }, { method: 'email' });
    assert.equal((await post(t, '/me/password', mail.cookie)).headers.get('location'), '/me?tab=profile&note=password');
    assert.deepEqual(tenant.resets.at(-1), { client_id: 'client-1', email: 'mae@example.com', connection: 'Username-Password-Authentication' });
  });

  test('deleting an account removes it at Auth0 first, then here', async () => {
    const who = { sub: 'google-oauth2|42', name: 'Gone Soon', email: 'gone@example.com', email_verified: true };
    const { cookie } = await signIn(t, tenant, who, { method: 'google' });
    await post(t, '/mods/core-lib/like', cookie, { like: '1' });
    assert.equal((await post(t, '/me/delete', cookie, {})).headers.get('location'), '/me?tab=profile&note=delete-confirm', 'needs the box ticked');
    tenant.failDelete = true;
    assert.equal((await post(t, '/me/delete', cookie, { confirm: '1' })).headers.get('location'), '/me?tab=profile&note=delete-failed');
    assert.ok(t.site.user('google-oauth2|42'), 'nothing removed when Auth0 fails');
    tenant.failDelete = false;
    const res = await post(t, '/me/delete', cookie, { confirm: '1' });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Account <span>deleted<\/span>/);
    assert.deepEqual(tenant.deleted, ['google-oauth2|42']);
    assert.equal(t.site.user('google-oauth2|42'), undefined);
    assert.equal(t.site.db.prepare('SELECT count(*) AS n FROM likes WHERE user_id = ?').get('google-oauth2|42').n, 0);
    assert.equal((await (await t.get('/api/v1/me', { headers: { cookie } })).json()).signedIn, false);
  });
});

describe('without sign-in set up', () => {
  let t;
  before(async () => (t = await start()));
  after(() => t.close());

  test('the site says so and works for visitors', async () => {
    assert.match(await t.text('/signin'), /Sign in <span>soon<\/span>/);
    assert.equal((await t.get('/auth/signin')).status, 503);
    assert.equal((await t.get('/me')).status, 303);
    assert.deepEqual(await t.json('/api/v1/me'), { signedIn: false, signIn: false });
    assert.match((await t.get('/')).headers.get('content-security-policy'), /form-action 'self'(;|$)/);
  });
});

describe('settings', () => {
  test('sign-in is on only with every setting it needs', () => {
    const full = {
      EDGEMODS_AUTH0_DOMAIN: 'https://edgemods-dev.us.auth0.com/', EDGEMODS_AUTH0_CLIENT_ID: 'id', EDGEMODS_AUTH0_CLIENT_SECRET: 'secret',
      EDGEMODS_SESSION_SECRET: 'x'.repeat(43), EDGEMODS_ADMINS: 'A@Example.com, b@example.com',
    };
    const on = loadConfig(full);
    assert.equal(on.auth.domain, 'edgemods-dev.us.auth0.com');
    assert.deepEqual(on.admins, ['a@example.com', 'b@example.com']);
    assert.equal(on.auth.management, undefined);
    assert.match(on.authProblems[0], /deleting an account does not/);
    assert.deepEqual(loadConfig({}).authProblems, []);
    assert.equal(loadConfig({}).auth, undefined);
    const partial = loadConfig({ ...full, EDGEMODS_AUTH0_CLIENT_SECRET: '' });
    assert.equal(partial.auth, undefined);
    assert.deepEqual(partial.authProblems, ['EDGEMODS_AUTH0_CLIENT_SECRET is not set, so sign-in is off.']);
    assert.equal(loadConfig({ ...full, EDGEMODS_SESSION_SECRET: 'short' }).auth, undefined);
    const managed = loadConfig({ ...full, EDGEMODS_AUTH0_MANAGEMENT_CLIENT_ID: 'm', EDGEMODS_AUTH0_MANAGEMENT_CLIENT_SECRET: 'ms' });
    assert.deepEqual(managed.auth.management, { domain: 'edgemods-dev.us.auth0.com', clientId: 'm', clientSecret: 'ms' });
  });
});
