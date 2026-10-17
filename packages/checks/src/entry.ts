// A registry entry: registry/<github-login>/<mod-id>.json, one file per mod, so publish pull requests never conflict.
// The file records the repository and GitHub's numeric ids, which survive renames.

import { GITHUB_LOGIN_PATTERN, ID_PATTERN, LIMITS, type Issue } from '@edgemodders/edgemods-format';

export const REGISTRY_DIR = 'registry';
export const ENTRY_SCHEMA_VERSION = 1;

export interface RegistryEntry {
  schemaVersion: typeof ENTRY_SCHEMA_VERSION;
  /** https://github.com/<owner>/<name> */
  repo: string;
  /** GitHub's numeric repository id. */
  repoId: number;
  /** GitHub's numeric user id of the owner. */
  ownerId: number;
}

export interface EntryPath {
  owner: string;
  id: string;
}

/** registry/<owner>/<id>.json, or undefined if the path is not shaped like an entry. */
export function parseEntryPath(path: string): EntryPath | undefined {
  const match = /^registry\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!match) return undefined;
  const [, owner, id] = match;
  if (!GITHUB_LOGIN_PATTERN.test(owner) || !ID_PATTERN.test(id)) return undefined;
  if (id.length < LIMITS.id.min || id.length > LIMITS.id.max) return undefined;
  return { owner, id };
}

export function entryPath(owner: string, id: string): string {
  return `${REGISTRY_DIR}/${owner}/${id}.json`;
}

const REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/([A-Za-z0-9._-]{1,100})$/;

/** owner/name from https://github.com/owner/name, or undefined. */
export function repoFromUrl(url: string): string | undefined {
  const match = REPO_URL.exec(url);
  if (!match || match[2] === '.' || match[2] === '..' || match[2].endsWith('.git')) return undefined;
  return `${match[1]}/${match[2]}`;
}

export function parseEntry(text: string): { entry?: RegistryEntry; issues: Issue[] } {
  const issues: Issue[] = [];
  const error = (path: string, message: string): void => void issues.push({ level: 'error', path, message });
  let value: any;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    error('', 'The registry file is not valid JSON.');
    return { issues };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    error('', 'The registry file must be an object.');
    return { issues };
  }
  for (const key of Object.keys(value)) {
    if (!['schemaVersion', 'repo', 'repoId', 'ownerId'].includes(key)) error(key, `"${key}" does not belong in a registry file.`);
  }
  if (value.schemaVersion !== ENTRY_SCHEMA_VERSION) error('schemaVersion', `The registry file's schemaVersion must be ${ENTRY_SCHEMA_VERSION}.`);
  if (typeof value.repo !== 'string' || !repoFromUrl(value.repo)) {
    error('repo', 'The registry file\'s "repo" must be the repository\'s address, like https://github.com/octocat/better-car-radio.');
  }
  for (const key of ['repoId', 'ownerId']) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0) error(key, `The registry file's "${key}" must be GitHub's numeric id.`);
  }
  return issues.length ? { issues } : { entry: value as RegistryEntry, issues };
}

export function formatEntry(entry: RegistryEntry): string {
  return JSON.stringify(entry, null, 2) + '\n';
}
