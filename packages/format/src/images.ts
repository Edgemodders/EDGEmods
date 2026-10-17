// Reads an image's format and size from its first bytes, without decoding it. PNG, JPEG and WebP only.

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
}

export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (isPng(bytes)) {
    if (bytes.length < 24) return undefined;
    return { format: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return readJpeg(bytes, view);
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return readWebp(bytes, view);
  return undefined;
}

/** The format a file name's extension promises. */
export function formatFromName(name: string): ImageFormat | undefined {
  const ext = /\.([a-z]+)$/i.exec(name)?.[1].toLowerCase();
  if (ext === 'png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'webp') return 'webp';
  return undefined;
}

function isPng(b: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return b.length >= 8 && sig.every((v, i) => b[i] === v);
}

function readJpeg(b: Uint8Array, view: DataView): ImageInfo | undefined {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = view.getUint16(i + 2);
    // Start-of-frame markers carry the size; C4 (DHT), C8 (JPG) and CC (DAC) do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { format: 'jpeg', height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    i += 2 + length;
  }
  return undefined;
}

function readWebp(b: Uint8Array, view: DataView): ImageInfo | undefined {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { format: 'webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = view.getUint32(21, true);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    const w = b[24] | (b[25] << 8) | (b[26] << 16);
    const h = b[27] | (b[28] << 8) | (b[29] << 16);
    return { format: 'webp', width: w + 1, height: h + 1 };
  }
  return undefined;
}

function ascii(b: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...b.subarray(start, start + length));
}
