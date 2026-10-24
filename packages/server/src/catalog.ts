// What the website shows: index.db (from the indexer) read together with site.db (check results, moderation),
// attached to the same connection. One rule decides what anyone sees, in shownSql(): a release shows once it has
// passed EDGEmods' release checks; a mod shows with its newest such release that is not a pre-release (or its
// newest pre-release if it has nothing else), unless an admin hid or blocked it.

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Requirement } from '@edgemodders/edgemods-format';
import { INDEX_SCHEMA_VERSION } from '@edgemodders/edgemods-indexer';

export const SORTS = ['relevance', 'updated', 'new', 'name'] as const;
export type Sort = (typeof SORTS)[number];
export const PAGE_SIZE = 24;

export interface ReleaseFile {
  name: string;
  role: 'required' | 'optional' | 'choose-one';
  group?: string;
  title?: string;
  note?: string;
  size: number;
  assetId: number;
  url?: string;
  requirements?: Requirement[];
}

export interface DownloadCheck {
  name: string;
  size: number;
  sha256: string;
  contents: { files: number; size: number; kinds: Record<string, number>; runsCode: string[] };
  scan?: { scanner: string; clean: boolean; findings: string[] };
}

export interface ReleaseView {
  version: string;
  tag: string;
  prerelease: boolean;
  publishedAt?: string;
  gameVersion?: string;
  notesHtml: string;
  files: ReleaseFile[];
  requirements: Requirement[];
  size: number;
  check?: { ok: boolean; checkedAt: string; downloads: DownloadCheck[] };
}

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
  card: string;
}

export interface ModView extends Card {
  ownerLogin: string;
  repo: string;
  license: string;
  pageHtml: string;
  gallery: { path: string; caption?: string }[];
  links: Record<string, string>;
  credits: { name: string; for?: string }[];
  /** Every release that shows, newest first; the first that is not a pre-release is `shown`. */
  releases: ReleaseView[];
  shown: ReleaseView;
}

export interface Query {
  q: string;
  type: string[];
  tag: string[];
  needs: string[];
  nocode: boolean;
  sort: Sort;
  page: number;
  /** Adult mods are left out unless the person opted in (never for visitors). */
  adult: boolean;
}

export interface Facet {
  value: string;
  label: string;
  count: number;
}

export interface SearchResult {
  total: number;
  page: number;
  pages: number;
  cards: Card[];
  facets: { type: Facet[]; tag: Facet[]; needs: Facet[]; nocode: number };
}

type Row = Record<string, any>;
type Params = Record<string, string | number>;

export class Catalog {
  private db: DatabaseSync;
  private builtAt = '';

  constructor(readonly indexPath: string, readonly sitePath: string, readonly options: { showUnchecked: boolean }) {
    this.db = this.open(indexPath);
  }

  /** Opens an index, checks it, and attaches site.db. Throws if the index cannot be used. */
  private open(path: string): DatabaseSync {
    if (!existsSync(path)) throw new Error(`There is no index at ${path}. Build one with edgemods-index.`);
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA query_only = ON');
      const meta = Object.fromEntries((db.prepare('SELECT key, value FROM meta').all() as Row[]).map((r) => [r.key, r.value]));
      if (meta.schemaVersion !== String(INDEX_SCHEMA_VERSION)) {
        throw new Error(`The index at ${path} has format ${meta.schemaVersion}; this website reads format ${INDEX_SCHEMA_VERSION}.`);
      }
      db.prepare('ATTACH DATABASE ? AS site').run(this.sitePath);
      this.builtAt = meta.builtAt ?? '';
      return db;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  /** Swaps in a new index file, keeping the old one if the new one cannot be opened. */
  reload(path = this.indexPath): void {
    const next = this.open(path);
    const old = this.db;
    this.db = next;
    old.close();
  }

  close(): void {
    this.db.close();
  }

  /** Counts of what shows; adult mods only when the viewer opted in (health checks count everything). */
  info(adult = true): { builtAt: string; mods: number; modders: number } {
    const row = this.db.prepare(`${this.shownSql()} SELECT count(*) AS mods, count(DISTINCT owner_id) AS modders FROM shown ${adult ? '' : 'WHERE adult = 0'}`).get() as Row;
    return { builtAt: this.builtAt, mods: row.mods, modders: row.modders };
  }

  /** The release rule. Every query that shows mods starts from these two views. */
  private shownSql(): string {
    const passed = this.options.showUnchecked
      ? '1'
      : 'EXISTS (SELECT 1 FROM site.release_checks c WHERE c.mod_id = r.mod_id AND c.version = r.version AND c.ok = 1)';
    return `WITH visible AS (
        SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.mod_id ORDER BY r.prerelease, r.rank) AS pick
        FROM releases r WHERE ${passed}
      ), shown AS (
        SELECT m.*, v.version, v.size, v.published_at AS shown_at, v.requirements AS reqs,
          EXISTS (SELECT 1 FROM site.release_checks c, json_each(c.downloads) d
                  WHERE c.mod_id = m.id AND c.version = v.version AND json_array_length(d.value, '$.contents.runsCode') > 0) AS runs_code
        FROM mods m JOIN visible v ON v.mod_id = m.id AND v.pick = 1
        WHERE NOT EXISTS (SELECT 1 FROM site.moderation x WHERE x.mod_id = m.id AND x.status <> 'visible')
      )`;
  }

  search(query: Query): SearchResult {
    const match = ftsQuery(query.q);
    const where = (skip?: 'type' | 'tag' | 'needs' | 'nocode'): { sql: string; params: Params } => {
      const parts: string[] = [];
      const params: Params = {};
      if (!query.adult) parts.push('s.adult = 0');
      if (match) {
        parts.push('s.id IN (SELECT id FROM mods_search WHERE mods_search MATCH :match)');
        params.match = match;
      }
      if (skip !== 'type' && query.type.length) {
        parts.push(`s.type IN (${query.type.map((_, i) => `:type${i}`).join(', ')})`);
        query.type.forEach((t, i) => (params[`type${i}`] = t));
      }
      if (skip !== 'tag') {
        query.tag.forEach((t, i) => {
          parts.push(`EXISTS (SELECT 1 FROM json_each(s.tags) t WHERE t.value = :tag${i})`);
          params[`tag${i}`] = t;
        });
      }
      if (skip !== 'needs') {
        query.needs.forEach((n, i) => {
          parts.push(`EXISTS (SELECT 1 FROM json_each(s.reqs) q WHERE coalesce(q.value ->> 'mod', q.value ->> 'name') = :need${i})`);
          params[`need${i}`] = n;
        });
      }
      if (skip !== 'nocode' && query.nocode) parts.push('s.runs_code = 0');
      return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
    };

    const all = where();
    const order = {
      relevance: match ? '(SELECT bm25(mods_search) FROM mods_search WHERE mods_search MATCH :match AND mods_search.id = s.id), s.shown_at DESC' : 's.shown_at DESC',
      updated: 's.shown_at DESC',
      new: 's.first_published DESC',
      name: 's.name COLLATE NOCASE',
    }[query.sort];
    const total = (this.db.prepare(`${this.shownSql()} SELECT count(*) AS n FROM shown s ${all.sql}`).get(all.params) as Row).n as number;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(1, query.page), pages);
    const rows = this.db.prepare(`${this.shownSql()} SELECT s.* FROM shown s ${all.sql} ORDER BY ${order}, s.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`)
      .all(all.params) as Row[];

    const facet = (sql: string, skip: 'type' | 'tag' | 'needs'): Row[] => {
      const w = where(skip);
      return this.db.prepare(`${this.shownSql()} ${sql.replace('%WHERE%', w.sql)}`).all(w.params) as Row[];
    };
    const types = facet('SELECT s.type AS value, count(*) AS n FROM shown s %WHERE% GROUP BY s.type ORDER BY n DESC, value', 'type');
    const tags = facet('SELECT t.value AS value, count(*) AS n FROM shown s, json_each(s.tags) t %WHERE% GROUP BY t.value ORDER BY n DESC, value LIMIT 60', 'tag');
    // "need", not "value": json_each has its own value column, which GROUP BY would pick instead.
    const needs = facet(`SELECT coalesce(q.value ->> 'mod', q.value ->> 'name') AS need, max(q.value ->> 'mod' IS NOT NULL) AS isMod, count(DISTINCT s.id) AS n
      FROM shown s, json_each(s.reqs) q %WHERE% GROUP BY need ORDER BY n DESC, need LIMIT 60`, 'needs').map((r): Row => ({ ...r, value: r.need }));
    const noW = where('nocode');
    const nocode = (this.db.prepare(`${this.shownSql()} SELECT count(*) AS n FROM shown s ${noW.sql ? `${noW.sql} AND` : 'WHERE'} s.runs_code = 0`).get(noW.params) as Row).n as number;

    const names = this.names(needs.filter((n) => n.isMod).map((n) => n.value));
    const withSelected = (list: Facet[], selected: string[], label: (v: string) => string): Facet[] => [
      ...list,
      ...selected.filter((v) => !list.some((f) => f.value === v)).map((v) => ({ value: v, label: label(v), count: 0 })),
    ];
    return {
      total,
      page,
      pages,
      cards: rows.map(toCard),
      facets: {
        type: withSelected(types.map((r) => ({ value: r.value, label: r.value, count: r.n })), query.type, (v) => v),
        tag: withSelected(tags.map((r) => ({ value: r.value, label: r.value, count: r.n })), query.tag, (v) => v),
        needs: withSelected(needs.map((r) => ({ value: r.value, label: (r.isMod && names.get(r.value)) || r.value, count: r.n })), query.needs, (v) => names.get(v) ?? v),
        nocode,
      },
    };
  }

  /** Cards for the home page's rails. */
  rail(sort: 'new' | 'updated', limit: number, adult: boolean): Card[] {
    return this.search({ q: '', type: [], tag: [], needs: [], nocode: false, sort, page: 1, adult }).cards.slice(0, limit);
  }

  typeCounts(adult: boolean): Facet[] {
    return this.search({ q: '', type: [], tag: [], needs: [], nocode: false, sort: 'updated', page: 1, adult }).facets.type;
  }

  /** One mod as anyone may see it, or undefined if it does not show (missing, hidden, or nothing checked yet). */
  mod(id: string): ModView | undefined {
    const row = this.db.prepare(`${this.shownSql()} SELECT * FROM shown WHERE id = ?`).get(id) as Row | undefined;
    if (!row) return undefined;
    const releases = (this.db.prepare(`${this.shownSql()} SELECT v.*, c.ok AS check_ok, c.checked_at, c.downloads AS check_downloads
        FROM visible v LEFT JOIN site.release_checks c ON c.mod_id = v.mod_id AND c.version = v.version
        WHERE v.mod_id = ? ORDER BY v.rank`).all(id) as Row[]).map(toRelease);
    const shown = releases.find((r) => r.version === row.version)!;
    return {
      ...toCard(row),
      ownerLogin: row.owner_login,
      repo: row.repo,
      license: row.license,
      pageHtml: row.page_html,
      gallery: JSON.parse(row.gallery),
      links: JSON.parse(row.links),
      credits: JSON.parse(row.credits),
      releases,
      shown,
    };
  }

  /** The names of mods by id, for requirements. Only mods that show. */
  names(ids: string[]): Map<string, string> {
    if (!ids.length) return new Map();
    const rows = this.db.prepare(`${this.shownSql()} SELECT id, name FROM shown WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Row[];
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Every release of a mod that shows, newest first, with its files and requirements: for install plans. */
  releasesOf(id: string): { name: string; adult: boolean; releases: ReleaseView[] } | undefined {
    const mod = this.mod(id);
    return mod && { name: mod.name, adult: mod.adult, releases: mod.releases };
  }

  /** An image EDGEmods may serve for a mod that shows: the repository and the tag to read it at. */
  image(id: string, path: string): { repo: string; ref: string; size: number } | undefined {
    const row = this.db.prepare(`${this.shownSql()} SELECT s.repo, i.ref, i.size FROM images i JOIN shown s ON s.id = i.mod_id WHERE i.mod_id = ? AND i.path = ?`)
      .get(id, path) as Row | undefined;
    return row && { repo: row.repo, ref: row.ref, size: row.size };
  }
}

/** A search box's words as a full-text query: each word a prefix, all of them needed. No query syntax gets through. */
export function ftsQuery(q: string): string {
  const words = (q.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  return words.map((w) => `"${w}"*`).join(' ');
}

function toCard(r: Row): Card {
  return {
    id: r.id,
    name: r.name,
    summary: r.summary,
    author: r.author_name,
    type: r.type,
    tags: JSON.parse(r.tags),
    version: r.version,
    size: r.size,
    firstPublished: r.first_published ?? undefined,
    lastUpdated: r.shown_at ?? undefined,
    adult: Boolean(r.adult),
    runsCode: Boolean(r.runs_code),
    card: r.card,
  };
}

function toRelease(r: Row): ReleaseView {
  return {
    version: r.version,
    tag: r.tag,
    prerelease: Boolean(r.prerelease),
    publishedAt: r.published_at ?? undefined,
    gameVersion: r.game_version ?? undefined,
    notesHtml: r.notes_html,
    files: JSON.parse(r.files),
    requirements: JSON.parse(r.requirements),
    size: r.size,
    ...(r.check_ok === null || r.check_ok === undefined
      ? {}
      : { check: { ok: Boolean(r.check_ok), checkedAt: r.checked_at, downloads: JSON.parse(r.check_downloads) } }),
  };
}
