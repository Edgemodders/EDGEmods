#!/usr/bin/env node
// Writes schema/edgemods.schema.json from the built package. Run with `npm run schema`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema } from '../dist/index.js';

const out = fileURLToPath(new URL('../schema/edgemods.schema.json', import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(buildSchema(), null, 2) + '\n');
console.log(`wrote ${out}`);
