#!/usr/bin/env node
// Runs the merge checks for one publish pull request. Used by .github/workflows/registry.yml.
//
//   GITHUB_TOKEN=… node packages/checks/bin/registry-check.mjs --repo Edgemodders/EDGEmods --pr 12 [--base main]
//     [--report report.md] [--result result.json] [--no-merge-note]
//
// EDGEMODS_SITE (the website, https://edgemods.ai) and EDGEMODS_CHECKS_SECRET connect the website: the checks ask
// its private blocklist, and a passing result is recorded there before the merge, so the release shows. Neither set:
// not connected yet (before the site is live). The site without the secret is an error, never a silent skip.
// Exit code 0 when every check passed, 1 when one failed, 2 when the checks could not run.
import { appendFileSync, writeFileSync } from 'node:fs';
import { blocklistApi, clamav, githubApi, renderReport, runChecks, sendCheckResult } from '../dist/index.js';

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

const { EDGEMODS_SITE: site, EDGEMODS_CHECKS_SECRET: secret } = process.env;
if (site && !secret) {
  console.error('The checks could not run: EDGEMODS_SITE is set but EDGEMODS_CHECKS_SECRET is not, so the blocklist cannot be asked.');
  process.exit(2);
}
try {
  const result = await runChecks({
    github: githubApi(process.env.GITHUB_TOKEN),
    registry,
    baseRef: arg('base') ?? 'main',
    pullRequest: pr,
    scanner: clamav(),
    blocklist: site ? blocklistApi(site, secret) : undefined,
  });
  const report = renderReport(result, { merging: args.includes('--no-merge-note') ? false : undefined });
  if (arg('report')) writeFileSync(arg('report'), report);
  if (arg('result')) writeFileSync(arg('result'), JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  console.log(report);
  if (result.ok && site) {
    await sendCheckResult(site, secret, result);
    console.log(`The passing result is recorded on ${new URL(site).host}.`);
  }
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  console.error(`The checks could not run: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
