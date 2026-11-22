// The EDGEmods side panel (the activity bar icon): search, and the lists Updated, New, Most downloaded and Liked.
// Its script (media/browse.js) draws the mods from data with textContent only; every call to the site is made here.

import * as vscode from 'vscode';
import { imagePath, SORTS, type Api, type Card, type Sort } from './core/index.js';
import { esc, shell, webviewOptions } from './webview.js';

/** What the panel shows: a sort of the whole catalogue, or the mods the person likes. */
export type List = Sort | 'liked';

export interface Filters {
  q: string;
  list: List;
  type: string[];
  tag: string[];
}

export interface BrowseHost {
  api(): Api;
  signedIn(): Promise<boolean>;
  signIn(): Promise<unknown>;
  openMod(id: string): Promise<void>;
  log(line: string): void;
}

const LISTS: readonly List[] = [...SORTS, 'liked'];
const words = (list: string[], max: number): string[] => list.filter((v) => typeof v === 'string' && v.length > 0 && v.length <= 40).slice(0, max);

export class BrowseView implements vscode.WebviewViewProvider {
  static readonly id = 'edgemods.browse';
  private view?: vscode.WebviewView;
  private filters: Filters = { q: '', list: 'updated', type: [], tag: [] };
  private page = 1;
  /** Only the newest search's answer is drawn. */
  private asked = 0;

  constructor(private readonly extensionUri: vscode.Uri, private readonly host: BrowseHost) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = webviewOptions(this.extensionUri);
    this.draw();
    view.webview.onDidReceiveMessage((m) => void this.received(m));
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  /** Draws the panel again, for a new site. */
  draw(): void {
    if (!this.view) return;
    const site = this.host.api().site;
    this.view.webview.html = shell(this.view.webview, this.extensionUri, site, {
      title: 'EDGEmods',
      script: 'browse.js',
      bodyClass: 'side',
      data: { site },
      body: `<div class="sidebox">
  <label class="sr" for="q">Search mods</label>
  <input class="search" id="q" type="search" placeholder="Search mods" value="${esc(this.filters.q)}" autocomplete="off">
  <div class="pills" role="tablist" aria-label="Which mods"></div>
  <div class="chips"></div>
  <p class="count dim" role="status"></p>
  <div class="rows"></div>
  <button class="btn sm more" type="button" hidden>More</button>
  <p class="foot"><a href="#" data-act="site">Open edgemods.ai</a></p>
</div>`,
    });
  }

  /** Shows the panel with these filters, as a link on a mod's page asks (a type or a tag). */
  async show(change: Partial<Filters>): Promise<void> {
    this.filters = { ...this.filters, ...change };
    await vscode.commands.executeCommand(`${BrowseView.id}.focus`);
    this.view?.webview.postMessage({ type: 'filters', filters: this.filters });
    await this.search(false);
  }

  /** After signing in or out: the counts, likes and the Liked list change. */
  refresh(): void {
    if (this.view) void this.search(false);
  }

  private async received(m: unknown): Promise<void> {
    if (!m || typeof m !== 'object') return;
    const msg = m as Record<string, unknown>;
    switch (msg.type) {
      case 'ready':
        this.view?.webview.postMessage({ type: 'filters', filters: this.filters });
        await this.search(false);
        return;
      case 'search': {
        const f = msg.filters as Partial<Filters> | undefined;
        this.filters = {
          q: typeof f?.q === 'string' ? f.q.slice(0, 200) : '',
          list: LISTS.includes(f?.list as List) ? (f!.list as List) : 'updated',
          type: Array.isArray(f?.type) ? words(f.type, 13) : [],
          tag: Array.isArray(f?.tag) ? words(f.tag, 10) : [],
        };
        await this.search(msg.more === true);
        return;
      }
      case 'open':
        if (typeof msg.id === 'string' && msg.id.length <= 64) await this.host.openMod(msg.id);
        return;
      case 'signIn':
        await this.host.signIn();
        return;
      case 'site':
        await vscode.env.openExternal(vscode.Uri.parse(this.host.api().page('/mods')));
        return;
    }
  }

  private async search(more: boolean): Promise<void> {
    const view = this.view;
    if (!view) return;
    const ask = ++this.asked;
    const f = this.filters;
    this.page = more ? this.page + 1 : 1;
    const api = this.host.api();
    view.webview.postMessage({ type: 'busy', more });
    try {
      if (f.list === 'liked') {
        if (!(await this.host.signedIn())) {
          if (ask === this.asked) view.webview.postMessage({ type: 'signedOut' });
          return;
        }
        const words = f.q.trim().toLowerCase();
        const cards = (await api.likes()).cards.filter((c) => !words || `${c.name} ${c.author} ${c.summary} ${c.tags.join(' ')}`.toLowerCase().includes(words));
        if (ask === this.asked) this.post(view, cards, cards.length, 1, 1, false, 'You have not liked any mods yet. Press the heart on a mod\'s page.');
        return;
      }
      // Best match needs words to match; without them, the newest updates.
      const sort: Sort = f.list === 'relevance' && !f.q.trim() ? 'updated' : f.list;
      const r = await api.search({ q: f.q, sort, page: this.page, type: f.type, tag: f.tag });
      if (ask === this.asked) this.post(view, r.cards, r.total, r.page, r.pages, more, f.q.trim() || f.type.length || f.tag.length ? 'No mods match. Try other words.' : 'No mods on EDGEmods yet.');
    } catch (err) {
      this.host.log(`browse: ${err instanceof Error ? err.message : err}`);
      if (ask === this.asked) view.webview.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private post(view: vscode.WebviewView, cards: Card[], total: number, page: number, pages: number, append: boolean, empty: string): void {
    const site = this.host.api().site;
    view.webview.postMessage({
      type: 'results', total, page, pages, append, empty,
      cards: cards.map((c) => ({ ...c, image: `${site}${imagePath(c.id, c.card)}` })),
    });
  }
}
