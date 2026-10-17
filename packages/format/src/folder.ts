// A mod's folder on disk as a source for checkModFiles. Used by the extension before publishing and by
// `npm run check:example`. Reads the disk, so it is not exported from the package's main entry.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { checkModFiles, type FileEntry, type FilesResult, type ModFiles } from './files.js';

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const MAX_FILES = 20000;

/** Lists the folder as git would see it, roughly: everything but .git and node_modules. */
export function diskFiles(dir: string): ModFiles {
  return {
    async list() {
      const files: FileEntry[] = [];
      let truncated = false;
      const walk = async (rel: string): Promise<void> => {
        for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
          if (files.length >= MAX_FILES) {
            truncated = true;
            return;
          }
          const path = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) await walk(path);
          } else if (entry.isFile()) {
            files.push({ path, size: (await stat(join(dir, path))).size });
          }
        }
      };
      await walk('');
      return { files, truncated };
    },
    read: (path) => readFile(join(dir, path)),
  };
}

export type FolderResult = FilesResult;

export function checkModFolder(dir: string): Promise<FolderResult> {
  return checkModFiles(diskFiles(dir));
}
