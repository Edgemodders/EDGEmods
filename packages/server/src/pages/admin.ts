// The Admin page (docs/design.md, "Administration"), for the verified emails in EDGEMODS_ADMINS, reached from the
// account menu. Tabs: Overview (with the spot review), Mods, Users, Reports, Blocklist, Log. Every action is a form
// that works without JavaScript, is checked same-origin, lands in the log, and comes back here with a fixed note.

import type { AdminMod, SpotReview } from '../catalog.js';
import type { DownloadConfig } from '../config.js';
import { html, type Html } from '../html.js';
import { REPORT_REASONS, type AdminUser, type BlockEntry, type Report } from '../site-store.js';
import { ago } from '../words.js';
import { page, type PageContext } from './layout.js';

export const ADMIN_TABS = ['overview', 'mods', 'users', 'reports', 'blocklist', 'log'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** The notes an action leaves; fixed sentences, so nothing from the address is shown. */
export const ADMIN_NOTES = {
  hidden: 'The mod is hidden from the site. Its registry file stays.',
  blocked: 'The mod is blocked: hidden from the site, with its new releases.',
  shown: 'The mod shows again (if nothing else hides it).',
  adult: 'The mod\'s adult flag is changed.',
  reviewed: 'Marked as reviewed.',
  'user-blocked': 'The account is blocked: signed out everywhere, and its next sign-in is refused.',
  'user-unblocked': 'The account can sign in again.',
  'not-yourself': 'You cannot block your own account.',
  'github-blocked': 'The GitHub account is blocked: its mods are hidden and it cannot sign in.',
  'repo-blocked': 'The repository is blocked: its mods are hidden.',
  unblocked: 'Taken off the blocklist.',
  'not-found': 'GitHub has no account or repository by that name. Check the spelling.',
  'github-down': 'GitHub did not answer just now. Try again in a moment.',
  closed: 'The report is closed.',
  unknown: 'That did not match anything. Reload the page and try again.',
} as const;
export type AdminNote = keyof typeof ADMIN_NOTES;

export interface AdminData {
  tab: AdminTab;
  q: string;
  note?: AdminNote;
  /** The signed-in admin's own user id, so their row has no Block button. */
  me: string;
  totals: { accounts: number; downloadsThisMonth: number; downloaders: number; likes: number };
  mods: number;
  downloads: DownloadConfig;
  spot: SpotReview[];
  modList: AdminMod[];
  users: AdminUser[];
  reports: Report[];
  names: Map<string, string>;
  blocklist: BlockEntry[];
  audit: { at: string; who: string; action: string; detail: string }[];
}

const sec = (id: string, title: string, body: Html): Html =>
  html`<section><div class="sechead"><h2><span class="id">${id}</span>${title}</h2></div><div class="rule"></div>${body}</section>`;

export function adminPage(ctx: PageContext, d: AdminData): Html {
  const open = d.reports.filter((r) => r.status === 'open').length;
  const tabs: [AdminTab, string][] = [
    ['overview', 'Overview'], ['mods', 'Mods'], ['users', 'Users'], ['reports', `Reports (${open})`], ['blocklist', `Blocklist (${d.blocklist.length})`], ['log', 'Log'],
  ];
  const panel = (key: AdminTab, body: Html): Html => html`<div class="tabpanel" id="tab-${key}" role="tabpanel" data-panel="${key}"${key === d.tab ? '' : html` hidden`}>${body}</div>`;
  return page(ctx, { title: 'Admin', noindex: true }, html`<main class="wrap">
    <div class="pagehead"><div class="eyebrow">Signed in as ${ctx.viewer?.name ?? ''}</div><h1>Ad<span>min</span></h1></div>
    ${d.note ? html`<p class="panel note notice" role="status">${ADMIN_NOTES[d.note]}</p>` : ''}
    <div class="tabs" id="tabs" role="tablist">${tabs.map(([key, label]) => html`<a role="tab" href="/admin?tab=${key}" data-tab="${key}" data-default="overview" aria-selected="${key === d.tab ? 'true' : 'false'}" aria-controls="tab-${key}">${label}</a>`)}</div>
    ${panel('overview', overview(d, open))}
    ${panel('mods', modsTab(d))}
    ${panel('users', usersTab(d))}
    ${panel('reports', reportsTab(d))}
    ${panel('blocklist', blocklistTab(d))}
    ${panel('log', logTable(d.audit))}
  </main>`);
}

function overview(d: AdminData, open: number): Html {
  const tile = (label: string, value: string, small: string, warn = false): Html =>
    html`<div class="panel tile${warn ? ' warn' : ''}"><p class="label">${label}</p><div class="big">${value}</div><small>${small}</small></div>`;
  const n = (v: number): string => v.toLocaleString('en');
  const speed = `${Number((d.downloads.freeSpeed / 1024 / 1024).toFixed(1))} MB/s`;
  return html`<div class="tiles">
      ${tile('Mods live', n(d.mods), 'showing on the site')}
      ${tile('Accounts', n(d.totals.accounts), 'signed up')}
      ${tile('Downloads', n(d.totals.downloadsThisMonth), `this month, by ${n(d.totals.downloaders)} ${d.totals.downloaders === 1 ? 'person' : 'people'}`)}
      ${tile('Open reports', n(open), 'from signed-in players', open > 0)}
      ${tile('Blocked', n(d.blocklist.length), 'accounts and repositories')}
      ${tile('Free speed', speed, d.downloads.mode === 'nginx' ? 'through nginx; EDGEMODS_FREE_SPEED' : 'not applied: this server sends downloads to GitHub')}
    </div>
    ${sec('01', 'Spot review', html`<p class="dim">Mods merge by themselves when every check passes. Look over the newest releases here, then mark each reviewed.</p>
      ${d.spot.length
        ? html`<div class="tw"><table><thead><tr><th>Mod</th><th>Owner</th><th>Released</th><th>Contents</th><th></th></tr></thead><tbody>
          ${d.spot.map((s) => html`<tr><td><b>${s.name}</b><small>${s.id} · ${s.version}${s.firstPublished === s.publishedAt ? ' · new mod' : ''}</small></td><td>${s.ownerLogin}</td>
            <td class="n left">${ago(s.publishedAt)}</td>
            <td>${s.runsCode ? html`<span class="st off">Runs code</span>` : html`<span class="st on">No code</span>`} ${s.adult ? html`<span class="st wip">18+</span>` : ''}</td>
            <td class="acts"><a class="btn sm" href="/mods/${s.id}">Look</a>
              <form method="post" action="/admin/mods/${s.id}"><input type="hidden" name="action" value="reviewed"><input type="hidden" name="version" value="${s.version}">
                <button class="btn sm" type="submit">Reviewed</button></form></td></tr>`)}
          </tbody></table></div>`
        : html`<p class="empty">Every release on the site has been looked over.</p>`}`)}`;
}

function search(tab: AdminTab, q: string, placeholder: string): Html {
  return html`<form class="row adminsearch" method="get" action="/admin"><input type="hidden" name="tab" value="${tab}">
    <label class="sr" for="q-${tab}">Search</label><input class="search" id="q-${tab}" name="q" value="${q}" placeholder="${placeholder}">
    <button class="btn sm" type="submit">Search</button>${q ? html`<a class="btn sm" href="/admin?tab=${tab}">Clear</a>` : ''}</form>`;
}

function modsTab(d: AdminData): Html {
  const status = (m: AdminMod): Html => {
    if (m.blockedBy) return html`<span class="st off">Blocked ${m.blockedBy === 'github' ? 'account' : 'repository'}</span>`;
    if (m.moderation === 'blocked') return html`<span class="st off">Blocked</span>`;
    if (m.moderation === 'hidden') return html`<span class="st off">Hidden</span>`;
    return m.shownVersion ? html`<span class="st on">Live</span>` : html`<span class="st wip">Waiting for checks</span>`;
  };
  const adult = (m: AdminMod): string => m.adultOverride === undefined ? (m.adult ? '18+ (modder)' : '') : m.adultOverride ? '18+ (admin)' : 'not 18+ (admin)';
  return html`${search('mods', d.q, 'Id, name or GitHub owner')}
    ${d.modList.length ? html`<div class="tw"><table><thead><tr><th>Mod</th><th>Owner</th><th>Status</th><th>Downloads</th><th>Reports</th><th>Action</th></tr></thead><tbody>
    ${d.modList.map((m) => html`<tr><td>${m.shownVersion ? html`<a href="/mods/${m.id}"><b>${m.name}</b></a>` : html`<b>${m.name}</b>`}<small>${m.id} · ${m.shownVersion ?? m.latest ?? ''}${m.runsCode ? ' · runs code' : ''}${adult(m) ? ` · ${adult(m)}` : ''}</small></td>
      <td>${m.ownerLogin}<small>${m.repo}</small></td>
      <td>${status(m)}${m.moderationReason ? html`<small>${m.moderationReason}</small>` : ''}</td>
      <td class="n">${m.downloads.toLocaleString('en')}</td><td class="n">${m.openReports ? html`<a href="/admin?tab=reports">${m.openReports}</a>` : '—'}</td>
      <td><form class="rowact" method="post" action="/admin/mods/${m.id}">
        <label class="sr" for="act-${m.id}">Action for ${m.name}</label>
        <select class="sort" id="act-${m.id}" name="action">
          <option value="hide">Hide</option><option value="block">Block</option><option value="show">Show again</option>
          <option value="adult-yes">Mark 18+</option><option value="adult-no">Mark not 18+</option><option value="adult-auto">18+ as the modder says</option>
          <option value="block-github">Block the GitHub account</option><option value="block-repo">Block the repository</option>
        </select>
        <input class="search" name="reason" maxlength="300" placeholder="Reason (private)" aria-label="Reason">
        <button class="btn sm" type="submit">Apply</button></form></td></tr>`)}
    </tbody></table></div>` : html`<p class="empty">${d.q ? 'No mod matches.' : 'No mods in the index yet.'}</p>`}`;
}

function usersTab(d: AdminData): Html {
  const via = (id: string): string => (id.startsWith('github|') ? 'GitHub' : id.startsWith('google-oauth2|') ? 'Google' : id.startsWith('auth0|') ? 'Email' : 'Auth0');
  return html`${search('users', d.q, 'Username, email or GitHub login')}
    ${d.users.length ? html`<div class="tw"><table><thead><tr><th>Account</th><th>Sign-in</th><th>Joined</th><th>Last seen</th><th>Downloads</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${d.users.map((u) => html`<tr><td><b>${u.username ?? '(no username yet)'}</b><small>${u.email ?? ''}${u.email && !u.emailVerified ? ' (not verified)' : ''}</small></td>
      <td>${via(u.id)}${u.githubLogin ? html`<small>${u.githubLogin}</small>` : ''}</td>
      <td class="n left">${ago(u.createdAt)}</td><td class="n left">${ago(u.seenAt)}</td><td class="n">${u.downloads.toLocaleString('en')}</td>
      <td>${u.status === 'blocked' ? html`<span class="st off">Blocked</span>${u.blockedReason ? html`<small>${u.blockedReason}</small>` : ''}` : html`<span class="st on">Active</span>`}</td>
      <td>${u.id === d.me ? html`<span class="dim">You</span>` : html`<form class="rowact" method="post" action="/admin/users/${encodeURIComponent(u.id)}">
        ${u.status === 'blocked'
          ? html`<input type="hidden" name="action" value="unblock"><button class="btn sm" type="submit">Unblock</button>`
          : html`<input type="hidden" name="action" value="block"><input class="search" name="reason" maxlength="300" placeholder="Reason (private)" aria-label="Reason">
                 <button class="btn sm danger" type="submit">Block</button>`}</form>`}</td></tr>`)}
    </tbody></table></div>` : html`<p class="empty">${d.q ? 'No account matches.' : 'No accounts yet.'}</p>`}`;
}

function reportsTab(d: AdminData): Html {
  const name = (id: string): string => d.names.get(id) ?? id;
  const openOnes = d.reports.filter((r) => r.status === 'open');
  const closed = d.reports.filter((r) => r.status === 'closed').slice(0, 50);
  return html`${openOnes.length ? html`<div class="tw"><table><thead><tr><th>Mod</th><th>From</th><th>Reason</th><th>When</th><th>Close</th></tr></thead><tbody>
    ${openOnes.map((r) => html`<tr><td><a href="/mods/${r.modId}"><b>${name(r.modId)}</b></a><small>${r.modId}</small></td><td>${r.by ?? '(deleted account)'}</td>
      <td><b>${REPORT_REASONS[r.reason]}</b>${r.note ? html`<small class="wrapnote">${r.note}</small>` : ''}</td><td class="n left">${ago(r.createdAt)}</td>
      <td><form class="rowact" method="post" action="/admin/reports/${String(r.id)}"><input type="hidden" name="action" value="close">
        <input class="search" name="note" maxlength="500" placeholder="What was done (private)" aria-label="What was done">
        <button class="btn sm" type="submit">Close</button></form></td></tr>`)}
    </tbody></table></div>` : html`<p class="empty">No open reports. Signed-in players report a mod from its page.</p>`}
    ${closed.length ? sec('', 'Closed', html`<div class="tw"><table><thead><tr><th>Mod</th><th>Reason</th><th>Closed</th><th>By</th><th>What was done</th></tr></thead><tbody>
      ${closed.map((r) => html`<tr><td>${name(r.modId)}</td><td>${REPORT_REASONS[r.reason]}</td><td class="n left">${ago(r.closedAt)}</td><td>${r.closedBy ?? ''}</td><td>${r.closeNote ?? ''}</td></tr>`)}
    </tbody></table></div>`) : ''}`;
}

function blocklistTab(d: AdminData): Html {
  const kind = { github: 'GitHub account', repo: 'Repository', account: 'EDGEmods account' } as const;
  return html`<form class="panel row blockform" method="post" action="/admin/blocklist"><input type="hidden" name="action" value="add">
      <label class="sr" for="bkind">What to block</label>
      <select class="sort" id="bkind" name="kind"><option value="github">GitHub account</option><option value="repo">Repository</option></select>
      <label class="sr" for="bname">Who</label><input class="search" id="bname" name="name" required maxlength="140" placeholder="login, or owner/repo">
      <label class="sr" for="breason">Reason</label><input class="search" id="breason" name="reason" maxlength="300" placeholder="Reason (private)">
      <button class="btn sm danger" type="submit">Block</button></form>
    <p class="dim small">The blocklist is private. A blocked GitHub account's mods are hidden and it cannot sign in; a blocked repository's mods are hidden. Both are kept by GitHub's numeric id, so a rename changes nothing. Block an EDGEmods account from the Users tab. The registry's merge checks will ask the server about the blocklist once the site is live.</p>
    ${d.blocklist.length ? html`<div class="tw"><table><thead><tr><th>What</th><th>Who</th><th>Reason</th><th>By</th><th>When</th><th></th></tr></thead><tbody>
    ${d.blocklist.map((b) => html`<tr><td>${kind[b.kind]}</td><td><b>${b.label}</b>${b.kind === 'account' ? '' : html`<small>id ${b.value}</small>`}</td><td>${b.reason}</td><td>${b.by}</td><td class="n left">${ago(b.at)}</td>
      <td class="acts"><form method="post" action="${b.kind === 'account' ? `/admin/users/${encodeURIComponent(b.value)}` : '/admin/blocklist'}">
        <input type="hidden" name="action" value="${b.kind === 'account' ? 'unblock' : 'remove'}">${b.kind === 'account' ? '' : html`<input type="hidden" name="kind" value="${b.kind}"><input type="hidden" name="value" value="${b.value}">`}
        <button class="btn sm" type="submit">Unblock</button></form></td></tr>`)}
    </tbody></table></div>` : html`<p class="empty">Nothing is blocked.</p>`}`;
}

function logTable(audit: AdminData['audit']): Html {
  return audit.length
    ? html`<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>
        ${audit.map((a) => html`<tr><td class="n left">${ago(a.at)}</td><td>${a.who}</td><td>${a.action}</td><td>${a.detail}</td></tr>`)}
      </tbody></table></div>`
    : html`<p class="empty">Every admin action shows up here: who, what and when.</p>`;
}
