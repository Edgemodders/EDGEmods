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
   * Signs a new index.db from the index rebuild on the owner's runner (POST /api/v1/admin/index). Its own secret,
   * so the runner never holds the merge checks' one. Unset: the endpoint is off.
   */
  indexSecret?: string;
  /**
   * Shows releases that have no release check result yet. For a developer's PC only: on the live site, a release
   * shows once it has passed.
   */
  showUnchecked: boolean;
  /** How long a cached image is kept by browsers, in seconds. */
  imageMaxAge: number;
  /** Sign-in through Auth0. Unset: the website runs without accounts, and says so. */
  auth?: AuthConfig;
  /** What stops sign-in from working, as sentences: empty when it is on, or when nothing about it is set. */
  authProblems: string[];
  /** How downloads are served (docs/design.md, "Subscriptions and download speed"). */
  downloads: DownloadConfig;
  /** Admins' email addresses, lower case. An email counts only once Auth0 has verified it. */
  admins: string[];
}

export interface DownloadConfig {
  /**
   * `redirect` (a PC, and later subscribers): the browser is sent to the file on GitHub, at full speed. `nginx` (the
   * live server): nginx streams the file from GitHub at `freeSpeed`, through the internal location in
   * deploy/nginx/edgemods-downloads.conf.
   */
  mode: 'redirect' | 'nginx';
  /** The free download speed, in bytes a second (EDGEMODS_FREE_SPEED, in MB/s; 3 to start, the owner's to set). */
  freeSpeed: number;
  /** Raises GitHub's limit when asking it for a file's address (nginx mode): 5,000 an hour instead of 60. */
  githubToken?: string;
}

export interface AuthConfig {
  /** The tenant's domain, such as edgemods-dev.us.auth0.com (later login.edgemods.ai). */
  domain: string;
  /** The website application (a Regular Web Application). */
  clientId: string;
  clientSecret: string;
  /** The EDGEmods API's identifier, for the extension's tokens (R4). */
  audience?: string;
  /** The VS Code extension's Native application (docs/auth0-setup.md, step 9). With the audience, the API and
   *  downloads accept its access tokens. */
  extensionClientId?: string;
  /** The in-game browser's Native application, with the Device Code grant (docs/auth0-setup.md, step 10). With the
   *  audience, the API and downloads accept its access tokens too. */
  deviceClientId?: string;
  /** The Management API, for deleting accounts. Its domain is the tenant's own, even when sign-in uses a custom domain. */
  management?: { domain: string; clientId: string; clientSecret: string };
  /** Signs the short-lived cookie that carries a sign-in from /auth/signin to /auth/callback. */
  sessionSecret: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.EDGEMODS_DATA ?? 'data');
  // 8800: TheLostRealms uses 8787 and 8790 to 8794 on the same server.
  const port = Number(env.EDGEMODS_PORT ?? 8800);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`EDGEMODS_PORT is not a port: ${env.EDGEMODS_PORT}`);
  return {
    host: env.EDGEMODS_HOST ?? '127.0.0.1',
    port,
    dataDir,
    indexPath: resolve(env.EDGEMODS_INDEX ?? join(dataDir, 'index.db')),
    publicUrl: (env.EDGEMODS_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    checksSecret: env.EDGEMODS_CHECKS_SECRET || undefined,
    indexSecret: env.EDGEMODS_INDEX_SECRET || undefined,
    showUnchecked: env.EDGEMODS_SHOW_UNCHECKED === '1',
    imageMaxAge: 86400,
    ...authConfig(env),
    admins: (env.EDGEMODS_ADMINS ?? '').split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
    downloads: downloadConfig(env),
  };
}

function downloadConfig(env: NodeJS.ProcessEnv): DownloadConfig {
  const mode = env.EDGEMODS_DOWNLOADS ?? 'redirect';
  if (mode !== 'redirect' && mode !== 'nginx') throw new Error(`EDGEMODS_DOWNLOADS is redirect or nginx, not ${mode}`);
  const mbps = Number(env.EDGEMODS_FREE_SPEED ?? 3);
  if (!(mbps > 0 && mbps <= 1000)) throw new Error(`EDGEMODS_FREE_SPEED is MB a second, from 0.1 to 1000: ${env.EDGEMODS_FREE_SPEED}`);
  return { mode, freeSpeed: Math.round(mbps * 1024 * 1024), githubToken: env.EDGEMODS_GITHUB_TOKEN || undefined };
}

function authConfig(env: NodeJS.ProcessEnv): { auth?: AuthConfig; authProblems: string[] } {
  const get = (name: string): string => (env[name] ?? '').trim();
  const domain = get('EDGEMODS_AUTH0_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const needed = {
    EDGEMODS_AUTH0_DOMAIN: domain,
    EDGEMODS_AUTH0_CLIENT_ID: get('EDGEMODS_AUTH0_CLIENT_ID'),
    EDGEMODS_AUTH0_CLIENT_SECRET: get('EDGEMODS_AUTH0_CLIENT_SECRET'),
    EDGEMODS_SESSION_SECRET: get('EDGEMODS_SESSION_SECRET'),
  };
  const missing = Object.entries(needed).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length === Object.keys(needed).length) return { authProblems: [] };
  const problems = missing.map((k) => `${k} is not set, so sign-in is off.`);
  if (domain && !/^[a-z0-9.-]+$/i.test(domain)) problems.push('EDGEMODS_AUTH0_DOMAIN is not a domain name, so sign-in is off.');
  if (needed.EDGEMODS_SESSION_SECRET && needed.EDGEMODS_SESSION_SECRET.length < 32) problems.push('EDGEMODS_SESSION_SECRET is shorter than 32 characters, so sign-in is off.');
  if (problems.length) return { authProblems: problems };
  const mId = get('EDGEMODS_AUTH0_MANAGEMENT_CLIENT_ID');
  const mSecret = get('EDGEMODS_AUTH0_MANAGEMENT_CLIENT_SECRET');
  const mDomain = get('EDGEMODS_AUTH0_MANAGEMENT_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, '') || domain;
  return {
    auth: {
      domain,
      clientId: needed.EDGEMODS_AUTH0_CLIENT_ID,
      clientSecret: needed.EDGEMODS_AUTH0_CLIENT_SECRET,
      audience: get('EDGEMODS_AUTH0_AUDIENCE') || undefined,
      extensionClientId: (get('EDGEMODS_AUTH0_AUDIENCE') && get('EDGEMODS_AUTH0_EXTENSION_CLIENT_ID')) || undefined,
      deviceClientId: (get('EDGEMODS_AUTH0_AUDIENCE') && get('EDGEMODS_AUTH0_REDNODE_CLIENT_ID')) || undefined,
      management: mId && mSecret ? { domain: mDomain, clientId: mId, clientSecret: mSecret } : undefined,
      sessionSecret: needed.EDGEMODS_SESSION_SECRET,
    },
    authProblems: [
      ...(mId && mSecret ? [] : ['EDGEMODS_AUTH0_MANAGEMENT_CLIENT_ID or _SECRET is not set: sign-in works, deleting an account does not.']),
      // The Management API's address is always the tenant's own (….auth0.com), never a custom login domain.
      ...(mId && mSecret && !/\.auth0\.com$/i.test(mDomain)
        ? [`EDGEMODS_AUTH0_MANAGEMENT_DOMAIN is not the tenant's own domain (….auth0.com): with a custom login domain, set it, or deleting an account fails.`]
        : []),
      ...(get('EDGEMODS_AUTH0_EXTENSION_CLIENT_ID') && !get('EDGEMODS_AUTH0_AUDIENCE') ? ['EDGEMODS_AUTH0_EXTENSION_CLIENT_ID needs EDGEMODS_AUTH0_AUDIENCE, so VS Code sign-in is off.'] : []),
      ...(get('EDGEMODS_AUTH0_EXTENSION_CLIENT_ID') ? [] : ['EDGEMODS_AUTH0_EXTENSION_CLIENT_ID is not set: the website signs in, VS Code does not.']),
      ...(get('EDGEMODS_AUTH0_REDNODE_CLIENT_ID') && !get('EDGEMODS_AUTH0_AUDIENCE') ? ['EDGEMODS_AUTH0_REDNODE_CLIENT_ID needs EDGEMODS_AUTH0_AUDIENCE, so signing in from the game is off.'] : []),
    ],
  };
}
