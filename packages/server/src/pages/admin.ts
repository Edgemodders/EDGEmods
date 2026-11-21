// The Admin page (docs/design.md, "Administration"), for the verified emails in EDGEMODS_ADMINS, reached from the
// account menu. R3d: the overview and the log of admin actions. Mods, users, the blocklist and reports come in R3e.

import type { DownloadConfig } from '../config.js';
import { html, type Html } from '../html.js';
import { ago } from '../words.js';
import { page, type PageContext } from './layout.js';

export interface AdminData {
  totals: { accounts: number; downloadsThisMonth: number; downloaders: number; likes: number };
  mods: number;
  downloads: DownloadConfig;
  audit: { at: string; who: string; action: string; detail: string }[];
}

export function adminPage(ctx: PageContext, d: AdminData): Html {
  const tile = (label: string, value: string, small: string): Html =>
    html`<div class="panel tile"><p class="label">${label}</p><div class="big">${value}</div><small>${small}</small></div>`;
  const n = (v: number): string => v.toLocaleString('en');
  const speed = `${Number((d.downloads.freeSpeed / 1024 / 1024).toFixed(1))} MB/s`;
  return page(ctx, { title: 'Admin', noindex: true }, html`<main class="wrap">
    <div class="pagehead"><div class="eyebrow">Signed in as ${ctx.viewer?.name ?? ''}</div><h1>Ad<span>min</span></h1></div>
    <section class="first"><div class="sechead"><h2><span class="id">01</span>Overview</h2></div><div class="rule"></div>
      <div class="tiles">
        ${tile('Mods live', n(d.mods), 'showing on the site')}
        ${tile('Accounts', n(d.totals.accounts), 'signed up')}
        ${tile('Downloads', n(d.totals.downloadsThisMonth), `this month, by ${n(d.totals.downloaders)} ${d.totals.downloaders === 1 ? 'person' : 'people'}`)}
        ${tile('Likes', n(d.totals.likes), 'in all')}
        ${tile('Free speed', speed, d.downloads.mode === 'nginx' ? 'through nginx; EDGEMODS_FREE_SPEED' : 'not applied: this server sends downloads to GitHub')}
      </div></section>
    <section><div class="sechead"><h2><span class="id">02</span>Log</h2></div><div class="rule"></div>
      ${d.audit.length
        ? html`<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead><tbody>
            ${d.audit.map((a) => html`<tr><td class="n left">${ago(a.at)}</td><td>${a.who}</td><td>${a.action}</td><td>${a.detail}</td></tr>`)}
          </tbody></table></div>`
        : html`<p class="empty">Every admin action shows up here: who, what and when.</p>`}
    </section>
  </main>`);
}
