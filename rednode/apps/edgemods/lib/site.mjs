// The EDGEmods site's API, as the VS Code extension uses it (extensions/edgemods/src/core/api.ts), for the Node mod.
// Only REDnode mods that install from the game are listed (?ingame=1). The token goes to the site only, never along
// a download's redirects to GitHub.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';

export const DEFAULT_SITE = 'https://edgemods.ai';
/** A mod id as the format allows (packages/format). */
export const MOD_ID = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export class SiteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MESSAGES = {
  'sign-in': 'Installing downloads the files, which needs a free EDGEmods account. Sign in on the Account tab.',
  'not-found': 'EDGEmods does not have that mod, or it is not shown any more.',
  'no-sign-in': 'This EDGEmods site has no sign-in set up.',
  'invalid-token': 'Your sign-in ran out. Sign in again on the Account tab.',
  'no-tokens': 'This EDGEmods site does not take sign-ins from the game yet.',
  'rate-limited': 'EDGEmods asks you to slow down. Try again in a minute.',
};

/** A site address the player may set: https, or http on this PC while testing. */
export function siteAddress(text) {
  let u;
  try {
    u = new URL(String(text ?? '').trim());
  } catch {
    return undefined;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return undefined;
  return u.origin;
}

export class Site {
  /**
   * @param {{ base: string, fetch?: typeof fetch, token?: (renew: boolean) => Promise<string | undefined> }} o
   */
  constructor({ base = DEFAULT_SITE, fetch = globalThis.fetch, token } = {}) {
    this.base = base;
    this.fetchFn = fetch;
    this.token = token;
  }

  async call(path, { signed = false, method = 'GET', body } = {}) {
    const go = async (token) => {
      try {
        return await this.fetchFn(`${this.base}${path}`, {
          method,
          headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        throw new SiteError(0, 'offline', `${new URL(this.base).host} did not answer. Check your connection.`);
      }
    };
    const token = signed ? await this.token?.(false) : undefined;
    let res = await go(token);
    if (res.status === 401 && token) {
      const again = await this.token?.(true);
      if (again) res = await go(again);
    }
    const data = await res.json().catch(() => undefined);
    if (!res.ok) {
      const code = typeof data?.error === 'string' ? data.error : `http-${res.status}`;
      const err = new SiteError(res.status, code, MESSAGES[code] ?? `EDGEmods answered HTTP ${res.status}.`);
      err.data = data;
      throw err;
    }
    return data;
  }

  /** How to sign in: the tenant, the API and the in-game application's client id. */
  auth() {
    return this.call('/api/v1/auth');
  }

  /** REDnode mods that install from the game. */
  search({ q = '', sort = 'updated', page = 1 } = {}) {
    const p = new URLSearchParams({ ingame: '1', sort, page: String(page) });
    if (q) p.set('q', q);
    return this.call(`/api/v1/mods?${p}`, { signed: true });
  }

  mod(id) {
    if (!MOD_ID.test(id)) throw new SiteError(400, 'bad-id', `"${id}" is not a mod id.`);
    return this.call(`/api/v1/mods/${id}`, { signed: true });
  }

  plan(id, version) {
    if (!MOD_ID.test(id)) throw new SiteError(400, 'bad-id', `"${id}" is not a mod id.`);
    return this.call(`/api/v1/mods/${id}/install-plan${version ? `?version=${encodeURIComponent(version)}` : ''}`, { signed: true })
      .catch((err) => {
        // A plan with problems comes back as 404 with the plan in it: the problems are the answer.
        if (Array.isArray(err.data?.problems) && err.data.problems.length) return err.data;
        throw err;
      });
  }

  me() {
    return this.call('/api/v1/me', { signed: true });
  }

  imageUrl(id, path) {
    return `${this.base}/mods/${encodeURIComponent(id)}/images/${String(path).split('/').map(encodeURIComponent).join('/')}`;
  }

  /**
   * Downloads one file of the plan to `dest`, checking it against `sha256`. The token goes with the first request,
   * to the site, and never with the redirects after it.
   */
  async download(url, dest, { sha256, onProgress, signal } = {}) {
    const first = new URL(url);
    if (first.origin !== new URL(this.base).origin) throw new SiteError(0, 'elsewhere', 'A download pointed away from EDGEmods, so it was stopped.');
    const get = async (href, token) => {
      try {
        return await this.fetchFn(href, { headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: 'manual', signal });
      } catch {
        if (signal?.aborted) throw new SiteError(0, 'cancelled', 'The download was cancelled.');
        throw new SiteError(0, 'offline', `${new URL(href).host} did not answer. Check your connection.`);
      }
    };
    const token = await this.token?.(false);
    if (!token) throw new SiteError(401, 'sign-in', MESSAGES['sign-in']);
    let res = await get(first.href, token);
    if (res.status === 401) {
      const again = await this.token?.(true);
      if (again) res = await get(first.href, again);
    }
    let at = first.href;
    for (let hops = 0; res.status >= 300 && res.status < 400 && hops < 5; hops++) {
      const location = res.headers.get('location');
      if (!location) break;
      const next = new URL(location, at);
      if (next.protocol !== 'https:' && next.origin !== new URL(this.base).origin) {
        throw new SiteError(0, 'redirect', 'The download pointed somewhere that is not https, so it was stopped.');
      }
      await res.body?.cancel();
      at = next.href;
      res = await get(at);
    }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => undefined);
      const code = typeof data?.error === 'string' ? data.error : `http-${res.status}`;
      throw new SiteError(res.status, code, MESSAGES[code] ?? `The download answered HTTP ${res.status}.`);
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
        size += value.length;
        if (!out.write(value)) await new Promise((ok) => out.once('drain', ok));
        onProgress?.(size, total);
      }
      await new Promise((ok, fail) => out.end((err) => (err ? fail(err) : ok())));
    } catch (err) {
      out.destroy();
      await rm(part, { force: true });
      if (signal?.aborted) throw new SiteError(0, 'cancelled', 'The download was cancelled.');
      throw err instanceof SiteError ? err : new SiteError(0, 'download', 'The download stopped part way.');
    }
    const got = hash.digest('hex');
    if (sha256 && got !== sha256) {
      await rm(part, { force: true });
      throw new SiteError(0, 'check', 'The file is not the one EDGEmods checked, so it was deleted.');
    }
    await rename(part, dest);
    return { size, sha256: got };
  }
}
