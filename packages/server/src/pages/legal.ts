// The privacy policy and the terms (/privacy, /terms). Google's consent screen links to both, and a site with accounts
// needs them. The facts are what the code does (site-store.ts, accounts.ts, downloads.ts, the deploy files); the
// wording is the owner's. While LEGAL_DRAFT is true each page says it is a draft and stays out of search engines.
// Every [bracketed] gap is for the owner to fill.

import { html, type Html } from '../html.js';
import { page, type PageContext } from './layout.js';

/** True until the owner has agreed the text. */
export const LEGAL_DRAFT = true;
/** The date the text last changed. */
export const LEGAL_DATE = '2026-11-23';

/** A gap the owner fills in. */
const todo = (text: string): Html => html`<mark class="todo">[${text}]</mark>`;

function legalPage(ctx: PageContext, title: string, heading: Html, lede: string, body: Html): Html {
  return page(ctx, { title, description: lede, noindex: LEGAL_DRAFT }, html`<main class="wrap legal">
    <div class="pagehead"><div class="eyebrow">EDGEmods · ${LEGAL_DATE}</div><h1>${heading}</h1><p class="lede">${lede}</p></div>
    ${LEGAL_DRAFT ? html`<p class="panel draftnote"><b>Draft.</b> This text is not agreed yet and may change before EDGEmods opens.</p>` : ''}
    <article class="readme">${body}</article>
  </main>`);
}

export function privacyPage(ctx: PageContext): Html {
  return legalPage(ctx, 'Privacy', html`Privacy`, 'What EDGEmods keeps about you, why, who else handles it, and how to see or delete it.', html`
<h2>The short version</h2>
<ul>
  <li>You can browse every mod without an account. Browsing sets no cookies.</li>
  <li>No ads, no trackers, no analytics. We never sell or rent anything about you.</li>
  <li>We keep what an account needs: who you are when you sign in, your username, your likes, downloads and reports.</li>
  <li>You can download everything we keep about you, and delete your account, from your Profile.</li>
</ul>

<h2>Who we are</h2>
<p>EDGEmods (edgemods.ai) is run by ${todo('name of the person or company')}, ${todo('postal address')}. Write to ${todo('contact email')} about anything on this page.</p>

<h2>When you browse</h2>
<p>We keep nothing about visitors in our database. Like every web server, ours writes a log line for each request: your IP address, the page, the time and what your browser says it is. We use the log to keep the site running and to stop abuse, and delete it after ${todo('number')} days.</p>
<p>Every page, picture and font comes from edgemods.ai itself, so your browser contacts no one else while you browse.</p>

<h2>When you sign in</h2>
<p>Sign-in is run by Auth0 (Okta). You sign in with GitHub, Google, or an email and password. A password goes to Auth0, never to us. From the sign-in we receive and keep:</p>
<ul>
  <li>Auth0's id for you, the name your sign-in gives, and your email address and whether it is verified;</li>
  <li>for a GitHub sign-in, your GitHub user number and login (modders' mods are found by these);</li>
  <li>the username you choose on EDGEmods, and when you last changed it;</li>
  <li>whether you chose to see adult mods;</li>
  <li>when your account was made and when you last used it.</li>
</ul>

<h2>Cookies</h2>
<p>Only two, both needed for signing in. Neither tracks you anywhere else.</p>
<ul>
  <li><code>edgemods_session</code> keeps you signed in for up to 30 days. We store only a fingerprint of it (SHA-256), so a copy of our database cannot sign anyone in.</li>
  <li><code>edgemods_login</code> lives for 10 minutes while you sign in, and is then removed.</li>
</ul>

<h2>What you do on EDGEmods</h2>
<ul>
  <li><b>Likes.</b> Others see how many likes a mod has, not who gave them.</li>
  <li><b>Downloads.</b> Which mod, version and file you downloaded, and when. Others see only how many times a mod was downloaded. Your list is your Downloaded mods tab.</li>
  <li><b>Reports.</b> The reason and your note. Admins see who sent a report.</li>
</ul>

<h2>Who sees what</h2>
<p>Other people see your username, and a modder's GitHub login on their mods. EDGEmods' admins can see the account details above, including your email address, to answer reports and stop abuse. Every admin action is logged.</p>

<h2>Who else handles your data</h2>
<table>
  <tr><th>Who</th><th>For</th></tr>
  <tr><td>Auth0 (Okta)</td><td>Sign-in, and the email it sends you (verifying your address, resetting a password). Its servers are in the United States.</td></tr>
  <tr><td>Amazon Web Services</td><td>The server that runs EDGEmods, the encrypted backup of our database (Amazon S3), and sending email (Amazon SES). Region: ${todo('AWS region')}.</td></tr>
  <tr><td>GitHub, Google</td><td>Only when you choose to sign in with them, under their own privacy policies.</td></tr>
  <tr><td>GitHub</td><td>Mods live in their authors' GitHub repositories. Our server fetches the files for your download, so GitHub does not see you. A link to a repository takes you to GitHub, under GitHub's policy.</td></tr>
</table>

<h2>The VS Code extension</h2>
<p>The EDGEmods extension signs in the same way. It keeps your sign-in in VS Code's secret storage on your own computer, contacts edgemods.ai only when you use it, and sends no telemetry. Its tools for AI assistants (MCP) browse as a visitor.</p>

<h2>Your choices</h2>
<ul>
  <li><b>See your data:</b> Profile, "Download my data", gives everything above in one file.</li>
  <li><b>Change it:</b> your username from your Profile. Your email comes from your sign-in; to change it, change it there, or write to us.</li>
  <li><b>Delete your account:</b> Profile, "Delete account". It removes your account at Auth0 and here: your profile, sign-ins, likes and settings. Your downloads stay only as anonymous counts, and your reports without your name. Your old username is held for 30 days so nobody can pose as you. Copies in our backups are gone within ${todo('number')} days.</li>
</ul>
<p>Depending on where you live (for example the EU, the UK or California) you may have further rights: to object, to restrict use, or to complain to a data protection authority. Write to ${todo('contact email')} and we answer within 30 days.</p>

<h2>Why we may use it</h2>
<p>For people in the EU and UK: we use your account data to give you the account you asked for (a contract), and logs and reports to keep EDGEmods safe (a legitimate interest). Showing adult mods is your own choice in your settings.</p>

<h2>Age</h2>
<p>You must be at least ${todo('13 or 16')} to make an account. Cyberpunk 2077 is a game for adults. Adult mods are hidden unless you sign in and choose to see them.</p>

<h2>Changes</h2>
<p>When this page changes, its date changes. We tell account holders about a change that matters before it applies.</p>
`);
}

export function termsPage(ctx: PageContext): Html {
  return legalPage(ctx, 'Terms', html`Terms of <span>use</span>`, 'The rules for using EDGEmods, for players and for modders.', html`
<h2>What EDGEmods is</h2>
<p>EDGEmods is a registry and a website for Cyberpunk 2077 mods. Each mod lives in its author's own GitHub repository; EDGEmods lists it, shows its page, and passes its files on when you download. EDGEmods is run by ${todo('name of the person or company')}. It is not affiliated with or endorsed by CD Projekt RED. Cyberpunk 2077 is a trademark of CD Projekt S.A.</p>
<p>By using edgemods.ai or the EDGEmods extension you agree to these terms and to the <a href="/privacy">privacy policy</a>.</p>

<h2>Accounts</h2>
<ul>
  <li>Browsing needs no account. Downloading, liking and reporting do.</li>
  <li>One account per person. Keep your sign-in to yourself; what happens with your account is yours to answer for.</li>
  <li>Your username must not pose as someone else, or EDGEmods, or be offensive. We may change a username that breaks this.</li>
</ul>

<h2>Using mods</h2>
<ul>
  <li>Mods are made by their authors, not by EDGEmods. Each comes under its author's licence, shown on its page.</li>
  <li>EDGEmods checks each release (its files, what they contain, and a malware scan) before it shows. The checks lower the risk; they are no guarantee.</li>
  <li>Mods change your game. Keep backups of your saves. You use mods at your own risk.</li>
</ul>

<h2>Publishing mods</h2>
<p>If you publish a mod on EDGEmods:</p>
<ul>
  <li>It stays in your repository and under your licence. EDGEmods does not take it over.</li>
  <li>You give EDGEmods permission to show its name, description, pictures, README and release notes, and to pass its files to players, for as long as it is listed.</li>
  <li>You must have the right to everything in it. Credit others' work and have their permission.</li>
  <li>Follow CD Projekt RED's Fan Content Guidelines. A mod on EDGEmods is free: no paywall, no early access for payment. Donation links are fine.</li>
  <li>Mark adult content as adult.</li>
  <li>No malware. No code that collects players' data or contacts other servers without telling players plainly on the mod's page.</li>
  <li>You can take your mod off EDGEmods at any time: ${todo('how: write to us, or a button once there is one')}.</li>
</ul>

<h2>Rules for everyone</h2>
<p>Do not upload or link to anything illegal, harmful or hateful; harass anyone; break or overload the site; get around a block; or collect data from EDGEmods in bulk without our permission.</p>

<h2>Reports and moderation</h2>
<p>Anyone signed in can report a mod. Admins may hide or block a mod, an account, or a GitHub account or repository that breaks these terms, and may do so before asking. Each action is logged with its reason. If you think we got it wrong, write to ${todo('contact email')}.</p>

<h2>Copyright complaints</h2>
<p>If a mod on EDGEmods uses your work without permission, write to ${todo('contact email')} with the mod's page, what is yours, and how to reach you. We hide the mod while we look into it. The files themselves are on GitHub, which has its own process for copyright claims.</p>

<h2>Downloads</h2>
<p>Every mod is free to download. Free downloads have a speed limit, so EDGEmods can afford to run.</p>

<h2>No warranty</h2>
<p>EDGEmods is provided as it is, without any warranty. As far as the law allows, ${todo('name of the person or company')} is not liable for damage from using EDGEmods or any mod on it, including lost saves or a broken game install. Nothing here limits rights the law does not let us limit.</p>

<h2>Ending</h2>
<p>You can delete your account at any time from your Profile. We may suspend or close an account that breaks these terms.</p>

<h2>Changes and law</h2>
<p>When these terms change, their date changes; we tell account holders about a change that matters before it applies. These terms are governed by the law of ${todo('country or state')}.</p>
<p>Questions: ${todo('contact email')}.</p>
`);
}
