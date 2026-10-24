// Builds index.db from the registry's entries: for each mod, its repository (found by GitHub's numeric id, so
// renames do not matter), every release whose tag and edgemods.json agree, the changelog's notes for each, and
// the newest release's page and images. Everything read from a repository is data: parsed, measured, rendered
// to sanitized HTML; nothing is run. A mod or release with a problem is left out and the problem recorded.

import { existsSync, renameSync, rmSync } from 'node:fs';
import { posix } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  CHANGELOG_FILE,
  checkRelease,
  compareVersions,
  isPrerelease,
  isVersion,
  LIMITS,
  MANIFEST_FILE,
  parseChangelog,
  parseManifest,
  type ChangelogSection,
  type Manifest,
} from '@edgemodders/edgemods-format';
import type { EntryPath, GitHub, GitHubIndex, RegistryEntry, Release, Repo } from '@edgemodders/edgemods-checks';
import { renderMarkdown } from './render.js';
import { INDEX_SCHEMA, INDEX_SCHEMA_VERSION } from './schema.js';

export type IndexGitHub = Pick<GitHub, 'file' | 'tree'> & GitHubIndex;

export interface RegistryMod extends EntryPath {
  entry: RegistryEntry;
}

export interface BuildOptions {
  github: IndexGitHub;
  mods: RegistryMod[];
  /** Where index.db is written. It is built beside it and moved into place when complete. */
  out: string;
  /** The registry's commit, recorded in the index. */
  registryRef?: string;
  /** How many mods are read at once. 4 by default. */
  concurrency?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface Problem {
  mod: string;
  version?: string;
  message: string;
}

export interface BuildResult {
  mods: number;
  releases: number;
  problems: Problem[];
}

/** One mod, read and ready to write. */
interface ModRecord {
  id: string;
  repo: Repo;
  latest: ReleaseRecord;
  releases: ReleaseRecord[];
  pageHtml: string;
  images: { path: string; size: number }[];
}

interface ReleaseRecord {
  version: string;
  release: Release;
  manifest: Manifest;
  manifestText: string;
  notesHtml: string;
  notesFrom: 'changelog' | 'release' | 'none';
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export async function buildIndex(o: BuildOptions): Promise<BuildResult> {
  const now = o.now ?? (() => new Date());
  const log = o.log ?? (() => {});
  const problems: Problem[] = [];
  const records: ModRecord[] = [];

  await pool(o.mods, o.concurrency ?? 4, async (mod) => {
    try {
      const record = await readMod(mod, o.github, problems);
      if (record) records.push(record);
      log(record ? `${mod.id}: ${record.releases.length} release(s), showing ${record.latest.version}` : `${mod.id}: left out`);
    } catch (err) {
      problems.push({ mod: mod.id, message: `It could not be read: ${err instanceof Error ? err.message : String(err)}` });
      log(`${mod.id}: failed`);
    }
  });

  records.sort((a, b) => a.id.localeCompare(b.id));
  const building = `${o.out}.building`;
  rmSync(building, { force: true });
  const db = new DatabaseSync(building);
  try {
    db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
    db.exec(INDEX_SCHEMA);
    write(db, records, problems, { registryRef: o.registryRef, builtAt: now().toISOString() });
  } finally {
    db.close();
  }
  if (existsSync(o.out)) rmSync(o.out);
  renameSync(building, o.out);
  return { mods: records.length, releases: records.reduce((n, r) => n + r.releases.length, 0), problems };
}

async function readMod(mod: RegistryMod, github: IndexGitHub, problems: Problem[]): Promise<ModRecord | undefined> {
  const problem = (message: string, version?: string): undefined => void problems.push({ mod: mod.id, ...(version ? { version } : {}), message });

  const repo = await github.repoById(mod.entry.repoId);
  if (!repo) return problem('Its repository is gone or not public.');
  if (repo.private) return problem(`${repo.fullName} is private.`);
  if (repo.disabled) return problem(`GitHub has disabled ${repo.fullName}.`);
  if (repo.owner.id !== mod.entry.ownerId) return problem(`${repo.fullName} now belongs to ${repo.owner.login}, not to the account that published it.`);

  const usable: ReleaseRecord[] = [];
  for (const release of await github.releases(repo.fullName)) {
    const version = release.tag.startsWith('v') ? release.tag.slice(1) : '';
    if (!isVersion(version)) continue; // Not an EDGEmods release tag; other releases are the modder's business.
    const text = await github.file(repo.fullName, release.tag, MANIFEST_FILE);
    if (!text) {
      problem(`The commit tagged ${release.tag} has no ${MANIFEST_FILE}.`, version);
      continue;
    }
    const manifestText = decode(text);
    const parsed = parseManifest(manifestText);
    const m = parsed.manifest;
    if (!m) {
      const first = parsed.issues.find((i) => i.level === 'error');
      problem(first ? `Its ${MANIFEST_FILE} has problems, such as: ${first.message.replace(/\.$/, '')}.` : `Its ${MANIFEST_FILE} has problems.`, version);
      continue;
    }
    if (m.id !== mod.id) {
      problem(`Its ${MANIFEST_FILE} is for "${m.id}", not "${mod.id}".`, version);
      continue;
    }
    if (m.author.github.toLowerCase() !== repo.owner.login.toLowerCase()) {
      problem(`Its ${MANIFEST_FILE} names ${m.author.github} as the author, but the repository belongs to ${repo.owner.login}.`, version);
      continue;
    }
    const errors = checkRelease(m, { tag: release.tag, assets: release.assets }).filter((i) => i.level === 'error');
    if (errors.length) {
      problem(errors[0].message, version);
      continue;
    }
    usable.push({ version, release, manifest: m, manifestText, notesHtml: '', notesFrom: 'none' });
  }
  if (!usable.length) return problem('It has no usable release.');
  usable.sort((a, b) => compareVersions(b.version, a.version));
  const latest = usable.find((r) => !isPrerelease(r.version)) ?? usable[0];
  const ctx = { modId: mod.id, repo: repo.fullName };

  // Release notes: the version's section of the changelog on the default branch, so a corrected note shows at
  // the next index; otherwise the release's own description.
  const changelogPath = latest.manifest.changelog ?? CHANGELOG_FILE;
  const changelogBytes = await github.file(repo.fullName, repo.defaultBranch, changelogPath);
  const sections: ChangelogSection[] = changelogBytes ? parseChangelog(decode(changelogBytes)) : [];
  const { files: defaultTree } = changelogBytes ? await github.tree(repo.fullName, repo.defaultBranch) : { files: [] };
  for (const r of usable) {
    const section = sections.find((s) => s.version === r.version);
    const source = section?.body ? 'changelog' : r.release.body?.trim() ? 'release' : 'none';
    if (source === 'none') continue;
    const md = source === 'changelog' ? section!.body : r.release.body!;
    // Notes link to files, never show images: the image cache holds only the newest release's.
    r.notesHtml = renderMarkdown(md, { ...ctx, dir: source === 'changelog' ? posix.dirname(changelogPath).replace(/^\.$/, '') : '', files: new Set(defaultTree.map((f) => f.path).filter((p) => !/\.(?:png|jpe?g|webp|gif)$/i.test(p))) }).html;
    r.notesFrom = source;
  }

  // The page and images, from the newest release's tag, so they match what is downloaded.
  const { files: tree } = await github.tree(repo.fullName, latest.release.tag);
  const sizes = new Map(tree.map((f) => [f.path, f.size]));
  const pagePath = latest.manifest.page ?? 'README.md';
  const pageBytes = await github.file(repo.fullName, latest.release.tag, pagePath);
  if (!pageBytes) return problem(`Its page, ${pagePath}, is missing at ${latest.release.tag}.`, latest.version);
  if (pageBytes.length > LIMITS.readmeBytes) return problem(`Its page, ${pagePath}, is larger than ${LIMITS.readmeBytes / 1024} KB.`, latest.version);
  const page = renderMarkdown(decode(pageBytes), { ...ctx, dir: posix.dirname(pagePath).replace(/^\.$/, ''), files: new Set(sizes.keys()) });

  const imagePaths = new Set([latest.manifest.images.card, ...(latest.manifest.images.gallery ?? []).map((g) => g.path), ...page.images]);
  const images: ModRecord['images'] = [];
  for (const path of imagePaths) {
    const size = sizes.get(path);
    if (size === undefined) {
      problem(`The image ${path} is missing at ${latest.release.tag}.`, latest.version);
      continue;
    }
    if (size > LIMITS.imageBytes) continue;
    images.push({ path, size });
  }
  if (!images.some((i) => i.path === latest.manifest.images.card)) return problem('Its card image is missing or too large.', latest.version);

  return { id: mod.id, repo, latest, releases: usable, pageHtml: page.html, images };
}

function write(db: DatabaseSync, records: ModRecord[], problems: Problem[], meta: { registryRef?: string; builtAt: string }): void {
  const insertMod = db.prepare(`INSERT INTO mods VALUES (:id, :name, :summary, :author_name, :owner_login, :owner_id, :repo, :repo_id, :type, :tags,
    :license, :adult, :latest, :first_published, :last_updated, :card, :gallery, :page_html, :links, :credits, :indexed_at)`);
  const insertRelease = db.prepare(`INSERT INTO releases VALUES (:mod_id, :version, :tag, :rank, :prerelease, :published_at, :game_version, :notes_html,
    :notes_from, :files, :requirements, :size, :manifest)`);
  const insertImage = db.prepare('INSERT INTO images VALUES (?, ?, ?, ?)');
  const insertSearch = db.prepare('INSERT INTO mods_search VALUES (?, ?, ?, ?, ?)');
  const insertProblem = db.prepare('INSERT INTO problems VALUES (?, ?, ?)');
  const insertMeta = db.prepare('INSERT INTO meta VALUES (?, ?)');

  db.exec('BEGIN');
  for (const r of records) {
    const m = r.latest.manifest;
    const dates = r.releases.map((x) => x.release.publishedAt).filter((d): d is string => Boolean(d)).sort();
    insertMod.run({
      id: r.id,
      name: m.name,
      summary: m.summary,
      author_name: m.author.name,
      owner_login: r.repo.owner.login,
      owner_id: r.repo.owner.id,
      repo: r.repo.fullName,
      repo_id: r.repo.id,
      type: m.type,
      tags: JSON.stringify(m.tags ?? []),
      license: m.license,
      adult: m.adult ? 1 : 0,
      latest: r.latest.version,
      first_published: dates[0] ?? null,
      last_updated: r.latest.release.publishedAt ?? null,
      card: m.images.card,
      gallery: JSON.stringify(m.images.gallery ?? []),
      page_html: r.pageHtml,
      links: JSON.stringify(m.links ?? {}),
      credits: JSON.stringify(m.credits ?? []),
      indexed_at: meta.builtAt,
    });
    r.releases.forEach((x, rank) => {
      const assets = new Map(x.release.assets.map((a) => [a.name, a]));
      const files = x.manifest.files.map((f) => {
        const a = assets.get(f.name)!;
        return { ...f, size: a.size, assetId: a.id, ...(a.url ? { url: a.url } : {}) };
      });
      insertRelease.run({
        mod_id: r.id,
        version: x.version,
        tag: x.release.tag,
        rank,
        prerelease: isPrerelease(x.version) ? 1 : 0,
        published_at: x.release.publishedAt ?? null,
        game_version: x.manifest.gameVersion ?? null,
        notes_html: x.notesHtml,
        notes_from: x.notesFrom,
        files: JSON.stringify(files),
        requirements: JSON.stringify(x.manifest.requirements ?? []),
        size: downloadSize(files),
        manifest: x.manifestText,
      });
    });
    for (const i of r.images) insertImage.run(r.id, i.path, r.latest.release.tag, i.size);
    insertSearch.run(r.id, m.name, m.summary, (m.tags ?? []).join(' '), m.author.name);
  }
  for (const p of problems) insertProblem.run(p.mod, p.version ?? null, p.message);
  insertMeta.run('schemaVersion', String(INDEX_SCHEMA_VERSION));
  insertMeta.run('builtAt', meta.builtAt);
  if (meta.registryRef) insertMeta.run('registryRef', meta.registryRef);
  db.exec('COMMIT');
}

/** What a player downloads by default: the required files and the first file of each choose-one group. */
export function downloadSize(files: { role: string; group?: string; size: number }[]): number {
  const groups = new Set<string>();
  let total = 0;
  for (const f of files) {
    if (f.role === 'required') total += f.size;
    else if (f.role === 'choose-one' && f.group && !groups.has(f.group)) {
      groups.add(f.group);
      total += f.size;
    }
  }
  return total;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}
