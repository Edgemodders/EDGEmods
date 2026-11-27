// The website and API as an Express app. Pages are built here as HTML (the owner's choice, 2026-10-23: search
// engines and link previews read them as they are); a little JavaScript in /assets/site.js improves them.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createWriteStream, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { isVersion } from '@edgemodders/edgemods-format';
import { Accounts, methodOf, safeReturn, sameOrigin, signedInFrom } from './accounts.js';
import { CONNECTIONS, type Fetch, type Method } from './auth0.js';
import { serveDownload } from './downloads.js';
import { ADMIN_NOTES, ADMIN_TABS, adminPage, type AdminNote, type AdminTab } from './pages/admin.js';
import { githubRepo, githubUser } from './github-lookup.js';
import { REPORT_REASONS, type ReportReason, type User } from './site-store.js';
import { HOLD_MS, USERNAME_PROBLEMS, Usernames } from './usernames.js';
import { SORTS, type Catalog, type ModView, type Query, type Sort } from './catalog.js';
import type { Config } from './config.js';
import { html, type Html } from './html.js';
import type { ImageCache } from './images.js';
import { ACCOUNT_TABS, accountPage, deletedPage, NOTES, signInPage, welcomePage, type AccountTab, type Note } from './pages/account.js';
import { browsePage, defaultSort, homePage } from './pages/browse.js';
import { message, type PageContext, type Viewer } from './pages/layout.js';
import { MOD_TABS, modPage, type ModTab } from './pages/mod.js';
import { publishPage } from './pages/publish.js';
import { privacyPage, termsPage } from './pages/legal.js';
import { resolvePlan } from './plan.js';
import type { SiteStore } from './site-store.js';

export interface AppDeps {
  config: Config;
  catalog: Catalog;
  site: SiteStore;
  images: ImageCache;
  /** Sign-in and sessions. Without it, or with sign-in off, everyone is a visitor. */
  accounts?: Accounts;
  /** For tests of pages: who is signed in, instead of a session. */
  viewer?: (req: Request) => Viewer | undefined;
  /** For tests: stands in for GitHub when asking for a file's address (nginx downloads). */
  githubFetch?: Fetch;
}

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const require = createRequire(import.meta.url);
const FONTS = ['chakra-petch', 'rajdhani', 'jetbrains-mono'].map((name) => [name, join(dirname(require.resolve(`@fontsource/${name}/package.json`)), 'files')]);
const SCHEMA = require.resolve('@edgemodders/edgemods-format/schema');

/** Only the site's own files; no inline scripts or styles, no frames, no plugins. Forms post to this site, and
 *  Sign out's form ends at the Auth0 tenant (browsers apply form-action to the redirect after a form). */
const csp = (signInDomain?: string): string => [
  "default-src 'self'",
  "img-src 'self'",
  "style-src 'self'",
  "script-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  signInDomain ? `form-action 'self' https://${signInDomain}` : "form-action 'self'",
].join('; ');

export function createApp(deps: AppDeps): express.Express {
  const { config, catalog, site, images } = deps;
  const accounts = deps.accounts ?? new Accounts(config, site);
  const auth0 = accounts.auth0;
  const viewerOf = deps.viewer ?? ((req: Request) => accounts.viewerOf(req));
  const CSP = csp(auth0?.config.domain);
  const usernames = new Usernames(site, (key) => catalog.modderId(key));
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

  // The VS Code extension's access token, on the API and downloads only; pages go by the cookie.
  app.use(async (req, res, next) => {
    if (!/^\/(api|download)\//.test(req.path)) return next();
    const problem = await accounts.acceptToken(req);
    if (!problem) return next();
    res.status(problem.status).set('Cache-Control', 'no-store');
    if (problem.status === 401) res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
    res.json({ error: problem.error });
  });

  // Someone signed in without a username picks one first; pages only, so files, the API and sign-out still work.
  // The extension asks for one in VS Code, so a download through a token answers with what is missing.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || /^\/(assets|auth|api|welcome|schema|healthz)(\/|$)/.test(req.path) || /^\/mods\/[^/]+\/images\//.test(req.path)) return next();
    const user = accounts.userOf(req);
    if (user && !user.username) {
      if (accounts.viaToken(req)) {
        res.status(403).set('Cache-Control', 'no-store').json({ error: 'username' });
        return;
      }
      res.redirect(303, `/welcome?return=${encodeURIComponent(safeReturn(req.originalUrl))}`);
      return;
    }
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
  // The VS Code extension's tabs use the site's stylesheet and fonts; fonts from another origin need CORS.
  app.use('/assets', (_req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    next();
  });
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
  app.get('/privacy', (req, res) => send(res, privacyPage(ctxOf(req))));
  app.get('/terms', (req, res) => send(res, termsPage(ctxOf(req))));

  // ---- accounts ----
  const form = express.urlencoded({ extended: false, limit: '10kb', parameterLimit: 20 });
  const field = (req: Request, name: string): string => (typeof req.body?.[name] === 'string' ? req.body[name] : '');
  const noStore = (res: Response): void => {
    res.set('Cache-Control', 'no-store');
  };
  /** Writes through the cookie must come from EDGEmods' own pages (a token carries no cookie, so it may write from
   *  anywhere). True when the request was refused. */
  const refuse = (req: Request, res: Response): boolean => {
    if (accounts.viaToken(req) || sameOrigin(req, config.publicUrl)) return false;
    if (req.accepts(['html', 'json']) === 'json') res.status(403).json({ error: 'cross-site' });
    else send(res, message(ctxOf(req), { title: 'Refused', eyebrow: 'Accounts', heading: html`Not from <span>here</span>`, lede: 'That request did not come from an EDGEmods page, so it was refused.' }), 403);
    return true;
  };

  app.get('/signin', (req, res) => {
    if (viewerOf(req)) {
      res.redirect(303, safeReturn(req.query.return));
      return;
    }
    send(res, signInPage(ctxOf(req), safeReturn(req.query.return), accounts.on));
  });

  app.get('/auth/signin', (req, res) => {
    if (!auth0) {
      send(res, signInPage(ctxOf(req), '/', false), 503);
      return;
    }
    const method = Object.keys(CONNECTIONS).includes(String(req.query.method)) ? (req.query.method as Method) : undefined;
    const start = auth0.start(method);
    noStore(res);
    res.append('Set-Cookie', accounts.pendingCookie({ state: start.state, nonce: start.nonce, verifier: start.verifier, returnTo: safeReturn(req.query.return), until: Date.now() + 600_000 }));
    res.redirect(302, start.url);
  });

  app.get('/auth/callback', async (req, res) => {
    noStore(res);
    const fail = (lede: string, status = 400): void => send(res, message(ctxOf(req), {
      title: 'Sign-in did not finish', eyebrow: 'Accounts', heading: html`Sign-in did not <span>finish</span>`, lede,
      actions: html`<a class="btn go" href="/signin">Try again</a><a class="btn" href="/mods">Browse mods</a>`,
    }), status);
    if (!auth0) return fail('Sign-in is not set up on this server.', 503);
    const pending = accounts.pendingOf(req);
    res.append('Set-Cookie', accounts.clearPendingCookie());
    if (typeof req.query.error === 'string') {
      return fail(req.query.error === 'access_denied' ? 'The sign-in was cancelled, or the account did not let EDGEmods in.' : 'Auth0 could not sign you in. Try again in a moment.');
    }
    if (!pending || typeof req.query.state !== 'string' || req.query.state !== pending.state || typeof req.query.code !== 'string' || !req.query.code) {
      return fail('This sign-in has expired or was started in another window. Start again.');
    }
    let claims;
    try {
      claims = await auth0.finish(req.query.code, pending.verifier, pending.nonce);
    } catch (err) {
      console.error(`sign-in refused: ${err instanceof Error ? err.message : err}`);
      return fail('Auth0\'s answer could not be checked, so you are not signed in. Try again in a moment.', 502);
    }
    const user = site.upsertUser(signedInFrom(claims));
    if (user.status === 'blocked' || (user.githubId !== undefined && site.isBlocked('github', user.githubId))) return fail('This account is blocked on EDGEmods.', 403);
    res.append('Set-Cookie', accounts.startSession(user.id));
    res.redirect(303, pending.returnTo);
  });

  // The VS Code extension's sign-in comes back here (its Auth0 callback), and this page hands it on to the editor
  // that started it: a page in the browser that says what happened, rather than Auth0's. The state starts with the
  // editor's link scheme (vscode, cursor, …), only from the list below; the code is useless without the verifier only
  // the extension holds (PKCE).
  app.get('/auth/vscode', (req, res) => {
    noStore(res);
    res.set('Referrer-Policy', 'no-referrer');
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const scheme = /^([a-z][a-z0-9-]{1,30})\.[A-Za-z0-9_-]{16,128}$/.exec(state)?.[1];
    if (!scheme || !EDITOR_SCHEMES.includes(scheme)) {
      return send(res, message(ctxOf(req), {
        title: 'Not a VS Code sign-in', eyebrow: 'Accounts', heading: html`Not a VS Code <span>sign-in</span>`,
        lede: 'This address finishes a sign-in started in VS Code, and this one did not come from there. Start the sign-in again from VS Code.',
      }), 400);
    }
    const back = new URLSearchParams();
    const code = typeof req.query.code === 'string' && /^[A-Za-z0-9._~-]{1,512}$/.test(req.query.code) ? req.query.code : undefined;
    const error = typeof req.query.error === 'string' && /^[a-z_]{1,64}$/.test(req.query.error) ? req.query.error : undefined;
    if (code) back.set('code', code);
    if (error || !code) back.set('error', error ?? 'no_code');
    back.set('state', state);
    // Not send(): its no-cache would let a browser keep the page, and the code in it, for later.
    res.type('html').set('Cache-Control', 'no-store')
      .send(handoffPage(ctxOf(req), `${scheme}://edgemodders.edgemods/auth?${back}`, error === undefined && code !== undefined).value);
  });

  app.post('/auth/signout', (req, res) => {
    if (refuse(req, res)) return;
    noStore(res);
    res.append('Set-Cookie', accounts.endSession(req));
    // End the Auth0 session too, so the next sign-in can choose another account.
    res.redirect(303, auth0 ? auth0.logoutUrl(`${config.publicUrl}/`) : '/');
  });

  /** The signed-in person for an account page or action; anyone else is sent to sign in. */
  const signedIn = (req: Request, res: Response) => {
    const user = accounts.userOf(req);
    if (!user) res.redirect(303, `/signin?return=${encodeURIComponent(req.method === 'GET' ? req.originalUrl : '/me')}`);
    return user;
  };
  const backTo = (res: Response, tab: AccountTab, note: Note): void => {
    res.redirect(303, `/me?tab=${tab}&note=${note}`);
  };

  app.get('/me', (req, res) => {
    const user = signedIn(req, res);
    if (!user) return;
    noStore(res);
    const tab = (ACCOUNT_TABS as readonly string[]).includes(String(req.query.tab)) ? (req.query.tab as AccountTab) : 'profile';
    const note = Object.keys(NOTES).includes(String(req.query.note)) ? (req.query.note as Note) : undefined;
    send(res, accountPage(ctxOf(req), tab, {
      user, method: methodOf(user.id), admin: accounts.isAdmin(user), note,
      nextChange: usernames.nextChange(user),
      liked: catalog.likedBy(user.id, user.adult),
      downloaded: catalog.downloadedBy(user.id),
      mine: user.githubId ? catalog.ownedBy(user.githubId) : [],
      canDelete: Boolean(auth0?.canManage),
    }));
  });

  app.get('/welcome', (req, res) => {
    const user = signedIn(req, res);
    if (!user) return;
    const returnTo = safeReturn(req.query.return);
    if (user.username) {
      res.redirect(303, returnTo);
      return;
    }
    noStore(res);
    send(res, welcomePage(ctxOf(req), { value: usernames.suggest(user), returnTo }));
  });

  app.post('/welcome', form, (req, res) => {
    if (refuse(req, res)) return;
    const user = signedIn(req, res);
    if (!user) return;
    const returnTo = safeReturn(field(req, 'return'));
    const wanted = field(req, 'username').trim();
    const problem = user.username ? undefined : usernames.claim(wanted, user);
    if (problem) {
      noStore(res);
      send(res, welcomePage(ctxOf(req), { value: wanted.slice(0, 40), returnTo, problem }), 400);
      return;
    }
    res.redirect(303, returnTo);
  });

  app.post('/me/username', form, (req, res) => {
    if (refuse(req, res)) return;
    const user = signedIn(req, res);
    if (!user) return;
    const problem = usernames.claim(field(req, 'username').trim(), user);
    backTo(res, 'profile', problem ? `username-${problem}` : 'username');
  });

  app.post('/me/settings', form, (req, res) => {
    if (refuse(req, res)) return;
    const user = signedIn(req, res);
    if (!user) return;
    site.setAdult(user.id, field(req, 'adult') === '1');
    backTo(res, 'settings', 'settings');
  });

  app.post('/me/password', form, async (req, res) => {
    if (refuse(req, res)) return;
    const user = signedIn(req, res);
    if (!user) return;
    if (!auth0 || methodOf(user.id) !== 'email' || !user.email) return backTo(res, 'profile', 'password-failed');
    try {
      await auth0.sendPasswordReset(user.email);
      backTo(res, 'profile', 'password');
    } catch (err) {
      console.error(`password email: ${err instanceof Error ? err.message : err}`);
      backTo(res, 'profile', 'password-failed');
    }
  });

  app.get('/me/data', (req, res) => {
    const user = signedIn(req, res);
    if (!user) return;
    noStore(res);
    res.attachment('edgemods-my-data.json').type('application/json').send(JSON.stringify(site.dataOf(user.id), null, 2));
  });

  // Deletes the Auth0 account first: if that fails, nothing is removed here either. (R3f: cancel the Stripe
  // subscription before both.)
  app.post('/me/delete', form, async (req, res) => {
    if (refuse(req, res)) return;
    const user = signedIn(req, res);
    if (!user) return;
    if (field(req, 'confirm') !== '1') return backTo(res, 'profile', 'delete-confirm');
    if (!auth0?.canManage) return backTo(res, 'profile', 'delete-failed');
    try {
      await auth0.deleteUser(user.id);
    } catch (err) {
      console.error(`delete account: ${err instanceof Error ? err.message : err}`);
      return backTo(res, 'profile', 'delete-failed');
    }
    site.deleteUser(user.id, HOLD_MS);
    noStore(res);
    res.append('Set-Cookie', accounts.endSession(req));
    send(res, deletedPage({ ...ctxOf(req), viewer: undefined }));
  });

  // Likes: a form on cards and mod pages; site.js sends the same form and asks for JSON.
  app.post('/mods/:id/like', form, (req, res) => {
    if (refuse(req, res)) return;
    const wantsJson = req.accepts(['html', 'json']) === 'json';
    const user = accounts.userOf(req);
    if (!user) {
      if (wantsJson) res.status(401).json({ error: 'sign-in' });
      else res.redirect(303, `/signin?return=${encodeURIComponent(safeReturn(field(req, 'return')))}`);
      return;
    }
    const m = catalog.mod(String(req.params.id));
    if (!m || (m.adult && !user.adult)) {
      if (wantsJson) res.status(404).json({ error: 'not-found' });
      else send(res, notFound(ctxOf(req)), 404);
      return;
    }
    const liked = field(req, 'like') !== '0';
    site.setLike(user.id, m.id, liked);
    if (wantsJson) res.set('Cache-Control', 'no-store').json({ liked, likes: site.likeCount(m.id) });
    else res.redirect(303, safeReturn(field(req, 'return')));
  });

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
    const reported = req.query.reported === '1' ? 'sent' : req.query.reported === 'already' ? 'already' : undefined;
    send(res, modPage(ctxOf(req), catalog, m, tab, reported));
  });

  // A signed-in player reports a mod to the admins; one open report per person and mod.
  app.post('/mods/:id/report', form, (req, res) => {
    if (refuse(req, res)) return;
    const user = accounts.userOf(req);
    if (!user) {
      res.redirect(303, `/signin?return=${encodeURIComponent(`/mods/${encodeURIComponent(String(req.params.id))}`)}`);
      return;
    }
    const m = catalog.mod(String(req.params.id));
    const reason = field(req, 'reason');
    if (!m || (m.adult && !user.adult) || !(reason in REPORT_REASONS)) {
      send(res, notFound(ctxOf(req)), 404);
      return;
    }
    const note = field(req, 'note').replace(/[^\P{C}\n]/gu, '').trim().slice(0, 1000);
    const sent = site.report(user.id, m.id, reason as ReportReason, note);
    res.redirect(303, `/mods/${encodeURIComponent(m.id)}?reported=${sent ? '1' : 'already'}`);
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

  // ---- admin (R3d: the overview and the log; the rest is R3e) ----
  /** The signed-in admin, or undefined after answering: sign in, or "admins only". */
  const adminOf = (req: Request, res: Response) => {
    const user = signedIn(req, res);
    if (!user) return undefined;
    if (accounts.isAdmin(user)) return user;
    send(res, message(ctxOf(req), {
      title: 'Admins only', eyebrow: 'Admin', heading: html`Admins <span>only</span>`,
      lede: 'This page is for EDGEmods admins: the verified email addresses in the server\'s settings.',
    }), 403);
    return undefined;
  };

  app.get('/admin', (req, res) => {
    const user = adminOf(req, res);
    if (!user) return;
    noStore(res);
    const tab = (ADMIN_TABS as readonly string[]).includes(String(req.query.tab)) ? (req.query.tab as AdminTab) : 'overview';
    const note = Object.keys(ADMIN_NOTES).includes(String(req.query.note)) ? (req.query.note as AdminNote) : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const reports = site.reports('all');
    send(res, adminPage(ctxOf(req), {
      tab, q, note, me: user.id,
      totals: site.totals(), mods: catalog.info().mods, downloads: config.downloads,
      spot: catalog.spotReviews(),
      modList: catalog.adminMods(tab === 'mods' ? q : ''),
      users: site.adminUsers(tab === 'users' ? q : ''),
      reports,
      names: new Map(reports.map((r) => [r.modId, catalog.indexed(r.modId)?.name ?? r.modId])),
      blocklist: site.blocklist(),
      audit: site.auditLog(),
    }));
  });

  /** Who an admin is in the log: their username, or their user id. */
  const who = (u: User): string => u.username ?? u.id;
  const reasonOf = (req: Request): string => field(req, 'reason').replace(/\p{C}/gu, '').trim().slice(0, 300);
  const backToAdmin = (res: Response, tab: AdminTab, note: AdminNote): void => {
    res.redirect(303, `/admin?tab=${tab}&note=${note}`);
  };

  // A mod: hide, block, show again, the adult flag, block its GitHub account or repository, or mark a release reviewed.
  app.post('/admin/mods/:id', form, (req, res) => {
    if (refuse(req, res)) return;
    const user = adminOf(req, res);
    if (!user) return;
    const m = catalog.indexed(String(req.params.id));
    if (!m) return backToAdmin(res, 'mods', 'unknown');
    const by = who(user);
    const reason = reasonOf(req);
    switch (field(req, 'action')) {
      case 'hide':
        site.setModeration(m.id, 'hidden', by, reason);
        site.log(by, 'Hid a mod', `${m.id}${reason ? `: ${reason}` : ''}`);
        return backToAdmin(res, 'mods', 'hidden');
      case 'block':
        site.setModeration(m.id, 'blocked', by, reason);
        site.log(by, 'Blocked a mod', `${m.id}${reason ? `: ${reason}` : ''}`);
        return backToAdmin(res, 'mods', 'blocked');
      case 'show':
        site.setModeration(m.id, 'visible', by, reason);
        site.log(by, 'Showed a mod again', m.id);
        return backToAdmin(res, 'mods', 'shown');
      case 'adult-yes':
      case 'adult-no':
      case 'adult-auto': {
        const value = { 'adult-yes': true, 'adult-no': false, 'adult-auto': undefined }[field(req, 'action') as 'adult-yes'];
        site.setAdultOverride(m.id, value, by);
        site.log(by, 'Changed a mod\'s adult flag', `${m.id}: ${value === undefined ? 'as the modder says' : value ? '18+' : 'not 18+'}`);
        return backToAdmin(res, 'mods', 'adult');
      }
      case 'block-github':
        site.block('github', m.ownerId, m.ownerLogin, by, reason);
        site.log(by, 'Blocked a GitHub account', `${m.ownerLogin} (id ${m.ownerId}), from ${m.id}${reason ? `: ${reason}` : ''}`);
        return backToAdmin(res, 'mods', 'github-blocked');
      case 'block-repo':
        site.block('repo', m.repoId, m.repo, by, reason);
        site.log(by, 'Blocked a repository', `${m.repo} (id ${m.repoId})${reason ? `: ${reason}` : ''}`);
        return backToAdmin(res, 'mods', 'repo-blocked');
      case 'reviewed': {
        const version = field(req, 'version');
        if (!isVersion(version)) return backToAdmin(res, 'overview', 'unknown');
        site.markReviewed(m.id, version, by);
        site.log(by, 'Reviewed a release', `${m.id} ${version}`);
        return backToAdmin(res, 'overview', 'reviewed');
      }
      default:
        return backToAdmin(res, 'mods', 'unknown');
    }
  });

  // An EDGEmods account: block (signed out everywhere, sign-in refused) or unblock. Never your own.
  app.post('/admin/users/:id', form, (req, res) => {
    if (refuse(req, res)) return;
    const user = adminOf(req, res);
    if (!user) return;
    const target = site.user(String(req.params.id));
    if (!target) return backToAdmin(res, 'users', 'unknown');
    const by = who(user);
    const action = field(req, 'action');
    if (action === 'block') {
      if (target.id === user.id) return backToAdmin(res, 'users', 'not-yourself');
      const reason = reasonOf(req);
      site.setStatus(target.id, 'blocked', by, reason);
      site.log(by, 'Blocked an account', `${target.username ?? target.id}${reason ? `: ${reason}` : ''}`);
      return backToAdmin(res, 'users', 'user-blocked');
    }
    if (action === 'unblock') {
      site.setStatus(target.id, 'active', by);
      site.log(by, 'Unblocked an account', target.username ?? target.id);
      return backToAdmin(res, 'users', 'user-unblocked');
    }
    backToAdmin(res, 'users', 'unknown');
  });

  // The blocklist: add a GitHub account or repository by name (GitHub gives its id), or take one off.
  app.post('/admin/blocklist', form, async (req, res) => {
    if (refuse(req, res)) return;
    const user = adminOf(req, res);
    if (!user) return;
    const by = who(user);
    const kind = field(req, 'kind');
    if (kind !== 'github' && kind !== 'repo') return backToAdmin(res, 'blocklist', 'unknown');
    if (field(req, 'action') === 'remove') {
      const value = field(req, 'value');
      if (!site.unblock(kind, value)) return backToAdmin(res, 'blocklist', 'unknown');
      site.log(by, kind === 'github' ? 'Unblocked a GitHub account' : 'Unblocked a repository', `id ${value}`);
      return backToAdmin(res, 'blocklist', 'unblocked');
    }
    const name = field(req, 'name').trim();
    const reason = reasonOf(req);
    let found: { id: number; label: string } | undefined;
    try {
      const token = config.downloads.githubToken;
      if (kind === 'github') {
        const u = await githubUser(name, deps.githubFetch, token);
        found = u && { id: u.id, label: u.login };
      } else {
        const r = await githubRepo(name, deps.githubFetch, token);
        found = r && { id: r.id, label: r.fullName };
      }
    } catch (err) {
      console.error(`blocklist lookup ${name}: ${err instanceof Error ? err.message : err}`);
      return backToAdmin(res, 'blocklist', 'github-down');
    }
    if (!found) return backToAdmin(res, 'blocklist', 'not-found');
    site.block(kind, found.id, found.label, by, reason);
    site.log(by, kind === 'github' ? 'Blocked a GitHub account' : 'Blocked a repository', `${found.label} (id ${found.id})${reason ? `: ${reason}` : ''}`);
    backToAdmin(res, 'blocklist', kind === 'github' ? 'github-blocked' : 'repo-blocked');
  });

  app.post('/admin/reports/:id', form, (req, res) => {
    if (refuse(req, res)) return;
    const user = adminOf(req, res);
    if (!user) return;
    const id = Number(req.params.id);
    const note = field(req, 'note').replace(/\p{C}/gu, '').trim().slice(0, 500);
    const closed = field(req, 'action') === 'close' && Number.isInteger(id) ? site.closeReport(id, who(user), note) : undefined;
    if (!closed) return backToAdmin(res, 'reports', 'unknown');
    site.log(who(user), 'Closed a report', `#${id} on ${closed.modId}${note ? `: ${note}` : ''}`);
    backToAdmin(res, 'reports', 'closed');
  });

  // Every download, from the website or (R4) the extension, comes through here: it needs a sign-in, counts the download
  // once per person, file and day, and serves the file (src/downloads.ts). Only files of releases that show.
  app.get('/download/:id/:version/:file', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    const id = String(req.params.id);
    const user = accounts.userOf(req);
    if (!user) {
      res.redirect(303, `/signin?return=${encodeURIComponent(`/mods/${encodeURIComponent(id)}?tab=files`)}`);
      return;
    }
    const m = catalog.mod(id);
    const release = m && (!m.adult || user.adult) ? m.releases.find((r) => r.version === req.params.version) : undefined;
    const file = release?.files.find((f) => f.name === req.params.file);
    if (!m || !release || !file) {
      if (accounts.viaToken(req)) res.status(404).json({ error: 'not-found' });
      else send(res, notFound(ctxOf(req)), 404);
      return;
    }
    // No limit on how many: every mod stays free to download (CD Projekt RED allows no paywalls on mods; the owner
    // dropped a monthly limit for that reason, 2026-11-21). Free downloads are limited in speed only, by nginx.
    let served;
    try {
      served = await serveDownload(config.downloads, { repo: m.repo, tag: release.tag, name: file.name, assetId: file.assetId, url: file.url }, deps.githubFetch);
    } catch (err) {
      console.error(`download ${m.id} ${release.version} ${file.name}: ${err instanceof Error ? err.message : err}`);
      if (accounts.viaToken(req)) {
        res.status(502).json({ error: 'github' });
        return;
      }
      send(res, message(ctxOf(req), {
        title: 'Download did not start', eyebrow: m.name, heading: html`Download did not <span>start</span>`,
        lede: 'GitHub, where the file lives, did not answer just now. Try again in a moment.',
        actions: html`<a class="btn go" href="${req.originalUrl}">Try again</a><a class="btn" href="/mods/${m.id}?tab=files">Back to ${m.name}</a>`,
      }), 502);
      return;
    }
    // HEAD asks about the file without fetching it, so it does not count.
    if (req.method === 'GET') site.recordDownload(user.id, m.id, release.version, file.name);
    if (served.kind === 'redirect') {
      res.redirect(302, served.location);
      return;
    }
    res.set({
      'X-Accel-Redirect': served.accelRedirect,
      'X-Accel-Limit-Rate': String(served.limitRate),
      'Content-Disposition': `attachment; filename="${served.filename.replace(/["\\\r\n]/g, '_')}"`,
    }).end();
  });

  // ---- API ----
  // How the VS Code extension signs in: the tenant, its own application and the API. Not secret.
  app.get('/api/v1/auth', (_req, res) => {
    if (!auth0?.acceptsTokens) {
      res.status(404).set('Cache-Control', 'no-cache').json({ error: 'no-sign-in' });
      return;
    }
    res.set('Cache-Control', 'no-cache').json({
      domain: auth0.config.domain,
      clientId: auth0.config.extensionClientId,
      audience: auth0.config.audience,
      scope: 'openid profile email offline_access',
      connections: CONNECTIONS,
    });
  });

  app.get('/api/v1/me', (req, res) => {
    const v = viewerOf(req);
    const user = accounts.userOf(req);
    res.set('Cache-Control', 'no-store').json(v
      ? {
        signedIn: true, id: v.id, username: user ? user.username ?? null : v.name, ...(user && !user.username ? { suggestion: usernames.suggest(user) } : {}),
        name: v.name, via: v.via, github: v.github, admin: v.admin, adult: v.adult, likes: [...(v.liked ?? [])],
      }
      : { signedIn: false, signIn: accounts.on });
  });

  // The first username, or a new one, from the extension (the website uses /welcome and /me/username).
  app.post('/api/v1/me/username', express.json({ limit: '2kb' }), (req, res) => {
    if (refuse(req, res)) return;
    res.set('Cache-Control', 'no-store');
    const user = accounts.userOf(req);
    if (!user) {
      res.status(401).json({ error: 'sign-in' });
      return;
    }
    const wanted = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const problem = usernames.claim(wanted, user);
    if (problem) {
      res.status(400).json({ error: problem, message: USERNAME_PROBLEMS[problem] });
      return;
    }
    res.json({ username: site.user(user.id)?.username ?? wanted });
  });

  // The mods this person likes, as cards: the extension's Liked list.
  app.get('/api/v1/me/likes', (req, res) => {
    const user = accounts.userOf(req);
    res.set('Cache-Control', 'no-store');
    if (!user) {
      res.status(401).json({ error: 'sign-in' });
      return;
    }
    res.json({ cards: catalog.likedBy(user.id, user.adult) });
  });

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

  // A mod's page for the extension's editor tab: the website's own page without its frame, for the person signed in.
  app.get('/api/v1/mods/:id/view', (req, res) => {
    const m = catalog.mod(String(req.params.id));
    const viewer = viewerOf(req);
    res.set('Cache-Control', 'no-store');
    if (!m) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    if (m.adult && !viewer?.adult) {
      res.status(403).json({ error: 'adult', message: viewer ? 'This mod is for adults. Turn on adult mods in your settings on the website to see it.' : 'This mod is for adults. Sign in, then turn on adult mods in your settings, to see it.' });
      return;
    }
    const tab = (MOD_TABS as readonly string[]).includes(String(req.query.tab)) ? (req.query.tab as ModTab) : 'about';
    const reported = req.query.reported === 'sent' || req.query.reported === 'already' ? req.query.reported : undefined;
    const ctx = { ...ctxOf(req), path: `/mods/${encodeURIComponent(m.id)}`, embed: true };
    res.json({ id: m.id, name: m.name, version: m.shown.version, tab, html: modPage(ctx, catalog, m, tab, reported).value });
  });

  app.post('/api/v1/mods/:id/like', express.json({ limit: '1kb' }), (req, res) => {
    if (refuse(req, res)) return;
    res.set('Cache-Control', 'no-store');
    const user = accounts.userOf(req);
    if (!user) {
      res.status(401).json({ error: 'sign-in' });
      return;
    }
    const m = catalog.mod(String(req.params.id));
    if (!m || (m.adult && !user.adult)) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    const liked = req.body?.like !== false;
    site.setLike(user.id, m.id, liked);
    res.json({ liked, likes: site.likeCount(m.id) });
  });

  app.post('/api/v1/mods/:id/report', express.json({ limit: '4kb' }), (req, res) => {
    if (refuse(req, res)) return;
    res.set('Cache-Control', 'no-store');
    const user = accounts.userOf(req);
    if (!user) {
      res.status(401).json({ error: 'sign-in' });
      return;
    }
    const m = catalog.mod(String(req.params.id));
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    if (!m || (m.adult && !user.adult)) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    if (!(reason in REPORT_REASONS)) {
      res.status(400).json({ error: 'reason', message: 'Choose why you are reporting this mod.' });
      return;
    }
    const note = (typeof req.body?.note === 'string' ? req.body.note : '').replace(/[^\P{C}\n]/gu, '').trim().slice(0, 1000);
    res.json({ sent: site.report(user.id, m.id, reason as ReportReason, note) });
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

  app.post('/api/v1/blocklist/check', express.raw({ type: 'application/json', limit: '10kb' }), (req, res) => {
    if (!config.checksSecret) {
      res.status(503).json({ error: 'not-configured' });
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!signatureOk(config.checksSecret, body, req.get('x-edgemods-signature'))) {
      res.status(401).json({ error: 'bad-signature' });
      return;
    }
    let q: any;
    try {
      q = JSON.parse(body.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'not-json' });
      return;
    }
    const github = Number.isSafeInteger(q?.github) && site.isBlocked('github', q.github);
    const repo = Number.isSafeInteger(q?.repo) && site.isBlocked('repo', q.repo);
    res.set('Cache-Control', 'no-store').json({ blocked: github || repo, github, repo });
  });

  // The index handover (docs/design.md, "Runners"): the rebuild on the owner's runner sends a fresh index.db. The
  // body goes to a file beside the index, never into memory. X-EDGEmods-Timestamp (Unix seconds) and the body are
  // signed together, so an old index cannot be sent again later; the service checks the file and swaps it in, or
  // keeps the current one.
  app.post('/api/v1/admin/index', (req, res, next) => {
    if (!config.indexSecret) {
      res.status(503).json({ error: 'not-configured' });
      return;
    }
    const secret = config.indexSecret;
    const ts = req.get('x-edgemods-timestamp') ?? '';
    if (!/^\d{1,12}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > INDEX_CLOCK_SKEW_S) {
      res.status(401).json({ error: 'bad-timestamp' });
      return;
    }
    if (req.get('content-type') !== 'application/vnd.sqlite3') {
      res.status(415).json({ error: 'not-sqlite' });
      return;
    }
    const length = Number(req.get('content-length'));
    if (!(length > 0) || length > INDEX_MAX_BYTES) {
      res.status(413).json({ error: 'size', max: INDEX_MAX_BYTES });
      return;
    }
    const file = join(dirname(config.indexPath), `index.db.upload-${randomBytes(6).toString('hex')}`);
    const hmac = createHmac('sha256', secret).update(`${ts}.`);
    const out = createWriteStream(file, { flags: 'wx' });
    let size = 0;
    const drop = () => rmSync(file, { force: true });
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > length) req.destroy();
      hmac.update(chunk);
    });
    pipeline(req, out).then(() => {
      const sig = /^sha256=([0-9a-f]{64})$/.exec(req.get('x-edgemods-signature') ?? '');
      if (size !== length || !sig || !timingSafeEqual(hmac.digest(), Buffer.from(sig[1], 'hex'))) {
        drop();
        res.status(401).json({ error: 'bad-signature' });
        return;
      }
      try {
        const done = catalog.replace(file);
        site.log('index rebuild', 'index replaced', `${done.before} mods shown before, ${done.mods} now; built ${done.builtAt}`);
        console.log(`Index replaced: ${done.before} mods shown before, ${done.mods} now (built ${done.builtAt}).`);
        res.set('Cache-Control', 'no-store').json({ ok: true, mods: done.mods, before: done.before, indexBuiltAt: done.builtAt });
      } catch (err) {
        drop();
        const why = err instanceof Error ? err.message : String(err);
        console.error(`Index refused: ${why}`);
        res.status(422).json({ error: 'refused', message: why });
      }
    }, (err: unknown) => {
      drop();
      if (!res.headersSent) next(err);
    });
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

/** The largest index.db the handover takes, and how far its timestamp may be from the server's clock. */
export const INDEX_MAX_BYTES = 512 * 1024 * 1024;
const INDEX_CLOCK_SKEW_S = 600;

/** The link schemes of the editors the extension's sign-in may go back to (docs/auth0-setup.md, step 9). */
export const EDITOR_SCHEMES = ['vscode', 'vscode-insiders', 'vscodium', 'cursor', 'windsurf', 'edgekit'];

/** The VS Code sign-in's page in the browser: it opens the editor (site.js follows the data-handoff link). */
function handoffPage(ctx: PageContext, link: string, ok: boolean): Html {
  return message(ctx, {
    title: ok ? 'Back to VS Code' : 'Sign-in did not finish',
    eyebrow: 'Signing in from VS Code',
    heading: ok ? html`Back to <span>VS Code</span>` : html`Sign-in did not <span>finish</span>`,
    lede: ok
      ? 'Your browser is handing the sign-in to VS Code. If it asks, let it open VS Code, then go back to VS Code: it says when you are signed in. You can close this tab.'
      : 'The sign-in was cancelled, or Auth0 did not let it through. VS Code says why; start again from there. You can close this tab.',
    actions: html`<a class="btn go" href="${link}" data-handoff>Open VS Code</a>`,
  });
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
  return { q, type: list(req.query.type, 13, 40), tag: list(req.query.tag, 10, 40), needs: list(req.query.needs, 10, 100), nocode: req.query.nocode === '1', ingame: req.query.ingame === '1', sort, page, adult };
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
