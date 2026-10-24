// The website and API as an Express app. Pages are built here as HTML (the owner's choice, 2026-10-23: search
// engines and link previews read them as they are); a little JavaScript in /assets/site.js improves them.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { isVersion } from '@edgemodders/edgemods-format';
import { SORTS, type Catalog, type ModView, type Query, type Sort } from './catalog.js';
import type { Config } from './config.js';
import { html, type Html } from './html.js';
import type { ImageCache } from './images.js';
import { browsePage, defaultSort, homePage } from './pages/browse.js';
import { message, type PageContext, type Viewer } from './pages/layout.js';
import { MOD_TABS, modPage, type ModTab } from './pages/mod.js';
import { publishPage } from './pages/publish.js';
import { resolvePlan } from './plan.js';
import type { SiteStore } from './site-store.js';

export interface AppDeps {
  config: Config;
  catalog: Catalog;
  site: SiteStore;
  images: ImageCache;
  /** Who is signed in. Accounts arrive in R3c; until then everyone is a visitor. */
  viewer?: (req: Request) => Viewer | undefined;
}

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const require = createRequire(import.meta.url);
const FONTS = ['chakra-petch', 'rajdhani', 'jetbrains-mono'].map((name) => [name, join(dirname(require.resolve(`@fontsource/${name}/package.json`)), 'files')]);
const SCHEMA = require.resolve('@edgemodders/edgemods-format/schema');

/** Only the site's own files; no inline scripts or styles, no frames, no plugins. */
const CSP = [
  "default-src 'self'",
  "img-src 'self'",
  "style-src 'self'",
  "script-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function createApp(deps: AppDeps): express.Express {
  const { config, catalog, site, images } = deps;
  const viewerOf = deps.viewer ?? (() => undefined);
  const assetVersion = createHash('sha256')
    .update(readFileSync(join(PUBLIC, 'site.css')))
    .update(readFileSync(join(PUBLIC, 'site.js')))
    .digest('hex')
    .slice(0, 10);

  const app = express();
  app.disable('x-powered-by');
  // nginx on the same machine sets X-Forwarded-For and X-Forwarded-Proto; trust them from it only.
  app.set('trust proxy', 'loopback');
  app.set('query parser', 'simple');

  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    });
    next();
  });

  const ctxOf = (req: Request, q?: string): PageContext => ({
    publicUrl: config.publicUrl,
    assetVersion,
    viewer: viewerOf(req),
    path: req.originalUrl,
    q,
  });
  const send = (res: Response, body: Html, status = 200): void => {
    res.status(status).type('html').set('Cache-Control', 'no-cache').send(body.value);
  };

  // ---- files ----
  const longCache = { maxAge: '365d', immutable: true, index: false, fallthrough: false };
  app.use('/assets', express.static(PUBLIC, { maxAge: '1h', index: false }));
  for (const [name, dir] of FONTS) app.use(`/assets/fonts/${name}`, express.static(dir, longCache));
  app.get('/schema/edgemods-1.json', (_req, res) => {
    res.type('application/schema+json').set('Cache-Control', 'public, max-age=3600').sendFile(SCHEMA);
  });
  app.get('/healthz', (_req, res) => {
    const info = catalog.info();
    res.set('Cache-Control', 'no-store').json({ ok: true, mods: info.mods, indexBuiltAt: info.builtAt });
  });

  // ---- pages ----
  app.get('/', (req, res) => send(res, homePage(ctxOf(req), catalog)));

  app.get('/mods', (req, res) => {
    const query = parseQuery(req, Boolean(viewerOf(req)?.adult));
    send(res, browsePage(ctxOf(req, query.q), query, catalog.search(query)));
  });

  app.get('/publish', (req, res) => send(res, publishPage(ctxOf(req))));

  app.get('/signin', (req, res) => send(res, message(ctxOf(req), {
    title: 'Sign in',
    eyebrow: 'Accounts',
    heading: html`Sign in <span>soon</span>`,
    lede: 'Accounts are on their way: sign in with GitHub, Google or an email to download, like and install mods. Browsing needs no account.',
  })));

  const findMod = (req: Request, res: Response): ModView | undefined => {
    const m = catalog.mod(String(req.params.id));
    const viewer = viewerOf(req);
    if (!m) {
      send(res, notFound(ctxOf(req)), 404);
      return undefined;
    }
    if (m.adult && !viewer?.adult) {
      send(res, message(ctxOf(req), {
        title: 'Adult content',
        eyebrow: 'Adult content',
        heading: html`This mod is for <span>adults</span>`,
        lede: viewer ? 'Turn on adult mods in your settings to see it.' : 'Sign in, then turn on adult mods in your settings, to see it.',
        actions: viewer ? html`<a class="btn" href="/mods">Back to mods</a>` : html`<a class="btn go" href="/signin">Sign in</a><a class="btn" href="/mods">Back to mods</a>`,
      }), 403);
      return undefined;
    }
    return m;
  };

  app.get('/mods/:id', (req, res) => {
    const m = findMod(req, res);
    if (!m) return;
    const tab = (MOD_TABS as readonly string[]).includes(String(req.query.tab)) ? (req.query.tab as ModTab) : 'about';
    send(res, modPage(ctxOf(req), catalog, m, tab));
  });

  app.get('/mods/:id/images/*path', async (req, res) => {
    const path = (req.params as unknown as { path: string[] }).path.join('/');
    const found = catalog.image(String(req.params.id), path);
    const image = found && (await images.get(found.repo, found.ref, path));
    if (!image) {
      res.status(404).type('text').send('Not found');
      return;
    }
    res.set({
      'Content-Type': image.type,
      'Cache-Control': `public, max-age=${config.imageMaxAge}`,
      'Content-Security-Policy': "default-src 'none'",
    }).send(Buffer.from(image.bytes));
  });

  // Links in a mod's page that point into its repository. Visitors are asked to sign in (the soft gate).
  app.get('/mods/:id/source/*path', (req, res) => {
    const m = findMod(req, res);
    if (!m) return;
    const path = (req.params as unknown as { path: string[] }).path.map(encodeURIComponent).join('/');
    if (viewerOf(req)) {
      res.redirect(302, `https://github.com/${m.repo}/blob/${encodeURIComponent(m.shown.tag)}/${path}`);
      return;
    }
    send(res, message(ctxOf(req), {
      title: 'Sign in to see the source',
      eyebrow: m.name,
      heading: html`Sign in to see <span>the source</span>`,
      lede: 'This link opens a file in the mod\'s repository. Seeing where a mod comes from needs a free account.',
      actions: html`<a class="btn go" href="/signin">Sign in</a><a class="btn" href="/mods/${m.id}">Back to ${m.name}</a>`,
    }), 403);
  });

  // ---- API ----
  app.get('/api/v1/mods', (req, res) => {
    const query = parseQuery(req, Boolean(viewerOf(req)?.adult));
    res.set('Cache-Control', 'no-cache').json(catalog.search(query));
  });

  app.get('/api/v1/mods/:id', (req, res) => {
    const m = catalog.mod(String(req.params.id));
    const viewer = viewerOf(req);
    if (!m || (m.adult && !viewer?.adult)) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    res.set('Cache-Control', 'no-cache').json(viewer ? m : forVisitors(m));
  });

  app.get('/api/v1/mods/:id/install-plan', (req, res) => {
    const viewer = viewerOf(req);
    const version = typeof req.query.version === 'string' && isVersion(req.query.version) ? req.query.version : undefined;
    const files = list(req.query.files, 50, 128);
    const plan = resolvePlan(
      (id) => {
        const m = catalog.releasesOf(id);
        return m && (!m.adult || viewer?.adult) ? m : undefined;
      },
      { mod: String(req.params.id), version, files },
      // Download links only for people who are signed in, like any download.
      viewer ? (mod, v, file) => `${config.publicUrl}/download/${encodeURIComponent(mod)}/${encodeURIComponent(v)}/${encodeURIComponent(file)}` : undefined,
    );
    res.set('Cache-Control', 'no-cache').status(plan.mods.length ? 200 : 404).json(plan);
  });

  // Release check results from EDGEmods' own workflows, signed with the shared secret (docs/design.md,
  // "Where an update is checked"). A release shows on the website once a passing result is recorded.
  app.post('/api/v1/checks', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
    if (!config.checksSecret) {
      res.status(503).json({ error: 'not-configured' });
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!signatureOk(config.checksSecret, body, req.get('x-edgemods-signature'))) {
      res.status(401).json({ error: 'bad-signature' });
      return;
    }
    let result: any;
    try {
      result = JSON.parse(body.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'not-json' });
      return;
    }
    if (typeof result?.mod !== 'string' || typeof result.version !== 'string' || !isVersion(result.version) || typeof result.ok !== 'boolean'
      || !Array.isArray(result.downloads)) {
      res.status(400).json({ error: 'bad-result' });
      return;
    }
    const checkedAt = typeof result.checkedAt === 'string' && !Number.isNaN(Date.parse(result.checkedAt)) ? new Date(result.checkedAt).toISOString() : new Date().toISOString();
    site.recordCheck({ mod: result.mod, version: result.version, ok: result.ok, checkedAt, downloads: result.downloads, report: result.steps ?? [] });
    res.status(204).end();
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not-found' });
  });

  app.use((req, res) => send(res, notFound(ctxOf(req)), 404));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error(`${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) {
      res.status(500).json({ error: 'server' });
      return;
    }
    send(res, message(ctxOf(req), { title: 'Something went wrong', eyebrow: 'Error', heading: html`Something went <span>wrong</span>`, lede: 'The page could not be built. Try again in a moment.' }), 500);
  });

  return app;
}

function notFound(ctx: PageContext): Html {
  return message(ctx, { title: 'Not found', eyebrow: '404', heading: html`Nothing <span>here</span>`, lede: 'This page or mod is not on EDGEmods. It may have been removed, or it is waiting for its checks.' });
}

/** A mod as a visitor may see it: nothing that gives the repository away. */
function forVisitors(m: ModView): Omit<ModView, 'ownerLogin' | 'repo'> {
  const { ownerLogin: _o, repo: _r, ...rest } = m;
  const strip = (r: ModView['shown']) => ({ ...r, files: r.files.map(({ url: _u, assetId: _a, ...f }) => f) as ModView['shown']['files'] });
  return { ...rest, shown: strip(m.shown), releases: m.releases.map(strip) };
}

function parseQuery(req: Request, adult: boolean): Query {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
  const wanted = String(req.query.sort ?? '');
  const sort = (SORTS as readonly string[]).includes(wanted) && (wanted !== 'relevance' || q.trim()) ? (wanted as Sort) : defaultSort({ q });
  const page = Math.min(1000, Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1));
  return { q, type: list(req.query.type, 13, 40), tag: list(req.query.tag, 10, 40), needs: list(req.query.needs, 10, 100), nocode: req.query.nocode === '1', sort, page, adult };
}

/** A repeated query parameter as a list of distinct strings, bounded in count and length. */
function list(value: unknown, max: number, maxLength: number): string[] {
  const items = (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= maxLength);
  return [...new Set(items)].slice(0, max);
}

function signatureOk(secret: string, body: Buffer, header: string | undefined): boolean {
  const match = /^sha256=([0-9a-f]{64})$/.exec(header ?? '');
  if (!match) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(match[1], 'hex'));
}
