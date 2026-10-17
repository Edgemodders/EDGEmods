// Checks a release against the manifest: the tag, and that every listed file is attached. Pure, like validate.ts:
// the merge checks pass in what GitHub's API returned, the extension what it is about to upload.

import { LIMITS } from './limits.js';
import type { Manifest } from './manifest.js';
import type { Issue } from './validate.js';

export interface ReleaseAsset {
  name: string;
  /** Bytes. */
  size: number;
}

export interface ReleaseInfo {
  tag: string;
  assets: ReleaseAsset[];
}

export function releaseTag(version: string): string {
  return `v${version}`;
}

export function checkRelease(manifest: Manifest, release: ReleaseInfo): Issue[] {
  const issues: Issue[] = [];
  const expected = releaseTag(manifest.version);
  if (release.tag !== expected) {
    issues.push({
      level: 'error',
      path: 'version',
      message: `The release is tagged "${release.tag}", but edgemods.json says version ${manifest.version}, so the tag must be "${expected}".`,
    });
  }

  const byName = new Map(release.assets.map((a) => [a.name, a]));
  const byLowerName = new Map(release.assets.map((a) => [a.name.toLowerCase(), a]));
  manifest.files.forEach((file, i) => {
    const path = `files[${i}].name`;
    const asset = byName.get(file.name);
    if (!asset) {
      const near = byLowerName.get(file.name.toLowerCase());
      issues.push({
        level: 'error',
        path,
        message: near
          ? `The release has "${near.name}", but edgemods.json lists "${file.name}". The names must match exactly, including capitals.`
          : `The file "${file.name}" is listed in edgemods.json but is not attached to the release ${release.tag}.`,
      });
      return;
    }
    if (asset.size <= 0) {
      issues.push({ level: 'error', path, message: `The file "${file.name}" on the release is empty.` });
    } else if (asset.size > LIMITS.releaseAssetBytes) {
      issues.push({ level: 'error', path, message: `The file "${file.name}" is ${formatBytes(asset.size)}; GitHub allows release files under 2 GiB.` });
    }
  });

  const listed = new Set(manifest.files.map((f) => f.name));
  for (const asset of release.assets) {
    if (!listed.has(asset.name)) {
      issues.push({
        level: 'warning',
        path: 'files',
        message: `The release has "${asset.name}", which edgemods.json does not list, so EDGEmods will not show it.`,
      });
    }
  }
  return issues;
}

export function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${bytes} bytes` : `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
