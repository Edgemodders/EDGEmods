// The EDGEmods extension (docs/design.md, "The EDGEmods extension"). R4a: signing in, the account in the status bar
// and VS Code's Accounts menu, choosing a username, and openLink for EDGEdeck's edgemods: links. Browsing (R4b) and
// installing (R4c) come next.
//
// Nothing here calls the network until the person asks for something that needs it: the status bar shows the
// account EDGEmods last named, from secret storage.

import * as vscode from 'vscode';
import { Api, ApiError, parseLink, Session, siteOf, SignedOutError, SIGN_IN_WAIT_MS, USERNAME_PATTERN, USERNAME_RULE, type Account, type Me, type Method } from './core/index.js';

const EXTENSION_ID = 'edgemodders.edgemods';
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
  context.subscriptions.push(
    log,
    accounts,
    vscode.authentication.registerAuthenticationProvider(PROVIDER, 'EDGEmods', accounts, { supportsMultipleAccounts: false }),
    vscode.window.registerUriHandler({ handleUri: (uri) => void accounts.handleUri(uri) }),
    vscode.commands.registerCommand('edgemods.signIn', () => accounts.signIn()),
    vscode.commands.registerCommand('edgemods.signOut', () => accounts.signOut()),
    vscode.commands.registerCommand('edgemods.chooseUsername', () => accounts.chooseUsername()),
    vscode.commands.registerCommand('edgemods.account', () => accounts.menu()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('edgemods.site')) void accounts.siteChanged();
    }),
    context.secrets.onDidChange((e) => {
      if (e.key === accounts.session.key) void accounts.refreshView();
    }),
  );
  void accounts.refreshView();
  return { apiVersion: 1, openLink: (url) => openLink(accounts, url) };
}

export function deactivate(): void {}

/** EDGEdeck hands over an edgemods: link. Installing from links is R4c; for now, the mod's page. */
async function openLink(accounts: Accounts, url: string): Promise<void> {
  const link = parseLink(url);
  log.appendLine(`link: ${link ? `${link.action} ${link.mod} ${link.version}` : 'not understood'}`);
  if (!link) {
    void vscode.window.showErrorMessage('That EDGEmods link is not one this version of the EDGEmods extension understands. Updating the extension may help.');
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    `Installing from the website's Mod manager button comes in the next update of the EDGEmods extension. For now, ${link.mod} ${link.version} can be downloaded from its page.`,
    'Open its page',
  );
  if (choice) await vscode.env.openExternal(vscode.Uri.parse(accounts.api.page(`/mods/${encodeURIComponent(link.mod)}?tab=files`)));
}

/** The person's EDGEmods sign-in: VS Code's Accounts menu, the status bar and the commands. */
class Accounts implements vscode.AuthenticationProvider, vscode.Disposable {
  session: Session;
  api: Api;
  private readonly changed = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.changed.event;
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
    const redirectUri = `${vscode.env.uriScheme}://${EXTENSION_ID}/auth`;
    try {
      const { url, done } = await this.session.begin(redirectUri, method);
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
    return this.session.account();
  }

  /** The sign-in link from the browser: vscode://edgemodders.edgemods/auth?code=…&state=… */
  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== '/auth') {
      log.appendLine(`link to ${uri.path}: not one this extension handles`);
      return;
    }
    const known = await this.session.complete(new URLSearchParams(uri.query));
    if (!known) void vscode.window.showWarningMessage('That EDGEmods sign-in link is old or from another window. Start the sign-in again from this window.');
  }

  /** Asks EDGEmods who this is, and keeps the answer for the status bar. */
  private async loadAccount(): Promise<Account | undefined> {
    let me: Me;
    try {
      me = await this.api.me();
    } catch (err) {
      void vscode.window.showErrorMessage(`EDGEmods: ${message(err)}`);
      return undefined;
    }
    if (!me.signedIn) return undefined;
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
