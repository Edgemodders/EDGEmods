// Bundles the extension (CommonJS, VS Code's module loader) and its VS Code-free core on its own (for the tests and,
// from R4d, the MCP server). Copies the icons from the brand sources. `node esbuild.mjs --watch` rebuilds on change.
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';

const watch = process.argv.includes('--watch');

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, logLevel: 'info' };
const extension = { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] };
const core = { ...common, entryPoints: ['src/core/index.ts'], outfile: 'dist/core.js' };

fs.mkdirSync('images', { recursive: true });
fs.copyFileSync('../../tools/brand/activity.svg', 'images/activity.svg');
fs.copyFileSync('../../docs/assets/brand/icon.png', 'images/icon.png');

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(core)]);
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(core)]);
}
