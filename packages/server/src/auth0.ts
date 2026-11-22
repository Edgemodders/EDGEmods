// SPDX-License-Identifier: Apache-2.0
// The sign-in exchange is adapted from The Lost Realms' Realm Registry (Registry/admin-login.js), Copyright 2026
// Brave You Worlds, LLC, under the Apache License 2.0: see ../NOTICE and ../licenses/Apache-2.0.txt.
//
// What the server asks of Auth0: the sign-in address, the code exchange (authorization code with PKCE and the
// client secret, done here so no token ever reaches the browser), the tenant's keys, the logout address, a password
// reset email, and deleting an account through the Management API. `fetch` is passed in so tests can stand in for
// the tenant.

import { createHash, randomBytes } from 'node:crypto';
import type { AuthConfig } from './config.js';
import { keyIdOf, verifyJwt, type Claims, type Jwk } from './jwt.js';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The sign-in methods the website offers, as Auth0 names their connections. */
export const CONNECTIONS = { github: 'github', google: 'google-oauth2', email: 'Username-Password-Authentication' } as const;
export type Method = keyof typeof CONNECTIONS;

const KEYS_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 10_000;

export interface SignInStart {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
}

export class Auth0 {
  private keys: { list: Jwk[]; at: number } = { list: [], at: 0 };
  private mgmtToken?: { value: string; until: number };

  constructor(readonly config: AuthConfig, readonly redirectUri: string, private readonly fetchFn: Fetch = fetch, private readonly now: () => number = Date.now) {}

  get issuer(): string {
    return `https://${this.config.domain}/`;
  }

  /** The address that starts a sign-in, and what the callback needs to finish it. */
  start(method?: Method): SignInStart {
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.redirectUri,
      // A person, not an API: the website keeps its own session, so it needs no access token.
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ...(method ? { connection: CONNECTIONS[method] } : {}),
    });
    return { url: `https://${this.config.domain}/authorize?${q}`, state, nonce, verifier };
  }

  /** Exchanges the code for an ID token and checks it. Throws with a sentence. */
  async finish(code: string, verifier: string, nonce: string): Promise<Claims> {
    const res = await this.post('/oauth/token', new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: this.redirectUri,
    }));
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body.id_token !== 'string') {
      throw new Error(`Auth0 refused the sign-in (HTTP ${res.status}${typeof body.error === 'string' ? `, ${body.error}` : ''})`);
    }
    const token = body.id_token;
    return verifyJwt(token, { keys: await this.keysFor(token), issuer: this.issuer, audience: this.config.clientId, now: this.now(), nonce });
  }

  /** Whether this server accepts the VS Code extension's access tokens. */
  get acceptsTokens(): boolean {
    return Boolean(this.config.audience && this.config.extensionClientId);
  }

  /**
   * Checks an access token the VS Code extension sent: this tenant, the EDGEmods API, made for the extension's own
   * application (its `azp`). Throws with a sentence.
   */
  async verifyAccessToken(token: string): Promise<Claims> {
    if (!this.acceptsTokens) throw new Error('this server does not take access tokens');
    const claims = verifyJwt(token, { keys: await this.keysFor(token), issuer: this.issuer, audience: this.config.audience!, now: this.now(), leewayMs: 0 });
    if (claims.azp !== this.config.extensionClientId) throw new Error('the token was made for another application');
    return claims;
  }

  /** Who an access token belongs to, from the tenant's userinfo (the access token carries no email or name). */
  async userInfo(token: string): Promise<Claims> {
    const res = await this.call(`https://${this.config.domain}/userinfo`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body.sub !== 'string' || !body.sub) throw new Error(`Auth0 did not say who this is (HTTP ${res.status})`);
    return body as Claims;
  }

  /** Where to send the browser to end its Auth0 session too, then come back. */
  logoutUrl(returnTo: string): string {
    return `https://${this.config.domain}/v2/logout?${new URLSearchParams({ client_id: this.config.clientId, returnTo })}`;
  }

  /** Asks Auth0 to email a link to set a new password (email-and-password accounts only). */
  async sendPasswordReset(email: string): Promise<void> {
    const res = await this.call(`https://${this.config.domain}/dbconnections/change_password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: this.config.clientId, email, connection: CONNECTIONS.email }),
    });
    if (!res.ok) throw new Error(`Auth0 did not send the email (HTTP ${res.status})`);
  }

  get canManage(): boolean {
    return Boolean(this.config.management);
  }

  /** Deletes the person from the tenant. A user Auth0 no longer has counts as deleted. */
  async deleteUser(id: string): Promise<void> {
    const m = this.config.management;
    if (!m) throw new Error('the server has no Management API access');
    const res = await this.call(`https://${m.domain}/api/v2/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${await this.managementToken()}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`Auth0 did not delete the account (HTTP ${res.status})`);
  }

  private async managementToken(): Promise<string> {
    const m = this.config.management!;
    if (this.mgmtToken && this.mgmtToken.until > this.now()) return this.mgmtToken.value;
    const res = await this.call(`https://${m.domain}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: m.clientId, client_secret: m.clientSecret, audience: `https://${m.domain}/api/v2/` }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body.access_token !== 'string') throw new Error(`Auth0 refused the server's Management API access (HTTP ${res.status})`);
    const life = Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : 3_600_000;
    this.mgmtToken = { value: body.access_token, until: this.now() + life - 60_000 };
    return body.access_token;
  }

  /** The tenant's keys, cached; fetched again early when a token names a key we do not have (a key rotation). */
  private async keysFor(token: string): Promise<Jwk[]> {
    const kid = keyIdOf(token);
    const age = this.now() - this.keys.at;
    const known = this.keys.list.some((k) => k.kid === kid);
    if (age < KEYS_TTL_MS && (known || age < 30_000)) return this.keys.list;
    const res = await this.call(`https://${this.config.domain}/.well-known/jwks.json`, { headers: { accept: 'application/json' } });
    const body = (await res.json().catch(() => ({}))) as { keys?: unknown };
    if (!res.ok || !Array.isArray(body.keys)) throw new Error(`the tenant's keys could not be read (HTTP ${res.status})`);
    this.keys = { list: body.keys as Jwk[], at: this.now() };
    return this.keys.list;
  }

  private post(path: string, form: URLSearchParams): Promise<Response> {
    return this.call(`https://${this.config.domain}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  }

  private call(url: string, init: RequestInit): Promise<Response> {
    return this.fetchFn(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  }
}
