// Usernames: the name other people see on EDGEmods, never the email (the owner, 2026-11-21). Unique across the site
// whatever the capitals; site.db's unique index is the final word. Plain letters only, so nobody can pose as "bob"
// with a lookalike letter from another alphabet. GitHub logins of modders with mods on EDGEmods are kept for them.

import type { SiteStore, User } from './site-store.js';

export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/;
/** A username given up is held this long before anyone else can take it (the owner, 2026-11-21). */
export const HOLD_MS = 30 * 24 * 3_600_000;
/** At most one change in this long; the first pick after signing up is not a change (the owner, 2026-11-21). */
export const CHANGE_GAP_MS = 60 * 24 * 3_600_000;

/** Names nobody can take: the site's own, its staff's, and the EDGE tools'. */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'staff', 'support', 'help', 'moderator', 'mod', 'mods', 'team', 'owner',
  'official', 'security', 'abuse', 'api', 'auth', 'signin', 'signout', 'login', 'logout', 'me', 'null', 'undefined',
  'anonymous', 'nobody', 'everyone', 'edge', 'edgemods', 'edgemodders', 'edgedeck', 'edgekit', 'edgeweb', 'edgewave',
  'edgemat', 'edgefab', 'edgequest', 'edgebuilder', 'edgechat', 'redcode', 'rednode', 'redbridge', 'redagent',
  'cdpr', 'cdprojekt', 'cdprojektred', 'wolvenkit', 'nexusmods',
]);
/** Words that make a username look official wherever they appear in it. */
const RESERVED_PARTS = ['admin', 'edgemod', 'moderator', 'official'];

export type UsernameProblem = 'invalid' | 'reserved' | 'modder' | 'taken' | 'wait';

export const USERNAME_PROBLEMS: Record<UsernameProblem, string> = {
  invalid: 'A username is 3 to 20 letters (a to z), digits, - or _, and starts with a letter or a digit.',
  reserved: 'That username is kept for EDGEmods itself. Pick another.',
  modder: 'That username is a modder\'s GitHub login, kept for them. Pick another.',
  taken: 'Someone already has that username. Pick another.',
  wait: 'A username can change once in 60 days.',
};

export class Usernames {
  constructor(
    private readonly site: SiteStore,
    /** The GitHub user id of the modder whose login this is (lower case), if any mod on EDGEmods is theirs. */
    private readonly modderId: (key: string) => number | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /** When this person may next change their username; undefined if they may now. */
  nextChange(user: Pick<User, 'usernameChangedAt'>): Date | undefined {
    if (!user.usernameChangedAt) return undefined;
    const next = Date.parse(user.usernameChangedAt) + CHANGE_GAP_MS;
    return next > this.now() ? new Date(next) : undefined;
  }

  /** Why this person cannot have this username, or undefined if they can. */
  problem(text: string, user: Pick<User, 'id' | 'githubId'> & Partial<Pick<User, 'username' | 'usernameChangedAt'>>): UsernameProblem | undefined {
    if (!USERNAME_PATTERN.test(text)) return 'invalid';
    const key = text.toLowerCase();
    // Changing only the capitals is not a change.
    if (user.username && user.username.toLowerCase() !== key && this.nextChange(user)) return 'wait';
    if (RESERVED.has(key) || RESERVED_PARTS.some((p) => key.includes(p))) return 'reserved';
    const modder = this.modderId(key);
    if (modder !== undefined && modder !== user.githubId) return 'modder';
    const holder = this.site.usernameHolder(key);
    if (holder && holder !== user.id) return 'taken';
    const held = this.site.usernameHeldFor(key, new Date(this.now()));
    if (held && held !== user.id) return 'taken';
    return undefined;
  }

  /** Gives the person this username if they may have it; otherwise says why not. */
  claim(text: string, user: Pick<User, 'id' | 'githubId'> & Partial<Pick<User, 'username' | 'usernameChangedAt'>>): UsernameProblem | undefined {
    const problem = this.problem(text, user);
    if (problem) return problem;
    return this.site.setUsername(user.id, text, HOLD_MS, new Date(this.now())) ? undefined : 'taken';
  }

  /** A free username to offer: the GitHub login for a GitHub sign-in, else one made from the name or the email. */
  suggest(user: Pick<User, 'id' | 'githubId' | 'githubLogin' | 'name' | 'email'>): string {
    if (user.githubLogin && USERNAME_PATTERN.test(user.githubLogin) && !this.problem(user.githubLogin, user)) return user.githubLogin;
    const plain = (s: string | undefined): string => (s ?? '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '').slice(0, 16);
    let base = plain(user.name) || plain(user.email?.split('@')[0]);
    if (base.length < 3) base = `player${base}`;
    if (!this.problem(base, user)) return base;
    for (let n = 2; n < 10_000; n++) {
      const candidate = `${base.slice(0, 20 - String(n).length)}${n}`;
      if (!this.problem(candidate, user)) return candidate;
    }
    return `player${Math.floor(this.now() % 1e9)}`;
  }
}
