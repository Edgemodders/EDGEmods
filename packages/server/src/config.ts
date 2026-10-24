// The service's settings, from the environment (on the server: /etc/edgemods.env). Every setting has a default
// that runs on a developer's PC.

import { join, resolve } from 'node:path';

export interface Config {
  /** The address to listen on. 127.0.0.1 behind nginx. */
  host: string;
  port: number;
  /** site.db and the image cache. */
  dataDir: string;
  /** index.db, built by packages/indexer. */
  indexPath: string;
  /** The site's own address, for links in pages and feeds. */
  publicUrl: string;
  /** Signs the release check results EDGEmods' workflow sends (POST /api/v1/checks). Unset: the endpoint is off. */
  checksSecret?: string;
  /**
   * Shows releases that have no release check result yet. For a developer's PC only: on the live site, a release
   * shows once it has passed.
   */
  showUnchecked: boolean;
  /** How long a cached image is kept by browsers, in seconds. */
  imageMaxAge: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.EDGEMODS_DATA ?? 'data');
  const port = Number(env.EDGEMODS_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`EDGEMODS_PORT is not a port: ${env.EDGEMODS_PORT}`);
  return {
    host: env.EDGEMODS_HOST ?? '127.0.0.1',
    port,
    dataDir,
    indexPath: resolve(env.EDGEMODS_INDEX ?? join(dataDir, 'index.db')),
    publicUrl: (env.EDGEMODS_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    checksSecret: env.EDGEMODS_CHECKS_SECRET || undefined,
    showUnchecked: env.EDGEMODS_SHOW_UNCHECKED === '1',
    imageMaxAge: 86400,
  };
}
