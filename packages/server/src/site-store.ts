// site.db: what EDGEmods itself knows, kept across index rebuilds and backed up by Litestream (docs/design.md,
// "Two kinds of data"). R3b: release check results and moderation. R3c: people, sessions and likes. Downloads next.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Each step brings the database from the version before it; PRAGMA user_version records how far it is. */
const MIGRATIONS = [
  `CREATE TABLE release_checks (
     mod_id TEXT NOT NULL,
     version TEXT NOT NULL,
     ok INTEGER NOT NULL,
     checked_at TEXT NOT NULL,
     downloads TEXT NOT NULL,       -- JSON [{ name, size, sha256, contents: { files, size, kinds, runsCode }, scan }]
     report TEXT NOT NULL,          -- JSON: the steps, for the admin page and My mods
     PRIMARY KEY (mod_id, version)
   );
   CREATE TABLE moderation (
     mod_id TEXT PRIMARY KEY,
     status TEXT NOT NULL CHECK (status IN ('visible', 'hidden', 'blocked')),
     reason TEXT NOT NULL DEFAULT '',
     changed_by TEXT NOT NULL,
     changed_at TEXT NOT NULL
   );`,
  // R3c: accounts. A person is their Auth0 user id; sessions are opaque ids kept as their SHA-256, so a copy of the
  // database cannot be used to sign in.
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,                 -- Auth0's user id: github|123, google-oauth2|456, auth0|abc
     name TEXT NOT NULL,                  -- from the sign-in
     display_name TEXT,                   -- chosen on EDGEmods; shown instead of name
     email TEXT,
     email_verified INTEGER NOT NULL DEFAULT 0,
     github_id INTEGER,                   -- GitHub's numeric user id, for a GitHub sign-in
     github_login TEXT,
     adult INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
     created_at TEXT NOT NULL,
     seen_at TEXT NOT NULL
   );
   CREATE INDEX users_github ON users (github_id);
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,                 -- SHA-256 of the cookie's value, hex
     user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     seen_at TEXT NOT NULL
   );
   CREATE INDEX sessions_user ON sessions (user_id);
   CREATE TABLE likes (
     user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     mod_id TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (user_id, mod_id)
   );
   CREATE INDEX likes_mod ON likes (mod_id);`,
  // Usernames (the owner, 2026-11-21): the name other people see, unique across EDGEmods whatever the capitals.
  // The unique index on username_key is what makes two people unable to hold the same one. A username someone gives
  // up is held for 30 days in released_usernames, so nobody can take it at once to pose as them.
  `ALTER TABLE users DROP COLUMN display_name;
   ALTER TABLE users ADD COLUMN username TEXT;           -- as the person typed it
   ALTER TABLE users ADD COLUMN username_key TEXT;       -- lower case, for uniqueness
   ALTER TABLE users ADD COLUMN username_changed_at TEXT; -- the last change; the first pick is not one
   CREATE UNIQUE INDEX users_username ON users (username_key);
   CREATE TABLE released_usernames (
     key TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,                -- who gave it up; they may take it back
     until TEXT NOT NULL
   );`,
];

export interface User {
  id: string;
  name: string;
  /** Chosen on EDGEmods; what other people see. Missing until the person picks one after their first sign-in. */
  username?: string;
  /** When the username last changed (the first pick does not count). */
  usernameChangedAt?: string;
  email?: string;
  emailVerified: boolean;
  githubId?: number;
  githubLogin?: string;
  adult: boolean;
  status: 'active' | 'blocked';
  createdAt: string;
  seenAt: string;
  /** When the current session began, for a user found through a session. */
  sessionStartedAt?: string;
}

/** What a sign-in tells us about a person. */
export interface SignedIn {
  id: string;
  name: string;
  email?: string;
  emailVerified: boolean;
  githubId?: number;
  githubLogin?: string;
}

type Row = Record<string, any>;

function toUser(r: Row): User {
  return {
    id: r.id,
    name: r.name,
    username: r.username ?? undefined,
    usernameChangedAt: r.username_changed_at ?? undefined,
    email: r.email ?? undefined,
    emailVerified: Boolean(r.email_verified),
    githubId: r.github_id ?? undefined,
    githubLogin: r.github_login ?? undefined,
    adult: Boolean(r.adult),
    status: r.status,
    createdAt: r.created_at,
    seenAt: r.seen_at,
  };
}

export interface CheckRecord {
  mod: string;
  version: string;
  ok: boolean;
  checkedAt: string;
  downloads: unknown[];
  report: unknown;
}

export class SiteStore {
  readonly db: DatabaseSync;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    const { user_version: at } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = at; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  /** Records a release check result; a newer result for the same release replaces the older. */
  recordCheck(c: CheckRecord): void {
    this.db.prepare(`INSERT INTO release_checks VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (mod_id, version) DO UPDATE SET ok = excluded.ok, checked_at = excluded.checked_at, downloads = excluded.downloads, report = excluded.report
      WHERE excluded.checked_at >= release_checks.checked_at`)
      .run(c.mod, c.version, c.ok ? 1 : 0, c.checkedAt, JSON.stringify(c.downloads), JSON.stringify(c.report));
  }

  setModeration(mod: string, status: 'visible' | 'hidden' | 'blocked', by: string, reason = ''): void {
    this.db.prepare(`INSERT INTO moderation VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (mod_id) DO UPDATE SET status = excluded.status, reason = excluded.reason, changed_by = excluded.changed_by, changed_at = excluded.changed_at`)
      .run(mod, status, reason, by, new Date().toISOString());
  }

  // ---- accounts ----

  /** Adds or refreshes a person after a sign-in. Their EDGEmods settings and chosen name are kept. */
  upsertUser(u: SignedIn, now = new Date()): User {
    const at = now.toISOString();
    this.db.prepare(`INSERT INTO users (id, name, email, email_verified, github_id, github_login, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, email = excluded.email, email_verified = excluded.email_verified,
        github_id = excluded.github_id, github_login = excluded.github_login, seen_at = excluded.seen_at`)
      .run(u.id, u.name, u.email ?? null, u.emailVerified ? 1 : 0, u.githubId ?? null, u.githubLogin ?? null, at, at);
    return this.user(u.id)!;
  }

  user(id: string): User | undefined {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return r && toUser(r);
  }

  /** Who holds a username (by its lower-case key), if anyone. */
  usernameHolder(key: string): string | undefined {
    return (this.db.prepare('SELECT id FROM users WHERE username_key = ?').get(key) as Row | undefined)?.id;
  }

  /** Who gave up a username that is still held, if it is. */
  usernameHeldFor(key: string, now = new Date()): string | undefined {
    return (this.db.prepare('SELECT user_id FROM released_usernames WHERE key = ? AND until > ?').get(key, now.toISOString()) as Row | undefined)?.user_id;
  }

  /**
   * Gives a person a username, holding their old one for `holdMs`. Returns false if someone else holds it: the unique
   * index decides, so two people can never both get it.
   */
  setUsername(userId: string, username: string, holdMs: number, now = new Date()): boolean {
    const key = username.toLowerCase();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.user(userId)?.username;
      this.db.prepare('DELETE FROM released_usernames WHERE until <= ? OR (key = ? AND user_id = ?)').run(now.toISOString(), key, userId);
      const changed = Boolean(old && old.toLowerCase() !== key);
      this.db.prepare('UPDATE users SET username = ?, username_key = ?, username_changed_at = CASE WHEN ? THEN ? ELSE username_changed_at END WHERE id = ?')
        .run(username, key, changed ? 1 : 0, now.toISOString(), userId);
      if (changed) this.holdUsername(old!.toLowerCase(), userId, holdMs, now);
      this.db.exec('COMMIT');
      return true;
    } catch (err) {
      this.db.exec('ROLLBACK');
      if ((err as { code?: string }).code === 'ERR_SQLITE_ERROR' && /UNIQUE/.test(String((err as Error).message))) return false;
      throw err;
    }
  }

  private holdUsername(key: string, userId: string, holdMs: number, now: Date): void {
    this.db.prepare('INSERT INTO released_usernames VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET user_id = excluded.user_id, until = excluded.until')
      .run(key, userId, new Date(now.getTime() + holdMs).toISOString());
  }

  setAdult(id: string, adult: boolean): void {
    this.db.prepare('UPDATE users SET adult = ? WHERE id = ?').run(adult ? 1 : 0, id);
  }

  /** Blocking ends every session at once. */
  setStatus(id: string, status: 'active' | 'blocked'): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
      if (status === 'blocked') this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Removes a person and, through the foreign keys, their sessions and likes. Their username is held like any given up. */
  deleteUser(id: string, holdMs = 0, now = new Date()): void {
    const old = this.user(id)?.username;
    if (old && holdMs > 0) this.holdUsername(old.toLowerCase(), id, holdMs, now);
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  createSession(hash: string, userId: string, lifeMs: number, now = new Date()): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)')
      .run(hash, userId, now.toISOString(), new Date(now.getTime() + lifeMs).toISOString(), now.toISOString());
  }

  /** The person a session belongs to, if it is current and they are not blocked. Notes when it was last used, hourly. */
  sessionUser(hash: string, now = new Date()): User | undefined {
    const r = this.db.prepare(`SELECT u.*, s.seen_at AS session_seen, s.created_at AS session_started FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'`).get(hash, now.toISOString()) as Row | undefined;
    if (!r) return undefined;
    if (now.getTime() - Date.parse(r.session_seen) > 3_600_000) {
      this.db.prepare('UPDATE sessions SET seen_at = ? WHERE id = ?').run(now.toISOString(), hash);
      this.db.prepare('UPDATE users SET seen_at = ? WHERE id = ?').run(now.toISOString(), r.id);
    }
    return { ...toUser(r), sessionStartedAt: r.session_started };
  }

  deleteSession(hash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(hash);
  }

  sessionCount(userId: string): number {
    return (this.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?').get(userId) as Row).n;
  }

  // ---- likes ----

  likes(userId: string): Set<string> {
    return new Set((this.db.prepare('SELECT mod_id FROM likes WHERE user_id = ?').all(userId) as Row[]).map((r) => r.mod_id));
  }

  setLike(userId: string, modId: string, liked: boolean, now = new Date()): void {
    if (liked) this.db.prepare('INSERT INTO likes VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(userId, modId, now.toISOString());
    else this.db.prepare('DELETE FROM likes WHERE user_id = ? AND mod_id = ?').run(userId, modId);
  }

  likeCount(modId: string): number {
    return (this.db.prepare('SELECT count(*) AS n FROM likes WHERE mod_id = ?').get(modId) as Row).n;
  }

  /** Everything EDGEmods keeps about a person, for "Download my data". */
  dataOf(userId: string): Record<string, unknown> | undefined {
    const user = this.user(userId);
    if (!user) return undefined;
    const likes = this.db.prepare('SELECT mod_id AS mod, created_at AS likedAt FROM likes WHERE user_id = ? ORDER BY created_at').all(userId);
    const sessions = this.db.prepare('SELECT created_at AS signedInAt, expires_at AS expiresAt, seen_at AS lastUsedAt FROM sessions WHERE user_id = ? ORDER BY created_at').all(userId);
    return { account: user, likes, sessions };
  }

  close(): void {
    this.db.close();
  }
}
