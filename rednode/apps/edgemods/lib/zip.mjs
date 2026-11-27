// Unpacks a mod's .zip into a folder, with the same path rules as EDGEmods' merge checks (packages/checks,
// unsafePaths): nothing absolute, nothing that climbs out with "..", no control or text-reversing characters, no
// password-protected entries. Stored and deflated entries only, which is what zip tools write. No dependencies.

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { Transform } from 'node:stream';

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 20000;
const MAX_TOTAL = 2 * 1024 ** 3;

/** The problem with a path inside the zip, in words, or undefined when it is fine. */
export function unsafePath(p) {
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return `"${p}" is an absolute path.`;
  if (p.split('/').some((s) => s === '..')) return `"${p}" climbs out of its folder.`;
  if (/[\u0000-\u001f]/.test(p)) return 'A file name has invisible control characters.';
  if (/[‪-‮⁦-⁩]/.test(p)) return `"${p}" has characters that reverse text.`;
  return undefined;
}

/** Every file in the zip: its path (forward slashes), sizes, method and where its data starts. */
export async function zipEntries(file) {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const read = async (position, length) => {
      if (position < 0 || position + length > size) throw new ZipError('The zip file is damaged: it points outside itself.');
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, position);
      return buf;
    };
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = await read(size - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { eocd = i; break; }
    if (eocd < 0) throw new ZipError('This is not a zip file, or it is damaged.');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locator = await read(size - tailLength + eocd - 20, 20);
      if (locator.readUInt32LE(0) !== ZIP64_LOCATOR) throw new ZipError('The zip file is damaged: its large-file record is missing.');
      const z = await read(Number(locator.readBigUInt64LE(8)), 56);
      if (z.readUInt32LE(0) !== ZIP64_EOCD) throw new ZipError('The zip file is damaged: its large-file record is wrong.');
      count = Number(z.readBigUInt64LE(32));
      cdSize = Number(z.readBigUInt64LE(40));
      cdOffset = Number(z.readBigUInt64LE(48));
    }
    if (count > MAX_ENTRIES) throw new ZipError(`The zip lists ${count} files; EDGEmods unpacks up to ${MAX_ENTRIES}.`);
    const cd = await read(cdOffset, cdSize);
    const entries = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CENTRAL) throw new ZipError('The zip file is damaged: its index is cut short.');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nameLength = cd.readUInt16LE(p + 28);
      const extraLength = cd.readUInt16LE(p + 30);
      const commentLength = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const nameBytes = cd.subarray(p + 46, p + 46 + nameLength);
      const path = (flags & 0x800 ? nameBytes.toString('utf8') : nameBytes.toString('latin1')).replace(/\\/g, '/');
      if (usize === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) {
        const extra = cd.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
        for (let e = 0; e + 4 <= extra.length;) {
          const id = extra.readUInt16LE(e);
          const len = extra.readUInt16LE(e + 2);
          if (id === 0x0001) {
            let at = e + 4;
            const next = () => { const v = at + 8 <= e + 4 + len ? Number(extra.readBigUInt64LE(at)) : -1; at += 8; return v; };
            if (usize === 0xffffffff) usize = next();
            if (csize === 0xffffffff) csize = next();
            if (offset === 0xffffffff) offset = next();
            break;
          }
          e += 4 + len;
        }
      }
      if (!path.endsWith('/')) entries.push({ path, size: usize, compressedSize: csize, method, offset, encrypted: (flags & 1) === 1 });
      p += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** Stops a stream that gives more bytes than the zip said, so a lying entry cannot fill the disk. */
function limit(max) {
  let n = 0;
  return new Transform({
    transform(chunk, _enc, done) {
      n += chunk.length;
      done(n > max ? new ZipError('A file in the zip is larger than it says.') : null, chunk);
    },
  });
}

/**
 * Unpacks `file` into `dir`, which should be new and empty. Every entry is checked first; one bad path or a
 * password stops it before anything is written.
 */
export async function unzip(file, dir) {
  const entries = await zipEntries(file);
  const root = resolve(dir);
  let total = 0;
  for (const e of entries) {
    const bad = unsafePath(e.path);
    if (bad) throw new ZipError(bad);
    if (e.encrypted) throw new ZipError(`"${e.path}" is protected with a password.`);
    if (e.method !== 0 && e.method !== 8) throw new ZipError(`"${e.path}" is packed in a way EDGEmods cannot unpack in the game (method ${e.method}).`);
    const target = resolve(root, e.path);
    if (!target.startsWith(root + sep)) throw new ZipError(`"${e.path}" would land outside its folder.`);
    total += e.size;
  }
  if (total > MAX_TOTAL) throw new ZipError('The zip unpacks to more than 2 GB.');
  const fh = await open(file, 'r');
  try {
    for (const e of entries) {
      const head = Buffer.alloc(30);
      await fh.read(head, 0, 30, e.offset);
      if (head.readUInt32LE(0) !== LOCAL) throw new ZipError(`The zip file is damaged at "${e.path}".`);
      const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const target = join(root, ...e.path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      const source = e.compressedSize > 0 ? createReadStream(file, { start, end: start + e.compressedSize - 1 }) : null;
      const out = createWriteStream(target);
      if (!source) {
        out.end();
        await new Promise((ok, fail) => { out.once('finish', ok); out.once('error', fail); });
      } else if (e.method === 8) {
        await pipeline(source, createInflateRaw(), limit(e.size), out);
      } else {
        await pipeline(source, limit(e.size), out);
      }
    }
  } finally {
    await fh.close();
  }
  return entries.map((e) => e.path);
}
