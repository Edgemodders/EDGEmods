// Checks a mod's repository folder on disk: edgemods.json, the page, the images, and file sizes git will accept.
// Used by the extension before publishing and by the example's check; the merge checks read the same files from GitHub.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { formatFromName, readImageInfo } from './images.js';
import { LIMITS } from './limits.js';
import { MANIFEST_FILE, type Manifest } from './manifest.js';
import { formatBytes } from './release.js';
import { parseManifest, type Issue } from './validate.js';

export interface FolderResult {
  ok: boolean;
  issues: Issue[];
  manifest?: Manifest;
}

const GIT_BLOCK_BYTES = 100 * 1024 ** 2;
const GIT_WARN_BYTES = 50 * 1024 ** 2;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const MAX_WALK = 20000;

export async function checkModFolder(dir: string): Promise<FolderResult> {
  const issues: Issue[] = [];
  const finish = (manifest?: Manifest): FolderResult => {
    const ok = !issues.some((i) => i.level === 'error');
    return ok && manifest ? { ok, issues, manifest } : { ok: false, issues };
  };

  let text: string;
  try {
    text = await readFile(join(dir, MANIFEST_FILE), 'utf8');
  } catch {
    issues.push({ level: 'error', path: '', message: `There is no ${MANIFEST_FILE} at the top of the mod's folder. The EDGEmods publishing form writes it.` });
    return finish();
  }
  const parsed = parseManifest(text);
  issues.push(...parsed.issues);
  const m = parsed.manifest;
  if (!m) return finish();

  const page = m.page ?? 'README.md';
  const pageFile = await findExact(dir, page);
  if (!pageFile.found) {
    issues.push(missing(m.page ? 'page' : '', pageFile, `The mod page "${page}"`));
  } else if (pageFile.size > LIMITS.readmeBytes) {
    issues.push({ level: 'error', path: m.page ? 'page' : '', message: `The mod page "${page}" is ${formatBytes(pageFile.size)}; the limit is ${formatBytes(LIMITS.readmeBytes)}.` });
  }

  if (m.changelog) {
    const log = await findExact(dir, m.changelog);
    if (!log.found) issues.push(missing('changelog', log, `The changelog "${m.changelog}"`));
  }

  await checkImage(dir, m.images.card, 'images.card', 'The card image', true, issues);
  for (const [i, g] of (m.images.gallery ?? []).entries()) {
    await checkImage(dir, g.path, `images.gallery[${i}].path`, `Gallery image ${i + 1}`, false, issues);
  }

  await checkTree(dir, issues);
  return finish(m);
}

async function checkImage(dir: string, path: string, where: string, what: string, isCard: boolean, issues: Issue[]): Promise<void> {
  const file = await findExact(dir, path);
  if (!file.found) {
    issues.push(missing(where, file, `${what} "${path}"`));
    return;
  }
  if (file.size > LIMITS.imageBytes) {
    issues.push({ level: 'error', path: where, message: `${what} "${path}" is ${formatBytes(file.size)}; the limit is ${formatBytes(LIMITS.imageBytes)}. Save it smaller or as .webp or .jpg.` });
  }
  const bytes = await readFile(join(dir, path));
  const info = readImageInfo(bytes);
  const promised = formatFromName(path);
  if (!info) {
    issues.push({ level: 'error', path: where, message: `${what} "${path}" is not a PNG, JPEG or WebP image EDGEmods can read.` });
    return;
  }
  if (info.format !== promised) {
    issues.push({ level: 'error', path: where, message: `${what} "${path}" is really a ${info.format.toUpperCase()} file. Rename it to match, such as ".${info.format === 'jpeg' ? 'jpg' : info.format}".` });
  }
  if (!isCard) return;
  const { minWidth, minHeight, recommendedWidth, recommendedHeight, ratio, ratioTolerance } = LIMITS.card;
  const actual = info.width / info.height;
  if (Math.abs(actual - ratio) / ratio > ratioTolerance) {
    issues.push({ level: 'error', path: where, message: `${what} is ${info.width} × ${info.height}. Cards are twice as wide as they are tall (2:1), such as ${recommendedWidth} × ${recommendedHeight}.` });
  } else if (info.width < minWidth || info.height < minHeight) {
    issues.push({ level: 'error', path: where, message: `${what} is ${info.width} × ${info.height}, too small. It must be at least ${minWidth} × ${minHeight}; ${recommendedWidth} × ${recommendedHeight} is best.` });
  } else if (info.width < recommendedWidth) {
    issues.push({ level: 'warning', path: where, message: `${what} is ${info.width} × ${info.height}. ${recommendedWidth} × ${recommendedHeight} looks sharper on large screens.` });
  }
}

/** Files git would refuse or warn about, and release files committed by mistake. */
async function checkTree(dir: string, issues: Issue[]): Promise<void> {
  let seen = 0;
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(join(dir, rel), { withFileTypes: true });
    for (const entry of entries) {
      if (++seen > MAX_WALK) return;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const { size } = await stat(join(dir, path));
      if (size > GIT_BLOCK_BYTES) {
        issues.push({ level: 'error', path: '', message: `"${path}" is ${formatBytes(size)}. GitHub refuses files over 100 MB in a repository. Attach it to the release instead, or leave it out.` });
      } else if (size > GIT_WARN_BYTES) {
        issues.push({ level: 'warning', path: '', message: `"${path}" is ${formatBytes(size)}. GitHub warns about files over 50 MB; consider attaching it to the release instead.` });
      }
      if (/\.(zip|7z)$/i.test(entry.name)) {
        issues.push({ level: 'warning', path: '', message: `"${path}" looks like a download. Mod downloads belong on the release, not in the repository.` });
      }
    }
  };
  await walk('');
}

interface Found {
  found: boolean;
  size: number;
  /** The same path with different capitals, when only that exists. */
  differentCase?: string;
}

/**
 * Finds a file by its exact path, capitals included. Windows does not care about capitals and GitHub does,
 * so "images/Card.png" on disk would load here and be missing on the website.
 */
async function findExact(dir: string, path: string): Promise<Found> {
  const parts = path.split('/');
  let current = dir;
  const actual: string[] = [];
  let caseDiffers = false;
  for (const part of parts) {
    let names: string[];
    try {
      names = await readdir(current);
    } catch {
      return { found: false, size: 0 };
    }
    const exact = names.find((n) => n === part);
    const loose = exact ?? names.find((n) => n.toLowerCase() === part.toLowerCase());
    if (!loose) return { found: false, size: 0 };
    if (!exact) caseDiffers = true;
    actual.push(loose);
    current = join(current, loose);
  }
  if (caseDiffers) return { found: false, size: 0, differentCase: actual.join('/') };
  try {
    const s = await stat(current);
    return s.isFile() ? { found: true, size: s.size } : { found: false, size: 0 };
  } catch {
    return { found: false, size: 0 };
  }
}

function missing(path: string, found: Found, what: string): Issue {
  return {
    level: 'error',
    path,
    message: found.differentCase
      ? `${what} is spelled "${found.differentCase}" on disk. GitHub cares about capitals, so the names must match exactly.`
      : `${what} is not in the mod's folder.`,
  };
}
