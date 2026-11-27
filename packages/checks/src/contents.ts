// Sorts a download's files into kinds the mod page can show in plain words, and finds paths that are unsafe
// to install. Nothing here fails a mod for having a plugin: plugins are normal, and the page says so.

import type { ArchiveEntry } from './archive.js';

export type ContentKind =
  | 'plugin'
  | 'program'
  | 'redscript'
  | 'cet'
  | 'archive'
  | 'tweak'
  | 'audio'
  | 'nested-archive'
  | 'rednode'
  | 'other';

/** Shown on the mod page, and in the merge checks' report. */
export const KIND_LABELS: Record<ContentKind, string> = {
  plugin: 'game plugins (.dll, .asi), which run inside the game',
  program: 'programs or scripts that run on Windows (.exe, .bat, .ps1 and similar)',
  redscript: 'redscript scripts (.reds)',
  cet: 'Cyber Engine Tweaks scripts (.lua)',
  archive: 'game archives (.archive, .xl)',
  tweak: 'tweaks (.yaml, .yml, .tweak)',
  audio: 'sound files (.wem, .opus, .bnk)',
  'nested-archive': 'archives inside the download (.zip, .7z, .rar)',
  rednode: 'REDnode package files (pages, scripts, pictures)',
  other: 'other files',
};

/** Kinds that run code with the player's permissions: the page warns about these. */
export const RUNS_CODE: ContentKind[] = ['plugin', 'program'];

const BY_EXTENSION: Record<string, ContentKind> = {
  dll: 'plugin', asi: 'plugin',
  exe: 'program', com: 'program', bat: 'program', cmd: 'program', ps1: 'program', vbs: 'program', msi: 'program', scr: 'program', jar: 'program',
  reds: 'redscript',
  lua: 'cet',
  archive: 'archive', xl: 'archive',
  yaml: 'tweak', yml: 'tweak', tweak: 'tweak',
  wem: 'audio', opus: 'audio', bnk: 'audio',
  zip: 'nested-archive', '7z': 'nested-archive', rar: 'nested-archive',
};

export function kindOf(path: string): ContentKind {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase();
  return (ext && BY_EXTENSION[ext]) || 'other';
}

export interface ContentSummary {
  files: number;
  /** Uncompressed bytes. */
  size: number;
  kinds: Partial<Record<ContentKind, number>>;
  /** Files that run code, by path, so a reviewer can look. A REDnode Node mod or service counts by its manifest. */
  runsCode: string[];
  /** The REDnode packages in it, when it has any. */
  rednode?: RednodeContents;
}

/** A REDnode package found in a download: a folder with a rednode-app.json (REDnode's docs/overlay-apps.md). */
export interface RednodePackage {
  id: string;
  name: string;
  version: string;
  /** The package's folder inside the download, '' for the download's top. */
  folder: string;
  /** What it is: a window (an entry page), a HUD widget, a Node mod (main), a service. */
  window: boolean;
  hud: boolean;
  node: boolean;
  service: boolean;
  permissions: string[];
  /** The REDnode versions it needs, from requires.rednode. */
  rednode?: string;
}

export interface RednodeContents {
  packages: RednodePackage[];
  /**
   * Every file is part of a package, so the download can go straight into REDnode's apps folders, without EDGEdeck:
   * packages at the top, in their own folders, or under red4ext/plugins/REDnode/apps/. A licence or readme at the top
   * is allowed.
   */
  only: boolean;
  /** rednode-app.json files that could not be read, in plain words. */
  problems: string[];
}

export const RED_MANIFEST = 'rednode-app.json';
const APPS_DIR = 'red4ext/plugins/REDnode/apps/';
const PACKAGE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TOP_EXTRAS = /^[^/]+\.(txt|md)$/i;

/** The rednode-app.json paths in a download, to read with readSmallFiles. */
export function rednodeManifests(entries: ArchiveEntry[]): string[] {
  return entries.map((e) => e.path).filter((p) => p === RED_MANIFEST || p.endsWith(`/${RED_MANIFEST}`));
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Reads the packages from their manifests and works out whether the download is REDnode only. */
export function rednodeContents(entries: ArchiveEntry[], manifests: Map<string, Buffer>): RednodeContents | undefined {
  const paths = rednodeManifests(entries);
  if (!paths.length) return undefined;
  const packages: RednodePackage[] = [];
  const problems: string[] = [];
  for (const p of paths) {
    const folder = p === RED_MANIFEST ? '' : p.slice(0, -RED_MANIFEST.length - 1);
    const raw = manifests.get(p);
    let m: any;
    try {
      if (!raw) throw new Error('unread');
      m = JSON.parse(raw.toString('utf8').replace(/^﻿/, ''));
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('not an object');
    } catch {
      problems.push(`"${p}" could not be read as JSON.`);
      continue;
    }
    if (typeof m.id !== 'string' || !PACKAGE_ID.test(m.id)) {
      problems.push(`"${p}" has no valid id (lowercase letters, digits, - and _, up to 64).`);
      continue;
    }
    packages.push({
      id: m.id,
      name: text(m.name, 100) || m.id,
      version: text(m.version, 40),
      folder,
      window: typeof m.entry === 'string' && m.kind !== 'hud',
      hud: typeof m.entry === 'string' && m.kind === 'hud',
      node: typeof m.main === 'string',
      service: typeof m.service === 'string',
      permissions: Array.isArray(m.permissions) ? m.permissions.filter((x: unknown) => typeof x === 'string').slice(0, 20).map((x: string) => x.slice(0, 60)) : [],
      rednode: text(m.requires?.rednode, 40) || undefined,
    });
  }
  const folders = packages.map((k) => k.folder);
  const inside = (path: string): boolean => folders.some((f) => f === '' || path.startsWith(`${f}/`));
  const placed = folders.every((f) => {
    if (f === '') return folders.length === 1;
    if (folders.some((g) => g !== f && (g === '' || f.startsWith(`${g}/`)))) return false; // a package inside another
    const parent = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
    return parent === '' || parent.toLowerCase() === APPS_DIR.toLowerCase();
  });
  // A plugin or a program inside a package is not something REDnode runs: such a download goes through EDGEdeck.
  const only = problems.length === 0 && packages.length > 0 && placed
    && entries.every((e) => (inside(e.path) || TOP_EXTRAS.test(e.path)) && !RUNS_CODE.includes(kindOf(e.path)));
  return { packages, only, problems };
}

/** Folds what the REDnode manifests said into the summary: their files are REDnode's, and a Node mod runs code. */
export function withRednode(summary: ContentSummary, entries: ArchiveEntry[], rednode: RednodeContents | undefined): ContentSummary {
  if (!rednode?.packages.length) return summary;
  const folders = rednode.packages.map((k) => k.folder);
  const kinds: Partial<Record<ContentKind, number>> = {};
  for (const e of entries) {
    let kind = kindOf(e.path);
    if (kind === 'other' && folders.some((f) => f === '' || e.path.startsWith(`${f}/`))) kind = 'rednode';
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  const runsCode = [...summary.runsCode];
  for (const k of rednode.packages) {
    if (k.node || k.service) runsCode.push(k.folder ? `${k.folder}/${RED_MANIFEST}` : RED_MANIFEST);
  }
  return { ...summary, kinds, runsCode, rednode };
}

export function summarize(entries: ArchiveEntry[]): ContentSummary {
  const kinds: Partial<Record<ContentKind, number>> = {};
  const runsCode: string[] = [];
  let size = 0;
  for (const e of entries) {
    const kind = kindOf(e.path);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (RUNS_CODE.includes(kind)) runsCode.push(e.path);
    size += e.size;
  }
  return { files: entries.length, size, kinds, runsCode };
}

/** Paths that would land outside the game folder, or that hide what they are. Each one fails the check. */
export function unsafePaths(entries: ArchiveEntry[]): string[] {
  const problems: string[] = [];
  for (const e of entries) {
    const p = e.path;
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) problems.push(`"${p}" is an absolute path; files must be inside the mod.`);
    else if (p.split('/').some((s) => s === '..')) problems.push(`"${p}" climbs out of the folder with "..".`);
    else if (/[\u0000-\u001f]/.test(p)) problems.push(`A file name contains invisible control characters.`);
    else if (/[‪-‮⁦-⁩]/.test(p)) problems.push(`"${p}" uses characters that reverse text, which can disguise a file's type.`);
  }
  return problems;
}
