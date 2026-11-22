// Bundles the extension (CommonJS, VS Code's module loader), its VS Code-free core on its own (for the tests) and the
// MCP server (dist/mcp.js, which bundles the core). Copies the icons from the brand sources. `node esbuild.mjs --watch` rebuilds on change.
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const watch = process.argv.includes('--watch');

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, logLevel: 'info' };
const extension = { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] };
const core = { ...common, entryPoints: ['src/core/index.ts'], outfile: 'dist/core.js' };
const mcp = { ...common, entryPoints: ['src/mcp.ts'], outfile: 'dist/mcp.js', minify: true };

fs.mkdirSync('images', { recursive: true });
fs.copyFileSync('../../tools/brand/activity.svg', 'images/activity.svg');
fs.copyFileSync('../../docs/assets/brand/icon.png', 'images/icon.png');

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(core), esbuild.context(mcp)]);
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  const [ext, , server] = await Promise.all([esbuild.build({ ...extension, metafile: true }), esbuild.build(core), esbuild.build({ ...mcp, metafile: true })]);
  writeNotices([ext.metafile, server.metafile]);
}

/**
 * ThirdPartyNotices.txt: the license of every npm package bundled into what the .vsix ships (extension.js and
 * mcp.js), as EDGEdeck does. Rewritten on every build. The workspace's own packages (packages/format) are this
 * repository's, MIT, and not listed.
 */
function writeNotices(metafiles) {
  const pkgs = new Map();
  for (const m of metafiles) {
    for (const input of Object.keys(m.inputs)) {
      const hit = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(input.replaceAll('\\', '/'));
      if (hit) pkgs.set(hit[2], hit[1]);
    }
  }
  const parts = ['The EDGEmods extension includes third-party software. Their notices follow.'];
  for (const [name, dir] of [...pkgs].sort(([a], [b]) => a.localeCompare(b))) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : `License: ${meta.license ?? 'see the package'}`;
    parts.push(`${name} ${meta.version}\n\n${text}`);
  }
  fs.writeFileSync('ThirdPartyNotices.txt', parts.join(`\n\n${'-'.repeat(78)}\n\n`) + '\n');
}
