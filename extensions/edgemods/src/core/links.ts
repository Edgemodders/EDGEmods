// Mod manager links (docs/links.md): edgemods://install/<mod>/<version>. Any web page can open one, so a link is
// only ever a request, which the player confirms; and it names no server, so it cannot point the extension at one.

import { ID_PATTERN, isVersion } from '@edgemodders/edgemods-format';

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
