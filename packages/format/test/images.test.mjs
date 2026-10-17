import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { formatFromName, readImageInfo } from '../dist/index.js';
import { exampleDir } from './helpers.mjs';

test('reads a PNG', () => {
  assert.deepEqual(readImageInfo(readFileSync(join(exampleDir, 'images/card.png'))), { format: 'png', width: 1280, height: 640 });
});

test('reads a JPEG start-of-frame after other segments', () => {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x80, 0x05, 0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const bytes = new Uint8Array([0xff, 0xd8, ...app0, ...sof0]);
  assert.deepEqual(readImageInfo(bytes), { format: 'jpeg', width: 1280, height: 640 });
});

test('reads the three WebP kinds', () => {
  const riff = (chunk, body) => new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), ...Buffer.from(chunk), ...body]);
  const vp8 = riff('VP8 ', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x05, 0x80, 0x02]);
  assert.deepEqual(readImageInfo(vp8), { format: 'webp', width: 1280, height: 640 });
  const bits = (1280 - 1) | ((640 - 1) << 14);
  const vp8l = riff('VP8L', [0, 0, 0, 0, 0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]);
  assert.deepEqual(readImageInfo(vp8l), { format: 'webp', width: 1280, height: 640 });
  const vp8x = riff('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0x04, 0x00, 0x7f, 0x02, 0x00]);
  assert.deepEqual(readImageInfo(vp8x), { format: 'webp', width: 1280, height: 640 });
});

test('anything else is not an image', () => {
  assert.equal(readImageInfo(new TextEncoder().encode('GIF89a......')), undefined);
  assert.equal(readImageInfo(new Uint8Array()), undefined);
});

test('formats from file names', () => {
  assert.equal(formatFromName('a.PNG'), 'png');
  assert.equal(formatFromName('a.jpeg'), 'jpeg');
  assert.equal(formatFromName('a.jpg'), 'jpeg');
  assert.equal(formatFromName('a.webp'), 'webp');
  assert.equal(formatFromName('a.gif'), undefined);
});
