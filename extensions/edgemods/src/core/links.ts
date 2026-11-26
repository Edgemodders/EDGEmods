// Mod manager links (docs/links.md): edgemods://install/<mod>/<version>. Any web page can open one, so a link is
// only ever a request, which the player confirms; and it names no server, so it cannot point the extension at one.

import { ID_PATTERN, isVersion } from '@edgemodders/edgemods-format';
import { EDITOR_SCHEMES } from './session.js';

export interface InstallLink {
  action: 'install';
  mod: string;
  version: string;
}

/** The link's request, or undefined when it is not one this version understands. */
export function parseLink(url: string): InstallLink | undefined {
  const text = String(url ?? '').trim();
  // Never a query or a fragment (EDGEdeck passes the link unencoded inside its own).
  if (text.length > 300 || /[?#\s]/.test(text)) return undefined;
  const m = /^edgemods:\/\/install\/([^/]+)\/([^/]+)\/?$/i.exec(text);
  if (!m) return undefined;
  let mod: string;
  let version: string;
  try {
    mod = decodeURIComponent(m[1]);
    version = decodeURIComponent(m[2]);
  } catch {
    return undefined;
  }
  if (!ID_PATTERN.test(mod) || mod.length > 64 || !isVersion(version)) return undefined;
  return { action: 'install', mod, version };
}

/** The mod manager link for a release: edgemods://install/<mod>/<version>. */
export function installLink(mod: string, version: string): string {
  return `edgemods://install/${encodeURIComponent(mod)}/${encodeURIComponent(version)}`;
}

/**
 * The address that asks the EDGEmods extension in this editor to install a release, for the MCP server, which runs
 * apart from VS Code: <editor>://edgemodders.edgemods/install/<mod>/<version>. The player still confirms in VS Code.
 */
export function installUri(editor: string, mod: string, version: string): string {
  if (!EDITOR_SCHEMES.includes(editor)) throw new Error(`${editor} is not an editor EDGEmods knows.`);
  if (!parseLink(installLink(mod, version))) throw new Error(`${mod} ${version} is not a mod id and version.`);
  return `${editor}://edgemodders.edgemods/install/${encodeURIComponent(mod)}/${encodeURIComponent(version)}`;
}

/** The request in such an address's path (/install/<mod>/<version>, as VS Code hands it over), or undefined. */
export function parseInstallPath(path: string): InstallLink | undefined {
  const m = /^\/install\/([^/]+)\/([^/]+)\/?$/.exec(String(path ?? ''));
  return m ? parseLink(installLink(m[1], m[2])) : undefined;
}
