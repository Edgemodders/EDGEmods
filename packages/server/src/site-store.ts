// site.db: what EDGEmods itself knows, kept across index rebuilds and backed up by Litestream (docs/design.md,
// "Two kinds of data"). R3b: release check results and moderation. R3c: people, sessions, likes and usernames. R3d:
// downloads.

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
  // R3d: downloads, counted once per person, file and day (docs/design.md, "Downloads"). A deleted account's rows
  // lose their person but stay, so mods' counts do not drop.
  `CREATE TABLE downloads (
     user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
     mod_id TEXT NOT NULL,
     version TEXT NOT NULL,
     file TEXT NOT NULL,
     day TEXT NOT NULL,                    -- YYYY-MM-DD, UTC
     at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX downloads_once ON downloads (user_id, mod_id, version, file, day);
   CREATE INDEX downloads_mod ON downloads (mod_id);
   CREATE INDEX downloads_user ON downloads (user_id, at);
   -- Settings admins change on the Admin page, and the log of every admin action (who, what, when).
   CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     changed_by TEXT NOT NULL,
     changed_at TEXT NOT NULL
   );
   CREATE TABLE audit (
     at TEXT NOT NULL,
     who TEXT NOT NULL,                    -- the admin's username, or their user id if they have none
     action TEXT NOT NULL,
     detail TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX audit_at ON audit (at);`,
  // The owner dropped the free monthly download limit the same day (2026-11-21): it could read as a paywall on mods,
  // which CD Projekt RED's guidelines forbid. Its settings table goes with it; free downloads are limited in speed only.
  `DROP TABLE settings;`,
  // R3e: the rest of the Admin page (docs/design.md, "Administration"). The blocklist is private: GitHub accounts and
  // repositories by GitHub's numeric ids, so renames change nothing; EDGEmods accounts are blocked on users.status.
  `ALTER TABLE users ADD COLUMN blocked_reason TEXT;
   ALTER TABLE users ADD COLUMN blocked_by TEXT;
   ALTER TABLE users ADD COLUMN blocked_at TEXT;
   CREATE TABLE blocklist (
     kind TEXT NOT NULL CHECK (kind IN ('github', 'repo')),
     value TEXT NOT NULL,                  -- GitHub's numeric id, as text
     label TEXT NOT NULL,                  -- the login or owner/repo when it was blocked
     reason TEXT NOT NULL DEFAULT '',
     blocked_by TEXT NOT NULL,
     blocked_at TEXT NOT NULL,
     PRIMARY KEY (kind, value)
   );
   CREATE TABLE mod_overrides (            -- admins' changes on top of the modder's metadata; the repository is never changed
     mod_id TEXT PRIMARY KEY,
     adult INTEGER,                        -- NULL: as the modder says
     changed_by TEXT NOT NULL,
     changed_at TEXT NOT NULL
   );
   CREATE TABLE reports (
     id INTEGER PRIMARY KEY,
     mod_id TEXT NOT NULL,
     user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
     reason TEXT NOT NULL CHECK (reason IN ('broken', 'malware', 'stolen', 'adult', 'other')),
     note TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
     closed_by TEXT,
     closed_at TEXT,
     close_note TEXT
   );
   CREATE UNIQUE INDEX reports_one_open ON reports (user_id, mod_id) WHERE status = 'open';
   CREATE INDEX reports_status ON reports (status, created_at);
   CREATE TABLE spot_reviews (            -- an admin looked over this release after it merged by itself
     mod_id TEXT NOT NULL,
     version TEXT NOT NULL,
     reviewed_by TEXT NOT NULL,
     reviewed_at TEXT NOT NULL,
     PRIMARY KEY (mod_id, version)
   );`,
];

export const REPORT_REASONS = {
  broken: 'Does not work',
  malware: 'Malware or harmful',
  stolen: 'Someone else\'s work',
  adult: 'Adult content not marked 18+',
  other: 'Something else',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

export interface Report {
  id: number;
  modId: string;
  /** The reporter's username (or user id), or undefined if their account is gone. */
  by?: string;
  reason: ReportReason;
  note: string;
  createdAt: string;
  status: 'open' | 'closed';
  closedBy?: string;
  closedAt?: string;
  closeNote?: string;
}

export interface BlockEntry {
  kind: 'github' | 'repo' | 'account';
  /** GitHub's id for github and repo; the user id for an account. */
  value: string;
  label: string;
  reason: string;
  by: string;
  at: string;
}

export interface AdminUser extends User {
  blockedReason?: string;
  downloads: number;
  likes: number;
}

/** The first moment of the month `now` is in, and of the next, in UTC. */
export function monthOf(now: Date): { start: string; next: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), next: next.toISOString() };
}

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

  /** Blocking ends every session at once and refuses the next sign-in. */
  setStatus(id: string, status: 'active' | 'blocked', by = 'system', reason = '', now = new Date()): void {
    this.db.exec('BEGIN');
    try {
      const blocked = status === 'blocked';
      this.db.prepare('UPDATE users SET status = ?, blocked_reason = ?, blocked_by = ?, blocked_at = ? WHERE id = ?')
        .run(status, blocked ? reason : null, blocked ? by : null, blocked ? now.toISOString() : null, id);
      if (blocked) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
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
      WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE b.kind = 'github' AND b.value = CAST(u.github_id AS TEXT))`).get(hash, now.toISOString()) as Row | undefined;
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

  // ---- downloads ----

  /** Counts a download; the same person, file and day count once. Returns whether it counted. */
  recordDownload(userId: string, modId: string, version: string, file: string, now = new Date()): boolean {
    const at = now.toISOString();
    const r = this.db.prepare('INSERT INTO downloads VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').run(userId, modId, version, file, at.slice(0, 10), at);
    return Number(r.changes) > 0;
  }

  downloadCount(modId: string): number {
    return (this.db.prepare('SELECT count(*) AS n FROM downloads WHERE mod_id = ?').get(modId) as Row).n;
  }

  // ---- moderation (R3e) ----

  moderationOf(modId: string): { status: 'visible' | 'hidden' | 'blocked'; reason: string } | undefined {
    const r = this.db.prepare('SELECT status, reason FROM moderation WHERE mod_id = ?').get(modId) as Row | undefined;
    return r && { status: r.status, reason: r.reason };
  }

  /** An admin's adult flag for a mod: true or false, or undefined to follow the modder. */
  setAdultOverride(modId: string, adult: boolean | undefined, by: string, now = new Date()): void {
    if (adult === undefined) this.db.prepare('DELETE FROM mod_overrides WHERE mod_id = ?').run(modId);
    else this.db.prepare('INSERT INTO mod_overrides VALUES (?, ?, ?, ?) ON CONFLICT (mod_id) DO UPDATE SET adult = excluded.adult, changed_by = excluded.changed_by, changed_at = excluded.changed_at')
      .run(modId, adult ? 1 : 0, by, now.toISOString());
  }

  // ---- the blocklist ----

  isBlocked(kind: 'github' | 'repo', id: number | string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM blocklist WHERE kind = ? AND value = ?').get(kind, String(id)));
  }

  block(kind: 'github' | 'repo', id: number | string, label: string, by: string, reason = '', now = new Date()): void {
    this.db.prepare(`INSERT INTO blocklist VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (kind, value) DO UPDATE SET label = excluded.label, reason = excluded.reason,
      blocked_by = excluded.blocked_by, blocked_at = excluded.blocked_at`).run(kind, String(id), label, reason, by, now.toISOString());
    // A blocked GitHub account cannot stay signed in through it.
    if (kind === 'github') this.db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE github_id = ?)").run(Number(id));
  }

  unblock(kind: 'github' | 'repo', id: number | string): boolean {
    return Number(this.db.prepare('DELETE FROM blocklist WHERE kind = ? AND value = ?').run(kind, String(id)).changes) > 0;
  }

  /** Everything blocked: GitHub accounts, repositories and EDGEmods accounts, newest first. */
  blocklist(): BlockEntry[] {
    const listed = (this.db.prepare('SELECT * FROM blocklist').all() as Row[]).map((r): BlockEntry => ({ kind: r.kind, value: r.value, label: r.label, reason: r.reason, by: r.blocked_by, at: r.blocked_at }));
    const accounts = (this.db.prepare("SELECT * FROM users WHERE status = 'blocked'").all() as Row[]).map((r): BlockEntry => ({
      kind: 'account', value: r.id, label: r.username ?? r.id, reason: r.blocked_reason ?? '', by: r.blocked_by ?? '', at: r.blocked_at ?? '',
    }));
    return [...listed, ...accounts].sort((a, b) => b.at.localeCompare(a.at));
  }

  // ---- reports ----

  /** Files a report; false if this person already has one open for this mod. */
  report(userId: string, modId: string, reason: ReportReason, note: string, now = new Date()): boolean {
    const r = this.db.prepare('INSERT INTO reports (mod_id, user_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(modId, userId, reason, note, now.toISOString());
    return Number(r.changes) > 0;
  }

  closeReport(id: number, by: string, note: string, now = new Date()): Report | undefined {
    this.db.prepare("UPDATE reports SET status = 'closed', closed_by = ?, closed_at = ?, close_note = ? WHERE id = ? AND status = 'open'").run(by, now.toISOString(), note, id);
    return this.reports('all').find((r) => r.id === id);
  }

  /** Reports, open ones first, newest first. */
  reports(which: 'open' | 'all' = 'all', limit = 200): Report[] {
    const rows = this.db.prepare(`SELECT r.*, coalesce(u.username, u.id) AS by_name FROM reports r LEFT JOIN users u ON u.id = r.user_id
      ${which === 'open' ? "WHERE r.status = 'open'" : ''} ORDER BY r.status = 'closed', r.created_at DESC LIMIT ?`).all(limit) as Row[];
    return rows.map((r) => ({
      id: r.id, modId: r.mod_id, by: r.by_name ?? undefined, reason: r.reason, note: r.note, createdAt: r.created_at, status: r.status,
      closedBy: r.closed_by ?? undefined, closedAt: r.closed_at ?? undefined, closeNote: r.close_note ?? undefined,
    }));
  }

  // ---- spot reviews ----

  markReviewed(modId: string, version: string, by: string, now = new Date()): void {
    this.db.prepare('INSERT INTO spot_reviews VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(modId, version, by, now.toISOString());
  }

  // ---- people, for admins ----

  adminUsers(q = '', limit = 200): AdminUser[] {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.db.prepare(`SELECT u.*, (SELECT count(*) FROM downloads d WHERE d.user_id = u.id) AS n_downloads, (SELECT count(*) FROM likes l WHERE l.user_id = u.id) AS n_likes
      FROM users u WHERE ? = '' OR u.username LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.github_login LIKE ? ESCAPE '\\' OR u.id = ?
      ORDER BY u.created_at DESC LIMIT ?`).all(q, like, like, like, q, limit) as Row[];
    return rows.map((r) => ({ ...toUser(r), blockedReason: r.blocked_reason ?? undefined, downloads: r.n_downloads, likes: r.n_likes }));
  }

  // ---- the audit log ----

  /** Records an admin action: who, what, and the change. */
  log(who: string, action: string, detail = '', now = new Date()): void {
    this.db.prepare('INSERT INTO audit VALUES (?, ?, ?, ?)').run(now.toISOString(), who, action, detail);
  }

  auditLog(limit = 50): { at: string; who: string; action: string; detail: string }[] {
    return (this.db.prepare('SELECT * FROM audit ORDER BY at DESC, rowid DESC LIMIT ?').all(limit) as Row[]).map((r) => ({ at: r.at, who: r.who, action: r.action, detail: r.detail }));
  }

  /** Counts for the Admin page's overview. */
  totals(now = new Date()): { accounts: number; downloadsThisMonth: number; downloaders: number; likes: number } {
    const { start } = monthOf(now);
    const one = (sql: string, ...p: string[]): number => (this.db.prepare(sql).get(...p) as Row).n;
    return {
      accounts: one('SELECT count(*) AS n FROM users'),
      downloadsThisMonth: one('SELECT count(*) AS n FROM downloads WHERE at >= ?', start),
      downloaders: one('SELECT count(DISTINCT user_id) AS n FROM downloads WHERE at >= ?', start),
      likes: one('SELECT count(*) AS n FROM likes'),
    };
  }

  /** Everything EDGEmods keeps about a person, for "Download my data". */
  dataOf(userId: string): Record<string, unknown> | undefined {
    const user = this.user(userId);
    if (!user) return undefined;
    const likes = this.db.prepare('SELECT mod_id AS mod, created_at AS likedAt FROM likes WHERE user_id = ? ORDER BY created_at').all(userId);
    const sessions = this.db.prepare('SELECT created_at AS signedInAt, expires_at AS expiresAt, seen_at AS lastUsedAt FROM sessions WHERE user_id = ? ORDER BY created_at').all(userId);
    const downloads = this.db.prepare('SELECT mod_id AS mod, version, file, at AS downloadedAt FROM downloads WHERE user_id = ? ORDER BY at').all(userId);
    return { account: user, likes, downloads, sessions };
  }

  close(): void {
    this.db.close();
  }
}
