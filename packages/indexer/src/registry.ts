// Reads the registry folder of a checkout: registry/<github-login>/<mod-id>.json, one file per mod.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseEntry, parseEntryPath, REGISTRY_DIR } from '@edgemodders/edgemods-checks';
import type { Problem, RegistryMod } from './build.js';

export function readRegistry(dir: string): { mods: RegistryMod[]; problems: Problem[] } {
  const mods: RegistryMod[] = [];
  const problems: Problem[] = [];
  for (const owner of readdirSync(dir).sort()) {
    if (!statSync(join(dir, owner)).isDirectory()) continue;
    for (const name of readdirSync(join(dir, owner)).sort()) {
      const where = parseEntryPath(`${REGISTRY_DIR}/${owner}/${name}`);
      if (!where) continue;
      const { entry, issues } = parseEntry(readFileSync(join(dir, owner, name), 'utf8'));
      if (entry) mods.push({ ...where, entry });
      else problems.push({ mod: where.id, message: `Its registry file has problems: ${issues.map((i) => i.message).join(' ')}` });
    }
  }
  return { mods, problems };
}
