// How a download is served (docs/design.md, "Subscriptions and download speed"). The service never handles a file's
// bytes. On a PC, and later for subscribers, the browser is sent to the file on GitHub. On the live server, the
// service asks GitHub for the file's short-lived signed address and hands it to nginx with X-Accel-Redirect; nginx
// fetches it and passes it on at the free speed (deploy/nginx/edgemods-downloads.conf). nginx does not follow
// redirects, which is why the service asks for the signed address first.

import type { Fetch } from './auth0.js';
import type { DownloadConfig } from './config.js';

/** Where nginx's internal location starts; the file host and path follow. */
export const NGINX_PREFIX = '/_edgemods/github/';
/** The hosts GitHub serves release files from. Anything else is refused, so nginx only ever fetches from GitHub. */
export const FILE_HOSTS = ['objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

export interface DownloadFile {
  repo: string;
  tag: string;
  name: string;
  assetId: number;
  url?: string;
}

export type Serve =
  | { kind: 'redirect'; location: string }
  | { kind: 'nginx'; accelRedirect: string; limitRate: number; filename: string };

/** GitHub's own download address for a release file. */
export function githubUrl(f: DownloadFile): string {
  return f.url ?? `https://github.com/${f.repo}/releases/download/${encodeURIComponent(f.tag)}/${encodeURIComponent(f.name)}`;
}

export async function serveDownload(config: DownloadConfig, f: DownloadFile, fetchFn: Fetch = fetch): Promise<Serve> {
  if (config.mode === 'redirect') return { kind: 'redirect', location: githubUrl(f) };
  const res = await fetchFn(`https://api.github.com/repos/${f.repo}/releases/assets/${f.assetId}`, {
    headers: {
      accept: 'application/octet-stream',
      'user-agent': 'EDGEmods',
      'x-github-api-version': '2022-11-28',
      ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {}),
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  const location = res.headers.get('location');
  if (res.status !== 302 || !location) throw new Error(`GitHub gave no address for ${f.repo} asset ${f.assetId} (HTTP ${res.status})`);
  const url = new URL(location);
  if (url.protocol !== 'https:' || !FILE_HOSTS.includes(url.hostname)) throw new Error(`GitHub's address is on an unexpected host: ${url.hostname}`);
  return { kind: 'nginx', accelRedirect: `${NGINX_PREFIX}${url.hostname}${url.pathname}${url.search}`, limitRate: config.freeSpeed, filename: f.name };
}
