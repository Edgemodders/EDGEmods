// The frame every page shares: head, status bar, footer. No inline scripts or styles: the Content-Security-Policy
// allows only the site's own files.

import { html, type Html } from '../html.js';
import { dateTime } from '../words.js';

export interface Viewer {
  /** Auth0's user id. */
  id?: string;
  name: string;
  /** The GitHub login, for a GitHub sign-in. */
  github?: string;
  githubId?: number;
  /** How they signed in, in words: GitHub, Google, Email and password. */
  via?: string;
  admin: boolean;
  /** Opted in to adult mods in their settings. */
  adult: boolean;
  /** The mods they like. */
  liked?: ReadonlySet<string>;
  /** When this session began (ISO). */
  since?: string;
}

export interface PageContext {
  publicUrl: string;
  /** Changes when site.css or site.js change, so browsers fetch the new ones. */
  assetVersion: string;
  viewer?: Viewer;
  /** The request's path and query, for the canonical link and the search box. */
  path: string;
  q?: string;
  /** For the VS Code extension: the page's own content only, with no site frame, shown in an editor tab. */
  embed?: boolean;
}

export interface PageMeta {
  title: string;
  description?: string;
  /** An image for link previews (Discord, Reddit): a path on this site. */
  image?: string;
  /** Which navigation link is the current page. */
  nav?: 'browse' | 'new' | 'publish';
  /** Leave out of search engines. */
  noindex?: boolean;
}

export const ICON = {
  down: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M6 11l6 6 6-6M5 20h14"/></svg>`,
  box: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8"/></svg>`,
  clock: html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>`,
  lock: html`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  heart: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`,
};

/** The sign-in page's address, coming back to where the person was. */
export function signInHref(ctx: Pick<PageContext, 'path'>): string {
  return ctx.path === '/' || ctx.path.startsWith('/signin') || ctx.path.startsWith('/auth/') ? '/signin' : `/signin?return=${encodeURIComponent(ctx.path)}`;
}

/**
 * A like button. Signed in: a small form that works without JavaScript (site.js sends it in place). Visitors: a
 * link to sign in, with the count.
 */
export function likeButton(ctx: PageContext, modId: string, count: number, extra = ''): Html {
  const n = html`<span class="n">${count.toLocaleString('en')}</span>`;
  // The wide button on a mod's page says what it does in words too; site.js keeps the word current.
  const word = (on: boolean): Html => (extra.includes('wide') ? html`<span class="w">${on ? 'Liked' : 'Like'}</span>` : html``);
  if (!ctx.viewer) return html`<a class="like${extra}" href="${signInHref(ctx)}" title="Sign in to like">${ICON.heart}${word(false)}${n}</a>`;
  const on = Boolean(ctx.viewer.liked?.has(modId));
  return html`<form class="likeform${extra}" method="post" action="/mods/${encodeURIComponent(modId)}/like">
    <input type="hidden" name="like" value="${on ? '0' : '1'}"><input type="hidden" name="return" value="${ctx.path}">
    <button class="like" type="submit" aria-pressed="${on ? 'true' : 'false'}" title="${on ? 'Unlike' : 'Like'}">${ICON.heart}${word(on)}${n}</button></form>`;
}

function accountMenu(ctx: PageContext): Html {
  const v = ctx.viewer;
  if (!v) return html`<a class="btn sm go" href="${signInHref(ctx)}">Sign in</a>`;
  return html`<details class="usermenu"><summary class="who"><span class="avatar">${v.name.slice(0, 1).toUpperCase()}</span>${v.name.split(' ')[0]}</summary>
    <div class="menu">
      <div class="head"><b>${v.name}</b>${v.github ? html`GitHub · ${v.github}` : ''}${v.since
        ? html`<small class="since">Logged in since <time datetime="${v.since}" data-local>${dateTime(v.since)}</time></small>` : ''}</div>
      <a href="/me">Profile</a>
      <a href="/me?tab=likes">Liked mods</a>
      <a href="/me?tab=downloads">Downloaded mods</a>
      <a href="/me?tab=mods">${v.github ? 'My mods' : 'Publishing'}</a>
      <a href="/me?tab=settings">Settings</a>
      ${v.admin ? html`<a href="/admin">Admin</a>` : ''}
      <form method="post" action="/auth/signout"><button type="submit">Sign out</button></form>
    </div></details>`;
}

export function page(ctx: PageContext, meta: PageMeta, body: Html): Html {
  if (ctx.embed) return body;
  const nav: [string, string, PageMeta['nav']][] = [
    // Browse already sorts by recently updated.
    ['/mods', 'Browse', 'browse'],
    ['/mods?sort=new', 'New', 'new'],
    ['/publish', 'Publish', 'publish'],
  ];
  const description = meta.description ?? 'Find, install and share Cyberpunk 2077 mods. Every mod lives in its author\'s own repository.';
  const title = meta.title === 'EDGEmods' ? meta.title : `${meta.title} · EDGEmods`;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${meta.noindex ? html`<meta name="robots" content="noindex">` : html`<link rel="canonical" href="${ctx.publicUrl}${ctx.path}">`}
<meta property="og:site_name" content="EDGEmods">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
${meta.image ? html`<meta property="og:image" content="${ctx.publicUrl}${meta.image}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" type="image/png" href="/assets/icon.png">
<link rel="stylesheet" href="/assets/site.css?v=${ctx.assetVersion}">
<script src="/assets/site.js?v=${ctx.assetVersion}" defer></script>
</head>
<body>
<header class="bar"><div class="wrap">
  <a class="logo" href="/"><span class="dot"></span>EDGE<span>mods</span></a>
  <nav aria-label="Main">${nav.map(([href, label, key]) => html`<a href="${href}"${key === meta.nav ? html` aria-current="page"` : ''}>${label}</a>`)}</nav>
  <form action="/mods" role="search"><label class="sr" for="topq">Search mods</label>
    <input class="search" id="topq" name="q" type="search" placeholder="Search mods" value="${ctx.q ?? ''}"></form>
  <div class="account">${accountMenu(ctx)}</div>
</div></header>
${body}
<footer class="wrap"><span>EDGEMODS · THE EDGE MOD REGISTRY FOR CYBERPUNK 2077</span>
  <nav><a href="/publish">Publish</a><a href="https://edgemodders.github.io/EDGEmods/">Docs</a></nav>
  <span>Mods live in their authors' repositories. Not affiliated with CD Projekt RED.</span></footer>
</body>
</html>`;
}

/** A plain page with a heading, a few words and buttons: not found, sign in, gates. */
export function message(ctx: PageContext, meta: PageMeta & { eyebrow: string; heading: Html; lede: string; actions?: Html }): Html {
  return page(ctx, { ...meta, noindex: true }, html`<main class="wrap"><div class="pagehead">
    <div class="eyebrow">${meta.eyebrow}</div><h1>${meta.heading}</h1><p class="lede">${meta.lede}</p>
    <div class="cta">${meta.actions ?? html`<a class="btn go" href="/mods">Browse mods</a>`}</div></div></main>`);
}
