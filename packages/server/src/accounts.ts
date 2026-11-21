// Who is signed in (docs/design.md, "Accounts"). The browser holds an opaque session id in an HttpOnly cookie; the
// server keeps its SHA-256 in site.db, so a session can be ended from here and a copy of the database signs nobody
// in. No token from Auth0 ever reaches the browser: the code is exchanged on the server.
//
// Between /auth/signin and /auth/callback, the sign-in's state, nonce and PKCE verifier ride in a short-lived
// cookie signed with EDGEMODS_SESSION_SECRET, so nothing is kept in memory and a restart does not break a sign-in
// in progress.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Auth0, Method } from './auth0.js';
import type { Claims } from './jwt.js';
import type { Config } from './config.js';
import type { Viewer } from './pages/layout.js';
import type { SignedIn, SiteStore, User } from './site-store.js';

export const SESSION_COOKIE = 'edgemods_session';
const LOGIN_COOKIE = 'edgemods_login';
export const SESSION_LIFE_MS = 30 * 24 * 3_600_000;
const LOGIN_LIFE_MS = 10 * 60_000;

export interface PendingSignIn {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  until: number;
}

/** How a person signed in, from the start of their Auth0 user id. */
export function methodOf(userId: string): Method | undefined {
  const prefix = userId.split('|')[0];
  return prefix === 'github' ? 'github' : prefix === 'google-oauth2' ? 'google' : prefix === 'auth0' ? 'email' : undefined;
}

export const METHOD_LABELS: Record<Method, string> = { github: 'GitHub', google: 'Google', email: 'Email and password' };

/** What an ID token says about a person, in EDGEmods' words. */
export function signedInFrom(claims: Claims): SignedIn {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const email = str(claims.email)?.toLowerCase();
  const github = /^github\|(\d+)$/.exec(claims.sub);
  // For a GitHub sign-in, Auth0's nickname is the GitHub login.
  const login = github ? str(claims.nickname) : undefined;
  const name = (str(claims.name) ?? str(claims.nickname) ?? email?.split('@')[0] ?? 'Player').slice(0, 80);
  return {
    id: claims.sub,
    name,
    email,
    emailVerified: claims.email_verified === true,
    githubId: github ? Number(github[1]) : undefined,
    githubLogin: login && /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : undefined,
  };
}

/** A path on this site to come back to after signing in; anything else becomes the home page. */
export function safeReturn(value: unknown): string {
  const s = typeof value === 'string' ? value : '';
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\') || s.length > 500 || /[\u0000-\u001f\\]/.test(s) || s.startsWith('/auth/')) return '/';
  return s;
}

/** A write through the cookie must come from the site's own pages (SameSite=Lax covers forms; this covers the rest). */
export function sameOrigin(req: Request, publicUrl: string): boolean {
  const origin = req.get('origin');
  if (origin) return origin === new URL(publicUrl).origin;
  return req.get('sec-fetch-site') === 'same-origin';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // A cookie that is not ours, badly encoded: ignore it.
    }
  }
  return out;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export class Accounts {
  private readonly secure: boolean;
  private readonly cache = new WeakMap<Request, User | null>();

  constructor(readonly config: Config, readonly site: SiteStore, readonly auth0?: Auth0, private readonly now: () => number = Date.now) {
    this.secure = config.publicUrl.startsWith('https:');
  }

  get on(): boolean {
    return Boolean(this.auth0);
  }

  /** The signed-in person behind a request, if any (looked up once per request). */
  userOf(req: Request): User | undefined {
    if (!this.on) return undefined;
    const known = this.cache.get(req);
    if (known !== undefined) return known ?? undefined;
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const user = sid && /^[A-Za-z0-9_-]{43}$/.test(sid) ? this.site.sessionUser(sha256(sid), new Date(this.now())) : undefined;
    this.cache.set(req, user ?? null);
    return user;
  }

  isAdmin(user: User): boolean {
    return Boolean(user.email && user.emailVerified && this.config.admins.includes(user.email));
  }

  viewerOf(req: Request): Viewer | undefined {
    const user = this.userOf(req);
    if (!user) return undefined;
    const method = methodOf(user.id);
    return {
      id: user.id,
      name: user.username ?? user.name,
      github: user.githubLogin,
      githubId: user.githubId,
      via: method ? METHOD_LABELS[method] : 'Auth0',
      admin: this.isAdmin(user),
      adult: user.adult,
      liked: this.site.likes(user.id),
      since: user.sessionStartedAt,
    };
  }

  // ---- the sign-in's own cookie ----

  pendingCookie(p: PendingSignIn): string {
    const payload = Buffer.from(JSON.stringify(p)).toString('base64url');
    return this.cookie(LOGIN_COOKIE, `${payload}.${this.mac(payload)}`, LOGIN_LIFE_MS, '/auth');
  }

  pendingOf(req: Request): PendingSignIn | undefined {
    const value = parseCookies(req.headers.cookie)[LOGIN_COOKIE] ?? '';
    const [payload, mac] = value.split('.');
    if (!payload || !mac) return undefined;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
    try {
      const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PendingSignIn;
      return p.until > this.now() ? p : undefined;
    } catch {
      return undefined;
    }
  }

  clearPendingCookie(): string {
    return this.cookie(LOGIN_COOKIE, '', 0, '/auth');
  }

  // ---- sessions ----

  /** Starts a session for a person; returns the Set-Cookie value. */
  startSession(userId: string): string {
    const sid = randomBytes(32).toString('base64url');
    this.site.createSession(sha256(sid), userId, SESSION_LIFE_MS, new Date(this.now()));
    return this.cookie(SESSION_COOKIE, sid, SESSION_LIFE_MS, '/');
  }

  /** Ends the request's session, if it has one; returns the Set-Cookie value that clears it. */
  endSession(req: Request): string {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (sid) this.site.deleteSession(sha256(sid));
    return this.cookie(SESSION_COOKIE, '', 0, '/');
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.auth0?.config.sessionSecret ?? '').update(`edgemods-login:${payload}`).digest('base64url');
  }

  /** HttpOnly so no script reads it; SameSite=Lax so another site's form cannot carry it; Secure on https. */
  private cookie(name: string, value: string, lifeMs: number, path: string): string {
    return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}; Max-Age=${Math.floor(lifeMs / 1000)}`;
  }
}
