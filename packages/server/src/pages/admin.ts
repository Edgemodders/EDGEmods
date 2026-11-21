// The Admin page (docs/design.md, "Administration"), for the verified emails in EDGEMODS_ADMINS, reached from the
// account menu. R3d: the overview, the free monthly download limit and the log of admin actions. Mods, users, the
// blocklist and reports come in R3e.

import { html, type Html } from '../html.js';
import { ago } from '../words.js';
import { page, type PageContext } from './layout.js';

export const ADMIN_NOTES = {
  saved: 'Saved. It applies to the next download.',
  invalid: 'The limit is a whole number from 0 (no limit) to 100,000.',
} as const;
export type AdminNote = keyof typeof ADMIN_NOTES;

export interface AdminData {
  totals: { accounts: number; downloadsThisMonth: number; downloaders: number; likes: number };
  mods: number;
  freeModsPerMonth: number;
  audit: { at: string; who: string; action: string; detail: string }[];
  note?: AdminNote;
}

export function adminPage(ctx: PageContext, d: AdminData): Html {
  const tile = (label: string, value: number, small: string): Html =>
    html`<div class="panel tile"><p class="label">${label}</p><div class="big">${value.toLocaleString('en')}</div><small>${small}</small></div>`;
  return page(ctx, { title: 'Admin', noindex: true }, html`<main class="wrap">
    <div class="pagehead"><div class="eyebrow">Signed in as ${ctx.viewer?.name ?? ''}</div><h1>Ad<span>min</span></h1></div>
    ${d.note ? html`<p class="panel note notice" role="status">${ADMIN_NOTES[d.note]}</p>` : ''}
    <section class="first"><div class="sechead"><h2><span class="id">01</span>Overview</h2></div><div class="rule"></div>
      <div class="tiles">
        ${tile('Mods live', d.mods, 'showing on the site')}
        ${tile('Accounts', d.totals.accounts, 'signed up')}
        ${tile('Downloads', d.totals.downloadsThisMonth, `this month, by ${d.totals.downloaders.toLocaleString('en')} ${d.totals.downloaders === 1 ? 'person' : 'people'}`)}
        ${tile('Likes', d.totals.likes, 'in all')}
      </div></section>
    <section><div class="sechead"><h2><span class="id">02</span>Downloads</h2></div><div class="rule"></div>
      <form class="panel adminform" method="post" action="/admin/settings">
        <label class="label" for="freeModsPerMonth">Free downloads per month</label>
        <div class="row"><input class="search" id="freeModsPerMonth" name="freeModsPerMonth" type="number" min="0" max="100000" step="1" required value="${String(d.freeModsPerMonth)}">
          <span class="dim">different mods</span><button class="btn sm go" type="submit">Save</button></div>
        <p class="dim small">How many different mods a free account may download in a calendar month (UTC). 0 is no limit${d.freeModsPerMonth === 0 ? ', which is the setting now' : ''}. Downloading a mod again, another of its files or another version uses none of the limit. Every account is free until subscriptions arrive.</p>
      </form></section>
    <section><div class="sechead"><h2><span class="id">03</span>Log</h2></div><div class="rule"></div>
      ${d.audit.length
        ? html`<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead><tbody>
            ${d.audit.map((a) => html`<tr><td class="n left">${ago(a.at)}</td><td>${a.who}</td><td>${a.action}</td><td>${a.detail}</td></tr>`)}
          </tbody></table></div>`
        : html`<p class="empty">Every admin action shows up here: who, what and when.</p>`}
    </section>
  </main>`);
}
