// The EDGEmods website's API (/api/v1), for the extension and the MCP server. Calls carry the access token when
// someone is signed in; a token the site refuses is renewed once and the call tried again.

import type { AuthInfo, Fetch } from './auth.js';

/** GET /api/v1/me */
export interface Me {
  signedIn: boolean;
  /** The Auth0 user id, such as github|123. */
  id?: string;
  /** Null until the person picks one. */
  username?: string | null;
  /** A free username to offer, when there is none yet. */
  suggestion?: string;
  name?: string;
  via?: string;
  github?: string;
  admin?: boolean;
  adult?: boolean;
  likes?: string[];
}

/** The site answered with an error. `code` is the site's own word for it (`username`, `blocked`, `taken`, …). */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const TIMEOUT_MS = 20_000;

const MESSAGES: Record<string, string> = {
  'no-sign-in': 'This EDGEmods site does not take sign-ins from VS Code yet.',
  'no-tokens': 'This EDGEmods site does not take sign-ins from VS Code yet.',
  'invalid-token': 'EDGEmods did not accept the sign-in. Sign in again.',
  blocked: 'This account is blocked on EDGEmods.',
  username: 'Choose your EDGEmods username first.',
  auth0: 'EDGEmods could not ask Auth0 who you are just now. Try again in a moment.',
  'not-found': 'EDGEmods does not have that.',
  'sign-in': 'Sign in to EDGEmods first.',
};

/** A site address the extension may use: https, or http on this PC only (so a token never crosses a network in clear). */
export function siteOf(value: string | undefined): string | undefined {
  try {
    const u = new URL(String(value ?? '').trim());
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local)) || u.username || u.password || u.search || u.hash) return undefined;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
}

export class Api {
  constructor(readonly site: string, private readonly fetchFn: Fetch = fetch, private readonly token?: (fresh: boolean) => Promise<string | undefined>) {}

  /** How to sign in to this site. */
  auth(): Promise<AuthInfo> {
    return this.call<AuthInfo>('GET', '/api/v1/auth', undefined, false);
  }

  me(): Promise<Me> {
    return this.call<Me>('GET', '/api/v1/me');
  }

  /** Claims a username. Throws an ApiError with the site's words when it cannot be had. */
  setUsername(username: string): Promise<{ username: string }> {
    return this.call('POST', '/api/v1/me/username', { username });
  }

  /** A site address for people, such as a mod's page. */
  page(path: string): string {
    return `${this.site}${path}`;
  }

  async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, signed = true): Promise<T> {
    const token = signed ? await this.token?.(false) : undefined;
    let res = await this.send(method, path, body, token);
    if (res.status === 401 && token) {
      const again = await this.token?.(true);
      if (again) res = await this.send(method, path, body, again);
    }
    const data = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (!res.ok) {
      const code = typeof data?.error === 'string' ? data.error : `http-${res.status}`;
      const message = typeof data?.message === 'string' ? data.message : MESSAGES[code] ?? `EDGEmods answered HTTP ${res.status}.`;
      throw new ApiError(res.status, code, message);
    }
    if (data === undefined) throw new ApiError(res.status, 'not-json', 'EDGEmods sent an answer this extension cannot read.');
    return data as T;
  }

  private async send(method: string, path: string, body: unknown, token: string | undefined): Promise<Response> {
    try {
      return await this.fetchFn(`${this.site}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ApiError(0, 'offline', `${this.site} did not answer${err instanceof Error && err.name === 'TimeoutError' ? ' in time' : ''}. Check your connection, or the edgemods.site setting.`);
    }
  }
}
