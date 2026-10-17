// Lists what a mod's download contains, without extracting or running anything.
// Zip: read from the central directory at the end of the file. 7z: `7z l`, which only reads the index.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface ArchiveEntry {
  path: string;
  /** Uncompressed bytes. */
  size: number;
  encrypted: boolean;
}

export class ArchiveError extends Error {}

export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function listArchive(file: string, name: string): Promise<ArchiveEntry[]> {
  if (/\.zip$/i.test(name)) return listZip(file);
  if (/\.7z$/i.test(name)) return list7z(file);
  throw new ArchiveError(`"${name}" is not a .zip or .7z file.`);
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const MAX_ENTRIES = 200000;

export async function listZip(file: string): Promise<ArchiveEntry[]> {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const read = async (position: number, length: number): Promise<Buffer> => {
      if (position < 0 || position + length > size) throw new ArchiveError('The zip file is damaged: it points outside itself.');
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, position);
      return buf;
    };

    // The end record is in the last 22 bytes plus up to 64 KB of comment.
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = await read(size - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new ArchiveError('This is not a zip file, or it is damaged: its end record is missing.');

    let count: number = tail.readUInt16LE(eocd + 10);
    let cdSize: number = tail.readUInt32LE(eocd + 12);
    let cdOffset: number = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locatorAt = size - tailLength + eocd - 20;
      const locator = await read(locatorAt, 20);
      if (locator.readUInt32LE(0) !== ZIP64_LOCATOR) throw new ArchiveError('The zip file is damaged: its large-file record is missing.');
      const z = await read(Number(locator.readBigUInt64LE(8)), 56);
      if (z.readUInt32LE(0) !== ZIP64_EOCD) throw new ArchiveError('The zip file is damaged: its large-file record is wrong.');
      count = Number(z.readBigUInt64LE(32));
      cdSize = Number(z.readBigUInt64LE(40));
      cdOffset = Number(z.readBigUInt64LE(48));
    }
    if (count > MAX_ENTRIES) throw new ArchiveError(`The zip file lists ${count} files; EDGEmods checks up to ${MAX_ENTRIES}.`);
    if (cdSize > 256 * 1024 ** 2) throw new ArchiveError('The zip file\'s index is too large to check.');

    const cd = await read(cdOffset, cdSize);
    const entries: ArchiveEntry[] = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CENTRAL) throw new ArchiveError('The zip file is damaged: its index is cut short.');
      const flags = cd.readUInt16LE(p + 8);
      let usize: number = cd.readUInt32LE(p + 24);
      const nameLength = cd.readUInt16LE(p + 28);
      const extraLength = cd.readUInt16LE(p + 30);
      const commentLength = cd.readUInt16LE(p + 32);
      const nameBytes = cd.subarray(p + 46, p + 46 + nameLength);
      // Bit 11: the name is UTF-8. Otherwise it is the old DOS code page; plain ASCII reads the same either way.
      const path = (flags & 0x800 ? nameBytes.toString('utf8') : nameBytes.toString('latin1')).replace(/\\/g, '/');
      if (usize === 0xffffffff) {
        const extra = cd.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
        for (let e = 0; e + 4 <= extra.length;) {
          const id = extra.readUInt16LE(e);
          const len = extra.readUInt16LE(e + 2);
          if (id === 0x0001 && len >= 8) { usize = Number(extra.readBigUInt64LE(e + 4)); break; }
          e += 4 + len;
        }
      }
      if (!path.endsWith('/')) entries.push({ path, size: usize, encrypted: (flags & 1) === 1 });
      p += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** Lists a .7z with the 7z tool (p7zip). Its technical listing is one "Key = value" block per file. */
export async function list7z(file: string, tool = '7z'): Promise<ArchiveEntry[]> {
  let stdout: string;
  try {
    ({ stdout } = await run(tool, ['l', '-slt', '-ba', '-p', '--', file], { maxBuffer: 256 * 1024 ** 2 }));
  } catch (err: any) {
    if (err?.code === 'ENOENT') throw new ArchiveError('The 7z tool is not installed, so the .7z file could not be listed.');
    const text = `${err?.stdout ?? ''}${err?.stderr ?? ''}`;
    if (/Wrong password|encrypted|Can not open encrypted/i.test(text)) {
      throw new ArchiveError('The .7z file is protected with a password, so EDGEmods cannot see inside it.');
    }
    throw new ArchiveError('The .7z file could not be read. It may be damaged.');
  }
  const entries: ArchiveEntry[] = [];
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const fields = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const eq = line.indexOf(' = ');
      if (eq > 0) fields.set(line.slice(0, eq), line.slice(eq + 3));
    }
    const path = fields.get('Path');
    if (!path || fields.get('Folder') === '+') continue;
    entries.push({ path: path.replace(/\\/g, '/'), size: Number(fields.get('Size') ?? 0), encrypted: fields.get('Encrypted') === '+' });
  }
  return entries;
}
