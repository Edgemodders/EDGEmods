// Checks a mod's repository files: edgemods.json, the page, the images, and file sizes git will accept.
// Works on any source of files: a folder on disk (the extension, see folder.ts) or a repository on GitHub
// (the merge checks). Pure: the source does the reading.

import { formatFromName, readImageInfo } from './images.js';
import { LIMITS } from './limits.js';
import { MANIFEST_FILE, type Manifest } from './manifest.js';
import { formatBytes } from './release.js';
import { parseManifest, type Issue } from './validate.js';

export interface FileEntry {
  /** Path inside the repository, with forward slashes, exactly as stored (capitals matter). */
  path: string;
  /** Bytes. */
  size: number;
}

export interface ModFiles {
  /** Every file in the repository. May stop early on a very large tree; `truncated` says so. */
  list(): Promise<{ files: FileEntry[]; truncated?: boolean }>;
  /** A file's bytes, by its exact path from list(). */
  read(path: string): Promise<Uint8Array>;
}

export interface FilesResult {
  ok: boolean;
  issues: Issue[];
  manifest?: Manifest;
}

const GIT_BLOCK_BYTES = 100 * 1024 ** 2;
const GIT_WARN_BYTES = 50 * 1024 ** 2;

export async function checkModFiles(source: ModFiles): Promise<FilesResult> {
  const issues: Issue[] = [];
  const finish = (manifest?: Manifest): FilesResult => {
    const ok = !issues.some((i) => i.level === 'error');
    return ok && manifest ? { ok, issues, manifest } : { ok: false, issues };
  };

  const { files, truncated } = await source.list();
  const exact = new Map(files.map((f) => [f.path, f]));
  const loose = new Map(files.map((f) => [f.path.toLowerCase(), f]));
  const find = (path: string): { file?: FileEntry; differentCase?: string } => {
    const hit = exact.get(path);
    if (hit) return { file: hit };
    const near = loose.get(path.toLowerCase());
    return near ? { differentCase: near.path } : {};
  };
  const missing = (where: string, path: string, what: string): void => {
    const { differentCase } = find(path);
    issues.push({
      level: 'error',
      path: where,
      message: differentCase
        ? `${what} is spelled "${differentCase}" in the repository. GitHub cares about capitals, so the names must match exactly.`
        : `${what} is not in the mod's repository.`,
    });
  };

  const manifestFile = find(MANIFEST_FILE).file;
  if (!manifestFile) {
    issues.push({ level: 'error', path: '', message: `There is no ${MANIFEST_FILE} at the top of the mod's repository. The EDGEmods publishing form writes it.` });
    return finish();
  }
  const parsed = parseManifest(new TextDecoder().decode(await source.read(manifestFile.path)));
  issues.push(...parsed.issues);
  const m = parsed.manifest;
  if (!m) return finish();

  const page = m.page ?? 'README.md';
  const pageFile = find(page).file;
  if (!pageFile) missing(m.page ? 'page' : '', page, `The mod page "${page}"`);
  else if (pageFile.size > LIMITS.readmeBytes) {
    issues.push({ level: 'error', path: m.page ? 'page' : '', message: `The mod page "${page}" is ${formatBytes(pageFile.size)}; the limit is ${formatBytes(LIMITS.readmeBytes)}.` });
  }

  if (m.changelog && !find(m.changelog).file) missing('changelog', m.changelog, `The changelog "${m.changelog}"`);

  const images: [string, string, string, boolean][] = [
    [m.images.card, 'images.card', 'The card image', true],
    ...(m.images.gallery ?? []).map((g, i): [string, string, string, boolean] => [g.path, `images.gallery[${i}].path`, `Gallery image ${i + 1}`, false]),
  ];
  for (const [path, where, what, isCard] of images) {
    const file = find(path).file;
    if (!file) missing(where, path, `${what} "${path}"`);
    else await checkImage(source, file, where, what, isCard, issues);
  }

  for (const f of files) {
    if (f.size > GIT_BLOCK_BYTES) {
      issues.push({ level: 'error', path: '', message: `"${f.path}" is ${formatBytes(f.size)}. GitHub refuses files over 100 MB in a repository. Attach it to the release instead, or leave it out.` });
    } else if (f.size > GIT_WARN_BYTES) {
      issues.push({ level: 'warning', path: '', message: `"${f.path}" is ${formatBytes(f.size)}. GitHub warns about files over 50 MB; consider attaching it to the release instead.` });
    }
    if (/\.(zip|7z)$/i.test(f.path)) {
      issues.push({ level: 'warning', path: '', message: `"${f.path}" looks like a download. Mod downloads belong on the release, not in the repository.` });
    }
  }
  if (truncated) {
    issues.push({ level: 'warning', path: '', message: 'The repository has too many files to check them all for size.' });
  }
  return finish(m);
}

async function checkImage(source: ModFiles, file: FileEntry, where: string, what: string, isCard: boolean, issues: Issue[]): Promise<void> {
  const { path } = file;
  if (file.size > LIMITS.imageBytes) {
    issues.push({ level: 'error', path: where, message: `${what} "${path}" is ${formatBytes(file.size)}; the limit is ${formatBytes(LIMITS.imageBytes)}. Save it smaller or as .webp or .jpg.` });
    return;
  }
  const info = readImageInfo(await source.read(path));
  if (!info) {
    issues.push({ level: 'error', path: where, message: `${what} "${path}" is not a PNG, JPEG or WebP image EDGEmods can read.` });
    return;
  }
  if (info.format !== formatFromName(path)) {
    issues.push({ level: 'error', path: where, message: `${what} "${path}" is really a ${info.format.toUpperCase()} file. Rename it to match, such as ".${info.format === 'jpeg' ? 'jpg' : info.format}".` });
  }
  if (!isCard) return;
  const { minWidth, minHeight, recommendedWidth, recommendedHeight, ratio, ratioTolerance } = LIMITS.card;
  if (Math.abs(info.width / info.height - ratio) / ratio > ratioTolerance) {
    issues.push({ level: 'error', path: where, message: `${what} is ${info.width} × ${info.height}. Cards are twice as wide as they are tall (2:1), such as ${recommendedWidth} × ${recommendedHeight}.` });
  } else if (info.width < minWidth || info.height < minHeight) {
    issues.push({ level: 'error', path: where, message: `${what} is ${info.width} × ${info.height}, too small. It must be at least ${minWidth} × ${minHeight}; ${recommendedWidth} × ${recommendedHeight} is best.` });
  } else if (info.width < recommendedWidth) {
    issues.push({ level: 'warning', path: where, message: `${what} is ${info.width} × ${info.height}. ${recommendedWidth} × ${recommendedHeight} looks sharper on large screens.` });
  }
}
