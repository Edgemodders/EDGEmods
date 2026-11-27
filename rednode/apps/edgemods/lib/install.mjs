// Installing a REDnode mod from the game (docs/design.md, "REDnode mods and the in-game browser"): the plan from the
// site, what this browser installed already, every file downloaded and checked against its SHA-256 and unpacked
// before anything moves, then each package folder moved into the browser's own folder (Documents\REDnode\EDGEmods),
// all or nothing. REDnode sees the new folders and starts them. No 'rednode' imports, so the tests run it in Node.

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzip } from './zip.mjs';

/** -1, 0 or 1. Numbers compare as numbers; a pre-release (1.0.0-beta) comes before its release. */
export function compareVersions(a, b) {
  const [ma, pa = ''] = String(a).split('-', 2);
  const [mb, pb = ''] = String(b).split('-', 2);
  const na = ma.split('.').map(Number);
  const nb = mb.split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] || 0) - (nb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa < pb ? -1 : 1;
}

/** Whether a release every one of `wants` accepts: that release or newer, or exactly it. */
export function accepts(version, wants = []) {
  return wants.every((w) => (w.exact ? compareVersions(version, w.version) === 0 : compareVersions(version, w.version) >= 0));
}

/** What this browser installed, kept in the package's data folder: mod id -> { version, name, packages, at }. */
export class Installed {
  constructor(file) {
    this.file = file;
    this.mods = {};
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      this.mods = data && typeof data.mods === 'object' ? data.mods : {};
    } catch {
      this.mods = {};
    }
    return this;
  }

  async save() {
    await writeFile(`${this.file}.new`, JSON.stringify({ mods: this.mods }, null, 2));
    await rename(`${this.file}.new`, this.file);
  }

  get(id) {
    return this.mods[id];
  }

  list() {
    return Object.entries(this.mods).map(([id, m]) => ({ id, ...m })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The mod that installed a package, if this browser did. */
  ownerOf(packageId) {
    return Object.entries(this.mods).find(([, m]) => m.packages.some((p) => p.id === packageId))?.[0];
  }
}

const filesOf = (m) => m.files ?? [];

/**
 * Works out what to do. `elsewhere(id)` says whether a package with that id is already in another of REDnode's
 * folders (the game's apps folder, where EDGEdeck deploys, or a development folder).
 */
export async function prepare(site, req, installed, elsewhere = () => false) {
  const plan = await site.plan(req.mod, req.version);
  if (plan.problems?.length) return { kind: 'problems', problems: plan.problems };
  if (!plan.inGame) {
    const outside = plan.mods.filter((m) => !m.inGame).map((m) => m.name);
    return { kind: 'edgedeck', plan, outside };
  }
  const get = [];
  const kept = [];
  for (const m of plan.mods) {
    const have = installed.get(m.id);
    const keep = m.id === plan.mod ? have?.version === m.version : Boolean(have && accepts(have.version, m.wants));
    (keep ? kept : get).push(m);
  }
  if (!get.length) return { kind: 'nothing', plan, kept };
  const problems = [];
  const packages = [];
  for (const m of get) {
    for (const f of filesOf(m)) {
      if (!f.sha256) problems.push(`${m.name}'s file ${f.name} has not been checked by EDGEmods yet.`);
      if (!f.download) problems.push(`${m.name}'s file ${f.name} has no download link: sign in first.`);
      if (!/\.zip$/i.test(f.name)) problems.push(`${m.name}'s file ${f.name} is not a .zip, which the game cannot unpack. Install it from EDGEkit.`);
      for (const k of f.rednode?.packages ?? []) packages.push({ ...k, mod: m.id, modName: m.name });
    }
  }
  const seen = new Map();
  for (const k of packages) {
    const owner = installed.ownerOf(k.id);
    if (seen.has(k.id)) problems.push(`${k.modName} and ${seen.get(k.id)} both have a REDnode package called "${k.id}".`);
    else if (owner && owner !== k.mod) problems.push(`The package "${k.id}" in ${k.modName} is already installed by ${installed.get(owner).name}.`);
    else if (elsewhere(k.id)) problems.push(`REDnode already has a package called "${k.id}", installed by EDGEdeck or by hand. Remove that copy first, or keep using it.`);
    seen.set(k.id, k.modName);
  }
  if (problems.length) return { kind: 'problems', problems };
  return { kind: 'ready', plan, get, kept, packages };
}

/** The question before installing, in plain words: { title, lines }. */
export function describe(ready) {
  const asked = ready.get.find((m) => m.id === ready.plan.mod) ?? ready.get.at(-1);
  const needs = ready.get.filter((m) => m !== asked);
  const title = `Install ${asked.name} ${asked.version}${needs.length ? ` and ${needs.length === 1 ? '1 mod' : `${needs.length} mods`} it needs` : ''}?`;
  const what = (k) => [k.window && 'a window', k.hud && 'a HUD widget', k.node && 'a Node mod', k.service && 'a service'].filter(Boolean).join(', ') || 'a package';
  const lines = [];
  for (const m of ready.get) {
    lines.push(`${m.name} ${m.version}${m.neededBy?.length ? ` (needed by ${m.neededBy.join(', ')})` : ''}`);
    for (const k of ready.packages.filter((p) => p.mod === m.id)) {
      lines.push(`  ${k.name}: ${what(k)}${k.permissions?.length ? `; asks for ${k.permissions.join(', ')}` : ''}${k.node || k.service ? '; runs code on your PC' : ''}`);
    }
  }
  for (const m of ready.kept) lines.push(`${m.name}: installed already`);
  for (const l of ready.plan.links ?? []) lines.push(`Get by hand: ${l.name} (${l.url})`);
  return { title, lines };
}

async function move(src, dest) {
  try {
    await rename(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV' && err.code !== 'EPERM') throw err;
    await cp(src, dest, { recursive: true, errorOnExist: true });
    await rm(src, { recursive: true, force: true });
  }
}

/**
 * Downloads, checks, unpacks and moves into `target`. Nothing in `target` changes until every file is checked and
 * unpacked; a failure while moving puts back what was there. Answers { mods, opened, closed }: the package ids to
 * switch on, and those an update no longer has.
 */
export async function carryOut(site, ready, { target, work, installed, progress = () => {}, signal, now = () => new Date().toISOString() }) {
  const run = join(work, `run-${Date.now()}`);
  const moves = [];
  try {
    let n = 0;
    const total = ready.get.reduce((k, m) => k + filesOf(m).length, 0);
    for (const m of ready.get) {
      for (const f of filesOf(m)) {
        n += 1;
        const at = join(run, m.id, `${n}`);
        await mkdir(at, { recursive: true });
        const file = join(at, 'download.zip');
        progress({ step: 'download', text: `Downloading ${m.name} (${n} of ${total})`, done: 0, total: f.size });
        await site.download(f.download, file, { sha256: f.sha256, signal, onProgress: (done, size) => progress({ step: 'download', text: `Downloading ${m.name} (${n} of ${total})`, done, total: size ?? f.size }) });
        progress({ step: 'unpack', text: `Unpacking ${m.name}` });
        const unpacked = join(at, 'files');
        await unzip(file, unpacked);
        for (const k of f.rednode?.packages ?? []) {
          const src = k.folder ? join(unpacked, ...k.folder.split('/')) : unpacked;
          let manifest;
          try {
            manifest = JSON.parse((await readFile(join(src, 'rednode-app.json'), 'utf8')).replace(/^﻿/, ''));
          } catch {
            throw Object.assign(new Error(`${m.name}'s package ${k.name} has no readable rednode-app.json.`), { step: 'unpack' });
          }
          if (manifest.id !== k.id) throw Object.assign(new Error(`${m.name}'s package is "${manifest.id}", not the "${k.id}" EDGEmods checked.`), { step: 'check' });
          moves.push({ mod: m, id: k.id, name: k.name, src });
        }
      }
    }
    if (signal?.aborted) throw Object.assign(new Error('Cancelled.'), { step: 'cancelled' });

    progress({ step: 'install', text: 'Putting the packages in place' });
    await mkdir(target, { recursive: true });
    const done = [];
    try {
      for (const mv of moves) {
        const dest = join(target, mv.id);
        let old;
        if (existsSync(dest)) {
          old = join(run, 'old', mv.id);
          await mkdir(join(run, 'old'), { recursive: true });
          await move(dest, old);
        }
        done.push({ dest, old });
        await move(mv.src, dest);
      }
    } catch (err) {
      for (const d of done.reverse()) {
        await rm(d.dest, { recursive: true, force: true }).catch(() => {});
        if (d.old) await move(d.old, d.dest).catch(() => {});
      }
      throw Object.assign(new Error(`The packages could not be put in place: ${err.message}`), { step: 'install' });
    }

    const closed = [];
    for (const m of ready.get) {
      const ids = moves.filter((mv) => mv.mod === m).map((mv) => ({ id: mv.id, name: mv.name }));
      for (const p of installed.get(m.id)?.packages ?? []) {
        if (!ids.some((x) => x.id === p.id)) {
          closed.push(p.id);
          await rm(join(target, p.id), { recursive: true, force: true });
        }
      }
      const needs = ready.plan.mods.filter((o) => (o.neededBy ?? []).includes(m.id)).map((o) => o.id);
      installed.mods[m.id] = { version: m.version, name: m.name, packages: ids, needs, at: now() };
    }
    await installed.save();
    return { mods: ready.get.map((m) => ({ id: m.id, name: m.name, version: m.version })), opened: moves.map((mv) => mv.id), closed };
  } finally {
    await rm(run, { recursive: true, force: true }).catch(() => {});
  }
}

/** Removes a mod this browser installed: its package folders go, and REDnode stops them. Answers their ids. */
export async function removeMod(installed, target, mod) {
  const m = installed.get(mod);
  if (!m) return [];
  for (const p of m.packages) await rm(join(target, p.id), { recursive: true, force: true });
  delete installed.mods[mod];
  await installed.save();
  return m.packages.map((p) => p.id);
}

/** The names of mods this browser installed that need `mod`, so removing it can say so first. */
export function dependents(installed, mod) {
  return Object.entries(installed.mods).filter(([id, m]) => id !== mod && (m.needs ?? []).includes(mod)).map(([, m]) => m.name);
}
