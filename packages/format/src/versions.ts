// Version order, by semantic versioning's precedence rules: numbers compare as numbers, a pre-release comes
// before its release (1.0.0-beta.2 < 1.0.0), and pre-release parts compare one by one. Pure, like validate.ts.

import { VERSION_PATTERN } from './limits.js';

/** Below 0 when a is older than b, 0 when equal, above 0 when newer. Both must match VERSION_PATTERN. */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = split(a);
  const [coreB, preB] = split(b);
  for (let i = 0; i < 3; i++) {
    if (coreA[i] !== coreB[i]) return coreA[i] < coreB[i] ? -1 : 1;
  }
  if (!preA.length || !preB.length) return preB.length - preA.length;
  for (let i = 0; i < Math.max(preA.length, preB.length); i++) {
    const x = preA[i];
    const y = preB[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function isVersion(text: string): boolean {
  return VERSION_PATTERN.test(text);
}

export function isPrerelease(version: string): boolean {
  return version.includes('-');
}

/** Whether a version meets a requirement: that version or newer, or exactly it when pinned. */
export function satisfies(version: string, wanted: { version: string; exact?: boolean }): boolean {
  const order = compareVersions(version, wanted.version);
  return wanted.exact ? order === 0 : order >= 0;
}

function split(version: string): [number[], string[]] {
  const dash = version.indexOf('-');
  const core = (dash < 0 ? version : version.slice(0, dash)).split('.').map(Number);
  const pre = dash < 0 ? [] : version.slice(dash + 1).split('.');
  return [core, pre];
}
