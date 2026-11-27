// Signing in from the game with Auth0's device flow (RFC 8628; docs/auth0-setup.md, step 10): the game shows a short
// code and an address, the player confirms on a phone or PC, and the game gets a refresh token. The tokens are kept
// in REDnode's secrets (encrypted with the player's Windows account), one entry per site.

export class SignInError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const EARLY_MS = 60_000;

/**
 * @param {{ site: import('./site.mjs').Site, store: { get(n: string): Promise<string|null>, set(n: string, v: string): Promise<void>, delete(n: string): Promise<void> },
 *   fetch?: typeof fetch, now?: () => number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void> }} o
 */
export class Account {
  constructor({ site, store, fetch = globalThis.fetch, now = Date.now, sleep = wait }) {
    this.site = site;
    this.store = store;
    this.fetchFn = fetch;
    this.now = now;
    this.sleep = sleep;
    this.renewing = undefined;
  }

  get key() {
    return `session:${this.site.base}`;
  }

  async session() {
    const raw = await this.store.get(this.key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  async signedIn() {
    return Boolean((await this.session())?.refreshToken);
  }

  async config() {
    let auth;
    try {
      auth = await this.site.auth();
    } catch (err) {
      if (err.code === 'no-sign-in') throw new SignInError('no-sign-in', 'This EDGEmods site has no sign-in set up.');
      throw err;
    }
    if (!auth?.device?.clientId) throw new SignInError('no-device', 'This EDGEmods site does not take sign-ins from the game yet.');
    return { domain: auth.domain, clientId: auth.device.clientId, audience: auth.audience, scope: auth.scope };
  }

  async post(domain, path, form) {
    let res;
    try {
      res = await this.fetchFn(`https://${domain}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams(form).toString(),
      });
    } catch {
      throw new SignInError('offline', `${domain} did not answer. Check your connection.`);
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  /**
   * Starts a sign-in. `show` gets the code and address to show the player; the promise ends signed in, or throws
   * when the code ran out, the player said no, or `signal` was aborted.
   */
  async signIn(show, signal) {
    const c = await this.config();
    const start = await this.post(c.domain, '/oauth/device/code', { client_id: c.clientId, scope: c.scope, audience: c.audience });
    if (!start.ok || !start.data.device_code) throw new SignInError('start', `Auth0 did not start the sign-in (${start.data.error_description ?? start.data.error ?? start.status}).`);
    const d = start.data;
    show({ userCode: d.user_code, uri: d.verification_uri, uriComplete: d.verification_uri_complete, expiresIn: d.expires_in });
    let interval = Math.max(1, Number(d.interval) || 5) * 1000;
    const until = this.now() + (Number(d.expires_in) || 900) * 1000;
    while (this.now() < until) {
      await this.sleep(interval, signal);
      if (signal?.aborted) throw new SignInError('cancelled', 'Sign-in cancelled.');
      const r = await this.post(c.domain, '/oauth/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: d.device_code, client_id: c.clientId });
      if (r.ok) {
        await this.keep(c, r.data);
        return;
      }
      const code = r.data.error;
      if (code === 'authorization_pending') continue;
      if (code === 'slow_down') { interval += 5000; continue; }
      if (code === 'expired_token') break;
      if (code === 'access_denied') throw new SignInError('denied', 'The sign-in was turned down on the other device.');
      throw new SignInError('token', `Auth0 refused the sign-in (${r.data.error_description ?? code ?? r.status}).`);
    }
    throw new SignInError('expired', 'The code ran out before it was confirmed. Start again.');
  }

  async keep(c, t) {
    const old = await this.session();
    const s = {
      domain: c.domain,
      clientId: c.clientId,
      refreshToken: t.refresh_token ?? old?.refreshToken,
      accessToken: t.access_token,
      expiresAt: this.now() + (Number(t.expires_in) || 3600) * 1000,
    };
    if (!s.refreshToken) throw new SignInError('no-refresh', 'Auth0 gave no refresh token: the in-game application needs the Refresh Token grant and the API offline access.');
    await this.store.set(this.key, JSON.stringify(s));
  }

  /** An access token for the site, renewed when it is about to run out or when `renew` asks. Undefined when signed out. */
  async token(renew = false) {
    const s = await this.session();
    if (!s?.refreshToken) return undefined;
    if (!renew && s.accessToken && s.expiresAt - EARLY_MS > this.now()) return s.accessToken;
    this.renewing ??= (async () => {
      const r = await this.post(s.domain, '/oauth/token', { grant_type: 'refresh_token', client_id: s.clientId, refresh_token: s.refreshToken });
      if (!r.ok) {
        // A refresh token that was revoked or ran out: signed out.
        if (r.status === 400 || r.status === 401 || r.status === 403) await this.store.delete(this.key);
        return undefined;
      }
      await this.keep(s, r.data);
      return r.data.access_token;
    })().finally(() => { this.renewing = undefined; });
    return this.renewing;
  }

  async signOut() {
    await this.store.delete(this.key);
  }
}

function wait(ms, signal) {
  return new Promise((ok) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); ok(); }, { once: true });
  });
}
