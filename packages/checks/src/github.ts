// The little of GitHub's REST API the merge checks need, behind an interface so tests can use a fake.
// Everything read from a mod's repository is data: it is parsed, measured or hashed, never run.

import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FileEntry } from '@edgemodders/edgemods-format';

export interface Account {
  login: string;
  id: number;
  /** 'User' or 'Organization'. */
  type: string;
}

export interface Repo {
  id: number;
  name: string;
  fullName: string;
  owner: Account;
  private: boolean;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

export interface PullRequest {
  number: number;
  state: string;
  author: Account;
  headSha: string;
  /** owner/name of the repository the pull request comes from (a fork). */
  headRepo: string;
}

export interface ChangedFile {
  path: string;
  /** added, removed, modified, renamed, copied, changed, unchanged. */
  status: string;
}

export interface Asset {
  id: number;
  name: string;
  size: number;
  /** https://github.com/<owner>/<repo>/releases/download/<tag>/<name>. */
  url?: string;
}

export interface Release {
  tag: string;
  draft: boolean;
  prerelease: boolean;
  publishedAt?: string;
  /** The release's description, markdown written by its author. */
  body?: string;
  assets: Asset[];
}

export interface GitHub {
  pullRequest(repo: string, number: number): Promise<PullRequest>;
  changedFiles(repo: string, number: number): Promise<ChangedFile[]>;
  /** A repository by owner/name, or undefined if it does not exist or cannot be seen. */
  repo(fullName: string): Promise<Repo | undefined>;
  /** A file's bytes at a ref, or undefined if it is not there. */
  file(fullName: string, ref: string, path: string): Promise<Uint8Array | undefined>;
  /** Every file at a ref, with sizes. */
  tree(fullName: string, ref: string): Promise<{ files: FileEntry[]; truncated: boolean }>;
  releaseByTag(fullName: string, tag: string): Promise<Release | undefined>;
  /** Streams a release asset to a file on disk. */
  downloadAsset(fullName: string, assetId: number, destination: string): Promise<void>;
}

/** What the website's indexer reads, on top of GitHub. */
export interface GitHubIndex {
  /** A repository by GitHub's numeric id, which stays the same when it is renamed or moves owner. */
  repoById(id: number): Promise<Repo | undefined>;
  /** Every published release (drafts are left out), newest first, up to 1,000. */
  releases(fullName: string): Promise<Release[]>;
}

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The real API, with a token (the workflow's, or the EDGEmods App's). */
export function githubApi(token: string | undefined, fetchFn: typeof fetch = fetch): GitHub & GitHubIndex {
  const headers = (accept = 'application/vnd.github+json'): Record<string, string> => ({
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'edgemods-registry-check',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const get = async (path: string, accept?: string): Promise<Response | undefined> => {
    const res = await fetchFn(`${API}${path}`, { headers: headers(accept), redirect: 'follow' });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new GitHubError(res.status, `GitHub answered ${res.status} for ${path}`);
    return res;
  };
  const json = async <T>(path: string): Promise<T | undefined> => {
    const res = await get(path);
    return res ? ((await res.json()) as T) : undefined;
  };
  const account = (a: { login: string; id: number; type: string }): Account => ({ login: a.login, id: a.id, type: a.type });
  const enc = (p: string): string => p.split('/').map(encodeURIComponent).join('/');
  const toRepo = (r: any): Repo => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: account(r.owner),
    private: r.private,
    archived: r.archived,
    disabled: r.disabled ?? false,
    fork: r.fork,
    defaultBranch: r.default_branch,
    htmlUrl: r.html_url,
  });
  const toRelease = (r: any): Release => ({
    tag: r.tag_name,
    draft: r.draft,
    prerelease: r.prerelease,
    publishedAt: r.published_at ?? undefined,
    body: r.body ?? undefined,
    assets: (r.assets as any[]).map((a) => ({ id: a.id, name: a.name, size: a.size, url: a.browser_download_url })),
  });

  return {
    async pullRequest(repo, number) {
      const pr = await json<any>(`/repos/${repo}/pulls/${number}`);
      if (!pr) throw new GitHubError(404, `pull request ${number} not found`);
      return {
        number: pr.number,
        state: pr.state,
        author: account(pr.user),
        headSha: pr.head.sha,
        headRepo: pr.head.repo?.full_name ?? repo,
      };
    },

    async changedFiles(repo, number) {
      const files: ChangedFile[] = [];
      for (let page = 1; page <= 30; page++) {
        const batch = await json<any[]>(`/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
        if (!batch?.length) break;
        files.push(...batch.map((f) => ({ path: f.filename as string, status: f.status as string })));
        if (batch.length < 100) break;
      }
      return files;
    },

    async repo(fullName) {
      const r = await json<any>(`/repos/${fullName}`);
      return r ? toRepo(r) : undefined;
    },

    async repoById(id) {
      const r = await json<any>(`/repositories/${id}`);
      return r ? toRepo(r) : undefined;
    },

    async releases(fullName) {
      const all: Release[] = [];
      for (let page = 1; page <= 10; page++) {
        const batch = await json<any[]>(`/repos/${fullName}/releases?per_page=100&page=${page}`);
        if (!batch?.length) break;
        all.push(...batch.filter((r) => !r.draft).map(toRelease));
        if (batch.length < 100) break;
      }
      return all;
    },

    async file(fullName, ref, path) {
      const res = await get(`/repos/${fullName}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`, 'application/vnd.github.raw+json');
      return res ? new Uint8Array(await res.arrayBuffer()) : undefined;
    },

    async tree(fullName, ref) {
      const t = await json<any>(`/repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      if (!t) return { files: [], truncated: false };
      const files = (t.tree as any[]).filter((e) => e.type === 'blob').map((e) => ({ path: e.path as string, size: e.size as number }));
      return { files, truncated: Boolean(t.truncated) };
    },

    async releaseByTag(fullName, tag) {
      const r = await json<any>(`/repos/${fullName}/releases/tags/${encodeURIComponent(tag)}`);
      return r ? toRelease(r) : undefined;
    },

    async downloadAsset(fullName, assetId, destination) {
      const res = await get(`/repos/${fullName}/releases/assets/${assetId}`, 'application/octet-stream');
      if (!res?.body) throw new GitHubError(404, `release file ${assetId} could not be downloaded`);
      await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(destination));
    },
  };
}
