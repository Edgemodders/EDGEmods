// The merge checks talk to the EDGEmods website with a secret only EDGEmods' workflows hold (EDGEMODS_CHECKS_SECRET
// on both sides). Each body is signed with HMAC SHA-256 in X-EDGEmods-Signature (packages/server/src/app.ts):
//   POST <site>/api/v1/blocklist/check   { github, repo } (GitHub's numeric ids) -> { blocked, github, repo }
//   POST <site>/api/v1/checks            a passing result, so the release shows on the website once it merges

import { createHmac } from 'node:crypto';
import type { Blocklist, CheckResult } from './checks.js';

const signed = (secret: string, body: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-EDGEmods-Signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
});

export function blocklistApi(baseUrl: string, secret: string, fetchFn: typeof fetch = fetch): Blocklist {
  return {
    async check({ ownerId, repoId }) {
      const body = JSON.stringify({ github: ownerId, repo: repoId });
      const res = await fetchFn(new URL('/api/v1/blocklist/check', baseUrl), { method: 'POST', body, headers: signed(secret, body), redirect: 'error' });
      if (!res.ok) throw new Error(`the EDGEmods website answered ${res.status} when asked about the blocklist`);
      const answer = (await res.json()) as { blocked?: unknown };
      if (typeof answer.blocked !== 'boolean') throw new Error('the EDGEmods website gave an unexpected blocklist answer');
      return { blocked: answer.blocked };
    },
  };
}

/**
 * Records a passing merge check on the website (a release shows once a passing result is recorded). Only a passing
 * result: a failing one could name someone else's mod (a pull request pointing at a repository its author does not
 * own fails), and must never hide their release.
 */
export async function sendCheckResult(baseUrl: string, secret: string, result: CheckResult, fetchFn: typeof fetch = fetch, now = new Date()): Promise<void> {
  if (!result.ok || !result.mod) throw new Error('only a passing result with its mod is sent');
  const body = JSON.stringify({ mod: result.mod.id, version: result.mod.version, ok: true, checkedAt: now.toISOString(), downloads: result.downloads, steps: result.steps });
  const res = await fetchFn(new URL('/api/v1/checks', baseUrl), { method: 'POST', body, headers: signed(secret, body), redirect: 'error' });
  if (res.status !== 204 && !res.ok) throw new Error(`the EDGEmods website answered ${res.status} when given the check result`);
}
