// The frame every page shares: head, status bar, footer. No inline scripts or styles: the Content-Security-Policy
// allows only the site's own files.

import { html, type Html } from '../html.js';

export interface Viewer {
  name: string;
  github?: string;
  admin: boolean;
  /** Opted in to adult mods in their settings. */
  adult: boolean;
}

export interface PageContext {
  publicUrl: string;
  /** Changes when site.css or site.js change, so browsers fetch the new ones. */
  assetVersion: string;
  viewer?: Viewer;
  /** The request's path and query, for the canonical link and the search box. */
  path: string;
  q?: string;
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
  vscode: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3l4 2v14l-4 2-10-9 10-9z M17 3v18 M3 9l4 3-4 3"/></svg>`,
};

export function page(ctx: PageContext, meta: PageMeta, body: Html): Html {
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
  <div class="account">${ctx.viewer
    ? html`<span class="who"><span class="avatar">${ctx.viewer.name.slice(0, 1).toUpperCase()}</span>${ctx.viewer.name.split(' ')[0]}</span>`
    : html`<a class="btn sm go" href="/signin">Sign in</a>`}</div>
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
