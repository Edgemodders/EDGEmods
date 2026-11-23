#!/usr/bin/env node
// Sends a fresh index.db to the EDGEmods website (the index handover, POST /api/v1/admin/index), signed with
// EDGEMODS_INDEX_SECRET together with the time, as the service checks it. Used by .github/workflows/index.yml.
//
//   EDGEMODS_INDEX_SECRET=... node packages/indexer/bin/edgemods-index-send.mjs <index.db> <site>
//
// Exits 1 if the site refused it; the site keeps its current index then.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [file, site] = process.argv.slice(2);
const secret = process.env.EDGEMODS_INDEX_SECRET;
if (!file || !site) {
  console.error('Usage: edgemods-index-send <index.db> <site address>');
  process.exit(2);
}
if (!secret) {
  console.error('EDGEMODS_INDEX_SECRET is not set.');
  process.exit(2);
}
let url;
try {
  url = new URL('/api/v1/admin/index', site);
} catch {
  console.error(`Not a web address: ${site}`);
  process.exit(2);
}
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
  console.error(`The index goes over HTTPS only (or to this machine): ${site}`);
  process.exit(2);
}

const body = readFileSync(file);
const ts = String(Math.floor(Date.now() / 1000));
const signature = `sha256=${createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex')}`;
try {
  const res = await fetch(url, {
    method: 'POST',
    body,
    redirect: 'error',
    headers: { 'content-type': 'application/vnd.sqlite3', 'x-edgemods-timestamp': ts, 'x-edgemods-signature': signature },
  });
  const text = await res.text();
  let answer;
  try { answer = JSON.parse(text); } catch { answer = { message: text.slice(0, 300) }; }
  if (!res.ok) {
    console.error(`${url.host} refused the index (${res.status}): ${answer.message ?? answer.error ?? ''}`);
    process.exit(1);
  }
  console.log(`${url.host} took the index: ${answer.mods} mod(s) shown (${answer.before} before), built ${answer.indexBuiltAt}.`);
} catch (err) {
  console.error(`Could not send the index to ${url.host}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
