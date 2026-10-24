#!/usr/bin/env node
// Builds the website's index.db from a checkout's registry folder and the mods' repositories on GitHub.
//
//   node packages/indexer/bin/edgemods-index.mjs [--registry registry] [--out index.db] [--ref <commit>]
//
// GITHUB_TOKEN (or GH_TOKEN) is used when set: GitHub allows 60 reads an hour without one, 5,000 with one.
// Exits 1 if the index could not be built; mods left out are listed but are not a failure.
import { resolve } from 'node:path';
import { githubApi } from '@edgemodders/edgemods-checks';
import { buildIndex, readRegistry } from '../dist/index.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const registry = resolve(option('registry', 'registry'));
const out = resolve(option('out', 'index.db'));
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;

try {
  const { mods, problems: entryProblems } = readRegistry(registry);
  console.log(`Registry: ${mods.length} mod(s) in ${registry}${token ? '' : ' (no GITHUB_TOKEN: 60 GitHub reads an hour)'}`);
  const started = Date.now();
  const result = await buildIndex({ github: githubApi(token), mods, out, registryRef: option('ref'), log: (m) => console.log(`  ${m}`) });
  const problems = [...entryProblems, ...result.problems];
  console.log(`Index: ${result.mods} mod(s), ${result.releases} release(s), in ${((Date.now() - started) / 1000).toFixed(1)} s: ${out}`);
  if (problems.length) {
    console.log('Left out:');
    for (const p of problems) console.log(`  ${p.mod}${p.version ? ` ${p.version}` : ''}: ${p.message}`);
  }
} catch (err) {
  console.error(`The index could not be built: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
