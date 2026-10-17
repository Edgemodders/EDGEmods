#!/usr/bin/env node
// Checks a mod's folder the way EDGEmods will: edgemods.json, the page, the images, and file sizes.
//   edgemods-check <folder>          plain words
//   edgemods-check <folder> --json   the issues as JSON
import { resolve } from 'node:path';
import { checkModFolder } from '../dist/folder.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('usage: edgemods-check <mod folder> [--json]');
  process.exit(2);
}

const result = await checkModFolder(resolve(dir));
if (json) {
  console.log(JSON.stringify({ ok: result.ok, issues: result.issues }, null, 2));
} else {
  const errors = result.issues.filter((i) => i.level === 'error');
  const warnings = result.issues.filter((i) => i.level === 'warning');
  for (const i of errors) console.log(`ERROR    ${i.path ? `${i.path}: ` : ''}${i.message}`);
  for (const i of warnings) console.log(`WARNING  ${i.path ? `${i.path}: ` : ''}${i.message}`);
  console.log(result.ok
    ? `OK: ${result.manifest?.name} ${result.manifest?.version} is ready for EDGEmods${warnings.length ? `, with ${warnings.length} warning(s)` : ''}.`
    : `Not ready: ${errors.length} problem(s) to fix.`);
}
process.exit(result.ok ? 0 : 1);
