// A mod's page in an editor tab, one tab per mod. The content is the website's own page for the person signed in
// (GET /api/v1/mods/<id>/view), in the site's look; its script (media/mod.js) switches tabs and pictures in place and
// sends every link and button here, where pageLink() decides what it may do.

import * as vscode from 'vscode';
import { compareVersions } from '@edgemodders/edgemods-format';
import { ApiError, installLink, MOD_TABS, pageLink, REPORT_REASONS, type Api, type ModTab, type ReportReason } from './core/index.js';
import type { DeckState } from './install.js';
import { esc, shell, webviewOptions } from './webview.js';

export interface ModHost {
  api(): Api;
  signedIn(): Promise<boolean>;
  signIn(): Promise<unknown>;
  /** An edgemods: link from the page's Mod manager button, or the toolbar's Install. */
  install(url: string): Promise<void>;
  /** What EDGEdeck has of the mod; undefined while EDGEdeck is not running. */
  deckState(id: string): DeckState | undefined;
  download(mod: string, version: string, file?: string): Promise<unknown>;
  browse(filters: { q: string; type: string[]; tag: string[] }): Promise<void>;
  log(line: string): void;
}

interface State {
  id: string;
  tab?: ModTab;
}

export class ModPanels implements vscode.WebviewPanelSerializer<State> {
  static readonly viewType = 'edgemods.mod';
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly extensionUri: vscode.Uri, private readonly host: ModHost) {}

  /** Opens the mod's tab, or brings it forward, on this tab of the page. */
  async open(id: string, tab?: ModTab): Promise<void> {
    const open = this.panels.get(id);
    if (open) {
      open.reveal();
      if (tab) open.webview.postMessage({ type: 'tab', tab });
      return;
    }
    const panel = vscode.window.createWebviewPanel(ModPanels.viewType, id, vscode.ViewColumn.Active, { ...webviewOptions(this.extensionUri), retainContextWhenHidden: false });
    this.adopt(panel, { id, tab });
  }

  /** VS Code brings back the tabs that were open when it closed. */
  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: State | undefined): Promise<void> {
    if (!state || typeof state.id !== 'string') {
      panel.dispose();
      return;
    }
    panel.webview.options = webviewOptions(this.extensionUri);
    this.adopt(panel, { id: state.id, tab: MOD_TABS.includes(state.tab as ModTab) ? state.tab : undefined });
  }

  /** Every open tab again: after signing in or out, or a new site. */
  refreshAll(): void {
    for (const [id, panel] of this.panels) void this.render(panel, id);
  }

  private adopt(panel: vscode.WebviewPanel, state: State): void {
    const { id } = state;
    this.panels.set(id, panel);
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'images', 'activity.svg');
    panel.onDidDispose(() => {
      if (this.panels.get(id) === panel) this.panels.delete(id);
    });
    panel.webview.onDidReceiveMessage((m) => void this.received(panel, id, m));
    void this.render(panel, id, state.tab);
  }

  /** The toolbar's words and button for what EDGEdeck has, against the newest release on EDGEmods. */
  private deckBar(id: string, newest?: string): string {
    const s = this.host.deckState(id);
    if (!s || !newest) return '';
    const button = (label: string): string => `<button class="btn sm go" type="button" data-act="install" data-version="${esc(newest)}">${esc(label)}</button>`;
    if (s.on) {
      const where = s.on.deployed ? 'in the game' : 'not deployed yet';
      const older = compareVersions(newest, s.on.version) > 0;
      return `<span class="dim">In EDGEdeck: ${esc(s.on.version)}, ${where}${older ? ` · ${esc(newest)} is out` : ''}</span>${older ? button(`Update to ${newest}`) : ''}`;
    }
    return s.off.length ? `<span class="dim">In EDGEdeck, turned off (${esc(s.off.map((m) => m.version).join(', '))})</span>${button('Install')}` : button('Install');
  }

  private async render(panel: vscode.WebviewPanel, id: string, tab?: ModTab, reported?: 'sent' | 'already'): Promise<void> {
    const api = this.host.api();
    const toolbar = (name: string, newest?: string): string => `<div class="vsbar wrap"><span class="dim mono">${esc(name)}</span>
      <span class="grow"></span>${this.deckBar(id, newest)}<button class="btn sm" type="button" data-act="refresh">Refresh</button><button class="btn sm" type="button" data-act="site">Open on ${esc(new URL(api.site).host)}</button></div>`;
    panel.webview.html = shell(panel.webview, this.extensionUri, api.site, { title: id, script: 'mod.js', bodyClass: 'modtab', data: { mod: id }, body: `${toolbar('EDGEmods')}<p class="wrap dim loading">Loading…</p>` });
    try {
      const page = await api.modPage(id, tab, reported);
      if (!this.panels.has(id)) return;
      panel.title = page.name;
      panel.webview.html = shell(panel.webview, this.extensionUri, api.site, {
        // A tab only when one was asked for; otherwise the page's script keeps the one shown last.
        title: page.name, script: 'mod.js', bodyClass: 'modtab', data: { mod: page.id, ...(tab ? { tab: page.tab } : {}) },
        // The site built and cleaned this HTML: its words are escaped and the README sanitized (packages/server).
        body: `${toolbar(`EDGEmods · ${page.name} ${page.version}`, page.version)}${page.html}`,
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      this.host.log(`mod ${id}: ${text}`);
      const signIn = err instanceof ApiError && err.code === 'adult' && !(await this.host.signedIn());
      panel.webview.html = shell(panel.webview, this.extensionUri, api.site, {
        title: id, script: 'mod.js', bodyClass: 'modtab', data: { mod: id },
        body: `${toolbar('EDGEmods')}<main class="wrap"><div class="pagehead"><div class="eyebrow">${esc(id)}</div><h1>Not <span>shown</span></h1>
          <p class="lede">${esc(text)}</p><div class="cta"><button class="btn go" type="button" data-act="refresh">Try again</button>${signIn ? '<a class="btn" href="/signin">Sign in</a>' : ''}</div></div></main>`,
      });
    }
  }

  private async received(panel: vscode.WebviewPanel, id: string, m: unknown): Promise<void> {
    if (!m || typeof m !== 'object') return;
    const msg = m as Record<string, unknown>;
    const api = this.host.api();
    switch (msg.type) {
      case 'act':
        if (msg.act === 'refresh') await this.render(panel, id);
        if (msg.act === 'site') await vscode.env.openExternal(vscode.Uri.parse(api.page(`/mods/${encodeURIComponent(id)}`)));
        // The version the toolbar named; the install checks it like any link.
        if (msg.act === 'install' && typeof msg.version === 'string') await this.host.install(installLink(id, msg.version));
        return;
      case 'link':
        if (typeof msg.href === 'string') await this.follow(id, msg.href);
        return;
      case 'like': {
        if (typeof msg.like !== 'boolean') return;
        if (!(await this.host.signedIn())) {
          await this.host.signIn();
          return;
        }
        try {
          const r = await api.like(id, msg.like);
          panel.webview.postMessage({ type: 'liked', liked: r.liked, likes: r.likes });
        } catch (err) {
          panel.webview.postMessage({ type: 'liked', failed: true });
          void vscode.window.showErrorMessage(`EDGEmods: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      case 'report': {
        const reason = String(msg.reason) as ReportReason;
        if (!(reason in REPORT_REASONS)) return;
        try {
          const sent = await api.report(id, reason, typeof msg.note === 'string' ? msg.note.slice(0, 1000) : '');
          await this.render(panel, id, undefined, sent ? 'sent' : 'already');
        } catch (err) {
          void vscode.window.showErrorMessage(`EDGEmods: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
    }
  }

  /** A link on the page, as written. */
  private async follow(from: string, href: string): Promise<void> {
    const link = pageLink(href);
    const api = this.host.api();
    switch (link.kind) {
      case 'install':
        return this.host.install(link.url);
      case 'download':
        await this.host.download(link.mod, link.version, link.file);
        return;
      case 'signIn':
        await this.host.signIn();
        return;
      case 'mod':
        return this.open(link.id, link.tab);
      case 'browse':
        return this.host.browse(link);
      case 'source': {
        // The site sends signed-in people to GitHub; a browser is not signed in, so go there directly.
        try {
          const info = await api.mod(link.mod);
          if (info.repo && info.shown.tag) {
            await vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${info.repo}/blob/${encodeURIComponent(info.shown.tag)}/${link.path}`, true));
            return;
          }
        } catch {
          // The website's own gate says what to do.
        }
        await vscode.env.openExternal(vscode.Uri.parse(api.page(`/mods/${encodeURIComponent(link.mod)}/source/${link.path}`), true));
        return;
      }
      case 'site':
        await vscode.env.openExternal(vscode.Uri.parse(api.page(link.path), true));
        return;
      case 'external':
        // VS Code asks before opening a site it does not trust yet.
        await vscode.env.openExternal(vscode.Uri.parse(link.url, true));
        return;
      case 'none':
        this.host.log(`mod ${from}: link not followed: ${href.slice(0, 200)}`);
        return;
    }
  }
}
