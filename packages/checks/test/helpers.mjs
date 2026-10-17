// Test helpers: zip files built in memory, a fake GitHub holding a modder's repository made from the example mod,
// and a fake scanner.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

export const exampleDir = fileURLToPath(new URL('../../../examples/example-mod/', import.meta.url));

/** A zip with stored (uncompressed) entries. `encrypted` sets the flag only; it is enough for the listing. */
export function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.path, 'utf8');
    const data = Buffer.from(e.data ?? '');
    const flags = 0x800 | (e.encrypted ? 1 : 0);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Every file of a folder, as path -> bytes. */
export function readFolder(dir, rel = '') {
  const files = new Map();
  for (const name of readdirSync(join(dir, rel))) {
    const path = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, path)).isDirectory()) for (const [p, b] of readFolder(dir, path)) files.set(p, b);
    else files.set(path, readFileSync(join(dir, path)));
  }
  return files;
}

export const MODDER = { login: 'octo-modder', id: 1001, type: 'User' };
export const REGISTRY = 'Edgemodders/EDGEmods';

/**
 * A world where everything is right: octo-modder opens pull request 7, adding
 * registry/octo-modder/edgemods-example.json for octo-modder/example-mod, which has the example mod and a v1.0.0
 * release with its four files. Tests change one thing and expect one failure.
 */
export function goodWorld() {
  const modFiles = readFolder(exampleDir);
  const manifest = JSON.parse(modFiles.get('edgemods.json').toString('utf8'));
  manifest.author.github = MODDER.login;
  modFiles.set('edgemods.json', Buffer.from(JSON.stringify(manifest, null, 2)));

  const entry = { schemaVersion: 1, repo: 'https://github.com/octo-modder/example-mod', repoId: 5005, ownerId: MODDER.id };
  const assets = manifest.files.map((f, i) => {
    const bytes = makeZip([
      { path: `archive/pc/mod/${f.name.replace('.zip', '')}.archive`, data: 'archive bytes' },
      { path: `r6/tweaks/${i}.yaml`, data: 'tweak: 1' },
    ]);
    return { id: 9000 + i, name: f.name, size: bytes.length, bytes };
  });

  return {
    pr: { number: 7, state: 'open', author: { ...MODDER }, headSha: 'headsha', headRepo: 'octo-modder/EDGEmods' },
    changed: [{ path: 'registry/octo-modder/edgemods-example.json', status: 'added' }],
    prFiles: new Map([['registry/octo-modder/edgemods-example.json', Buffer.from(JSON.stringify(entry))]]),
    registryFiles: new Map([
      ['registry/README.md', Buffer.from('# registry')],
      ['registry/someone-else/better-car-radio.json', Buffer.from(JSON.stringify({ schemaVersion: 1, repo: 'https://github.com/someone-else/radio', repoId: 77, ownerId: 2002 }))],
    ]),
    repo: {
      id: 5005, name: 'example-mod', fullName: 'octo-modder/example-mod', owner: { ...MODDER },
      private: false, archived: false, disabled: false, fork: false, defaultBranch: 'main', htmlUrl: 'https://github.com/octo-modder/example-mod',
    },
    refs: { main: modFiles, 'v1.0.0': new Map(modFiles) },
    release: { tag: 'v1.0.0', draft: false, prerelease: false, assets },
  };
}

/** A GitHub over a world from goodWorld(). */
export function fakeGitHub(w) {
  return {
    async pullRequest(repo, number) {
      if (repo !== REGISTRY || number !== w.pr.number) throw new Error('no such pull request');
      return w.pr;
    },
    async changedFiles() {
      return w.changed;
    },
    async repo(fullName) {
      return w.repo && fullName.toLowerCase() === w.repo.fullName.toLowerCase() ? w.repo : undefined;
    },
    async file(fullName, ref, path) {
      if (fullName === w.pr.headRepo && ref === w.pr.headSha) return w.prFiles.get(path);
      if (fullName === REGISTRY) return w.registryFiles.get(path);
      return w.refs[ref]?.get(path);
    },
    async tree(fullName, ref) {
      const files = fullName === REGISTRY ? w.registryFiles : w.refs[ref];
      return { files: [...(files ?? new Map())].map(([path, b]) => ({ path, size: b.length })), truncated: false };
    },
    async releaseByTag(fullName, tag) {
      return w.release && w.release.tag === tag ? { ...w.release, assets: w.release.assets.map(({ bytes, ...a }) => a) } : undefined;
    },
    async downloadAsset(fullName, assetId, destination) {
      writeFileSync(destination, w.release.assets.find((a) => a.id === assetId).bytes);
    },
  };
}

/** Finds "EICAR" in a file, like a real scanner finds its test signature. */
export const fakeScanner = {
  name: 'TestScan',
  async scan(file) {
    return readFileSync(file).includes('EICAR') ? { clean: false, findings: ['Eicar-Test-Signature'] } : { clean: true, findings: [] };
  },
};
