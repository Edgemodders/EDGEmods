// SPDX-License-Identifier: Apache-2.0
// Adapted from The Lost Realms' Realm Registry (Registry/admin-login.js, verifyIdToken), Copyright 2026 Brave You
// Worlds, LLC, under the Apache License 2.0: see ../NOTICE and ../licenses/Apache-2.0.txt. The rest of the EDGEmods
// server is MIT.
//
// Checks an RS256 token from Auth0 with Node's own crypto, no library. Each check is a way this goes wrong elsewhere:
//   - The algorithm is pinned to RS256. A header saying "none", or HS256 with the public key as the secret, is the
//     oldest token attack there is; the header is read for its key id and nothing that decides how to verify.
//   - Issuer and audience are compared as exact strings. Auth0's issuer ends in a slash; trimming it would accept
//     another tenant's tokens.
//   - Expiry is checked here, with a minute's leeway for clocks.

import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

export interface Jwk extends JsonWebKey {
  kid?: string;
  kty?: string;
}

export interface JwtCheck {
  keys: Jwk[];
  issuer: string;
  audience: string;
  now: number;
  /** For ID tokens: the nonce the sign-in sent, which the token must carry back. */
  nonce?: string;
  /** For expiry: a minute by default. */
  leewayMs?: number;
  /** How far ahead of this clock a token's issue time may be: five minutes by default. */
  futureLeewayMs?: number;
}

export type Claims = Record<string, unknown> & { sub: string };

/** The key id a token names, to pick the key (and to fetch the keys again if it is new). */
export function keyIdOf(token: string): string | undefined {
  try {
    const head = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    return typeof head.kid === 'string' ? head.kid : undefined;
  } catch {
    return undefined;
  }
}

/** The token's claims if it is good; otherwise throws with a sentence. */
export function verifyJwt(token: string, check: JwtCheck): Claims {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('that is not a token');
  let head: Record<string, unknown>;
  let body: Record<string, unknown>;
  try {
    head = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    body = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('the token cannot be read');
  }
  if (head.alg !== 'RS256') throw new Error(`tokens must be RS256, not ${String(head.alg)}`);
  const jwk = check.keys.find((k) => k.kid === head.kid && k.kty === 'RSA');
  if (!jwk) throw new Error('the tenant has no key with that id');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'), key, Buffer.from(parts[2], 'base64url'))) {
    throw new Error('the token\'s signature does not verify');
  }
  if (body.iss !== check.issuer) throw new Error('the token comes from another issuer');
  const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (!aud.includes(check.audience)) throw new Error('the token was made for another application');
  const leeway = check.leewayMs ?? 60_000;
  if (!(Number(body.exp) * 1000 > check.now - leeway)) throw new Error('the token has expired');
  // A token "issued" ahead of our clock means a clock is off. Five minutes is allowed: PCs drift (one here was 4.5
  // minutes slow, 2026-11-21), and expiry, not issue time, is what keeps an old token out.
  const ahead = Number(body.iat) * 1000 - check.now;
  if (body.iat !== undefined && ahead > (check.futureLeewayMs ?? 300_000)) {
    throw new Error(`the token was issued ${Math.round(ahead / 1000)} s ahead of this computer's clock; set the clock right`);
  }
  if (check.nonce !== undefined && body.nonce !== check.nonce) throw new Error('the token is not for this sign-in');
  if (typeof body.sub !== 'string' || !body.sub) throw new Error('the token names nobody');
  return body as Claims;
}
