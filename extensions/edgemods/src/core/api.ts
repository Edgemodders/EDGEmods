// The EDGEmods website's API (/api/v1), for the extension and the MCP server. Calls carry the access token when
// someone is signed in; a token the site refuses is renewed once and the call tried again.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
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

/** A mod in a list (GET /api/v1/mods, /api/v1/me/likes). */
export interface Card {
  id: string;
  name: string;
  summary: string;
  author: string;
  type: string;
  tags: string[];
  version: string;
  size: number;
  firstPublished?: string;
  lastUpdated?: string;
  adult: boolean;
  runsCode: boolean;
  /** The card picture's path in the mod's repository; the site serves it under /mods/<id>/images/. */
  card: string;
  likes: number;
  downloads: number;
}

export const SORTS = ['relevance', 'updated', 'new', 'downloads', 'likes', 'name'] as const;
export type Sort = (typeof SORTS)[number];

export interface SearchQuery {
  q?: string;
  sort?: Sort;
  page?: number;
  type?: string[];
  tag?: string[];
}

export interface SearchResult {
  total: number;
  page: number;
  pages: number;
  cards: Card[];
}

export const MOD_TABS = ['about', 'files', 'versions', 'needs'] as const;
export type ModTab = (typeof MOD_TABS)[number];

/** A mod's page for an editor tab (GET /api/v1/mods/<id>/view): the website's own content, without its frame. */
export interface ModPage {
  id: string;
  name: string;
  version: string;
  tab: ModTab;
  html: string;
}

/** A release as GET /api/v1/mods/<id> gives it: what a download is checked against. */
export interface ModRelease {
  tag?: string;
  version: string;
  files: { name: string; title?: string; role: string; size: number }[];
  check?: { ok: boolean; downloads: { name: string; size: number; sha256: string }[] };
}

export interface ModInfo {
  /** owner/name on GitHub: for people who are signed in only. */
  repo?: string;
  id: string;
  name: string;
  shown: ModRelease;
  releases: ModRelease[];
}

/** A file in an install plan (GET /api/v1/mods/<id>/install-plan, packages/server/src/plan.ts). */
export interface PlanFile {
  name: string;
  role: string;
  group?: string;
  title?: string;
  size: number;
  /** What EDGEmods recorded when it checked the release; missing for a release not checked yet. */
  sha256?: string;
}

export interface PlanMod {
  id: string;
  name: string;
  version: string;
  /** The files to install. */
  files: PlanFile[];
  /** Files the player may add or swap in: optional files, and the other files of each choose-one group. */
  offered: PlanFile[];
  /** The mods that need this one, by id; empty for the mod asked for. */
  neededBy: string[];
  /** What each of those accepts. Missing from sites older than 2026-11-26. */
  wants?: { version: string; exact?: boolean; by: string }[];
}

/** What installing a mod brings: requirements first, the mod asked for last. */
export interface Plan {
  mod: string;
  mods: PlanMod[];
  links: { name: string; url: string; note?: string; neededBy: string[] }[];
  /** Plain words; any problem means nothing can be installed. */
  problems: string[];
  size: number;
}

export const REPORT_REASONS = {
  broken: 'Does not work',
  malware: 'Malware or harmful',
  stolen: 'Someone else\'s work',
  adult: 'Adult content not marked 18+',
  other: 'Something else',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** The path of a mod picture on the site. */
export function imagePath(mod: string, path: string): string {
  return `/mods/${encodeURIComponent(mod)}/images/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** The site answered with an error. `code` is the site's own word for it (`username`, `blocked`, `taken`, …). */
export class ApiError extends Error {
  /** `data`: the site's answer, when it sent one. */
  constructor(readonly status: number, readonly code: string, message: string, readonly data?: unknown) {
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
  github: 'GitHub, where the file lives, did not answer just now. Try again in a moment.',
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

  search(query: SearchQuery = {}): Promise<SearchResult> {
    const p = new URLSearchParams();
    if (query.q?.trim()) p.set('q', query.q.trim());
    if (query.sort) p.set('sort', query.sort);
    if (query.page && query.page > 1) p.set('page', String(query.page));
    for (const t of query.type ?? []) p.append('type', t);
    for (const t of query.tag ?? []) p.append('tag', t);
    const text = p.toString();
    return this.call('GET', `/api/v1/mods${text ? `?${text}` : ''}`);
  }

  /** The mods the person likes, most recently liked first. */
  likes(): Promise<{ cards: Card[] }> {
    return this.call('GET', '/api/v1/me/likes');
  }

  mod(id: string): Promise<ModInfo> {
    return this.call('GET', `/api/v1/mods/${encodeURIComponent(id)}`);
  }

  modPage(id: string, tab?: ModTab, reported?: 'sent' | 'already'): Promise<ModPage> {
    const p = new URLSearchParams();
    if (tab && tab !== 'about') p.set('tab', tab);
    if (reported) p.set('reported', reported);
    const text = p.toString();
    return this.call('GET', `/api/v1/mods/${encodeURIComponent(id)}/view${text ? `?${text}` : ''}`);
  }

  like(id: string, like: boolean): Promise<{ liked: boolean; likes: number }> {
    return this.call('POST', `/api/v1/mods/${encodeURIComponent(id)}/like`, { like });
  }

  /** True when the report went to the admins; false when this person already has one open for the mod. */
  async report(id: string, reason: ReportReason, note: string): Promise<boolean> {
    return (await this.call<{ sent: boolean }>('POST', `/api/v1/mods/${encodeURIComponent(id)}/report`, { reason, note })).sent;
  }

  /**
   * What installing a mod brings. A plan the site could not make (an unknown mod or release) comes back with its
   * problem rather than as an error. `signed` false asks as a visitor, as the MCP server does.
   */
  async installPlan(id: string, q: { version?: string; files?: string[] } = {}, signed = true): Promise<Plan> {
    const p = new URLSearchParams();
    if (q.version) p.set('version', q.version);
    for (const f of q.files ?? []) p.append('files', f);
    const text = p.toString();
    const path = `/api/v1/mods/${encodeURIComponent(id)}/install-plan${text ? `?${text}` : ''}`;
    try {
      return await this.call<Plan>('GET', path, undefined, signed);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && err.data && Array.isArray((err.data as Partial<Plan>).problems)) return err.data as Plan;
      throw err;
    }
  }

  /** A file's download address on the site, which counts it and serves it (a sign-in is needed). */
  downloadPath(mod: string, version: string, file: string): string {
    return `/download/${encodeURIComponent(mod)}/${encodeURIComponent(version)}/${encodeURIComponent(file)}`;
  }

  /**
   * Downloads one of the site's /download/ paths to `dest`, written as `<dest>.part` first and renamed when whole.
   * With `sha256`, a file that does not match is deleted and the download fails. The site answers with a redirect to
   * GitHub; the token goes to the site only, never along a redirect.
   */
  async download(path: string, dest: string, opts: { sha256?: string; onProgress?: (done: number, total?: number) => void; signal?: AbortSignal } = {}): Promise<{ size: number; sha256: string }> {
    const get = async (url: string, token?: string): Promise<Response> => {
      try {
        return await this.fetchFn(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: 'manual', signal: opts.signal });
      } catch {
        if (opts.signal?.aborted) throw new ApiError(0, 'cancelled', 'The download was cancelled.');
        throw new ApiError(0, 'offline', `${new URL(url).host} did not answer. Check your connection.`);
      }
    };
    const first = `${this.site}${path}`;
    const token = await this.token?.(false);
    if (!token) throw new ApiError(401, 'sign-in', MESSAGES['sign-in']);
    let res = await get(first, token);
    if (res.status === 401) {
      const again = await this.token?.(true);
      if (again) res = await get(first, again);
    }
    // A few hops at most (the site, then GitHub's own redirect to its file store), never with the token.
    let at = first;
    for (let hops = 0; res.status >= 300 && res.status < 400 && hops < 5; hops++) {
      const location = res.headers.get('location');
      if (!location) break;
      const next = new URL(location, at);
      if (next.protocol !== 'https:') throw new ApiError(0, 'redirect', 'The download pointed somewhere that is not https, so it was stopped.');
      await res.body?.cancel();
      at = next.href;
      res = await get(at);
    }
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
      const code = typeof data?.error === 'string' ? data.error : `http-${res.status}`;
      throw new ApiError(res.status, code, MESSAGES[code] ?? `The download answered HTTP ${res.status}.`);
    }
    const total = Number(res.headers.get('content-length')) || undefined;
    const part = `${dest}.part`;
    const hash = createHash('sha256');
    const out = createWriteStream(part);
    let size = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        size += value.byteLength;
        if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
        opts.onProgress?.(size, total);
      }
      await new Promise<void>((resolve, reject) => out.end(() => resolve()).once('error', reject));
    } catch (err) {
      out.destroy();
      await rm(part, { force: true });
      if (opts.signal?.aborted) throw new ApiError(0, 'cancelled', 'The download was cancelled.');
      throw new ApiError(0, 'offline', `The download stopped: ${err instanceof Error ? err.message : err}`);
    }
    const sha256 = hash.digest('hex');
    if (opts.sha256 && opts.sha256.toLowerCase() !== sha256) {
      await rm(part, { force: true });
      throw new ApiError(0, 'checksum', 'The file that came down is not the one EDGEmods checked, so it was deleted. Try again; if it happens again, report the mod.');
    }
    await rename(part, dest);
    return { size, sha256 };
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
      throw new ApiError(res.status, code, message, data);
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
