// The sign-in page and the Account page (docs/design.md, "The account page"; the prototype's me.html). Every
// action is a form that works without JavaScript and comes back here with a short note.

import type { Method } from '../auth0.js';
import { compareVersions } from '@edgemodders/edgemods-format';
import type { Card, DownloadedMod, OwnedMod } from '../catalog.js';
import { html, type Html } from '../html.js';
import type { User } from '../site-store.js';
import { USERNAME_PROBLEMS, type UsernameProblem } from '../usernames.js';
import { ago, date } from '../words.js';
import { card } from './browse.js';
import { message, page, type PageContext } from './layout.js';

export const ACCOUNT_TABS = ['profile', 'likes', 'downloads', 'mods', 'settings'] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

/** The notes an action leaves; fixed sentences, so nothing from the address is shown. */
export const NOTES = {
  username: 'Your username is saved.',
  'username-invalid': USERNAME_PROBLEMS.invalid,
  'username-reserved': USERNAME_PROBLEMS.reserved,
  'username-modder': USERNAME_PROBLEMS.modder,
  'username-taken': USERNAME_PROBLEMS.taken,
  'username-wait': USERNAME_PROBLEMS.wait,
  settings: 'Your settings are saved.',
  password: 'Auth0 is sending you an email with a link to set a new password.',
  'password-failed': 'The password email could not be sent. Try again in a few minutes.',
  'delete-confirm': 'Tick the box to confirm, then press Delete account again.',
  'delete-failed': 'Your account could not be deleted just now; nothing was removed. Try again in a few minutes.',
} as const;
export type Note = keyof typeof NOTES;

export function signInPage(ctx: PageContext, returnTo: string, on: boolean): Html {
  if (!on) {
    return message(ctx, {
      title: 'Sign in',
      eyebrow: 'Accounts',
      heading: html`Sign in <span>soon</span>`,
      lede: 'Sign-in is not set up on this server yet. Browsing needs no account.',
    });
  }
  const go = (method: Method): string => `/auth/signin?method=${method}${returnTo === '/' ? '' : `&return=${encodeURIComponent(returnTo)}`}`;
  return page(ctx, { title: 'Sign in', noindex: true }, html`<main class="wrap">
    <div class="pagehead"><div class="eyebrow">Accounts</div><h1>Sign <span>in</span></h1>
      <p class="lede">A free account lets you download, install and like mods, and see where each mod comes from. Browsing needs no account.</p></div>
    <div class="signin">
      <a class="panel method" href="${go('github')}"><b>GitHub</b><span>Needed to publish mods: they live in your GitHub repositories.</span></a>
      <a class="panel method" href="${go('google')}"><b>Google</b><span>Your Google account.</span></a>
      <a class="panel method" href="${go('email')}"><b>Email</b><span>An email address and a password. New here? Choose Sign up on the next page.</span></a>
    </div>
    <p class="dim">Sign-in runs on Auth0. EDGEmods gets your name and email address, never a password, and never access to your repositories.</p>
  </main>`);
}

export interface AccountData {
  user: User;
  /** When the username may change again, if not now. */
  nextChange?: Date;
  method?: Method;
  admin: boolean;
  liked: Card[];
  downloaded: DownloadedMod[];
  /** This month's different mods against the free monthly limit, when there is one. */
  allowance?: { used: number; limit: number; resets: string };
  mine: OwnedMod[];
  canDelete: boolean;
  note?: Note;
}

export function accountPage(ctx: PageContext, tab: AccountTab, d: AccountData): Html {
  const v = ctx.viewer!;
  const tabs: [AccountTab, string][] = [
    ['profile', 'Profile'],
    ['likes', `Liked mods (${d.liked.length})`],
    ['downloads', `Downloaded mods (${d.downloaded.length})`],
    ['mods', v.github ? `My mods (${d.mine.length})` : 'Publishing'],
    ['settings', 'Settings'],
  ];
  const panel = (key: AccountTab, body: Html): Html => html`<div class="tabpanel" id="tab-${key}" role="tabpanel" data-panel="${key}"${key === tab ? '' : html` hidden`}>${body}</div>`;
  return page(ctx, { title: 'Your account', noindex: true }, html`<main class="wrap">
    <div class="pagehead"><div class="eyebrow">Signed in with ${v.via ?? 'Auth0'}${v.github ? html` · ${v.github}` : ''}</div><h1>${v.name}</h1></div>
    ${d.note ? html`<p class="panel note notice" role="status">${NOTES[d.note]}</p>` : ''}
    <div class="tabs" id="tabs" role="tablist">${tabs.map(([key, label]) => html`<a role="tab" href="/me?tab=${key}" data-tab="${key}" data-default="profile" aria-selected="${key === tab ? 'true' : 'false'}" aria-controls="tab-${key}">${label}</a>`)}</div>
    ${panel('profile', profilePanel(d))}
    ${panel('likes', d.liked.length ? html`<div class="cards">${d.liked.map((c) => card(ctx, c))}</div>` : html`<p class="empty">Mods you like show up here. Press the heart on any mod.</p>`)}
    ${panel('downloads', downloadsPanel(d))}
    ${panel('mods', modsPanel(ctx, d))}
    ${panel('settings', html`<form class="panel" method="post" action="/me/settings">
      <p class="label">Content</p>
      <label class="toggle"><input type="checkbox" name="adult" value="1"${d.user.adult ? html` checked` : ''}> Show adult mods (18+)</label>
      <p class="dim small">Off by default. Adult mods never show to people who are not signed in.</p>
      <button class="btn sm go" type="submit">Save settings</button></form>`)}
  </main>`);
}

function profilePanel(d: AccountData): Html {
  const u = d.user;
  const managedBy = d.method === 'github' ? 'GitHub' : d.method === 'google' ? 'Google' : undefined;
  return html`<div class="acct">
    <div class="panel"><p class="label">Profile</p>
      <div class="row"><span class="avatar big">${(u.username ?? u.name).slice(0, 1).toUpperCase()}</span><div><b class="bigname">${u.username ?? u.name}</b>${u.email ? html`<br><span class="dim">${u.email}</span>` : ''}</div></div>
      <dl class="kv">
        <dt>Name</dt><dd>${u.name} <span class="dim">· only you see it</span></dd>
        <dt>Email</dt><dd>${u.email ?? 'None given'} ${u.email ? (u.emailVerified ? html`<span class="tag g">Verified</span>` : html`<span class="tag y">Not verified</span>`) : ''}</dd>
        <dt>Signed in with</dt><dd>${d.method === 'github' ? `GitHub · ${u.githubLogin ?? ''}` : d.method === 'google' ? 'Google' : d.method === 'email' ? 'Email and password' : 'Auth0'}</dd>
        <dt>Member since</dt><dd>${date(u.createdAt)}</dd>
        ${d.admin ? html`<dt>Role</dt><dd>Admin</dd>` : ''}
      </dl>
      <form class="row" method="post" action="/me/username">
        <label class="sr" for="username">Username</label>
        <input class="search" id="username" name="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{2,19}" required value="${u.username ?? ''}" autocomplete="username">
        <button class="btn sm" type="submit">Change username</button></form>
      <p class="dim small">Your username is what other people see on EDGEmods, never your name or email. It can change once in 60 days${d.nextChange ? html`; your next change is possible on ${date(d.nextChange.toISOString())}` : ''}. A username you give up is kept for you for 30 days.</p>
      ${managedBy
        ? html`<p class="dim small">Your email and password are managed by ${managedBy}.</p>`
        : html`<form method="post" action="/me/password"><button class="btn sm" type="submit">Email me a link to change my password</button></form>`}
    </div>
    <div class="panel"><p class="label">Sign-in methods</p>
      <p class="dim small">Each way of signing in is its own EDGEmods account for now. Linking them, so GitHub, Google and email share one account, comes later.</p>
      ${d.method === 'github' ? '' : html`<p class="dim small">Publishing mods needs a GitHub sign-in.</p>`}
    </div>
    <div class="panel"><p class="label">Your data</p>
      <div class="row"><a class="btn sm" href="/me/data" download>Download my data</a></div>
      <form method="post" action="/me/delete" class="danger-zone">
        <label class="toggle"><input type="checkbox" name="confirm" value="1"${d.canDelete ? '' : html` disabled`}> Delete my EDGEmods account, likes and settings. My mods stay in their repositories.</label>
        <button class="btn sm danger" type="submit"${d.canDelete ? '' : html` disabled`}>Delete account</button>
        ${d.canDelete ? '' : html`<p class="dim small">Deleting accounts is not set up on this server yet.</p>`}
      </form>
    </div>
    <form method="post" action="/auth/signout"><button class="btn sm" type="submit">Sign out</button></form>
  </div>`;
}

/** What the person downloaded, with the version they got and whether a newer one is out: an update check. */
function downloadsPanel(d: AccountData): Html {
  const a = d.allowance;
  const allowance = a ? html`<p class="dim">This month: <b>${a.used} of ${a.limit}</b> different mods downloaded. The count starts again on ${date(a.resets)}. Downloading a mod again does not count twice.</p>` : '';
  if (!d.downloaded.length) return html`${allowance}<p class="empty">Mods you download show up here, with a note when a newer version is out.</p>`;
  const status = (m: DownloadedMod): Html => {
    if (!m.shownVersion) return html`<span class="st plan">No longer on EDGEmods</span>`;
    return compareVersions(m.shownVersion, m.version) > 0
      ? html`<a class="st wip" href="/mods/${m.id}?tab=versions">Newer version: ${m.shownVersion}</a>`
      : html`<span class="st on">Up to date</span>`;
  };
  return html`${allowance}<div class="tw"><table><thead><tr><th>Mod</th><th>Your version</th><th>Downloaded</th><th>Status</th></tr></thead><tbody>
    ${d.downloaded.map((m) => html`<tr><td>${m.shownVersion ? html`<a href="/mods/${m.id}"><b>${m.name ?? m.id}</b></a>` : html`<b>${m.name ?? m.id}</b>`}<small>${m.id}</small></td>
      <td class="n">${m.version}</td><td class="n">${ago(m.downloadedAt)}</td><td>${status(m)}</td></tr>`)}
    </tbody></table></div>`;
}

function modsPanel(ctx: PageContext, d: AccountData): Html {
  if (!ctx.viewer?.github) {
    return html`<div class="panel note"><p class="label">Publishing</p>
      <p>Publishing a mod needs a GitHub sign-in: your mod lives in your own GitHub repository, and EDGEmods checks that it is yours.</p>
      <p>You are signed in with ${ctx.viewer?.via ?? 'another method'}. Sign out, then sign in with GitHub to publish; your mods belong to that account.</p>
      <a class="btn sm" href="/publish">How publishing works</a></div>`;
  }
  if (!d.mine.length) {
    return html`<p class="empty">No mods yet. Publish one from REDcode in VS Code: <a href="/publish">how publishing works</a>.</p>`;
  }
  const status = (m: OwnedMod): Html => m.moderation
    ? html`<span class="st off">Hidden by EDGEmods</span>`
    : m.shownVersion ? html`<span class="st on">Live</span>` : html`<span class="st wip">Waiting for checks</span>`;
  return html`<p class="dim">Publish and update mods from VS Code: EDGEmods › My mods, or the Publish button in REDcode.</p>
    <div class="tw"><table><thead><tr><th>Mod</th><th>Status</th><th>Version</th><th>Likes</th><th>Updated</th><th></th></tr></thead><tbody>
    ${d.mine.map((m) => html`<tr><td><b>${m.name}</b><small>${m.id}</small></td><td>${status(m)}</td>
      <td class="n">${m.shownVersion ?? m.latest ?? ''}</td><td class="n">${m.likes.toLocaleString('en')}</td><td class="n">${ago(m.lastUpdated)}</td>
      <td class="acts">${m.shownVersion ? html`<a class="btn sm" href="/mods/${m.id}">Page</a>` : ''}</td></tr>`)}
    </tbody></table></div>`;
}

/** After the first sign-in: pick the name other people will see. */
export function welcomePage(ctx: PageContext, f: { value: string; returnTo: string; problem?: UsernameProblem }): Html {
  return page(ctx, { title: 'Choose your username', noindex: true }, html`<main class="wrap">
    <div class="pagehead"><div class="eyebrow">Welcome to EDGEmods</div><h1>Choose your <span>username</span></h1>
      <p class="lede">Your username is the name other people see on EDGEmods. Your real name and email stay private.</p></div>
    <form class="panel welcome" method="post" action="/welcome">
      <input type="hidden" name="return" value="${f.returnTo}">
      <label class="label" for="username">Username</label>
      <div class="row"><input class="search" id="username" name="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{2,19}" required autofocus value="${f.value}" autocomplete="username"${f.problem ? html` aria-invalid="true" aria-describedby="username-problem"` : ''}>
        <button class="btn go" type="submit">Continue</button></div>
      ${f.problem ? html`<p class="problem" id="username-problem" role="alert">${USERNAME_PROBLEMS[f.problem]}</p>` : ''}
      <p class="dim small">3 to 20 letters (a to z), digits, - or _. Capitals are kept as you type them, but Bob and bob are the same username. You can change it once in 60 days.</p>
    </form>
  </main>`);
}

export function deletedPage(ctx: PageContext): Html {
  return message(ctx, {
    title: 'Account deleted',
    eyebrow: 'Accounts',
    heading: html`Account <span>deleted</span>`,
    lede: 'Your EDGEmods account, likes and settings are gone. Your mods stay in their repositories. Thanks for being here.',
  });
}
