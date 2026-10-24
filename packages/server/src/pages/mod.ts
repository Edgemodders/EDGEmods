// A mod's page. Tabs work without JavaScript: each is a link (?tab=files) and the server shows that panel;
// site.js switches them in place. Visitors who have not signed in see no download links and nothing that gives
// the repository away (the soft gate): no GitHub login, no repository, no GitHub download addresses.

import { isModRequirement, type Requirement } from '@edgemodders/edgemods-format';
import type { Catalog, ModView, ReleaseFile, ReleaseView } from '../catalog.js';
import { html, raw, type Html } from '../html.js';
import { resolvePlan } from '../plan.js';
import { ago, bytes, date, KIND_LABELS, needsWords, plural, typeLabel } from '../words.js';
import { imageUrl } from './browse.js';
import { ICON, page, type PageContext } from './layout.js';

export const MOD_TABS = ['about', 'files', 'versions', 'needs'] as const;
export type ModTab = (typeof MOD_TABS)[number];

export function modPage(ctx: PageContext, catalog: Catalog, m: ModView, tab: ModTab): Html {
  const who = ctx.viewer;
  const shown = m.shown;
  const names = catalog.names(allMods(m));
  const pictures = [{ path: m.card, caption: '' }, ...m.gallery.filter((g) => g.path !== m.card)];
  const tabs: [ModTab, string][] = [
    ['about', 'About'],
    ['files', `Files (${shown.files.length})`],
    ['versions', `Versions (${m.releases.length})`],
    ['needs', `Requirements (${shown.requirements.length})`],
  ];
  const panel = (key: ModTab, body: Html): Html => html`<div class="tabpanel" id="tab-${key}" role="tabpanel" data-panel="${key}"${key === tab ? '' : html` hidden`}>${body}</div>`;
  return page(ctx, { title: m.name, description: m.summary, image: imageUrl(m.id, m.card) }, html`<main class="wrap">
    <div class="crumbs"><a href="/mods">Mods</a> / <a href="/mods?type=${m.type}">${typeLabel(m.type)}</a> / ${m.name}</div>
    <div class="modhead">
      <div>
        <div class="modmeta first"><a class="tag y" href="/mods?type=${m.type}">${typeLabel(m.type)}</a>${m.runsCode ? html`<span class="tag r">Runs code</span>` : ''}${m.adult ? html`<span class="tag r">18+</span>` : ''}</div>
        <h1>${m.name}</h1>
        <p class="lede">${m.summary}</p>
        <div class="byline">by ${m.author}${who ? html` · <a href="https://github.com/${m.repo}">${m.repo}</a>` : ''}</div>
        <div class="modmeta">${m.tags.map((t) => html`<a class="tag" href="/mods?tag=${t}">${t}</a>`)}</div>
        <div class="gallery" data-gallery>
          <div class="main"><img id="galleryMain" src="${imageUrl(m.id, pictures[0].path)}" alt="${pictures[0].caption || m.name}" width="1280" height="640"></div>
          <div class="caption" id="galleryCaption">${pictures[0].caption ?? ''}</div>
          ${pictures.length > 1 ? html`<div class="thumbs">${pictures.map((p, i) => html`<a href="${imageUrl(m.id, p.path)}" data-shot="${imageUrl(m.id, p.path)}" data-caption="${p.caption ?? ''}" aria-current="${i === 0 ? 'true' : 'false'}" aria-label="Picture ${i + 1}"><img src="${imageUrl(m.id, p.path)}" alt="" loading="lazy"></a>`)}</div>` : ''}
        </div>
      </div>
      <aside class="side">
        <div class="panel"><div class="actions">${who
          ? html`<a class="btn go" href="vscode://edgemodders.edgemods/install?mod=${encodeURIComponent(m.id)}&amp;version=${encodeURIComponent(shown.version)}">${ICON.vscode} Install in VS Code</a>
                 <a class="btn" href="?tab=files#tabs">${ICON.down} Download files</a>`
          : html`<a class="btn go" href="/signin">${ICON.lock} Sign in to download</a>
                 <p class="gate">Downloading, installing and seeing where a mod comes from need a free account.</p>`}</div></div>
        <div class="panel"><dl class="kv">
          <dt>Version</dt><dd>${shown.version}</dd>
          <dt>Updated</dt><dd>${date(shown.publishedAt)}</dd>
          <dt>Published</dt><dd>${date(m.firstPublished)}</dd>
          <dt>Size</dt><dd>${bytes(shown.size)}</dd>
          ${shown.gameVersion ? html`<dt>Game</dt><dd>Tested with ${shown.gameVersion}</dd>` : ''}
          <dt>License</dt><dd>${m.license}</dd>
          <dt>Source</dt><dd>${who ? html`<a href="https://github.com/${m.repo}">GitHub</a>` : html`<span class="dim">Sign in to see</span>`}</dd>
        </dl></div>
        ${contentsPanel(shown)}
      </aside>
    </div>
    <div class="tabs" id="tabs" role="tablist">${tabs.map(([key, label]) => html`<a role="tab" href="?tab=${key}#tabs" data-tab="${key}" aria-selected="${key === tab ? 'true' : 'false'}" aria-controls="tab-${key}">${label}</a>`)}</div>
    ${panel('about', html`<div class="readme">${raw(m.pageHtml)}</div>${creditsBlock(m)}`)}
    ${panel('files', filesPanel(ctx, m, shown, names))}
    ${panel('versions', versionsPanel(ctx, m, names))}
    ${panel('needs', needsPanel(catalog, m, names))}
  </main>`);
}

function contentsPanel(r: ReleaseView): Html {
  const downloads = r.check?.downloads ?? [];
  if (!downloads.length) return html`<div class="panel"><p class="label">What's in the download</p><p class="gate">Not checked yet.</p></div>`;
  const kinds = new Map<string, number>();
  for (const d of downloads) for (const [k, n] of Object.entries(d.contents.kinds)) kinds.set(k, (kinds.get(k) ?? 0) + n);
  const runs = downloads.flatMap((d) => d.contents.runsCode);
  const scanners = [...new Set(downloads.map((d) => d.scan?.scanner).filter(Boolean))];
  return html`<div class="panel${runs.length ? ' warn' : ''}">
    <p class="label">What's in the download</p>
    ${runs.length ? html`<p class="gate">It has a <b>game plugin or program</b>: code that runs with your permissions. That is normal for frameworks; install mods like this from authors you trust.</p>` : ''}
    <ul class="contents">${[...kinds].map(([k, n]) => html`<li>${n} × ${KIND_LABELS[k] ?? k}</li>`)}</ul>
    <p class="dim mono small">Checked${scanners.length ? html` and scanned (${scanners.join(', ')})` : ''} ${ago(r.check!.checkedAt)}</p>
    <details class="raw"><summary>Raw values</summary><pre>${downloads.map((d) => `${d.name}\nsha256 ${d.sha256}\n${d.contents.runsCode.map((p) => `runs code: ${p}`).join('\n')}`).join('\n\n')}</pre></details>
  </div>`;
}

function creditsBlock(m: ModView): Html {
  if (!m.credits.length && !Object.keys(m.links).length) return html``;
  const LINKS: Record<string, string> = { homepage: 'Homepage', nexus: 'Nexus Mods', discord: 'Discord', donate: 'Support the author' };
  return html`<div class="aboutfoot">
    ${m.credits.length ? html`<div><p class="label">Credits</p><ul class="contents">${m.credits.map((c) => html`<li>${c.name}${c.for ? html` <span class="dim">· ${c.for}</span>` : ''}</li>`)}</ul></div>` : ''}
    ${Object.keys(m.links).length ? html`<div><p class="label">Links</p><ul class="contents">${Object.entries(m.links).map(([k, url]) => html`<li><a href="${url}" rel="nofollow ugc noopener noreferrer" target="_blank">${LINKS[k] ?? k}</a></li>`)}</ul></div>` : ''}
  </div>`;
}

const ROLE_WORDS: Record<ReleaseFile['role'], string> = { required: 'Required', optional: 'Optional', 'choose-one': 'Choose one' };

function fileRow(ctx: PageContext, m: ModView, r: ReleaseView, f: ReleaseFile, names: Map<string, string>): Html {
  return html`<div class="file vfile"><span class="role">${f.role === 'choose-one' ? `One of ${f.group}` : ROLE_WORDS[f.role]}</span>
    <div><div class="t">${f.title ?? f.name}</div><div class="n">${f.name}</div></div>
    <div class="sz">${bytes(f.size)}${ctx.viewer ? html`<br><a href="/download/${m.id}/${r.version}/${encodeURIComponent(f.name)}">Download</a>` : ''}</div>
    ${f.note ? html`<p class="note">${f.note}</p>` : ''}${fileNeeds(f, names)}</div>`;
}

function fileNeeds(f: ReleaseFile, names: Map<string, string>): Html {
  if (!f.requirements?.length) return html``;
  return html`<p class="note">This file needs ${f.requirements.map((r, i) => html`${i ? ', ' : ''}${requirementWords(r, names)}`)}.</p>`;
}

function requirementWords(r: Requirement, names: Map<string, string>): Html {
  if (!isModRequirement(r)) return html`<a href="${r.url}" rel="nofollow ugc noopener noreferrer" target="_blank">${r.name}</a> (outside EDGEmods)`;
  const name = names.get(r.mod);
  return name ? html`<a href="/mods/${r.mod}">${name}</a> ${needsWords(r)}` : html`${r.mod} ${needsWords(r)} <span class="warnword">(not on EDGEmods any more)</span>`;
}

function filesPanel(ctx: PageContext, m: ModView, r: ReleaseView, names: Map<string, string>): Html {
  const required = r.files.filter((f) => f.role === 'required');
  const groups = [...new Set(r.files.filter((f) => f.role === 'choose-one').map((f) => f.group!))];
  const optional = r.files.filter((f) => f.role === 'optional');
  const block = (title: string, hint: string, files: ReleaseFile[]): Html =>
    html`<div class="panel filegroup"><p class="label">${title} <em>${hint}</em></p>${files.map((f) => fileRow(ctx, m, r, f, names))}</div>`;
  return html`<p class="dim">Version ${r.version}, released ${date(r.publishedAt)}. ${ctx.viewer ? 'Install in VS Code to pick files and bring the requirements along.' : html`<a href="/signin">Sign in</a> to download or install.`}</p>
    <div class="files">
      ${required.length ? block('Required', 'always installed', required) : ''}
      ${groups.map((g) => block(`Choose one: ${g}`, 'these replace each other, so only one is installed', r.files.filter((f) => f.group === g)))}
      ${optional.length ? block('Optional', 'add any of these on top', optional) : ''}
    </div>`;
}

function versionsPanel(ctx: PageContext, m: ModView, names: Map<string, string>): Html {
  return html`<p class="dim">Every release stays here with its own files and requirements, so you can go back to an older version.</p>
    <div class="threads">${m.releases.map((r) => html`<details class="thread version-row"${r.version === m.shown.version ? html` open` : ''}>
      <summary><span class="num">${r.version}</span><span class="title">${r.version === m.shown.version ? html`<span class="tag y">Latest</span> ` : ''}${r.prerelease ? html`<span class="tag c">Pre-release</span> ` : ''}${date(r.publishedAt)}</span>
        <span class="meta dim">${r.gameVersion ? `Tested with game ${r.gameVersion} · ` : ''}${plural(r.files.length, 'file')} · ${bytes(r.size)}</span></summary>
      <div class="body">
        <p class="label">What changed</p>${r.notesHtml ? html`<div class="readme notes">${raw(r.notesHtml)}</div>` : html`<p class="dim">The author wrote no notes for this version.</p>`}
        <p class="label">Files</p><div class="vfiles">${r.files.map((f) => fileRow(ctx, m, r, f, names))}</div>
        <p class="label">Requirements</p><p>${r.requirements.length ? r.requirements.map((q, i) => html`${i ? ' · ' : ''}${requirementWords(q, names)}`) : 'None'}</p>
        ${ctx.viewer ? html`<a class="btn sm" href="vscode://edgemodders.edgemods/install?mod=${encodeURIComponent(m.id)}&amp;version=${encodeURIComponent(r.version)}">${r.version === m.shown.version ? 'Install' : 'Install this version'}</a>` : html`<a class="btn sm" href="/signin">Sign in to download or install</a>`}
      </div></details>`)}</div>`;
}

function needsPanel(catalog: Catalog, m: ModView, names: Map<string, string>): Html {
  const reqs = m.shown.requirements;
  const plan = resolvePlan((id) => catalog.releasesOf(id), { mod: m.id, version: m.shown.version });
  const chain = plan.mods.filter((x) => x.id !== m.id);
  return html`<p class="dim">Installing in VS Code brings the EDGEmods requirements along, and theirs in turn: EDGEmods works out the chain, and EDGEdeck installs each mod into your loadout. Get the links outside EDGEmods yourself; EDGEmods does not check them.</p>
    ${reqs.length ? html`<div class="reqs">${reqs.map((r) => {
      if (isModRequirement(r)) {
        const name = names.get(r.mod);
        const dep = name ? catalog.mod(r.mod) : undefined;
        return dep
          ? html`<a class="panel req" href="/mods/${dep.id}"><span class="thumb"><img src="${imageUrl(dep.id, dep.card)}" alt="" loading="lazy"></span><span><b>${dep.name}</b><small>On EDGEmods · ${needsWords(r)}</small></span></a>`
          : html`<div class="panel req warn"><span class="ext">Missing</span><span><b>${r.mod}</b><small>${needsWords(r)} · not on EDGEmods any more</small></span></div>`;
      }
      return html`<a class="panel req" href="${r.url}" rel="nofollow ugc noopener noreferrer" target="_blank"><span class="ext">Outside</span><span><b>${r.name}</b><small>${hostOf(r.url)} · not checked by EDGEmods</small></span></a>`;
    })}</div>` : html`<p>This mod needs nothing else.</p>`}
    ${chain.length || plan.problems.length ? html`<div class="panel plan-chain"><p class="label">What installing brings</p>
      ${chain.length ? html`<ol class="contents">${[...chain, ...plan.mods.filter((x) => x.id === m.id)].map((x) => html`<li><b>${x.name}</b> ${x.version}${x.neededBy.length ? html` <span class="dim">· needed by ${x.neededBy.map((id) => names.get(id) ?? (id === m.id ? m.name : id)).join(', ')}</span>` : html` <span class="dim">· this mod</span>`}</li>`)}</ol>` : ''}
      ${plan.problems.map((p) => html`<p class="warnword">${p}</p>`)}</div>` : ''}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Every EDGEmods mod named by any release's requirements, to look up their names once. */
function allMods(m: ModView): string[] {
  const ids = new Set<string>();
  for (const r of m.releases) {
    for (const q of [...r.requirements, ...r.files.flatMap((f) => f.requirements ?? [])]) if (isModRequirement(q)) ids.add(q.mod);
  }
  return [...ids];
}
