// site.db: what EDGEmods itself knows, kept across index rebuilds and backed up by Litestream (docs/design.md,
// "Two kinds of data"). R3b: release check results and moderation. Accounts, likes and downloads come next.

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
];

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

  close(): void {
    this.db.close();
  }
}
