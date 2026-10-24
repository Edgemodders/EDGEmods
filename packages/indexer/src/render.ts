// Mod pages and release notes are markdown written by strangers. This turns them into HTML that is safe to put in
// the website as it is: a fixed list of tags and attributes, no scripts, styles, frames or forms, and no images
// from anywhere but the mod's own repository, served by EDGEmods from its cache.
//
// Links and images that point into the mod's repository are rewritten to EDGEmods addresses, so the page does
// not give the repository away to visitors who have not signed in (the soft gate): /mods/<id>/images/<path> for
// images, /mods/<id>/source/<path> for other files, which the website sends on to GitHub after sign-in.

import { posix } from 'node:path';
import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export interface RenderContext {
  modId: string;
  /** owner/name, to recognise absolute links into the mod's own repository. */
  repo: string;
  /** The folder of the markdown file inside the repository ('' for the top), for relative links. */
  dir: string;
  /** Repository paths that exist. Images are shown only if they are here and are images. */
  files: ReadonlySet<string>;
}

export interface Rendered {
  html: string;
  /** Repository paths of the images the HTML shows, for the website's image cache. */
  images: string[];
}

const markdown = new Marked({ gfm: true, breaks: false });

// The formats the website's image cache checks before serving (readImageInfo in packages/format).
const IMAGE_FILE = /\.(?:png|jpe?g|webp)$/i;

const TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote', 'pre', 'code', 'kbd', 'samp', 'em', 'strong', 'b', 'i',
  'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'abbr', 'a', 'img', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table',
  'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'details', 'summary', 'figure', 'figcaption', 'picture', 'div',
  'span', 'input',
];

/** Markdown to safe HTML, with the repository's links and images rewritten. */
export function renderMarkdown(text: string, ctx: RenderContext): Rendered {
  const raw = markdown.parse(text, { async: false });
  const images = new Set<string>();
  const html = sanitizeHtml(raw, {
    allowedTags: TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['align', 'colspan', 'rowspan'],
      td: ['align', 'colspan', 'rowspan'],
      ol: ['start'],
      code: ['class'],
      abbr: ['title'],
      details: ['open'],
      input: ['type', 'checked', 'disabled'],
    },
    allowedClasses: { code: [/^language-[\w+-]+$/] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
    // The page's own headings start at h2; an h1 in a README becomes h2, and so on down.
    transformTags: {
      h1: 'h2',
      h2: 'h3',
      h3: 'h4',
      h4: 'h5',
      h5: 'h6',
      a: (tagName, attribs) => ({ tagName, attribs: link(attribs, ctx) }),
      img: (tagName, attribs) => {
        const path = repoPath(attribs.src ?? '', ctx);
        const ok = path !== undefined && IMAGE_FILE.test(path) && ctx.files.has(path);
        if (ok) images.add(path);
        const { src: _src, ...rest } = attribs;
        return { tagName, attribs: ok ? { ...rest, src: `/mods/${ctx.modId}/images/${encodePath(path)}`, loading: 'lazy' } : rest };
      },
      // Only GitHub's task list checkboxes.
      input: (tagName, attribs) => ({ tagName, attribs: attribs.type === 'checkbox' ? { type: 'checkbox', disabled: '', ...('checked' in attribs ? { checked: '' } : {}) } : {} }),
    },
    // Images from anywhere else are left out, with their alt text kept as words.
    exclusiveFilter: (frame) => (frame.tag === 'img' && !frame.attribs.src) || (frame.tag === 'input' && frame.attribs.type !== 'checkbox'),
  });
  return { html: html.trim(), images: [...images] };
}

function link(attribs: Record<string, string>, ctx: RenderContext): Record<string, string> {
  const href = attribs.href ?? '';
  const out: Record<string, string> = attribs.title ? { title: attribs.title } : {};
  if (href.startsWith('#')) return { ...out, href };
  const path = repoPath(href, ctx);
  if (path !== undefined) return { ...out, href: `/mods/${ctx.modId}/source/${encodePath(path)}` };
  if (/^(?:https?:|mailto:)/i.test(href)) return { ...out, href, rel: 'nofollow ugc noopener noreferrer', target: '_blank' };
  return out;
}

/**
 * The repository path a link or image points at, for relative addresses and absolute ones into the mod's own
 * repository (github.com/<repo>/blob|raw|tree/<ref>/<path>, raw.githubusercontent.com/<repo>/<ref>/<path>).
 * Undefined for anything else, or a path that climbs out of the repository.
 */
function repoPath(address: string, ctx: RenderContext): string | undefined {
  const bare = address.trim().replace(/[?#].*$/, '');
  if (!bare) return undefined;
  let path: string;
  const own = absoluteInRepo(bare, ctx.repo);
  if (own !== undefined) {
    path = own;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith('//')) {
    return undefined;
  } else {
    path = bare.startsWith('/') ? bare.slice(1) : posix.join(ctx.dir, bare);
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  path = posix.normalize(path).replace(/\/$/, '');
  if (!path || path === '.' || path === '..' || path.startsWith('../') || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return undefined;
  return path;
}

function absoluteInRepo(address: string, repo: string): string | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const parts = url.pathname.split('/').filter(Boolean);
  const [owner, name] = repo.toLowerCase().split('/');
  const same = (a?: string, b?: string): boolean => a?.toLowerCase() === owner && b?.toLowerCase() === name;
  if (url.hostname === 'github.com' && same(parts[0], parts[1]) && ['blob', 'raw', 'tree'].includes(parts[2]) && parts.length > 4) {
    return parts.slice(4).join('/');
  }
  if (url.hostname === 'raw.githubusercontent.com' && same(parts[0], parts[1]) && parts.length > 3) {
    return parts.slice(3).join('/');
  }
  return undefined;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
