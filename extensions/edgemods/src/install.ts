// Installing from VS Code (R4c): a mod's Install button, EDGEmods: Install a mod, the website's Mod manager button
// (an edgemods: link EDGEdeck hands over) and the MCP server's mods_install (a vscode: link) all come here. The
// steps are in src/core/install.ts; this asks the questions, shows progress and the result, and offers to deploy.
// Without EDGEdeck 0.34 or newer, it offers to save the files instead.

import { join } from 'node:path';
import * as vscode from 'vscode';
import { compareVersions } from '@edgemodders/edgemods-format';
import { bytes, carryOut, failureWords, prepare, type Api, type ChooseFiles, type Deck, type DeckMod, type Done, type InstallRequest } from './core/index.js';
import type { Downloads } from './downloads.js';

const EDGEDECK = 'edgemodders.edgedeck';

export interface InstallHost {
  api(): Api;
  signedIn(): Promise<boolean>;
  signIn(): Promise<unknown>;
  log(line: string): void;
  showLog(): void;
  /** The mod's tabs show what EDGEdeck has now. */
  changed(): void;
}

/** EDGEdeck's API as far as EDGEmods uses it. */
interface DeckApi extends Deck {
  deploy(): Promise<unknown>;
}

/** What EDGEdeck has of one mod, for its tab's toolbar. */
export interface DeckState {
  /** The release that is on, if any. */
  on?: DeckMod;
  /** Releases there but off. */
  off: DeckMod[];
}

export class Installer {
  private busy = false;

  constructor(private readonly context: vscode.ExtensionContext, private readonly host: InstallHost, private readonly downloads: Downloads) {}

  /** EDGEdeck's API when it is installed and new enough (0.34.0: installMods and edgemodsMods), activating it if needed. */
  private async deck(): Promise<{ api?: DeckApi; why?: 'missing' | 'old' }> {
    const ext = vscode.extensions.getExtension<Partial<DeckApi>>(EDGEDECK);
    if (!ext) return { why: 'missing' };
    let api: Partial<DeckApi> | undefined;
    try {
      api = ext.isActive ? ext.exports : await ext.activate();
    } catch (err) {
      this.host.log(`EDGEdeck did not start: ${err instanceof Error ? err.message : err}`);
      return { why: 'missing' };
    }
    if (typeof api?.installMods !== 'function' || typeof api.edgemodsMods !== 'function') return { why: 'old' };
    return { api: api as DeckApi };
  }

  /** What EDGEdeck has of a mod, without starting EDGEdeck: nothing until it runs. */
  state(mod: string): DeckState | undefined {
    const ext = vscode.extensions.getExtension<Partial<DeckApi>>(EDGEDECK);
    if (!ext?.isActive || typeof ext.exports?.edgemodsMods !== 'function') return undefined;
    let mods: DeckMod[];
    try {
      mods = ext.exports.edgemodsMods().filter((m) => m.modId === mod);
    } catch {
      return undefined;
    }
    return { on: mods.find((m) => m.on), off: mods.filter((m) => !m.on).sort((a, b) => compareVersions(b.version, a.version)) };
  }

  async install(req: InstallRequest): Promise<void> {
    if (this.busy) {
      void vscode.window.showInformationMessage('EDGEmods is installing a mod already. Try again when it has finished.');
      return;
    }
    this.busy = true;
    try {
      await this.run(req);
    } finally {
      this.busy = false;
      this.host.changed();
    }
  }

  private async run(req: InstallRequest): Promise<void> {
    const what = `${req.mod}${req.version ? ` ${req.version}` : ''}`;
    this.host.log(`install ${what}: asked`);
    const { api: deck, why } = await this.deck();
    if (!deck) return this.withoutDeck(req, why!);
    if (!(await this.host.signedIn())) {
      const c = await vscode.window.showInformationMessage('Installing downloads the files, which needs a free EDGEmods account.', 'Sign in');
      if (!c || !(await this.host.signIn()) || !(await this.host.signedIn())) return;
    }
    const api = this.host.api();
    const ready = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `EDGEmods: working out ${what}` }, () => prepare(api, deck, req, chooseFiles));
    if (ready.kind === 'nothing') {
      const notInGame = ready.sorted.kept.filter((k) => !k.have.deployed);
      this.host.log(`install ${what}: already in EDGEdeck (${ready.sorted.kept.map((k) => `${k.mod.id} ${k.have.version}`).join(', ')})`);
      const c = await vscode.window.showInformationMessage(
        `${ready.root.name} ${ready.root.version}${ready.plan.mods.length > 1 ? ' and the mods it needs are' : ' is'} in EDGEdeck already, turned on.${notInGame.length ? ' Deploy to put them in the game.' : ''}`,
        ...(notInGame.length ? ['Deploy now'] : []),
      );
      if (c) await deck.deploy();
      return;
    }
    if (ready.kind !== 'ready') return this.stopped(req, ready);
    const yes = await vscode.window.showInformationMessage(ready.words.message, { modal: true, detail: ready.words.detail }, 'Install');
    if (yes !== 'Install') {
      this.host.log(`install ${what}: not confirmed`);
      return;
    }
    const folder = join(this.context.globalStorageUri.fsPath, 'installs', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const done = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `EDGEmods: ${ready.root.name} ${ready.root.version}`, cancellable: true },
      (progress, cancel) => {
        const stop = new AbortController();
        cancel.onCancellationRequested(() => stop.abort());
        let shown = 0;
        return carryOut(api, deck, ready, {
          folder, signal: stop.signal,
          progress: (text, now, total) => {
            const share = total ? (now / total) * 100 : 0;
            progress.report({ message: `${text}, ${bytes(now)} of ${bytes(total)}`, increment: Math.max(0, share - shown) });
            shown = Math.max(shown, share);
          },
        });
      },
    );
    if (done.kind !== 'done') return this.stopped(req, done);
    const others = done.sorted.get.length - (done.sorted.get.includes(done.root) ? 1 : 0);
    this.host.log(`install ${what}: in EDGEdeck: ${done.installed.map((m) => `${m.modId} ${m.version} (${m.id})`).join(', ')}; not deployed`);
    const links = done.plan.links;
    const c = await vscode.window.showInformationMessage(
      `Installed ${done.root.name} ${done.root.version}${others ? ` and ${others === 1 ? '1 mod it needs' : `${others} mods it needs`}` : ''} in EDGEdeck, turned on. Deploy to put ${others ? 'them' : 'it'} in the game.${links.length ? ` It also needs ${links.map((l) => l.name).join(', ')}, from outside EDGEmods.` : ''}`,
      'Deploy now',
      ...(links.length ? [links.length === 1 ? `Open ${links[0].name}` : 'Show what to get'] : []),
    );
    if (c === 'Deploy now') await deck.deploy();
    else if (c && links.length === 1) await vscode.env.openExternal(vscode.Uri.parse(links[0].url, true));
    else if (c) {
      const pick = await vscode.window.showQuickPick(links.map((l) => ({ label: l.name, description: l.note, detail: l.url, url: l.url })), { title: 'Get these yourself (EDGEmods does not check them)' });
      if (pick) await vscode.env.openExternal(vscode.Uri.parse(pick.url, true));
    }
  }

  /** Cancelled, problems in the plan, or a failure: say so in plain words, the raw reason in the log. */
  private async stopped(req: InstallRequest, s: Exclude<Done, { kind: 'done' }>): Promise<void> {
    const what = `${req.mod}${req.version ? ` ${req.version}` : ''}`;
    if (s.kind === 'cancelled') {
      this.host.log(`install ${what}: cancelled`);
      return;
    }
    if (s.kind === 'problems') {
      this.host.log(`install ${what}: ${s.problems.join(' ')}`);
      await vscode.window.showErrorMessage(`EDGEmods cannot install ${req.mod}.`, { modal: true, detail: s.problems.join('\n\n') });
      return;
    }
    this.host.log(`install ${what}: failed at ${s.step}${s.mod ? ` (${s.mod.id} ${s.mod.version})` : ''}${s.code ? ` [${s.code}]` : ''}: ${s.reason}${s.undone?.length ? `; EDGEdeck undid ${s.undone.join(', ')}` : ''}`);
    if (s.code === 'username') {
      await vscode.commands.executeCommand('edgemods.chooseUsername');
      return;
    }
    const c = await vscode.window.showErrorMessage(`EDGEmods: ${failureWords(s)}`, 'Try again', 'Show details');
    if (c === 'Try again') await this.run(req);
    if (c === 'Show details') this.host.showLog();
  }

  /** No EDGEdeck, or one older than 0.34.0: get it, or save the files to install by hand. */
  private async withoutDeck(req: InstallRequest, why: 'missing' | 'old'): Promise<void> {
    this.host.log(`install ${req.mod}: EDGEdeck ${why === 'old' ? 'is older than 0.34.0' : 'is not installed'}`);
    const c = await vscode.window.showWarningMessage(
      why === 'old'
        ? 'Installing with requirements needs EDGEdeck 0.34 or newer. Update EDGEdeck, or save the files and install them yourself.'
        : 'Installing with requirements needs EDGEdeck, the EDGE mod manager. Get it, or save the files and install them yourself.',
      why === 'old' ? 'Update EDGEdeck' : 'Get EDGEdeck',
      'Download the files',
    );
    if (c === 'Download the files') {
      let version = req.version;
      if (!version) {
        try {
          version = (await this.host.api().mod(req.mod)).shown.version;
        } catch (err) {
          void vscode.window.showErrorMessage(`EDGEmods: ${err instanceof Error ? err.message : err}`);
          return;
        }
      }
      await this.downloads.save(req.mod, version);
    } else if (c) {
      await vscode.commands.executeCommand('workbench.extensions.search', `@id:${EDGEDECK}`);
    }
  }
}

/** The asked-for mod's files: one pick per choose-one group, then its optional files, none ticked. */
const chooseFiles: ChooseFiles = async (mod, choices) => {
  const picked: string[] = [];
  for (const g of choices.groups) {
    const items = g.files.map((f) => ({ label: f.title ?? f.name, description: `${f.name} · ${bytes(f.size)}`, name: f.name }));
    const first = items.find((i) => i.name === g.picked);
    if (first) first.description += ' · suggested';
    const pick = await vscode.window.showQuickPick(first ? [first, ...items.filter((i) => i !== first)] : items, {
      title: `${mod.name} ${mod.version}: choose one`, placeHolder: g.group, ignoreFocusOut: true,
    });
    if (!pick) return undefined;
    picked.push(pick.name);
  }
  if (choices.optional.length) {
    const picks = await vscode.window.showQuickPick(
      choices.optional.map((f) => ({ label: f.title ?? f.name, description: `${f.name} · ${bytes(f.size)}`, name: f.name })),
      { title: `${mod.name} ${mod.version}: optional files`, placeHolder: 'Tick any you want, or press Enter for none', canPickMany: true, ignoreFocusOut: true },
    );
    if (!picks) return undefined;
    picked.push(...picks.map((p) => p.name));
  }
  return picked;
};
