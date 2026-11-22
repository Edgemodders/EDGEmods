// Signing in to EDGEmods from outside a browser (docs/design.md, "Extension sign-in"): Auth0's authorization code
// flow with PKCE for a Native application, which has no client secret. The browser shows Auth0's page; the answer
// comes back to the editor as a link (vscode://edgemodders.edgemods/auth?code=…&state=…), and the code is swapped
// here for an access token (an hour) and a refresh token, which Auth0 replaces each time it is used.

import { createHash, randomBytes } from 'node:crypto';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type Method = 'github' | 'google' | 'email';

/** What the EDGEmods site says about signing in (GET /api/v1/auth). */
export interface AuthInfo {
  domain: string;
  clientId: string;
  audience: string;
  scope: string;
  connections: Record<Method, string>;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** When the access token runs out, in ms since 1970. */
  expiresAt: number;
}

/** The sign-in is over: the refresh token was refused (expired, revoked, the account deleted). Sign in again. */
export class SignedOutError extends Error {
  constructor(message = 'You are signed out of EDGEmods. Sign in again.') {
    super(message);
    this.name = 'SignedOutError';
  }
}

const TIMEOUT_MS = 15_000;

/** A new PKCE pair: the verifier stays here, the challenge goes to Auth0. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: challengeOf(verifier) };
}

export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function randomState(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * The address that opens Auth0's sign-in page in the browser. Spaces are %20, not +: VS Code's Uri, which carries the
 * address to the browser, decodes and encodes it again, and would turn a + into a real plus.
 */
export function authorizeUrl(info: AuthInfo, p: { redirectUri: string; state: string; challenge: string; method?: Method }): string {
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: info.clientId,
    redirect_uri: p.redirectUri,
    scope: info.scope,
    audience: info.audience,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    ...(p.method ? { connection: info.connections[p.method] } : {}),
  };
  const q = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://${info.domain}/authorize?${q}`;
}

/** Swaps the code from the sign-in link for tokens. */
export function exchangeCode(info: AuthInfo, p: { code: string; verifier: string; redirectUri: string }, fetchFn: Fetch = fetch, now = Date.now): Promise<Tokens> {
  return tokenCall(info, { grant_type: 'authorization_code', client_id: info.clientId, code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri }, undefined, fetchFn, now);
}

/** A new access token from the refresh token; Auth0 sends a new refresh token too (rotation). */
export function refreshTokens(info: AuthInfo, refreshToken: string, fetchFn: Fetch = fetch, now = Date.now): Promise<Tokens> {
  return tokenCall(info, { grant_type: 'refresh_token', client_id: info.clientId, refresh_token: refreshToken }, refreshToken, fetchFn, now);
}

/** Tells Auth0 the refresh token is no longer wanted. Best effort: signing out here does not wait on it. */
export async function revokeToken(info: AuthInfo, refreshToken: string, fetchFn: Fetch = fetch): Promise<void> {
  await fetchFn(`https://${info.domain}/oauth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: info.clientId, token: refreshToken }),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function tokenCall(info: AuthInfo, form: Record<string, string>, oldRefresh: string | undefined, fetchFn: Fetch, now: () => number): Promise<Tokens> {
  const res = await fetchFn(`https://${info.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = typeof body.error === 'string' ? body.error : '';
    // invalid_grant: the code or refresh token is used up, expired or revoked.
    if (error === 'invalid_grant' || (oldRefresh && (res.status === 401 || res.status === 403))) throw new SignedOutError();
    throw new Error(`Auth0 did not sign you in (HTTP ${res.status}${error ? `, ${error}` : ''}).`);
  }
  if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('Auth0 sent no access token.');
  const refreshToken = typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : oldRefresh;
  if (!refreshToken) throw new Error('Auth0 sent no refresh token: the EDGEmods API needs "Allow offline access" (docs/auth0-setup.md, step 4).');
  const life = Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : 3_600_000;
  return { accessToken: body.access_token, refreshToken, expiresAt: now() + life };
}
