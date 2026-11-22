// Manual download: a mod's files saved to a folder the person picks, each checked against the SHA-256 EDGEmods
// recorded when it checked the release. Installing them into EDGEdeck is R4c.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import * as vscode from 'vscode';
import { ApiError, type Api } from './core/index.js';

const FOLDER_KEY = 'edgemods.downloadFolder';

export interface DownloadHost {
  api(): Api;
  signedIn(): Promise<boolean>;
  signIn(): Promise<unknown>;
  log(line: string): void;
}

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** A file name the site gave that is safe to write as it is: no folders, nothing Windows refuses. */
function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && basename(name) === name && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !/^\.+$/.test(name) && !/[. ]$/.test(name);
}

export class Downloads {
  constructor(private readonly context: vscode.ExtensionContext, private readonly host: DownloadHost) {}

  /**
   * Saves these files of a release. With no `files`, the release's only file, or a choice among its files.
   * Returns the paths saved.
   */
  async save(mod: string, version: string, files?: string[]): Promise<string[]> {
    if (!(await this.host.signedIn())) {
      const c = await vscode.window.showInformationMessage('Downloading needs a free EDGEmods account.', 'Sign in');
      if (!c || !(await this.host.signIn()) || !(await this.host.signedIn())) return [];
    }
    const api = this.host.api();
    let info;
    try {
      info = await api.mod(mod);
    } catch (err) {
      void vscode.window.showErrorMessage(`EDGEmods: ${err instanceof Error ? err.message : err}`);
      return [];
    }
    const release = info.releases.find((r) => r.version === version);
    if (!release) {
      void vscode.window.showErrorMessage(`EDGEmods: ${info.name} has no version ${version} any more.`);
      return [];
    }
    let names = files?.filter((f) => release.files.some((x) => x.name === f)) ?? [];
    if (!files) {
      if (release.files.length === 1) names = [release.files[0].name];
      else {
        const picks = await vscode.window.showQuickPick(
          release.files.map((f) => ({ label: f.title ?? f.name, description: `${f.name} · ${mb(f.size)}`, detail: f.role === 'required' ? 'Required' : f.role === 'optional' ? 'Optional' : 'Choose one of a group', picked: f.role === 'required', name: f.name })),
          { title: `Download ${info.name} ${version}`, placeHolder: 'Pick the files to save', canPickMany: true },
        );
        names = picks?.map((p) => p.name) ?? [];
      }
    }
    if (!names.length) return [];
    const bad = names.find((n) => !safeName(n));
    if (bad) {
      void vscode.window.showErrorMessage(`EDGEmods: the file name "${bad}" cannot be saved as it is on this PC, so nothing was downloaded. Report the mod.`);
      return [];
    }
    const remembered = this.context.globalState.get<string>(FOLDER_KEY);
    const start = remembered && existsSync(remembered) ? remembered : join(homedir(), 'Downloads');
    const chosen = await vscode.window.showOpenDialog({
      title: `Where to save ${names.length === 1 ? names[0] : `${names.length} files of ${info.name}`}`,
      defaultUri: vscode.Uri.file(start), canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Save here',
    });
    const folder = chosen?.[0]?.fsPath;
    if (!folder) return [];
    await this.context.globalState.update(FOLDER_KEY, folder);
    const replacing = names.filter((n) => existsSync(join(folder, n)));
    if (replacing.length) {
      const c = await vscode.window.showWarningMessage(`${replacing.join(', ')} ${replacing.length === 1 ? 'is' : 'are'} already in that folder.`, { modal: true }, 'Replace');
      if (c !== 'Replace') return [];
    }
    const sums = new Map((release.check?.downloads ?? []).map((d) => [d.name, d.sha256]));
    const saved: string[] = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `EDGEmods: downloading ${info.name} ${version}`, cancellable: true }, async (progress, cancel) => {
      const stop = new AbortController();
      cancel.onCancellationRequested(() => stop.abort());
      for (const [i, name] of names.entries()) {
        const sha256 = sums.get(name);
        if (!sha256) this.host.log(`download ${mod} ${version} ${name}: EDGEmods has not checked this file yet, so it is saved without a SHA-256 check`);
        let last = 0;
        try {
          await api.download(api.downloadPath(mod, version, name), join(folder, name), {
            sha256, signal: stop.signal,
            onProgress: (done, total) => {
              const share = total ? (done - last) / total / names.length : 0;
              last = done;
              progress.report({ message: `${names.length > 1 ? `${i + 1} of ${names.length}: ` : ''}${name}, ${mb(done)}${total ? ` of ${mb(total)}` : ''}`, increment: share * 100 });
            },
          });
          saved.push(join(folder, name));
          this.host.log(`downloaded ${mod} ${version} ${name}${sha256 ? ', SHA-256 matches' : ''}`);
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          this.host.log(`download ${mod} ${version} ${name}: ${text}`);
          if (err instanceof ApiError && err.code === 'cancelled') return;
          if (err instanceof ApiError && err.code === 'username') {
            void vscode.commands.executeCommand('edgemods.chooseUsername');
            return;
          }
          void vscode.window.showErrorMessage(`EDGEmods: ${name} did not download. ${text}`, 'Try again').then((c) => c && this.save(mod, version, [name]));
          return;
        }
      }
    });
    if (saved.length) {
      const c = await vscode.window.showInformationMessage(saved.length === 1 ? `Saved ${basename(saved[0])}.` : `Saved ${saved.length} files of ${info.name}.`, 'Show in folder');
      if (c) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(saved[0]));
    }
    return saved;
  }
}
