// Checks an edgemods.json value and explains each problem in plain words.
// Pure: no file system and no network, so the website, the extension, the merge checks and a browser can all use it.

import {
  FILE_NAME_PATTERN,
  GAME_VERSION_PATTERN,
  GITHUB_LOGIN_PATTERN,
  HTTPS_URL_PATTERN,
  ID_PATTERN,
  IMAGE_PATH_PATTERN,
  LIMITS,
  MARKDOWN_PATH_PATTERN,
  TAG_PATTERN,
  VERSION_PATTERN,
} from './limits.js';
import { FILE_ROLES, LINK_KEYS, MOD_TYPES, SCHEMA_VERSION, type Manifest } from './manifest.js';

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  /** Where the problem is, such as files[2].note. Empty for the file as a whole. */
  path: string;
  /** What is wrong and how to fix it, in plain words. */
  message: string;
}

export interface ValidationResult {
  /** True when there are no errors. Warnings do not stop a mod. */
  ok: boolean;
  issues: Issue[];
  /** The manifest, typed, when ok is true. */
  manifest?: Manifest;
}

const TOP_LEVEL_FIELDS = [
  '$schema', 'schemaVersion', 'id', 'name', 'summary', 'version', 'author', 'credits', 'license', 'type', 'tags',
  'gameVersion', 'adult', 'images', 'page', 'changelog', 'files', 'requirements', 'links',
];

type Obj = Record<string, unknown>;

class Checker {
  readonly issues: Issue[] = [];

  error(path: string, message: string): void {
    this.issues.push({ level: 'error', path, message });
  }

  warn(path: string, message: string): void {
    this.issues.push({ level: 'warning', path, message });
  }

  /** An object, or an error saying what was expected. */
  object(value: unknown, path: string, what: string): Obj | undefined {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Obj;
    this.error(path, `${what} must be an object ({ … }), not ${describe(value)}.`);
    return undefined;
  }

  array(value: unknown, path: string, what: string): unknown[] | undefined {
    if (Array.isArray(value)) return value;
    this.error(path, `${what} must be a list ([ … ]), not ${describe(value)}.`);
    return undefined;
  }

  /** A string within the given length, trimmed of nothing: leading or trailing spaces are an error. */
  text(value: unknown, path: string, what: string, max: number, min = 1): string | undefined {
    if (typeof value !== 'string') {
      this.error(path, `${what} must be text in quotes, not ${describe(value)}.`);
      return undefined;
    }
    const length = [...value].length;
    if (value.trim() !== value) this.error(path, `${what} starts or ends with spaces. Remove them.`);
    if (length < min) {
      this.error(path, min === 1 ? `${what} is empty.` : `${what} is too short: ${length} characters, at least ${min}.`);
    } else if (length > max) {
      this.error(path, `${what} is too long: ${length} characters, the limit is ${max}.`);
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      this.error(path, `${what} contains invisible control characters. Remove them.`);
    }
    return value;
  }

  /** Fields that are not part of the format: usually a typo. */
  unknownFields(obj: Obj, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(obj)) {
      if (allowed.includes(key)) continue;
      const near = closest(key, allowed);
      const where = path ? `${path}.${key}` : key;
      this.error(where, `"${key}" is not a field EDGEmods knows${near ? `. Did you mean "${near}"?` : '. Remove it.'}`);
    }
  }

  required(obj: Obj, key: string, path: string, what: string): boolean {
    if (obj[key] !== undefined) return true;
    this.error(join(path, key), `${what} is missing.`);
    return false;
  }
}

/** Parses edgemods.json text, then validates it. A syntax error is reported with its line and column. */
export function parseManifest(text: string): ValidationResult {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (err) {
    return { ok: false, issues: [{ level: 'error', path: '', message: explainJsonError(body, err) }] };
  }
  return validateManifest(value);
}

export function validateManifest(value: unknown): ValidationResult {
  const c = new Checker();
  const m = c.object(value, '', 'edgemods.json');
  if (!m) return result(c, value);

  c.unknownFields(m, TOP_LEVEL_FIELDS, '');

  if (m.$schema !== undefined) c.text(m.$schema, '$schema', 'The schema link', LIMITS.url.max);

  if (c.required(m, 'schemaVersion', '', 'The format version (schemaVersion)')) {
    if (m.schemaVersion !== SCHEMA_VERSION) {
      c.error('schemaVersion', typeof m.schemaVersion === 'number' && m.schemaVersion > SCHEMA_VERSION
        ? `This file uses format version ${m.schemaVersion}, newer than this checker knows (${SCHEMA_VERSION}). Update EDGEmods.`
        : `The format version must be ${SCHEMA_VERSION}.`);
    }
  }

  if (c.required(m, 'id', '', 'The mod id')) {
    const id = c.text(m.id, 'id', 'The mod id', LIMITS.id.max, LIMITS.id.min);
    if (id !== undefined && !ID_PATTERN.test(id)) {
      c.error('id', `The mod id "${id}" may only use lowercase letters, digits and single dashes between words, like "better-car-radio".`);
    }
  }

  if (c.required(m, 'name', '', 'The name')) c.text(m.name, 'name', 'The name', LIMITS.name.max, LIMITS.name.min);

  if (c.required(m, 'summary', '', 'The short description (summary)')) {
    c.text(m.summary, 'summary', 'The short description', LIMITS.summary.max, LIMITS.summary.min);
  }

  if (c.required(m, 'version', '', 'The version')) {
    const version = c.text(m.version, 'version', 'The version', 64);
    if (version !== undefined) checkVersion(c, version, 'version', 'The version');
  }

  if (c.required(m, 'author', '', 'The author')) checkAuthor(c, m.author);
  if (m.credits !== undefined) checkCredits(c, m.credits);

  if (c.required(m, 'license', '', 'The license')) c.text(m.license, 'license', 'The license', LIMITS.license.max);

  if (c.required(m, 'type', '', 'The mod type')) {
    if (typeof m.type !== 'string' || !(MOD_TYPES as readonly string[]).includes(m.type)) {
      c.error('type', `The mod type must be one of: ${MOD_TYPES.join(', ')}. ${typeof m.type === 'string' ? `"${m.type}" is not one of them.` : ''}`.trim());
    }
  }

  if (m.tags !== undefined) checkTags(c, m.tags);

  if (m.gameVersion === undefined) {
    c.warn('gameVersion', 'No game version is given. Players like to know which game version the mod was tested with, such as "2.31".');
  } else {
    const gv = c.text(m.gameVersion, 'gameVersion', 'The game version', 16);
    if (gv !== undefined && !GAME_VERSION_PATTERN.test(gv)) {
      c.error('gameVersion', `The game version "${gv}" should look like the game's own version number, such as "2.31" or "2.12a".`);
    }
  }

  if (m.adult !== undefined && typeof m.adult !== 'boolean') {
    c.error('adult', `"adult" must be true or false, without quotes, not ${describe(m.adult)}.`);
  }

  if (c.required(m, 'images', '', 'The images (at least the card image)')) checkImages(c, m.images);

  if (m.page !== undefined) checkMarkdownPath(c, m.page, 'page', 'The mod page file');
  if (m.changelog !== undefined) checkMarkdownPath(c, m.changelog, 'changelog', 'The changelog file');

  if (c.required(m, 'files', '', 'The list of release files')) checkFiles(c, m.files);
  if (m.requirements !== undefined) checkRequirements(c, m.requirements, typeof m.id === 'string' ? m.id : undefined);
  if (m.links !== undefined) checkLinks(c, m.links);

  return result(c, value);
}

function result(c: Checker, value: unknown): ValidationResult {
  const ok = !c.issues.some((i) => i.level === 'error');
  return ok ? { ok, issues: c.issues, manifest: value as Manifest } : { ok, issues: c.issues };
}

function checkVersion(c: Checker, version: string, path: string, what: string): void {
  if (VERSION_PATTERN.test(version)) return;
  if (/^v\d/i.test(version)) {
    c.error(path, `${what} "${version}" starts with "v". Write the number only, such as "${version.slice(1)}"; the release tag adds the "v".`);
  } else if (/^\d+(\.\d+)?$/.test(version)) {
    c.error(path, `${what} "${version}" needs three numbers, MAJOR.MINOR.PATCH, such as "${version}${version.includes('.') ? '.0' : '.0.0'}".`);
  } else {
    c.error(path, `${what} "${version}" must be three numbers, MAJOR.MINOR.PATCH, such as "1.0.0" or "2.1.3".`);
  }
}

function checkAuthor(c: Checker, value: unknown): void {
  const a = c.object(value, 'author', 'The author');
  if (!a) return;
  c.unknownFields(a, ['name', 'github'], 'author');
  if (c.required(a, 'name', 'author', "The author's name")) c.text(a.name, 'author.name', "The author's name", LIMITS.authorName.max);
  if (c.required(a, 'github', 'author', "The author's GitHub login")) {
    const login = c.text(a.github, 'author.github', "The author's GitHub login", 39);
    if (login !== undefined && !GITHUB_LOGIN_PATTERN.test(login)) {
      c.error('author.github', `"${login}" is not a GitHub login. Write the login only, such as "octocat", without "@" or a link.`);
    }
  }
}

function checkCredits(c: Checker, value: unknown): void {
  const list = c.array(value, 'credits', 'The credits');
  if (!list) return;
  if (list.length > LIMITS.credits.max) c.error('credits', `There are ${list.length} credits; the limit is ${LIMITS.credits.max}.`);
  list.forEach((item, i) => {
    const path = `credits[${i}]`;
    const credit = c.object(item, path, `Credit ${i + 1}`);
    if (!credit) return;
    c.unknownFields(credit, ['name', 'for'], path);
    if (c.required(credit, 'name', path, `Credit ${i + 1}'s name`)) c.text(credit.name, `${path}.name`, `Credit ${i + 1}'s name`, LIMITS.creditName.max);
    if (credit.for !== undefined) c.text(credit.for, `${path}.for`, `What credit ${i + 1} is for`, LIMITS.creditFor.max);
  });
}

function checkTags(c: Checker, value: unknown): void {
  const list = c.array(value, 'tags', 'The tags');
  if (!list) return;
  if (list.length > LIMITS.tags.max) c.error('tags', `There are ${list.length} tags; the limit is ${LIMITS.tags.max}. Keep the ones players would search for.`);
  const seen = new Set<string>();
  list.forEach((tag, i) => {
    const path = `tags[${i}]`;
    const t = c.text(tag, path, `Tag ${i + 1}`, LIMITS.tag.max, LIMITS.tag.min);
    if (t === undefined) return;
    if (!TAG_PATTERN.test(t)) c.error(path, `The tag "${t}" may only use lowercase letters, digits and single dashes, like "night-city".`);
    if (seen.has(t)) c.error(path, `The tag "${t}" is listed twice.`);
    seen.add(t);
  });
}

function checkImages(c: Checker, value: unknown): void {
  const img = c.object(value, 'images', 'The images');
  if (!img) return;
  c.unknownFields(img, ['card', 'gallery'], 'images');
  if (c.required(img, 'card', 'images', 'The card image')) checkImagePath(c, img.card, 'images.card', 'The card image');
  if (img.gallery === undefined) {
    c.warn('images.gallery', 'There are no gallery images. Screenshots help players decide.');
    return;
  }
  const list = c.array(img.gallery, 'images.gallery', 'The gallery');
  if (!list) return;
  if (list.length > LIMITS.gallery.max) c.error('images.gallery', `There are ${list.length} gallery images; the limit is ${LIMITS.gallery.max}.`);
  const seen = new Set<string>();
  list.forEach((item, i) => {
    const path = `images.gallery[${i}]`;
    const g = c.object(item, path, `Gallery image ${i + 1}`);
    if (!g) return;
    c.unknownFields(g, ['path', 'caption'], path);
    if (c.required(g, 'path', path, `Gallery image ${i + 1}'s path`)) {
      const p = checkImagePath(c, g.path, `${path}.path`, `Gallery image ${i + 1}`);
      if (p !== undefined) {
        if (seen.has(p.toLowerCase())) c.error(`${path}.path`, `The gallery lists "${p}" twice.`);
        seen.add(p.toLowerCase());
      }
    }
    if (g.caption !== undefined) c.text(g.caption, `${path}.caption`, `Gallery image ${i + 1}'s caption`, LIMITS.caption.max);
  });
}

function checkImagePath(c: Checker, value: unknown, path: string, what: string): string | undefined {
  const p = c.text(value, path, what, 200);
  if (p === undefined) return undefined;
  if (p.includes('\\')) {
    c.error(path, `${what} "${p}" uses backslashes. Use forward slashes, such as "images/card.png".`);
  } else if (/^[a-z]+:\/\//i.test(p)) {
    c.error(path, `${what} "${p}" is a link. Images must be files in the mod's repository, under images/, such as "images/card.png".`);
  } else if (!IMAGE_PATH_PATTERN.test(p)) {
    c.error(path, `${what} "${p}" must be a .png, .jpg or .webp file under images/, such as "images/card.png", using letters, digits, dots, dashes and underscores.`);
  }
  return p;
}

function checkMarkdownPath(c: Checker, value: unknown, path: string, what: string): void {
  const p = c.text(value, path, what, 200);
  if (p === undefined) return;
  if (p.includes('\\')) c.error(path, `${what} "${p}" uses backslashes. Use forward slashes.`);
  else if (!MARKDOWN_PATH_PATTERN.test(p)) c.error(path, `${what} "${p}" must be a .md file in the repository, such as "README.md".`);
}

function checkFiles(c: Checker, value: unknown): void {
  const list = c.array(value, 'files', 'The list of release files');
  if (!list) return;
  if (list.length < LIMITS.files.min) {
    c.error('files', 'The list of release files is empty. Add at least one file, the zip players install.');
    return;
  }
  if (list.length > LIMITS.files.max) c.error('files', `There are ${list.length} release files; the limit is ${LIMITS.files.max}.`);

  const names = new Map<string, number>();
  const groups = new Map<string, number[]>();
  let installable = false;

  list.forEach((item, i) => {
    const path = `files[${i}]`;
    const label = `File ${i + 1}`;
    const f = c.object(item, path, label);
    if (!f) return;
    c.unknownFields(f, ['name', 'role', 'group', 'title', 'note'], path);

    if (c.required(f, 'name', path, `${label}'s name`)) {
      const name = c.text(f.name, `${path}.name`, `${label}'s name`, LIMITS.fileName.max);
      if (name !== undefined) {
        if (!FILE_NAME_PATTERN.test(name)) {
          c.error(`${path}.name`, /\s/.test(name)
            ? `The file name "${name}" has spaces. GitHub renames such files, so use dashes or dots instead, such as "${name.replace(/\s+/g, '-')}".`
            : `The file name "${name}" must be a .zip or .7z file using letters, digits, dots, dashes, underscores and "+".`);
        }
        const key = name.toLowerCase();
        if (names.has(key)) c.error(`${path}.name`, `The file "${name}" is listed twice (also as file ${(names.get(key) ?? 0) + 1}).`);
        else names.set(key, i);
      }
    }

    let role: string | undefined;
    if (c.required(f, 'role', path, `${label}'s role`)) {
      if (typeof f.role === 'string' && (FILE_ROLES as readonly string[]).includes(f.role)) role = f.role;
      else c.error(`${path}.role`, `${label}'s role must be one of: ${FILE_ROLES.join(', ')}.`);
    }

    if (role === 'choose-one') {
      if (c.required(f, 'group', path, `${label} is a choose-one file, so its group`)) {
        const group = c.text(f.group, `${path}.group`, `${label}'s group`, LIMITS.fileGroup.max);
        if (group !== undefined) groups.set(group, [...(groups.get(group) ?? []), i]);
      }
    } else if (f.group !== undefined && role !== undefined) {
      c.error(`${path}.group`, `${label} has a group but its role is "${role}". Only choose-one files have a group.`);
    }
    if (role === 'required' || role === 'choose-one') installable = true;

    if (f.title !== undefined) c.text(f.title, `${path}.title`, `${label}'s title`, LIMITS.fileTitle.max);
    if (f.note !== undefined) c.text(f.note, `${path}.note`, `${label}'s note`, LIMITS.fileNote.max);
  });

  for (const [group, members] of groups) {
    if (members.length < 2) {
      c.error(`files[${members[0]}].group`, `The choose-one group "${group}" has only one file. A group needs at least two files to choose from; otherwise make the file required or optional.`);
    }
  }
  if (!installable && names.size > 0) {
    c.error('files', 'Every file is optional. Mark the main file as required, or give players a choose-one group.');
  }
}

function checkRequirements(c: Checker, value: unknown, ownId: string | undefined): void {
  const list = c.array(value, 'requirements', 'The requirements');
  if (!list) return;
  if (list.length > LIMITS.requirements.max) c.error('requirements', `There are ${list.length} requirements; the limit is ${LIMITS.requirements.max}.`);
  const seen = new Set<string>();
  list.forEach((item, i) => {
    const path = `requirements[${i}]`;
    const label = `Requirement ${i + 1}`;
    const r = c.object(item, path, label);
    if (!r) return;
    const hasMod = r.mod !== undefined;
    const hasUrl = r.url !== undefined || r.name !== undefined;
    if (hasMod && hasUrl) {
      c.error(path, `${label} has both "mod" and "url"/"name". Use "mod" for a mod on EDGEmods, or "name" and "url" for anything else.`);
      return;
    }
    if (hasMod) {
      c.unknownFields(r, ['mod', 'minVersion', 'note'], path);
      const id = c.text(r.mod, `${path}.mod`, `${label}'s mod id`, LIMITS.id.max, LIMITS.id.min);
      if (id !== undefined) {
        if (!ID_PATTERN.test(id)) c.error(`${path}.mod`, `"${id}" is not an EDGEmods mod id. Pick the mod from the search box, or use "name" and "url" for a mod elsewhere.`);
        if (id === ownId) c.error(`${path}.mod`, 'The mod lists itself as a requirement.');
        if (seen.has(`mod:${id}`)) c.error(`${path}.mod`, `The mod "${id}" is listed twice.`);
        seen.add(`mod:${id}`);
      }
      if (r.minVersion !== undefined) {
        const v = c.text(r.minVersion, `${path}.minVersion`, `${label}'s minimum version`, 64);
        if (v !== undefined) checkVersion(c, v, `${path}.minVersion`, `${label}'s minimum version`);
      }
    } else {
      c.unknownFields(r, ['name', 'url', 'note'], path);
      if (r.name === undefined && r.url === undefined) {
        c.error(path, `${label} is empty. Use "mod" for a mod on EDGEmods, or "name" and "url" for anything else.`);
        return;
      }
      if (c.required(r, 'name', path, `${label}'s name`)) c.text(r.name, `${path}.name`, `${label}'s name`, LIMITS.requirementName.max);
      if (c.required(r, 'url', path, `${label}'s link`)) {
        const url = checkUrl(c, r.url, `${path}.url`, `${label}'s link`);
        if (url !== undefined) {
          if (seen.has(`url:${url}`)) c.error(`${path}.url`, `The link "${url}" is listed twice.`);
          seen.add(`url:${url}`);
        }
      }
    }
    if (r.note !== undefined) c.text(r.note, `${path}.note`, `${label}'s note`, LIMITS.requirementNote.max);
  });
}

function checkLinks(c: Checker, value: unknown): void {
  const links = c.object(value, 'links', 'The links');
  if (!links) return;
  c.unknownFields(links, LINK_KEYS, 'links');
  for (const key of LINK_KEYS) {
    if (links[key] !== undefined) checkUrl(c, links[key], `links.${key}`, `The ${key} link`);
  }
}

function checkUrl(c: Checker, value: unknown, path: string, what: string): string | undefined {
  const url = c.text(value, path, what, LIMITS.url.max);
  if (url === undefined) return undefined;
  if (/^http:\/\//i.test(url)) c.error(path, `${what} "${url}" uses http. Use the https address.`);
  else if (!HTTPS_URL_PATTERN.test(url)) c.error(path, `${what} "${url}" is not a web address. It should start with https://.`);
  return url;
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return `the text "${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`;
  if (typeof value === 'object') return 'an object';
  return `${typeof value === 'number' ? 'the number' : typeof value === 'boolean' ? 'the value' : typeof value} ${String(value)}`;
}

/** The allowed name nearest to a typo, if it is close enough to be a likely mistake. */
function closest(key: string, allowed: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of allowed) {
    const d = distance(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return bestDistance <= Math.max(1, Math.floor(key.length / 3)) ? best : undefined;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

function explainJsonError(text: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const pos = /position (\d+)/.exec(message);
  if (!pos) return `edgemods.json is not valid JSON: ${message}`;
  const offset = Number(pos[1]);
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  const hint = /,\s*[}\]]/.test(text.slice(Math.max(0, offset - 20), offset + 1))
    ? ' There may be a comma after the last item, which JSON does not allow.'
    : '';
  return `edgemods.json is not valid JSON at line ${line}, column ${column}.${hint}`;
}
