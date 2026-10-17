#!/usr/bin/env node
// Runs the merge checks for one publish pull request. Used by .github/workflows/registry.yml.
//
//   GITHUB_TOKEN=… node packages/checks/bin/registry-check.mjs --repo Edgemodders/EDGEmods --pr 12 [--base main]
//     [--report report.md] [--result result.json] [--no-merge-note]
//
// Optional: EDGEMODS_API_URL and EDGEMODS_REGISTRY_SECRET connect the private blocklist on the EDGEmods server.
// Exit code 0 when every check passed, 1 when one failed, 2 when the checks could not run.
import { appendFileSync, writeFileSync } from 'node:fs';
import { blocklistApi, clamav, githubApi, renderReport, runChecks } from '../dist/index.js';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const registry = arg('repo') ?? process.env.GITHUB_REPOSITORY;
const pr = Number(arg('pr'));
if (!registry || !Number.isInteger(pr) || pr <= 0) {
  console.error('usage: registry-check --repo owner/name --pr <number> [--base main] [--report file] [--result file]');
  process.exit(2);
}

const { EDGEMODS_API_URL: apiUrl, EDGEMODS_REGISTRY_SECRET: secret } = process.env;
try {
  const result = await runChecks({
    github: githubApi(process.env.GITHUB_TOKEN),
    registry,
    baseRef: arg('base') ?? 'main',
    pullRequest: pr,
    scanner: clamav(),
    blocklist: apiUrl && secret ? blocklistApi(apiUrl, secret) : undefined,
  });
  const report = renderReport(result, { merging: args.includes('--no-merge-note') ? false : undefined });
  if (arg('report')) writeFileSync(arg('report'), report);
  if (arg('result')) writeFileSync(arg('result'), JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  console.log(report);
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  console.error(`The checks could not run: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
