// Installing a mod with its requirements through EDGEdeck (R4c; docs/design.md, "Installing a mod and its
// requirements"). The site works out the plan; this asks EDGEdeck what the library has, downloads every file still
// needed and checks each against the SHA-256 EDGEmods recorded, then hands the mods to EDGEdeck in the plan's order,
// all or nothing. Nothing goes into the game: EDGEdeck turns the mods on and the player deploys.
//
// No VS Code here: the extension supplies the questions (src/install.ts), the tests a stand-in EDGEdeck.

import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { satisfies } from '@edgemodders/edgemods-format';
import { ApiError, type Api, type Plan, type PlanFile, type PlanMod } from './api.js';
import { bytes } from './tools.js';

// ---- EDGEdeck's side (EDGEdeckApi since 0.34.0, EDGEdeck#16): the shapes as EDGEdeck's src/installMods.ts has them ----

export interface DeckItem {
  /** Downloaded .zip or .7z files, already checked. */
  files: string[];
  source: 'edgemods';
  modId: string;
  version: string;
  name: string;
  /** EDGEmods ids of the mods it needs. */
  requires: string[];
}

export interface DeckInstalled {
  modId: string;
  /** EDGEdeck's own id for the mod. */
  id: string;
  version: string;
}

export type DeckResult =
  | { ok: true; installed: DeckInstalled[]; skipped: DeckInstalled[] }
  | { ok: false; failed: { modId: string; step: string; reason: string }; undone: string[] };

/** A release of an EDGEmods mod in EDGEdeck's library. */
export interface DeckMod {
  modId: string;
  version: string;
  id: string;
  /** On in the active loadout. */
  on: boolean;
  /** Its files are in the game. */
  deployed: boolean;
}

export interface Deck {
  installMods(mods: DeckItem[], options?: { title?: string }): Promise<DeckResult>;
  edgemodsMods(): DeckMod[];
}

// ---- what to do ----

export interface Sorted {
  /** To download and hand to EDGEdeck, in install order. */
  get: PlanMod[];
  /** In EDGEdeck already and on, at a release every mod that needs it accepts. */
  kept: { mod: PlanMod; have: DeckMod }[];
}

/**
 * Which mods of the plan EDGEdeck has already. The mod asked for counts only at the release asked for; a requirement
 * at any release that is on and that everything needing it accepts. A release that is there but off is installed
 * again, which turns it back on.
 */
export function sortOut(plan: Plan, have: DeckMod[]): Sorted {
  const sorted: Sorted = { get: [], kept: [] };
  for (const mod of plan.mods) {
    const on = have.filter((h) => h.modId === mod.id && h.on);
    const accepts = (h: DeckMod): boolean =>
      mod.id === plan.mod || !mod.wants?.length ? h.version === mod.version : mod.wants.every((w) => satisfies(h.version, w));
    const found = on.find((h) => h.version === mod.version) ?? on.find(accepts);
    if (found && accepts(found)) sorted.kept.push({ mod, have: found });
    else sorted.get.push(mod);
  }
  return sorted;
}

/** The ids of the plan's mods that this one needs. */
export function requiresOf(plan: Plan, mod: PlanMod): string[] {
  return plan.mods.filter((m) => m.neededBy.includes(mod.id)).map((m) => m.id);
}

/** The files the asked-for mod installs unless the player picks others. */
export function defaultFiles(mod: PlanMod): string[] {
  return mod.files.filter((f) => f.role !== 'required').map((f) => f.name);
}

/** The asked-for mod's choices: each choose-one group with more than one file, and its optional files. */
export function choicesOf(mod: PlanMod): { groups: { group: string; files: PlanFile[]; picked: string }[]; optional: PlanFile[] } {
  const all = [...mod.files, ...mod.offered];
  const groups = [...new Set(all.filter((f) => f.role === 'choose-one' && f.group).map((f) => f.group!))]
    .map((group) => ({ group, files: all.filter((f) => f.role === 'choose-one' && f.group === group), picked: mod.files.find((f) => f.group === group)?.name ?? '' }))
    .filter((g) => g.files.length > 1);
  return { groups, optional: mod.offered.filter((f) => f.role === 'optional') };
}

/** A file name from the site that is safe to write as it is: no folders, nothing Windows refuses. */
export function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && basename(name) === name && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !/^\.+$/.test(name) && !/[. ]$/.test(name);
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The question the player answers before anything downloads, in plain words. */
export function describe(plan: Plan, sorted: Sorted): { message: string; detail: string } {
  const root = plan.mods.find((m) => m.id === plan.mod)!;
  const names = new Map(plan.mods.map((m) => [m.id, m.name]));
  const getting = sorted.get.includes(root);
  const others = sorted.get.filter((m) => m !== root).length;
  const size = sorted.get.reduce((n, m) => n + m.files.reduce((k, f) => k + f.size, 0), 0);
  const message = getting
    ? `Install ${root.name} ${root.version}${others ? ` and ${count(others, 'mod it needs', 'mods it needs')}` : ''}?`
    : `${root.name} ${root.version} is in EDGEdeck already. Install ${count(others, 'mod it needs', 'mods it needs')}?`;
  const line = (m: PlanMod): string => `• ${m.name} ${m.version}${m.neededBy.length ? `, needed by ${m.neededBy.map((n) => names.get(n) ?? n).join(', ')}` : ''} (${bytes(m.files.reduce((k, f) => k + f.size, 0))})`;
  const unchecked = sorted.get.flatMap((m) => m.files).filter((f) => !f.sha256).length;
  const detail = [
    `To install, ${bytes(size)} to download:`,
    ...sorted.get.map(line),
    ...(sorted.kept.length ? ['', 'In EDGEdeck already, kept as they are:', ...sorted.kept.map((k) => `• ${k.mod.name} ${k.have.version}`)] : []),
    ...(plan.links.length ? ['', 'Get these yourself, from outside EDGEmods (EDGEmods does not check them):', ...plan.links.map((l) => `• ${l.name}${l.note ? ` (${l.note})` : ''}`)] : []),
    ...(unchecked ? ['', `EDGEmods has not checked ${count(unchecked, 'of these files', 'of these files')} yet, so ${unchecked === 1 ? 'it is' : 'they are'} not compared with a checked copy.`] : []),
    '',
    'EDGEdeck adds them and turns them on. Nothing goes into the game until you deploy.',
  ];
  return { message, detail: detail.join('\n') };
}

// ---- running it ----

export interface InstallRequest {
  mod: string;
  /** The newest release when left out. */
  version?: string;
}

/** The player's choice of the asked-for mod's files; undefined cancels. Asked only when there is a choice. */
export type ChooseFiles = (mod: PlanMod, choices: ReturnType<typeof choicesOf>) => Promise<string[] | undefined>;

export type Prepared =
  | { kind: 'ready'; plan: Plan; sorted: Sorted; root: PlanMod; words: { message: string; detail: string } }
  | { kind: 'nothing'; plan: Plan; sorted: Sorted; root: PlanMod }
  | Stopped;

export type Stopped =
  | { kind: 'cancelled' }
  | { kind: 'problems'; problems: string[] }
  | { kind: 'failed'; step: 'plan' | 'download' | 'check' | 'install'; mod?: { id: string; name: string; version: string }; reason: string; code?: string; undone?: string[] };

export type Done = { kind: 'done'; plan: Plan; sorted: Sorted; root: PlanMod; installed: DeckInstalled[] } | Stopped;

const failedPlan = (err: unknown): Stopped => ({
  kind: 'failed', step: 'plan', reason: err instanceof Error ? err.message : String(err), ...(err instanceof ApiError ? { code: err.code } : {}),
});

/** The plan, the player's file choices, and what EDGEdeck has: everything before the question. */
export async function prepare(api: Api, deck: Deck, req: InstallRequest, chooseFiles: ChooseFiles): Promise<Prepared> {
  let plan: Plan;
  try {
    plan = await api.installPlan(req.mod, { version: req.version });
  } catch (err) {
    return failedPlan(err);
  }
  if (plan.problems.length) return { kind: 'problems', problems: plan.problems };
  let root = plan.mods.find((m) => m.id === plan.mod);
  if (!root) return { kind: 'problems', problems: [`EDGEmods cannot work out an install for ${req.mod}.`] };
  const choices = choicesOf(root);
  if (choices.groups.length || choices.optional.length) {
    const picked = await chooseFiles(root, choices);
    if (!picked) return { kind: 'cancelled' };
    // A choose-one group with a single file is no choice; it stays.
    const files = [...picked, ...root.files.filter((f) => f.role === 'choose-one' && !choices.groups.some((g) => g.group === f.group)).map((f) => f.name)];
    const before = defaultFiles(root).sort().join('\n');
    if ([...files].sort().join('\n') !== before) {
      // Another file can bring other requirements, so the site works the plan out again.
      try {
        plan = await api.installPlan(req.mod, { version: root.version, files });
      } catch (err) {
        return failedPlan(err);
      }
      if (plan.problems.length) return { kind: 'problems', problems: plan.problems };
      root = plan.mods.find((m) => m.id === plan.mod)!;
    }
  }
  const sorted = sortOut(plan, deck.edgemodsMods());
  if (!sorted.get.length) return { kind: 'nothing', plan, sorted, root };
  const bad = sorted.get.flatMap((m) => m.files).find((f) => !safeName(f.name));
  if (bad) return { kind: 'failed', step: 'download', reason: `The file name "${bad.name}" cannot be saved as it is on this PC, so nothing was downloaded. Report the mod.` };
  return { kind: 'ready', plan, sorted, root, words: describe(plan, sorted) };
}

export interface CarryOut {
  /** An empty folder of this run's own; removed afterwards, whatever happens. */
  folder: string;
  progress?(text: string, done: number, total: number): void;
  signal?: AbortSignal;
}

/** Downloads and checks every file, then hands the mods to EDGEdeck. Call after the player said yes. */
export async function carryOut(api: Api, deck: Deck, ready: Extract<Prepared, { kind: 'ready' }>, opts: CarryOut): Promise<Done> {
  const { plan, sorted, root } = ready;
  const total = sorted.get.reduce((n, m) => n + m.files.reduce((k, f) => k + f.size, 0), 0);
  let before = 0;
  const items: DeckItem[] = [];
  try {
    for (const mod of sorted.get) {
      const files: string[] = [];
      for (const f of mod.files) {
        const dest = join(opts.folder, mod.id, mod.version, f.name);
        await mkdir(dirname(dest), { recursive: true });
        try {
          await api.download(api.downloadPath(mod.id, mod.version, f.name), dest, {
            sha256: f.sha256, signal: opts.signal,
            onProgress: (done) => opts.progress?.(`${mod.name} ${mod.version}: ${f.name}`, before + Math.min(done, f.size), total),
          });
        } catch (err) {
          if (err instanceof ApiError && err.code === 'cancelled') return { kind: 'cancelled' };
          const at = { id: mod.id, name: mod.name, version: mod.version };
          if (err instanceof ApiError && err.code === 'checksum') return { kind: 'failed', step: 'check', mod: at, reason: `${f.name}: ${err.message}`, code: err.code };
          return { kind: 'failed', step: 'download', mod: at, reason: `${f.name}: ${err instanceof Error ? err.message : err}`, ...(err instanceof ApiError ? { code: err.code } : {}) };
        }
        before += f.size;
        files.push(dest);
      }
      items.push({ files, source: 'edgemods', modId: mod.id, version: mod.version, name: mod.name, requires: requiresOf(plan, mod) });
    }
    opts.progress?.('EDGEdeck is adding them', total, total);
    let result: DeckResult;
    try {
      result = await deck.installMods(items, { title: `Installing ${root.name} ${root.version}` });
    } catch (err) {
      return { kind: 'failed', step: 'install', reason: `EDGEdeck stopped: ${err instanceof Error ? err.message : err}` };
    }
    if (!result.ok) {
      const at = plan.mods.find((m) => m.id === result.failed.modId);
      return {
        kind: 'failed', step: 'install', reason: result.failed.reason, code: result.failed.step, undone: result.undone,
        ...(at ? { mod: { id: at.id, name: at.name, version: at.version } } : {}),
      };
    }
    return { kind: 'done', plan, sorted, root, installed: [...result.installed, ...result.skipped] };
  } finally {
    // EDGEdeck keeps its own copy of each download in the library.
    await rm(opts.folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A stopped install in one sentence, naming the mod and the step; a requirement is never reported as the mod asked for. */
export function failureWords(s: Extract<Stopped, { kind: 'failed' }>): string {
  const what = s.mod ? `${s.mod.name} ${s.mod.version}` : '';
  const step = { plan: 'EDGEmods could not work out the install', download: `${what || 'A file'} did not download`, check: `${what || 'A file'} failed its check`, install: `EDGEdeck could not add ${what || 'the mods'}` }[s.step];
  return `Nothing was installed. ${step}: ${s.reason}`;
}
