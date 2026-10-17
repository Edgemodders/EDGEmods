import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const exampleDir = fileURLToPath(new URL('../../../examples/example-mod/', import.meta.url));

/** A fresh copy of the example manifest, to break one thing at a time. */
export function example() {
  return JSON.parse(readFileSync(join(exampleDir, 'edgemods.json'), 'utf8'));
}

export function messages(result, level = 'error') {
  return result.issues.filter((i) => i.level === level).map((i) => `${i.path}: ${i.message}`);
}
