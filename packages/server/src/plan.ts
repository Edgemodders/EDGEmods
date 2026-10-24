// The install plan (docs/design.md, "Installing a mod and its requirements"): the mod a player picked, the chain of
// EDGEmods mods it needs, the release of each, the files, and the order to install them in, requirements first.
// The extension shows it, downloads and checks every file, then hands the mods to EDGEdeck in this order.
//
// Versions: a requirement allows its release or any newer one, or exactly it when pinned. Each mod gets the newest
// release every requirement on it allows (a pre-release only when nothing else fits). Choosing a release can bring
// in that release's own requirements, so the choice is repeated until it settles.

import { compareVersions, isModRequirement, isPrerelease, satisfies, type Requirement } from '@edgemodders/edgemods-format';
import type { ReleaseFile, ReleaseView } from './catalog.js';

export const MAX_DEPTH = 20;

export type PlanSource = (id: string) => { name: string; releases: ReleaseView[] } | undefined;

export interface PlanRequest {
  mod: string;
  /** A release of the mod; its newest one by default. */
  version?: string;
  /** The picked mod's optional files to add, and choose-one files to use instead of each group's first. */
  files?: string[];
}

export interface PlanFile {
  name: string;
  role: ReleaseFile['role'];
  group?: string;
  title?: string;
  size: number;
  sha256?: string;
  /** EDGEmods' download link; only for people who are signed in. */
  download?: string;
}

export interface PlanMod {
  id: string;
  name: string;
  version: string;
  /** The files to install. */
  files: PlanFile[];
  /** Files the player may add or swap in: optional files, and the other files of each choose-one group. */
  offered: PlanFile[];
  /** The mods that need this one, by id; empty for the picked mod. */
  neededBy: string[];
}

export interface PlanLink {
  name: string;
  url: string;
  note?: string;
  neededBy: string[];
}

export interface Plan {
  mod: string;
  /** Requirements first, the picked mod last. */
  mods: PlanMod[];
  /** Requirements outside EDGEmods, for the player to get themselves. Never fetched. */
  links: PlanLink[];
  /** Plain words. Any problem stops the install before anything is downloaded. */
  problems: string[];
  /** Bytes, all files in the plan. */
  size: number;
}

interface Constraint {
  version: string;
  exact?: boolean;
  by: string;
}

export function resolvePlan(source: PlanSource, request: PlanRequest, download?: (mod: string, version: string, file: string) => string): Plan {
  const root = source(request.mod);
  const empty = (problem: string): Plan => ({ mod: request.mod, mods: [], links: [], problems: [problem], size: 0 });
  if (!root) return empty(`"${request.mod}" is not on EDGEmods.`);
  const rootRelease = request.version ? root.releases.find((r) => r.version === request.version) : defaultRelease(root.releases);
  if (!rootRelease) return empty(`${root.name} has no release ${request.version} on EDGEmods.`);

  const names = new Map<string, string>([[request.mod, root.name]]);
  const nameOf = (id: string): string => names.get(id) ?? source(id)?.name ?? id;
  let choice = new Map<string, ReleaseView>([[request.mod, rootRelease]]);
  let walk!: Walk;
  for (let round = 0; round < 10; round++) {
    walk = walkChain(source, request, choice, nameOf);
    const next = new Map<string, ReleaseView>([[request.mod, rootRelease]]);
    for (const [id, constraints] of walk.constraints) {
      if (id === request.mod) {
        const unmet = constraints.filter((c) => !satisfies(rootRelease.version, c));
        if (unmet.length) walk.problems.push(`${unmet.map((c) => `${nameOf(c.by)} needs ${root.name} ${wanted(c)}`).join('; ')}, but this is ${root.name} ${rootRelease.version}.`);
        continue;
      }
      const mod = source(id);
      if (!mod) {
        walk.problems.push(`${list(constraints.map((c) => nameOf(c.by)))} ${constraints.length === 1 ? 'needs' : 'need'} "${id}", which is not on EDGEmods any more.`);
        continue;
      }
      names.set(id, mod.name);
      const picked = pick(mod.releases, constraints);
      if (!picked) {
        walk.problems.push(constraints.length === 1
          ? `${nameOf(constraints[0].by)} needs ${mod.name} ${wanted(constraints[0])}, and EDGEmods has no such release.`
          : `No release of ${mod.name} fits every mod that needs it: ${constraints.map((c) => `${nameOf(c.by)} needs ${wanted(c)}`).join('; ')}.`);
        continue;
      }
      next.set(id, picked);
    }
    const settled = next.size === choice.size && [...next].every(([id, r]) => choice.get(id)?.version === r.version);
    choice = next;
    if (settled || walk.problems.length) break;
  }
  walk = walkChain(source, request, choice, nameOf, walk.problems);

  const order = installOrder(request.mod, walk.edges);
  const mods: PlanMod[] = order.filter((id) => choice.has(id)).map((id) => {
    const release = choice.get(id)!;
    const selected = walk.files.get(id) ?? [];
    const asPlanFile = (f: ReleaseFile): PlanFile => planFile(f, release, id, download);
    return {
      id,
      name: nameOf(id),
      version: release.version,
      files: selected.map(asPlanFile),
      offered: release.files.filter((f) => !selected.includes(f)).map(asPlanFile),
      neededBy: [...(walk.neededBy.get(id) ?? [])],
    };
  });
  return {
    mod: request.mod,
    mods,
    links: [...walk.links.values()],
    problems: [...new Set(walk.problems)],
    size: mods.reduce((n, m) => n + m.files.reduce((k, f) => k + f.size, 0), 0),
  };
}

interface Walk {
  constraints: Map<string, Constraint[]>;
  edges: Map<string, string[]>;
  neededBy: Map<string, Set<string>>;
  files: Map<string, ReleaseFile[]>;
  links: Map<string, PlanLink>;
  problems: string[];
}

/** Follows requirements from the picked mod through the releases chosen so far, collecting what each mod asks for. */
function walkChain(source: PlanSource, request: PlanRequest, choice: Map<string, ReleaseView>, nameOf: (id: string) => string, problems: string[] = []): Walk {
  const w: Walk = { constraints: new Map(), edges: new Map(), neededBy: new Map(), files: new Map(), links: new Map(), problems };
  const seen = new Set<string>();
  const visit = (id: string, release: ReleaseView, path: string[]): void => {
    if (seen.has(id)) return;
    seen.add(id);
    if (path.length > MAX_DEPTH) {
      w.problems.push(`The chain of requirements is deeper than ${MAX_DEPTH} mods at ${nameOf(id)}.`);
      return;
    }
    const files = selectFiles(release.files, id === request.mod ? request.files : undefined);
    w.files.set(id, files);
    const requirements: Requirement[] = [...release.requirements, ...files.flatMap((f) => f.requirements ?? [])];
    for (const r of requirements) {
      if (!isModRequirement(r)) {
        const link = w.links.get(r.url) ?? { name: r.name, url: r.url, ...(r.note ? { note: r.note } : {}), neededBy: [] };
        if (!link.neededBy.includes(id)) link.neededBy.push(id);
        w.links.set(r.url, link);
        continue;
      }
      push(w.constraints, r.mod, { version: r.version, ...(r.exact ? { exact: true } : {}), by: id });
      if (!w.neededBy.has(r.mod)) w.neededBy.set(r.mod, new Set());
      w.neededBy.get(r.mod)!.add(id);
      if (path.includes(r.mod) || r.mod === id) {
        w.problems.push(`${nameOf(id)} needs ${nameOf(r.mod)}, which needs ${nameOf(id)} in turn. EDGEmods cannot choose which to install first.`);
        continue;
      }
      push(w.edges, id, r.mod);
      const next = choice.get(r.mod) ?? (() => {
        const mod = source(r.mod);
        return mod && pick(mod.releases, w.constraints.get(r.mod)!);
      })();
      if (next) visit(r.mod, next, [...path, r.mod]);
    }
  };
  visit(request.mod, choice.get(request.mod)!, [request.mod]);
  return w;
}

/** The files to install: every required file, one of each choose-one group (the asked-for one, or the first). */
function selectFiles(files: ReleaseFile[], asked: string[] = []): ReleaseFile[] {
  const groups = new Map<string, ReleaseFile>();
  for (const f of files.filter((x) => x.role === 'choose-one' && x.group)) {
    const current = groups.get(f.group!);
    if (!current || (asked.includes(f.name) && !asked.includes(current.name))) groups.set(f.group!, f);
  }
  return files.filter((f) => f.role === 'required' || (f.role === 'choose-one' && groups.get(f.group!) === f) || (f.role === 'optional' && asked.includes(f.name)));
}

/** The newest release that every requirement allows, preferring one that is not a pre-release. */
function pick(releases: ReleaseView[], constraints: Constraint[]): ReleaseView | undefined {
  const fits = releases.filter((r) => constraints.every((c) => satisfies(r.version, c))).sort((a, b) => compareVersions(b.version, a.version));
  return fits.find((r) => !isPrerelease(r.version)) ?? fits[0];
}

function defaultRelease(releases: ReleaseView[]): ReleaseView | undefined {
  return releases.find((r) => !r.prerelease) ?? releases[0];
}

/** Requirements before the mods that need them; the picked mod last. Each mod once. */
function installOrder(root: string, edges: Map<string, string[]>): string[] {
  const order: string[] = [];
  const done = new Set<string>();
  const visit = (id: string, path: Set<string>): void => {
    if (done.has(id) || path.has(id)) return;
    path.add(id);
    for (const dep of edges.get(id) ?? []) visit(dep, path);
    path.delete(id);
    done.add(id);
    order.push(id);
  };
  visit(root, new Set());
  return order;
}

function planFile(f: ReleaseFile, release: ReleaseView, mod: string, download?: (mod: string, version: string, file: string) => string): PlanFile {
  const sha256 = release.check?.downloads.find((d) => d.name === f.name)?.sha256;
  return {
    name: f.name,
    role: f.role,
    ...(f.group ? { group: f.group } : {}),
    ...(f.title ? { title: f.title } : {}),
    size: f.size,
    ...(sha256 ? { sha256 } : {}),
    ...(download ? { download: download(mod, release.version, f.name) } : {}),
  };
}

function wanted(c: { version: string; exact?: boolean }): string {
  return c.exact ? `exactly ${c.version}` : `${c.version} or newer`;
}

function list(items: string[]): string {
  const unique = [...new Set(items)];
  return unique.length <= 1 ? unique.join('') : `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
