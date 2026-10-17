// The merge checks for a publish pull request: a chain of steps, each passing or failing with reasons in plain
// words. The pull request merges by itself only when every step passes. The steps never run anything from the
// pull request or the mod's repository: they read files as data, measure, parse and hash them.

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkModFiles,
  checkRelease,
  formatBytes,
  MANIFEST_FILE,
  parseManifest,
  releaseTag,
  type Issue,
  type Manifest,
  type ModFiles,
} from '@edgemodders/edgemods-format';
import { ArchiveError, listArchive, sha256 } from './archive.js';
import { summarize, unsafePaths, type ContentSummary } from './contents.js';
import { parseEntry, parseEntryPath, repoFromUrl, REGISTRY_DIR, type EntryPath, type RegistryEntry } from './entry.js';
import type { GitHub, PullRequest, Release, Repo } from './github.js';
import { ScannerUnavailable, type Scanner } from './scan.js';

export interface Blocklist {
  /** Whether EDGEmods' admins have blocked this GitHub account or repository. */
  check(query: { ownerId: number; login: string; repoId: number }): Promise<{ blocked: boolean }>;
}

export interface CheckOptions {
  github: GitHub;
  /** owner/name of the EDGEmods registry repository. */
  registry: string;
  /** The registry's main branch, where existing entries are read. */
  baseRef: string;
  pullRequest: number;
  scanner?: Scanner;
  blocklist?: Blocklist;
  /** Where downloads are put while they are checked. A fresh temporary folder by default. */
  workDir?: string;
  /** All of a mod's downloads together. 8 GiB by default. */
  maxDownloadBytes?: number;
}

export type StepStatus = 'pass' | 'fail' | 'skip';

export interface StepResult {
  id: string;
  title: string;
  status: StepStatus;
  issues: Issue[];
  /** Plain facts for the report, such as "Owner: octocat". */
  notes: string[];
}

export interface DownloadReport {
  name: string;
  size: number;
  sha256: string;
  contents: ContentSummary;
  scan?: { scanner: string; clean: boolean; findings: string[] };
}

export interface CheckResult {
  /** Every step passed: the pull request may merge. */
  ok: boolean;
  steps: StepResult[];
  mod?: { id: string; name: string; version: string; owner: string; repo: string; repoId: number };
  downloads: DownloadReport[];
}

interface State {
  pr?: PullRequest;
  where?: EntryPath;
  entry?: RegistryEntry;
  repo?: Repo;
  manifest?: Manifest;
  release?: Release;
  downloads: DownloadReport[];
  /** edgemods.json issues the metadata step reported, so the files step does not repeat them. */
  reported: Set<string>;
}

const issueKey = (i: Issue): string => `${i.path}\n${i.message}`;

class Step {
  readonly issues: Issue[] = [];
  readonly notes: string[] = [];
  constructor(readonly id: string, readonly title: string) {}
  fail(message: string, path = ''): void {
    this.issues.push({ level: 'error', path, message });
  }
  warn(message: string, path = ''): void {
    this.issues.push({ level: 'warning', path, message });
  }
  get failed(): boolean {
    return this.issues.some((i) => i.level === 'error');
  }
}

type StepFn = (s: Step, state: State, o: CheckOptions) => Promise<void>;

const STEPS: [string, string, StepFn][] = [
  ['pull-request', 'The pull request', checkPullRequest],
  ['repository', "The mod's repository", checkRepository],
  ['metadata', 'edgemods.json', checkMetadata],
  ['release', 'The release', checkReleaseStep],
  ['files', 'The mod page and images', checkFiles],
  ['downloads', 'The downloads: contents and malware scan', checkDownloads],
];

export async function runChecks(options: CheckOptions): Promise<CheckResult> {
  const state: State = { downloads: [], reported: new Set() };
  const steps: StepResult[] = [];
  let stopped = false;
  for (const [id, title, fn] of STEPS) {
    if (stopped) {
      steps.push({ id, title, status: 'skip', issues: [], notes: ['Skipped until the problems above are fixed.'] });
      continue;
    }
    const step = new Step(id, title);
    try {
      await fn(step, state, options);
    } catch (err) {
      step.fail(`The check could not finish: ${err instanceof Error ? err.message : String(err)}. Re-run the checks; if it happens again, an EDGEmods admin will look.`);
    }
    steps.push({ id, title, status: step.failed ? 'fail' : 'pass', issues: step.issues, notes: step.notes });
    if (step.failed) stopped = true;
  }
  const ok = steps.every((s) => s.status === 'pass');
  const { where, entry, repo, manifest } = state;
  return {
    ok,
    steps,
    downloads: state.downloads,
    ...(where && entry && repo && manifest
      ? { mod: { id: where.id, name: manifest.name, version: manifest.version, owner: repo.owner.login, repo: repo.htmlUrl, repoId: repo.id } }
      : {}),
  };
}

async function checkPullRequest(s: Step, state: State, o: CheckOptions): Promise<void> {
  const pr = await o.github.pullRequest(o.registry, o.pullRequest);
  state.pr = pr;
  s.notes.push(`Opened by ${pr.author.login}.`);
  if (pr.state !== 'open') return s.fail('The pull request is not open.');

  const files = await o.github.changedFiles(o.registry, o.pullRequest);
  if (files.length !== 1) {
    return s.fail(`A publish pull request adds exactly one file, registry/<your GitHub login>/<mod id>.json. This one changes ${files.length} files.`);
  }
  const [file] = files;
  if (file.status === 'removed') return s.fail('Removing a mod from the registry is done by EDGEmods admins, not by a publish pull request.');
  if (file.status !== 'added') {
    return s.fail('Registry files are not edited after publishing. New versions are picked up from the mod\'s releases by themselves.');
  }
  const where = parseEntryPath(file.path);
  if (!where) {
    return s.fail(`"${file.path}" is not a registry file. It must be ${REGISTRY_DIR}/<your GitHub login>/<mod id>.json, with the mod id in lowercase words joined by dashes.`);
  }
  state.where = where;
  if (where.owner.toLowerCase() !== pr.author.login.toLowerCase()) {
    return s.fail(`The registry file is in the folder "${where.owner}", but the pull request was opened by ${pr.author.login}. Modders publish only into their own folder.`);
  }
  if (pr.author.type !== 'User') return s.fail('Publish pull requests come from a person\'s GitHub account.');

  const bytes = await o.github.file(pr.headRepo, pr.headSha, file.path);
  if (!bytes) return s.fail('The registry file could not be read from the pull request.');
  const { entry, issues } = parseEntry(new TextDecoder().decode(bytes));
  for (const i of issues) s.fail(i.message, i.path);
  if (!entry) return;
  state.entry = entry;
  if (entry.ownerId !== pr.author.id) {
    s.fail(`The registry file's ownerId (${entry.ownerId}) is not ${pr.author.login}'s GitHub id (${pr.author.id}).`, 'ownerId');
  }
}

async function checkRepository(s: Step, state: State, o: CheckOptions): Promise<void> {
  const { entry, where, pr } = state as Required<Pick<State, 'entry' | 'where' | 'pr'>>;
  const fullName = repoFromUrl(entry.repo)!;
  const repo = await o.github.repo(fullName);
  if (!repo) return s.fail(`The repository ${entry.repo} was not found. It must exist and be public.`);
  state.repo = repo;
  s.notes.push(`Repository: ${repo.htmlUrl} (id ${repo.id}).`);

  if (repo.id !== entry.repoId) s.fail(`The registry file's repoId (${entry.repoId}) is not ${repo.fullName}'s id (${repo.id}).`, 'repoId');
  if (repo.owner.id !== pr.author.id) {
    s.fail(`${repo.fullName} belongs to ${repo.owner.login}, not to ${pr.author.login}, who opened the pull request. Modders publish their own repositories.`);
  }
  if (repo.owner.type !== 'User') s.fail('For now, mods are published from a person\'s own GitHub account, not an organization.');
  if (repo.private) s.fail(`${repo.fullName} is private. Mods on EDGEmods are public repositories.`);
  if (repo.archived) s.fail(`${repo.fullName} is archived, so it cannot get updates. Unarchive it first.`);
  if (repo.disabled) s.fail(`GitHub has disabled ${repo.fullName}.`);
  if (repo.fork) s.warn(`${repo.fullName} is a fork of another repository. That is fine if the mod is your own work or you have permission.`);

  if (o.blocklist) {
    const { blocked } = await o.blocklist.check({ ownerId: repo.owner.id, login: repo.owner.login, repoId: repo.id });
    if (blocked) s.fail('This account or repository cannot publish on EDGEmods. Contact the EDGEmods admins if you think this is a mistake.');
  } else {
    s.notes.push('Blocklist: not connected yet.');
  }

  // Ids are unique across EDGEmods: requirements point at them.
  const { files } = await o.github.tree(o.registry, o.baseRef);
  const existing = files.map((f) => parseEntryPath(f.path)).filter((e): e is EntryPath => Boolean(e));
  const taken = existing.find((e) => e.id === where.id);
  if (taken) {
    s.fail(taken.owner.toLowerCase() === where.owner.toLowerCase()
      ? `You already have a mod with the id "${where.id}" on EDGEmods. Publish new versions as releases of its repository.`
      : `The mod id "${where.id}" is already used on EDGEmods. Choose another id.`);
  }
  const similar = existing.filter((e) => e.id !== where.id && distance(e.id, where.id) <= 1).map((e) => e.id);
  if (similar.length) s.warn(`The id "${where.id}" is very close to ${similar.map((x) => `"${x}"`).join(', ')}. EDGEmods admins may ask about it.`);

  // The same repository must not be registered twice under different ids.
  for (const e of existing.filter((x) => x.owner.toLowerCase() === where.owner.toLowerCase())) {
    const bytes = await o.github.file(o.registry, o.baseRef, `${REGISTRY_DIR}/${e.owner}/${e.id}.json`);
    const other = bytes ? parseEntry(new TextDecoder().decode(bytes)).entry : undefined;
    if (other?.repoId === repo.id) s.fail(`${repo.fullName} is already on EDGEmods as "${e.id}". One repository is one mod.`);
  }
}

async function checkMetadata(s: Step, state: State, o: CheckOptions): Promise<void> {
  const { repo, where } = state as Required<Pick<State, 'repo' | 'where'>>;
  const bytes = await o.github.file(repo.fullName, repo.defaultBranch, MANIFEST_FILE);
  if (!bytes) return s.fail(`There is no ${MANIFEST_FILE} at the top of ${repo.fullName} on its ${repo.defaultBranch} branch. The EDGEmods publishing form writes it.`);
  const parsed = parseManifest(new TextDecoder().decode(bytes));
  for (const i of parsed.issues) {
    (i.level === 'error' ? s.fail : s.warn).call(s, i.message, i.path);
    state.reported.add(issueKey(i));
  }
  const m = parsed.manifest;
  if (!m) return;
  state.manifest = m;
  s.notes.push(`${m.name} ${m.version}, ${m.type}.`);
  if (m.id !== where.id) s.fail(`edgemods.json says the mod id is "${m.id}", but the registry file is named "${where.id}.json". They must match.`, 'id');
  if (m.author.github.toLowerCase() !== repo.owner.login.toLowerCase()) {
    s.fail(`edgemods.json names "${m.author.github}" as the author's GitHub login, but the repository belongs to ${repo.owner.login}.`, 'author.github');
  }
}

async function checkReleaseStep(s: Step, state: State, o: CheckOptions): Promise<void> {
  const { repo, manifest } = state as Required<Pick<State, 'repo' | 'manifest'>>;
  const tag = releaseTag(manifest.version);
  const release = await o.github.releaseByTag(repo.fullName, tag);
  if (!release || release.draft) return s.fail(`There is no published release tagged "${tag}" on ${repo.fullName}. Publish one with the mod's files attached.`);
  state.release = release;
  s.notes.push(`Release ${release.tag}${release.prerelease ? ' (pre-release)' : ''}, ${release.assets.length} file(s).`);
  for (const i of checkRelease(manifest, { tag: release.tag, assets: release.assets })) (i.level === 'error' ? s.fail : s.warn).call(s, i.message, i.path);

  // The release's own edgemods.json is what gets published; it must describe this version.
  const atTag = await o.github.file(repo.fullName, tag, MANIFEST_FILE);
  if (!atTag) return s.fail(`The commit tagged ${tag} has no ${MANIFEST_FILE}.`);
  const parsed = parseManifest(new TextDecoder().decode(atTag));
  const tagged = parsed.manifest;
  if (!tagged) {
    for (const i of parsed.issues.filter((x) => x.level === 'error')) s.fail(`In the commit tagged ${tag}: ${i.message}`, i.path);
  } else if (tagged.version !== manifest.version || tagged.id !== manifest.id) {
    s.fail(`The commit tagged ${tag} has edgemods.json for ${tagged.id} ${tagged.version}, not ${manifest.id} ${manifest.version}. Tag the commit that has the new version.`);
  }
}

async function checkFiles(s: Step, state: State, o: CheckOptions): Promise<void> {
  const { repo, release } = state as Required<Pick<State, 'repo' | 'release'>>;
  const result = await checkModFiles(githubFiles(o.github, repo.fullName, release.tag));
  for (const i of result.issues) {
    // edgemods.json was checked already; repeat only what is about the files themselves.
    if (state.reported.has(issueKey(i))) continue;
    if (i.path.startsWith('images') || i.path === 'page' || i.path === 'changelog' || i.path === '') (i.level === 'error' ? s.fail : s.warn).call(s, i.message, i.path);
  }
}

async function checkDownloads(s: Step, state: State, o: CheckOptions): Promise<void> {
  const { repo, release, manifest } = state as Required<Pick<State, 'repo' | 'release' | 'manifest'>>;
  if (!o.scanner) return s.fail('The malware scanner is not available, so the downloads cannot be checked. An EDGEmods admin will look.');
  const max = o.maxDownloadBytes ?? 8 * 1024 ** 3;
  const assets = manifest.files.map((f) => release.assets.find((a) => a.name === f.name)!);
  const total = assets.reduce((n, a) => n + a.size, 0);
  if (total > max) return s.fail(`The downloads add up to ${formatBytes(total)}; EDGEmods checks up to ${formatBytes(max)} per mod.`);

  const work = o.workDir ?? (await mkdtemp(join(tmpdir(), 'edgemods-check-')));
  try {
    for (const asset of assets) {
      const file = join(work, `${asset.id}-${asset.name}`);
      await o.github.downloadAsset(repo.fullName, asset.id, file);
      try {
        const { size } = await stat(file);
        if (size !== asset.size) {
          s.fail(`"${asset.name}" downloaded as ${formatBytes(size)}, but GitHub lists it as ${formatBytes(asset.size)}.`);
          continue;
        }
        const hash = await sha256(file);
        let entries;
        try {
          entries = await listArchive(file, asset.name);
        } catch (err) {
          s.fail(err instanceof ArchiveError ? `"${asset.name}": ${err.message}` : `"${asset.name}" could not be read.`);
          continue;
        }
        if (entries.length === 0) s.fail(`"${asset.name}" is empty.`);
        for (const problem of unsafePaths(entries)) s.fail(`"${asset.name}": ${problem}`);
        const locked = entries.filter((e) => e.encrypted);
        if (locked.length) s.fail(`"${asset.name}" has ${locked.length} file(s) protected with a password, so EDGEmods cannot check them. Upload it without a password.`);

        const contents = summarize(entries);
        const report: DownloadReport = { name: asset.name, size: asset.size, sha256: hash, contents };
        try {
          const scan = await o.scanner.scan(file);
          report.scan = { scanner: o.scanner.name, ...scan };
          if (!scan.clean) s.fail(`${o.scanner.name} found ${scan.findings.join(', ')} in "${asset.name}". The mod cannot be published with it.`);
        } catch (err) {
          s.fail(err instanceof ScannerUnavailable ? `${err.message} "${asset.name}" was not scanned.` : `"${asset.name}" could not be scanned.`);
        }
        state.downloads.push(report);
        s.notes.push(`${asset.name}: ${contents.files} file(s), ${formatBytes(contents.size)} unpacked, sha256 ${hash.slice(0, 12)}…`);
        if (contents.runsCode.length) {
          s.notes.push(`${asset.name} contains files that run code (${contents.runsCode.length}): the mod page will say so.`);
        }
      } finally {
        await rm(file, { force: true });
      }
    }
  } finally {
    if (!o.workDir) await rm(work, { recursive: true, force: true });
  }
}

/** A repository at a ref, as a source for checkModFiles. */
export function githubFiles(github: GitHub, fullName: string, ref: string): ModFiles {
  return {
    list: () => github.tree(fullName, ref),
    async read(path) {
      const bytes = await github.file(fullName, ref, path);
      if (!bytes) throw new Error(`${path} could not be read from ${fullName}`);
      return bytes;
    },
  };
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}
