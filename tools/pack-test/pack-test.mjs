// Packs a small mod project on a GitHub runner through REDbridge, the way REDcode does, to find
// out whether the shared build workflow can work (docs/design.md, "Packing on GitHub").
// The project is made from scratch, so no game file is involved: an onscreens file (made by the
// bridge's loc.newFile, then filled with made-up entries so there is something to compress), its
// .archive.xl, and a Cyber Engine Tweaks script. Without a game folder, WolvenKit compresses
// with kraken.dll instead of the game's Oodle, as it must on a runner.
//
//   node tools/pack-test/pack-test.mjs <REDbridge.exe> <work folder>
//
// Writes <work>/packed (the game-folder layout) and prints timings; on GitHub also writes the
// job summary.
import { appendFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { bridge } from './bridge.mjs';

const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error('usage: node pack-test.mjs <REDbridge.exe> <work folder>');
  process.exit(2);
}
const MOD = 'edgemods-pack-test';
const project = join(work, MOD);
const packed = join(work, 'packed');
rmSync(work, { recursive: true, force: true });
mkdirSync(project, { recursive: true });

const times = [];
async function step(name, fn) {
  const t = performance.now();
  const r = await fn();
  times.push([name, Math.round(performance.now() - t)]);
  console.log(`${name}: ${times.at(-1)[1]} ms`);
  return r;
}

const files = (dir) => readdirSync(dir, { recursive: true })
  .map((f) => join(dir, f))
  .filter((f) => statSync(f).isFile())
  .map((f) => relative(dir, f).replaceAll('\\', '/'))
  .sort();

const started = performance.now();
const rb = bridge(exe);

// The project: an onscreens file and its .xl from the bridge, and a script under resources.
const loc = await step('loc.newFile (bridge start and first call)', () => rb.call('loc.newFile', { projectDir: project, modName: MOD }));
const lua = join(project, 'source', 'resources', 'bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods', MOD, 'init.lua');
mkdirSync(join(lua, '..'), { recursive: true });
writeFileSync(lua, 'registerForEvent("onInit", function() print("[edgemods-pack-test] loaded") end)\n');
// Fill the onscreens file with 20,000 made-up entries (the same every run), so the packer has a
// CR2W file of a few MB to compress, as a real mod's meshes and textures are.
const words = ['night', 'city', 'chrome', 'neon', 'edge', 'runner', 'street', 'data', 'ghost', 'signal'];
let seed = 1;
const say = (n) => Array.from({ length: n }, () => words[(seed = (seed * 1103515245 + 12345) % 2147483648) % words.length]).join(' ');
const doc = await rb.call('cr2w.open', { file: join(project, loc.file) });
await step('cr2w.patch, 20,000 entries', () => rb.call('cr2w.patch', {
  doc: doc.doc,
  ops: Array.from({ length: 20_000 }, (_, i) => ({
    op: 'add',
    path: 'root.Data.entries.-',
    value: { $type: 'localizationPersistenceOnScreenEntry', primaryKey: String(i + 1), secondaryKey: `edgemods-pack-test-${i}`, femaleVariant: say(12), maleVariant: say(12) },
  })),
}));
await rb.call('cr2w.save', { doc: doc.doc });

// Pack as REDcode's pack.ts does: the archive into archive/pc/mod, .xl files beside it,
// everything else under resources by its relative path.
const modDir = join(packed, 'archive', 'pc', 'mod');
const pack = await step('project.pack', () => rb.call('project.pack', { dir: join(project, 'source', 'archive'), outDir: modDir, modName: MOD }));
const resources = join(project, 'source', 'resources');
for (const f of files(resources)) {
  const to = f.endsWith('.xl') && !f.includes('/') ? join(modDir, f) : join(packed, f);
  mkdirSync(join(to, '..'), { recursive: true });
  cpSync(join(resources, f), to);
}

// Read the archive back, and unpack every resource to compare it with its source.
const listing = await step('archive.openMod', () => rb.call('archive.openMod', { path: pack.archive }));
const sources = files(join(project, 'source', 'archive'));
const back = join(work, 'unpacked');
await step('archive.extractFromMod', () => rb.call('archive.extractFromMod', {
  archivePath: pack.archive,
  items: sources.map((f) => ({ path: f.replaceAll('/', '\\'), outFile: join(back, f) })),
}));
rb.close();
const same = sources.filter((f) => readFileSync(join(project, 'source', 'archive', f)).equals(readFileSync(join(back, f))));
const inBytes = sources.reduce((n, f) => n + statSync(join(project, 'source', 'archive', f)).size, 0);
const total = Math.round(performance.now() - started);

const out = files(packed);
const report = [
  '## REDbridge pack on a GitHub runner',
  '',
  `Runner: ${process.env.RUNNER_OS ?? process.platform} ${process.env.ImageOS ?? ''} ${process.env.ImageVersion ?? ''}`.trim(),
  '',
  '| Step | Time |',
  '|---|---|',
  ...times.map(([n, ms]) => `| ${n} | ${ms} ms |`),
  `| Total, bridge start to read back | ${total} ms |`,
  '',
  `Onscreens file: \`${loc.file}\`; .xl: \`${loc.xl}\``,
  '',
  `Archive: ${pack.bytes} bytes from ${inBytes} bytes of source, ${pack.files} file(s) packed; warnings: ${pack.warnings.length ? pack.warnings.join(', ') : 'none'}`,
  '',
  `Unpacked and compared with the source: ${same.length} of ${sources.length} identical`,
  '',
  `Read back: ${listing.files} resource(s): ${listing.items.map((i) => `\`${i.name ?? i.hash}\``).join(', ')}`,
  '',
  'The packed folder:',
  '',
  ...out.map((f) => `- \`${f}\``),
  '',
].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);

const want = [`archive/pc/mod/${MOD}.archive`, `bin/x64/plugins/cyber_engine_tweaks/mods/${MOD}/init.lua`];
const missing = want.filter((f) => !out.includes(f));
if (same.length !== sources.length) {
  console.error(`Unpacked files differ from their source: ${sources.filter((f) => !same.includes(f)).join(', ')}`);
  process.exit(1);
}
if (missing.length || listing.files < 1 || !out.some((f) => f.startsWith('archive/pc/mod/') && f.endsWith('.xl'))) {
  console.error(`The packed folder is not what a mod manager expects; missing: ${missing.join(', ') || 'the .xl or the archive contents'}`);
  process.exit(1);
}
