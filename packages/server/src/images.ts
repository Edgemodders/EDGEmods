// Mod images, served by EDGEmods from its own cache (docs/design.md, "Images"): the page never points at GitHub,
// so it does not give the repository away, and the website stays fast when GitHub is slow. Only paths the index
// lists for a mod are fetched, at the release's tag, and a file is kept only if its bytes are a PNG, JPEG or WebP
// image of an allowed size, so the cache cannot be used to serve anything else.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS, readImageInfo, type ImageFormat } from '@edgemodders/edgemods-format';

export const IMAGE_TYPES: Record<ImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

export interface CachedImage {
  bytes: Uint8Array;
  type: string;
}

export class ImageCache {
  private readonly pending = new Map<string, Promise<CachedImage | undefined>>();

  constructor(readonly dir: string, private readonly fetchFn: typeof fetch = fetch, private readonly timeoutMs = 15000) {}

  /** The image at a repository's tag, from the cache or GitHub; undefined if it is not a usable image. */
  get(repo: string, ref: string, path: string): Promise<CachedImage | undefined> {
    const key = createHash('sha256').update(`${repo}\n${ref}\n${path}`).digest('hex');
    let job = this.pending.get(key);
    if (!job) {
      job = this.load(key, repo, ref, path).finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    return job;
  }

  private async load(key: string, repo: string, ref: string, path: string): Promise<CachedImage | undefined> {
    const file = join(this.dir, key.slice(0, 2), key);
    const cached = await readFile(file).catch(() => undefined);
    if (cached) return check(cached);

    const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' }).catch(() => undefined);
    if (!res?.ok || !res.body) return undefined;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > LIMITS.imageBytes) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const image = check(bytes);
    if (!image) return undefined;
    await mkdir(join(this.dir, key.slice(0, 2)), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, file).catch(() => undefined);
    return image;
  }
}

function check(bytes: Uint8Array): CachedImage | undefined {
  if (bytes.length === 0 || bytes.length > LIMITS.imageBytes) return undefined;
  const info = readImageInfo(bytes);
  return info ? { bytes, type: IMAGE_TYPES[info.format] } : undefined;
}
