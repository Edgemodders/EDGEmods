// The private blocklist lives in the EDGEmods server's database. The merge checks ask the server, with a secret
// only the registry workflow holds. Proposed endpoint, built with the server in R3:
//   GET <api>/api/v1/registry/blocked?ownerId=…&login=…&repoId=…   ->   { "blocked": true | false }

import type { Blocklist } from './checks.js';

export function blocklistApi(baseUrl: string, secret: string, fetchFn: typeof fetch = fetch): Blocklist {
  return {
    async check({ ownerId, login, repoId }) {
      const url = new URL('/api/v1/registry/blocked', baseUrl);
      url.search = new URLSearchParams({ ownerId: String(ownerId), login, repoId: String(repoId) }).toString();
      const res = await fetchFn(url, { headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`the EDGEmods server answered ${res.status} when asked about the blocklist`);
      const body = (await res.json()) as { blocked?: unknown };
      if (typeof body.blocked !== 'boolean') throw new Error('the EDGEmods server gave an unexpected blocklist answer');
      return { blocked: body.blocked };
    },
  };
}
