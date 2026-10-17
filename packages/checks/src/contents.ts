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
  /** Files that run code, by path, so a reviewer can look. */
  runsCode: string[];
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
