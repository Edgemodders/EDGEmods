// The EDGEmods extension (docs/design.md, "The EDGEmods extension"). R4a: signing in, the account in the status bar
// and VS Code's Accounts menu, choosing a username, and openLink for EDGEdeck's edgemods: links. R4b: the side panel
// (search and lists), a mod's page in an editor tab, likes, reports and manual downloads. Installing is R4c.
//
// Nothing here calls the network until the person asks for something that needs it: the status bar shows the
// account EDGEmods last named, from secret storage.

import * as vscode from 'vscode';
import { BrowseView } from './browse.js';
import { Api, ApiError, EDITOR_SCHEMES, parseLink, Session, siteOf, SignedOutError, SIGN_IN_WAIT_MS, USERNAME_PATTERN, USERNAME_RULE, type Account, type Me, type Method } from './core/index.js';
import { Downloads } from './downloads.js';
import { ModPanels } from './modPanel.js';

const PROVIDER = 'edgemods';
const DEFAULT_SITE = 'https://edgemods.ai';

/** What activate() returns: EDGEdeck calls openLink with the whole edgemods: link (EDGEdeck 0.33.0 and newer). */
export interface EdgemodsApi {
  apiVersion: 1;
  openLink(url: string): Promise<void>;
}

let log: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): EdgemodsApi {
  log = vscode.window.createOutputChannel('EDGEmods');
  const accounts = new Accounts(context);
  const host = {
    api: () => accounts.api,
    signedIn: () => accounts.session.signedIn(),
    signIn: () => accounts.signIn(),
    log: (line: string) => log.appendLine(line),
  };
  const downloads = new Downloads(context, host);
  const panels: ModPanels = new ModPanels(context.extensionUri, {
    ...host,
    install: (url) => install(downloads, url),
    download: (mod, version, file) => downloads.save(mod, version, file ? [file] : undefined),
    browse: (f) => browse.show(f),
  });
  const browse = new BrowseView(context.extensionUri, { ...host, openMod: (id) => panels.open(id) });
  context.subscriptions.push(
    accounts.onDidChangeAccount(() => {
      panels.refreshAll();
      browse.refresh();
    }),
    vscode.window.registerWebviewViewProvider(BrowseView.id, browse),
    vscode.window.registerWebviewPanelSerializer(ModPanels.viewType, panels),
    vscode.commands.registerCommand('edgemods.findMod', () => findMod(accounts, panels)),
    vscode.commands.registerCommand('edgemods.openMod', (id: unknown) => (typeof id === 'string' ? panels.open(id) : findMod(accounts, panels))),
    vscode.commands.registerCommand('edgemods.refresh', () => {
      browse.refresh();
      panels.refreshAll();
    }),
    log,
    accounts,
    vscode.authentication.registerAuthenticationProvider(PROVIDER, 'EDGEmods', accounts, { supportsMultipleAccounts: false }),
    vscode.window.registerUriHandler({ handleUri: (uri) => void accounts.handleUri(uri) }),
    vscode.commands.registerCommand('edgemods.signIn', () => accounts.signIn()),
    vscode.commands.registerCommand('edgemods.signOut', () => accounts.signOut()),
    vscode.commands.registerCommand('edgemods.chooseUsername', () => accounts.chooseUsername()),
    vscode.commands.registerCommand('edgemods.account', () => accounts.menu()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('edgemods.site')) {
        void accounts.siteChanged().then(() => {
          browse.draw();
          panels.refreshAll();
        });
      }
    }),
    context.secrets.onDidChange((e) => {
      if (e.key === accounts.session.key) void accounts.refreshView();
    }),
  );
  void accounts.refreshView();
  return { apiVersion: 1, openLink: (url) => openLink(panels, downloads, url) };
}

export function deactivate(): void {}

/** EDGEdeck hands over an edgemods: link (the website's Mod manager button): the mod's tab, then the install. */
async function openLink(panels: ModPanels, downloads: Downloads, url: string): Promise<void> {
  const link = parseLink(url);
  log.appendLine(`link: ${link ? `${link.action} ${link.mod} ${link.version}` : 'not understood'}`);
  if (!link) {
    void vscode.window.showErrorMessage('That EDGEmods link is not one this version of the EDGEmods extension understands. Updating the extension may help.');
    return;
  }
  await panels.open(link.mod, 'files');
  await install(downloads, url);
}

/** Install, from a mod's tab or a link. Installing through EDGEdeck is R4c; until then, the files can be saved. */
async function install(downloads: Downloads, url: string): Promise<void> {
  const link = parseLink(url);
  if (!link) return;
  const choice = await vscode.window.showInformationMessage(
    `Installing ${link.mod} ${link.version} through EDGEdeck, with its requirements, comes in the next update of the EDGEmods extension. For now you can save its files.`,
    'Download the files',
  );
  if (choice) await downloads.save(link.mod, link.version);
}

/** EDGEmods: Find a mod. Searches as you type; picking one opens its tab. */
async function findMod(accounts: Accounts, panels: ModPanels): Promise<void> {
  const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { id?: string }>();
  pick.title = 'Find a mod on EDGEmods';
  pick.placeholder = 'Type words from its name, description, tags or author';
  pick.matchOnDescription = true;
  pick.matchOnDetail = true;
  let asked = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const search = (q: string): void => {
    const ask = ++asked;
    pick.busy = true;
    accounts.api.search({ q, sort: q.trim() ? 'relevance' : 'updated' }).then((r) => {
      if (ask !== asked) return;
      pick.items = r.cards.length
        ? r.cards.map((c) => ({ label: c.name, description: `by ${c.author} · v${c.version}`, detail: c.summary, id: c.id, alwaysShow: true }))
        : [{ label: q.trim() ? 'No mods match those words' : 'No mods on EDGEmods yet', alwaysShow: true }];
    }, (err) => {
      if (ask === asked) pick.items = [{ label: `$(warning) ${err instanceof Error ? err.message : err}`, alwaysShow: true }];
    }).finally(() => {
      if (ask === asked) pick.busy = false;
    });
  };
  pick.onDidChangeValue((q) => {
    clearTimeout(timer);
    timer = setTimeout(() => search(q), 250);
  });
  pick.onDidAccept(() => {
    const id = pick.selectedItems[0]?.id;
    if (!id) return;
    pick.hide();
    void panels.open(id);
  });
  pick.onDidHide(() => {
    clearTimeout(timer);
    pick.dispose();
  });
  pick.show();
  search('');
}

/** The person's EDGEmods sign-in: VS Code's Accounts menu, the status bar and the commands. */
class Accounts implements vscode.AuthenticationProvider, vscode.Disposable {
  session: Session;
  api: Api;
  private readonly changed = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.changed.event;
  /** Someone signed in or out, or picked a new username: pages and lists show something else now. */
  readonly onDidChangeAccount = this.changed.event;
  private readonly status = vscode.window.createStatusBarItem('edgemods.account', vscode.StatusBarAlignment.Left, 50);
  private shown?: vscode.AuthenticationSession;
  /** A free username EDGEmods offered, until one is picked. */
  private suggestion?: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.status.name = 'EDGEmods account';
    this.status.command = 'edgemods.account';
    ({ session: this.session, api: this.api } = this.connect());
  }

  dispose(): void {
    this.session.cancel();
    this.status.dispose();
    this.changed.dispose();
  }

  // ---- the site ----

  private connect(): { session: Session; api: Api } {
    const setting = vscode.workspace.getConfiguration('edgemods').get<string>('site', DEFAULT_SITE);
    const site = siteOf(setting);
    if (!site) void vscode.window.showWarningMessage(`The edgemods.site setting (${setting}) is not an https address, or http on this PC, so EDGEmods uses ${DEFAULT_SITE}.`);
    const session = new Session(site ?? DEFAULT_SITE, this.context.secrets);
    const api = new Api(session.site, fetch, (fresh) => this.token(fresh));
    return { session, api };
  }

  async siteChanged(): Promise<void> {
    this.session.cancel();
    ({ session: this.session, api: this.api } = this.connect());
    await this.refreshView();
  }

  /** An access token for the API; a refused refresh token means signed out, which the view then shows. */
  private async token(fresh: boolean): Promise<string | undefined> {
    try {
      return await this.session.accessToken({ fresh });
    } catch (err) {
      if (err instanceof SignedOutError) {
        await this.refreshView();
        void vscode.window.showWarningMessage('Your EDGEmods sign-in has ended. Sign in again.', 'Sign in').then((c) => c && this.signIn());
        return undefined;
      }
      throw err;
    }
  }

  // ---- signing in ----

  async signIn(): Promise<Account | undefined> {
    const method = await pickMethod();
    if (!method) return undefined;
    // Auth0 sends the browser to the site's landing page, which says what happened and hands the sign-in to this
    // editor's link handler (vscode://edgemodders.edgemods/auth); the state names the editor.
    const editor = vscode.env.uriScheme;
    if (!EDITOR_SCHEMES.includes(editor)) {
      void vscode.window.showErrorMessage(`EDGEmods: signing in from this editor (${editor}) is not supported yet. Sign in from VS Code.`);
      return undefined;
    }
    const redirectUri = `${this.session.site}/auth/vscode`;
    try {
      const { url, done } = await this.session.begin(redirectUri, method, editor);
      const opened = await vscode.env.openExternal(vscode.Uri.parse(url, true));
      if (!opened) throw new Error('VS Code could not open your browser.');
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'EDGEmods: finish signing in in your browser…', cancellable: true },
        (_p, cancel) => new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => this.session.cancel('The sign-in took too long. Try again.'), SIGN_IN_WAIT_MS);
          cancel.onCancellationRequested(() => this.session.cancel());
          done.then(resolve, reject).finally(() => clearTimeout(timer));
        }),
      );
    } catch (err) {
      const text = message(err);
      log.appendLine(`sign-in: ${text}`);
      if (text !== 'The sign-in was cancelled.') void vscode.window.showErrorMessage(`EDGEmods: ${text}`);
      return undefined;
    }
    const account = await this.loadAccount();
    if (account && !account.username) await this.chooseUsername();
    else if (account?.username) void vscode.window.showInformationMessage(`Signed in to EDGEmods as ${account.username}.`);
    return this.session.account();
  }

  /** The sign-in link from the site's landing page: vscode://edgemodders.edgemods/auth?code=…&state=… */
  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== '/auth') {
      log.appendLine(`link to ${uri.path}: not one this extension handles`);
      return;
    }
    const known = await this.session.complete(new URLSearchParams(uri.query));
    log.appendLine(`sign-in link: ${known ? 'for this window' : 'not for this window'}`);
    if (!known) void vscode.window.showWarningMessage('That EDGEmods sign-in link is old or from another window. Start the sign-in again from this window.');
  }

  /** Asks EDGEmods who this is, and keeps the answer for the status bar. */
  private async loadAccount(): Promise<Account | undefined> {
    let me: Me;
    try {
      me = await this.api.me();
    } catch (err) {
      log.appendLine(`account: ${message(err)}`);
      void vscode.window.showErrorMessage(`EDGEmods: ${message(err)}`);
      return undefined;
    }
    if (!me.signedIn) {
      // Only after a sign-in that just worked, or a token the site no longer takes: say so rather than nothing.
      log.appendLine('account: the site did not take the sign-in');
      if (await this.session.signedIn()) void vscode.window.showErrorMessage('EDGEmods: the site did not take your sign-in. Sign out and sign in again.');
      return undefined;
    }
    log.appendLine(`account: signed in with ${me.via ?? 'an account'}${me.username ? ` as ${me.username}` : ', no username yet'}`);
    const account: Account = { id: me.id ?? me.name ?? 'you', username: me.username ?? undefined, name: me.name ?? 'You', via: me.via };
    await this.session.setAccount(account);
    this.suggestion = me.suggestion;
    await this.refreshView();
    return account;
  }

  async chooseUsername(): Promise<void> {
    if (!(await this.session.signedIn())) {
      const c = await vscode.window.showInformationMessage('Sign in to EDGEmods first.', 'Sign in');
      if (c) await this.signIn();
      return;
    }
    const current = (await this.session.account())?.username;
    let value = current ?? this.suggestion ?? '';
    let problem: string | undefined;
    for (;;) {
      const wanted = await vscode.window.showInputBox({
        title: current ? 'Change your EDGEmods username' : 'Choose your EDGEmods username',
        prompt: problem ?? `Other people see your username, never your name or email. ${current ? 'A username can change once in 60 days.' : 'You can change it later, once in 60 days.'}`,
        value,
        validateInput: (v) => (USERNAME_PATTERN.test(v.trim()) ? undefined : USERNAME_RULE),
        ignoreFocusOut: true,
      });
      if (wanted === undefined || wanted.trim() === current) return;
      value = wanted.trim();
      try {
        const { username } = await this.api.setUsername(value);
        await this.loadAccount();
        void vscode.window.showInformationMessage(`Your EDGEmods username is ${username}.`);
        return;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 400) {
          void vscode.window.showErrorMessage(`EDGEmods: ${message(err)}`);
          return;
        }
        problem = err.message;
      }
    }
  }

  async signOut(): Promise<void> {
    const before = this.shown;
    await this.session.signOut();
    await this.refreshView();
    if (before) void vscode.window.showInformationMessage('Signed out of EDGEmods.');
  }

  /** The status bar's menu. */
  async menu(): Promise<void> {
    const account = await this.session.account();
    if (!account) {
      await this.signIn();
      return;
    }
    const items: (vscode.QuickPickItem & { run: () => unknown })[] = [
      { label: '$(globe) Open my account on the website', run: () => vscode.env.openExternal(vscode.Uri.parse(this.api.page('/me'))) },
      { label: account.username ? '$(edit) Change my username' : '$(edit) Choose my username', run: () => this.chooseUsername() },
      { label: '$(sign-out) Sign out', run: () => this.signOut() },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: `EDGEmods: ${account.username ?? account.name}${account.via ? `, signed in with ${account.via}` : ''}` });
    await pick?.run();
  }

  // ---- what VS Code shows ----

  async refreshView(): Promise<void> {
    const account = await this.session.account();
    const signedIn = await this.session.signedIn();
    if (signedIn && account) {
      this.status.text = `$(account) ${account.username ?? 'EDGEmods: choose a username'}`;
      this.status.tooltip = `EDGEmods: signed in${account.via ? ` with ${account.via}` : ''} on ${this.session.site}`;
    } else {
      this.status.text = '$(sign-in) EDGEmods';
      this.status.tooltip = `Sign in to EDGEmods (${this.session.site})`;
    }
    this.status.show();
    const now = signedIn && account ? this.authSession(account) : undefined;
    const before = this.shown;
    this.shown = now;
    if (before?.id !== now?.id || before?.account.label !== now?.account.label) {
      this.changed.fire({ added: now && !before ? [now] : [], removed: before && !now ? [before] : [], changed: now && before ? [now] : [] });
    }
  }

  private authSession(account: Account): vscode.AuthenticationSession {
    // Other extensions get no EDGEmods token through VS Code: the token is fetched fresh by this extension only.
    return { id: `${this.session.site}#${account.id}`, accessToken: '', account: { id: account.id, label: account.username ?? account.name }, scopes: [] };
  }

  // ---- vscode.AuthenticationProvider (VS Code's Accounts menu) ----

  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    const account = await this.session.account();
    return account && (await this.session.signedIn()) ? [this.authSession(account)] : [];
  }

  async createSession(): Promise<vscode.AuthenticationSession> {
    const account = await this.signIn();
    if (!account) throw new Error('Not signed in to EDGEmods.');
    return this.authSession(account);
  }

  async removeSession(): Promise<void> {
    await this.signOut();
  }
}

async function pickMethod(): Promise<Method | undefined> {
  const items: (vscode.QuickPickItem & { method: Method })[] = [
    { label: '$(github) GitHub', description: 'Modders: needed to publish', method: 'github' },
    { label: '$(account) Google', method: 'google' },
    { label: '$(mail) Email and password', method: 'email' },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Sign in to EDGEmods',
    placeHolder: 'The same account as on the website: pick how you signed in there',
  });
  return pick?.method;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
