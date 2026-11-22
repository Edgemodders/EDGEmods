// Finds a GitHub account or repository's numeric id from its name, for the blocklist: ids survive renames, so a
// blocked modder cannot come back by renaming. Public reads; a token (EDGEMODS_GITHUB_TOKEN) raises GitHub's limit.

import type { Fetch } from './auth0.js';

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

async function get(path: string, fetchFn: Fetch, token?: string): Promise<Record<string, unknown> | undefined> {
  const res = await fetchFn(`https://api.github.com${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'EDGEmods', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GitHub did not answer (HTTP ${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

/** A GitHub account by login: its id and its login as GitHub spells it. Undefined if there is none. */
export async function githubUser(login: string, fetchFn: Fetch = fetch, token?: string): Promise<{ id: number; login: string } | undefined> {
  if (!LOGIN.test(login)) return undefined;
  const u = await get(`/users/${encodeURIComponent(login)}`, fetchFn, token);
  return u && typeof u.id === 'number' && typeof u.login === 'string' ? { id: u.id, login: u.login } : undefined;
}

/** A repository by owner/name: its id and full name. Undefined if there is none (or it is private). */
export async function githubRepo(fullName: string, fetchFn: Fetch = fetch, token?: string): Promise<{ id: number; fullName: string } | undefined> {
  const name = fullName.replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!REPO.test(name)) return undefined;
  const [owner, repo] = name.split('/');
  const r = await get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, fetchFn, token);
  return r && typeof r.id === 'number' && typeof r.full_name === 'string' ? { id: r.id, fullName: r.full_name } : undefined;
}
