// The home page, the browse page and the mod card they share. Browse works without JavaScript: the filters are a
// form that sends GET /mods, so every search is an address that can be shared; site.js only submits it on change.

import type { Card, Catalog, Query, SearchResult, Sort } from '../catalog.js';
import { html, pathOf, type Html } from '../html.js';
import { ago, bytes, date, daysSince, plural, typeLabel } from '../words.js';
import { ICON, page, type PageContext } from './layout.js';

export const imageUrl = (id: string, path: string): string => `/mods/${encodeURIComponent(id)}/images/${pathOf(path)}`;

export function card(c: Card, now = Date.now()): Html {
  const fresh = daysSince(c.firstPublished, now) < 7;
  const updated = !fresh && daysSince(c.lastUpdated, now) < 7;
  return html`<article class="card">
    <div class="img"><img src="${imageUrl(c.id, c.card)}" alt="" loading="lazy" width="640" height="320">
      <div class="flags"><span class="tag solid y">${typeLabel(c.type)}</span>
        <span class="right">${fresh ? html`<span class="tag solid g">New</span>` : ''}${updated ? html`<span class="tag solid c">Updated</span>` : ''}${
          c.runsCode ? html`<span class="tag solid r" title="Contains a game plugin or program that runs code">Runs code</span>` : ''}${c.adult ? html`<span class="tag solid r">18+</span>` : ''}</span></div></div>
    <div class="body">
      <a class="name" href="/mods/${c.id}">${c.name}</a>
      <span class="by">by ${c.author}</span>
      <p class="sum">${c.summary}</p>
      <div class="tags">${c.tags.slice(0, 3).map((t) => html`<span class="tag">${t}</span>`)}</div>
    </div>
    <div class="foot">
      <span class="stat" title="Size">${ICON.box}${bytes(c.size)}</span>
      <span class="stat" title="Version">v${c.version}</span>
      <span class="stat" title="Updated ${date(c.lastUpdated)}">${ICON.clock}${ago(c.lastUpdated, now)}</span>
    </div></article>`;
}

export function homePage(ctx: PageContext, catalog: Catalog): Html {
  const adult = Boolean(ctx.viewer?.adult);
  const info = catalog.info(adult);
  const types = catalog.typeCounts(adult);
  const rail = (title: string, id: string, sort: 'new' | 'updated'): Html => {
    const cards = catalog.rail(sort, 8, adult);
    return cards.length
      ? html`<section><div class="sechead"><h2><span class="id">${id}</span>${title}</h2><a href="/mods?sort=${sort}">See all →</a></div><div class="rule"></div>
          <div class="cards">${cards.map((c) => card(c))}</div></section>`
      : html``;
  };
  return page(ctx, { title: 'EDGEmods' }, html`<header class="hero wrap">
      <div class="eyebrow">The EDGE mod registry for Cyberpunk 2077</div>
      <h1>Open-source <span>modding</span></h1>
      <p class="lede">Find, install and share mods. Every mod lives in its author's own repository: EDGEmods checks it, lists it, and installs it through EDGEdeck in one click.</p>
      <div class="cta"><a class="btn go" href="/mods">Browse mods</a><a class="btn" href="/publish">Publish a mod</a></div>
      <div class="stats"><span><b>${info.mods}</b>${info.mods === 1 ? 'mod' : 'mods'}</span><span><b>${info.modders}</b>${info.modders === 1 ? 'modder' : 'modders'}</span></div>
    </header>
    <main class="wrap">
      ${types.length
        ? html`<section class="first"><div class="sechead"><h2><span class="id">00</span>Types</h2></div><div class="rule"></div>
            <div class="types">${types.map((t) => html`<a class="typetile" href="/mods?type=${t.value}">${typeLabel(t.value)}<small>${t.count}</small></a>`)}</div></section>`
        : html`<p class="empty">No mods yet. Be the first: <a href="/publish">publish a mod</a>.</p>`}
      ${rail('New mods', '01', 'new')}
      ${rail('Recently updated', '02', 'updated')}
    </main>`);
}

const SORT_LABELS: Record<Sort, string> = { relevance: 'Best match', updated: 'Recently updated', new: 'Newest', name: 'Name A–Z' };

/** The browse page's address for a query, leaving out defaults. */
export function browseUrl(q: Query, change: Partial<Query> = {}): string {
  const s = { ...q, ...change };
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  for (const t of s.type) p.append('type', t);
  for (const t of s.tag) p.append('tag', t);
  for (const t of s.needs) p.append('needs', t);
  if (s.nocode) p.set('nocode', '1');
  if (s.sort !== defaultSort(s)) p.set('sort', s.sort);
  if (s.page > 1) p.set('page', String(s.page));
  const text = p.toString();
  return text ? `/mods?${text}` : '/mods';
}

export const defaultSort = (q: Pick<Query, 'q'>): Sort => (q.q.trim() ? 'relevance' : 'updated');

export function browsePage(ctx: PageContext, query: Query, result: SearchResult): Html {
  const without = (key: 'type' | 'tag' | 'needs', value: string): string => browseUrl(query, { [key]: query[key].filter((v) => v !== value), page: 1 });
  const chips: [string, string][] = [
    ...(query.q ? [[`“${query.q}”`, browseUrl(query, { q: '', page: 1, sort: query.sort === 'relevance' ? 'updated' : query.sort })] as [string, string]] : []),
    ...query.type.map((v) => [typeLabel(v), without('type', v)] as [string, string]),
    ...query.tag.map((v) => [v, without('tag', v)] as [string, string]),
    ...query.needs.map((v) => [result.facets.needs.find((f) => f.value === v)?.label ?? v, without('needs', v)] as [string, string]),
    ...(query.nocode ? [['No game plugins', browseUrl(query, { nocode: false, page: 1 })] as [string, string]] : []),
  ];
  const facet = (key: 'type' | 'tag' | 'needs', title: string, label: (v: string, l: string) => string) => {
    const list = result.facets[key];
    if (!list.length) return html``;
    return html`<fieldset class="facet"><legend>${title}</legend>${list.map((f) => html`<label><input type="checkbox" name="${key}" value="${f.value}"${
      query[key].includes(f.value) ? html` checked` : ''}>${label(f.value, f.label)}<small>${f.count}</small></label>`)}</fieldset>`;
  };
  const sorts = (query.q ? (['relevance', 'updated', 'new', 'name'] as Sort[]) : (['updated', 'new', 'name'] as Sort[]));
  const title = query.q ? `“${query.q}”` : query.type.length === 1 ? `${typeLabel(query.type[0])} mods` : 'Mods';
  return page(ctx, { title, nav: query.sort === 'new' && !query.q ? 'new' : 'browse', noindex: chips.length > 1 }, html`<main class="wrap">
    <form class="browse" action="/mods" method="get" id="browse">
      <aside class="facets" id="facets" aria-label="Filters">
        ${facet('type', 'Type', (v) => typeLabel(v))}
        ${facet('tag', 'Tags', (v) => v)}
        ${facet('needs', 'Needs', (_, l) => l)}
        <fieldset class="facet"><legend>Contents</legend><label><input type="checkbox" name="nocode" value="1"${query.nocode ? html` checked` : ''}>No game plugins<small>${result.facets.nocode}</small></label></fieldset>
        <fieldset class="facet"><legend>Adult mods</legend><p class="locked">${ctx.viewer ? (ctx.viewer.adult ? 'Shown, as your settings say.' : 'Hidden. Change it in your settings.') : 'Hidden. Sign in to choose.'}</p></fieldset>
        <button class="btn sm apply" type="submit">Apply filters</button>
      </aside>
      <div>
        <div class="toolbar">
          <label class="sr" for="q">Search</label><input class="search" id="q" name="q" type="search" placeholder="Search names, descriptions, tags, authors" value="${query.q}">
          <button class="btn sm filters-toggle" type="button" aria-controls="facets" aria-expanded="false">Filters</button>
          <span class="count">${plural(result.total, 'mod')}</span>
          <label class="sr" for="sort">Sort</label>
          <select class="sort" id="sort" name="sort">${sorts.map((s) => html`<option value="${s}"${s === query.sort ? html` selected` : ''}>${SORT_LABELS[s]}</option>`)}</select>
        </div>
        ${chips.length ? html`<div class="chips">${chips.map(([label, href]) => html`<a class="chip" href="${href}">${label} <span aria-label="Remove">×</span></a>`)}${
          chips.length > 1 ? html`<a class="chip clear" href="/mods">Clear all</a>` : ''}</div>` : ''}
        <div class="cards">${result.cards.length ? result.cards.map((c) => card(c)) : html`<p class="empty wide">No mods match. Try fewer filters.</p>`}</div>
        ${result.pages > 1 ? html`<nav class="pager" aria-label="Pages">
          ${result.page > 1 ? html`<a class="btn sm" href="${browseUrl(query, { page: result.page - 1 })}" rel="prev">Previous</a>` : ''}
          <span class="count">Page ${result.page} of ${result.pages}</span>
          ${result.page < result.pages ? html`<a class="btn sm" href="${browseUrl(query, { page: result.page + 1 })}" rel="next">Next</a>` : ''}</nav>` : ''}
      </div>
    </form></main>`);
}
