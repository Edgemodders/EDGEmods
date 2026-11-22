// What a link on a mod's page does in VS Code. The page is the website's own (GET /api/v1/mods/<id>/view), and its
// About tab is the mod author's README, so a link can be anything: it is only ever read as a request, here, in the
// extension, and never followed inside the editor.

import { ID_PATTERN, isVersion } from '@edgemodders/edgemods-format';
import { MOD_TABS, type ModTab } from './api.js';

export type PageLink =
  | { kind: 'install'; url: string }
  | { kind: 'download'; mod: string; version: string; file: string }
  | { kind: 'signIn' }
  | { kind: 'mod'; id: string; tab?: ModTab }
  | { kind: 'browse'; q: string; type: string[]; tag: string[] }
  | { kind: 'source'; mod: string; path: string }
  | { kind: 'site'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'none' };

const isId = (s: string): boolean => s.length <= 64 && ID_PATTERN.test(s);

/** `href` as written in the page (not resolved against anything). */
export function pageLink(href: string): PageLink {
  const text = String(href ?? '').trim();
  if (!text || text.length > 2048 || text.startsWith('#') || text.startsWith('?')) return { kind: 'none' };
  if (/^edgemods:/i.test(text)) return { kind: 'install', url: text };
  if (/^https?:\/\//i.test(text)) {
    try {
      return { kind: 'external', url: new URL(text).href };
    } catch {
      return { kind: 'none' };
    }
  }
  // Only the site's own paths from here on: never another scheme (javascript:, file:, command:, vscode:).
  if (!text.startsWith('/') || text.startsWith('//')) return { kind: 'none' };
  let url: URL;
  try {
    url = new URL(text, 'https://site.invalid');
  } catch {
    return { kind: 'none' };
  }
  const parts = url.pathname.split('/').slice(1);
  let decoded: string[];
  try {
    decoded = parts.map(decodeURIComponent);
  } catch {
    return { kind: 'none' };
  }
  if (decoded[0] === 'signin') return { kind: 'signIn' };
  if (decoded[0] === 'download' && decoded.length === 4 && isId(decoded[1]) && isVersion(decoded[2]) && decoded[3] && !/[\\/]/.test(decoded[3])) {
    return { kind: 'download', mod: decoded[1], version: decoded[2], file: decoded[3] };
  }
  if (decoded[0] === 'mods' && decoded.length === 1) {
    const list = (key: string): string[] => url.searchParams.getAll(key).filter((v) => v && v.length <= 40).slice(0, 10);
    return { kind: 'browse', q: (url.searchParams.get('q') ?? '').slice(0, 200), type: list('type'), tag: list('tag') };
  }
  if (decoded[0] === 'mods' && decoded[1] && isId(decoded[1])) {
    if (decoded.length === 2) {
      const tab = url.searchParams.get('tab');
      return { kind: 'mod', id: decoded[1], ...((MOD_TABS as readonly string[]).includes(tab ?? '') ? { tab: tab as ModTab } : {}) };
    }
    if (decoded[2] === 'source' && decoded.length > 3) return { kind: 'source', mod: decoded[1], path: parts.slice(3).join('/') };
    if (decoded[2] === 'images') return { kind: 'none' };
  }
  return { kind: 'site', path: `${url.pathname}${url.search}` };
}
