// Keeps the extension signed in to one EDGEmods site. The refresh token, the current access token and who it
// belongs to live together in the editor's secret storage under one key per site, so every window shares them:
// a window that needs a token first reads what another window may have just stored, which keeps two windows from
// spending the same refresh token (Auth0 rotates it, and treats a second use as a theft).

import { authorizeUrl, exchangeCode, pkce, randomState, refreshTokens, revokeToken, SignedOutError, type AuthInfo, type Fetch, type Method, type Tokens } from './auth.js';
import { Api } from './api.js';

/** The editor's secret storage, or anything shaped like it. */
export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

/** Who is signed in, as EDGEmods last said. */
export interface Account {
  id: string;
  username?: string;
  name: string;
  via?: string;
}

interface Saved extends Tokens {
  domain: string;
  clientId: string;
  account?: Account;
}

interface Pending {
  state: string;
  verifier: string;
  redirectUri: string;
  info: AuthInfo;
  settle: (err?: Error) => void;
}

/**
 * The editors whose link handler a sign-in may go back to: their link schemes, which the site's landing page
 * (/auth/vscode) accepts at the start of the state. The same list as the server's EDITOR_SCHEMES.
 */
export const EDITOR_SCHEMES = ['vscode', 'vscode-insiders', 'vscodium', 'cursor', 'windsurf', 'edgekit'];

/** An access token this close to running out is renewed first. */
const EARLY_MS = 60_000;
/** How long a sign-in in the browser may take. */
export const SIGN_IN_WAIT_MS = 10 * 60_000;

export class Session {
  private pending?: Pending;
  private renewing?: Promise<string | undefined>;
  private infoCache?: AuthInfo;

  constructor(readonly site: string, private readonly store: SecretStore, private readonly fetchFn: Fetch = fetch, private readonly now: () => number = Date.now) {}

  get key(): string {
    return `edgemods.signin:${this.site}`;
  }

  /** How this site signs in; asked once per session. */
  async info(): Promise<AuthInfo> {
    this.infoCache ??= await new Api(this.site, this.fetchFn).auth();
    return this.infoCache;
  }

  async signedIn(): Promise<boolean> {
    return Boolean(await this.saved());
  }

  async account(): Promise<Account | undefined> {
    return (await this.saved())?.account;
  }

  async setAccount(account: Account): Promise<void> {
    const s = await this.saved();
    if (s) await this.save({ ...s, account });
  }

  /**
   * Starts a sign-in: the address to open in the browser, and a promise that settles when the editor gets the link
   * back (see complete) or the sign-in is cancelled. Starting another cancels this one. `editor` is the editor's link
   * scheme (vscode, cursor, …): it starts the state, so the site's landing page knows which editor to hand back to.
   */
  async begin(redirectUri: string, method?: Method, editor?: string): Promise<{ url: string; done: Promise<void> }> {
    const info = await this.info();
    this.cancel();
    const { verifier, challenge } = pkce();
    const state = editor ? `${editor}.${randomState()}` : randomState();
    let settle!: (err?: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
      settle = (err) => (err ? reject(err) : resolve());
    });
    this.pending = { state, verifier, redirectUri, info, settle };
    return { url: authorizeUrl(info, { redirectUri, state, challenge, method }), done };
  }

  /** Stops a sign-in in progress, if there is one. */
  cancel(reason = 'The sign-in was cancelled.'): void {
    const p = this.pending;
    this.pending = undefined;
    p?.settle(new Error(reason));
  }

  /**
   * The sign-in link came back with these query parameters. Returns false when it is not for the sign-in in progress
   * (an old link, or none in progress), which changes nothing.
   */
  async complete(query: URLSearchParams): Promise<boolean> {
    const p = this.pending;
    if (!p || query.get('state') !== p.state) return false;
    this.pending = undefined;
    const error = query.get('error');
    if (error) {
      p.settle(new Error(error === 'access_denied' ? 'The sign-in was cancelled, or the account did not let EDGEmods in.' : `Auth0 could not sign you in (${error}).`));
      return true;
    }
    const code = query.get('code');
    if (!code) {
      p.settle(new Error('Auth0 sent no sign-in code.'));
      return true;
    }
    try {
      const tokens = await exchangeCode(p.info, { code, verifier: p.verifier, redirectUri: p.redirectUri }, this.fetchFn, this.now);
      await this.save({ ...tokens, domain: p.info.domain, clientId: p.info.clientId });
      p.settle();
    } catch (err) {
      p.settle(err instanceof Error ? err : new Error(String(err)));
    }
    return true;
  }

  /** A good access token, renewed when it is about to run out; undefined when nobody is signed in. */
  async accessToken({ fresh = false } = {}): Promise<string | undefined> {
    const s = await this.saved();
    if (!s) return undefined;
    if (!fresh && s.expiresAt - EARLY_MS > this.now()) return s.accessToken;
    // One renewal at a time in this window; the others wait for it.
    this.renewing ??= this.renew(fresh ? s.accessToken : undefined).finally(() => {
      this.renewing = undefined;
    });
    return this.renewing;
  }

  /** Signs out here, and tells Auth0 to forget the refresh token. */
  async signOut(): Promise<void> {
    const s = await this.saved();
    await this.store.delete(this.key);
    if (s) await revokeToken({ domain: s.domain, clientId: s.clientId } as AuthInfo, s.refreshToken, this.fetchFn).catch(() => undefined);
  }

  private async renew(stale?: string): Promise<string | undefined> {
    // Read again: another window may have renewed it a moment ago.
    const s = await this.saved();
    if (!s) return undefined;
    if (s.accessToken !== stale && s.expiresAt - EARLY_MS > this.now()) return s.accessToken;
    try {
      const tokens = await refreshTokens({ domain: s.domain, clientId: s.clientId } as AuthInfo, s.refreshToken, this.fetchFn, this.now);
      await this.save({ ...s, ...tokens });
      return tokens.accessToken;
    } catch (err) {
      if (err instanceof SignedOutError) await this.store.delete(this.key);
      throw err;
    }
  }

  private async saved(): Promise<Saved | undefined> {
    const text = await this.store.get(this.key);
    if (!text) return undefined;
    try {
      const s = JSON.parse(text) as Saved;
      return typeof s.refreshToken === 'string' && typeof s.domain === 'string' && typeof s.clientId === 'string' ? s : undefined;
    } catch {
      return undefined;
    }
  }

  private async save(s: Saved): Promise<void> {
    await this.store.store(this.key, JSON.stringify(s));
  }
}
