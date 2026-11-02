// PNG drawing shared by the test-file generators (make-test-comics.mjs, make-test-songs.mjs).

import { deflateSync } from 'node:zlib';

// ---- PNG encoding (RGB, 8 bits per channel) ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** `pixels` is width * height * 3 bytes of RGB. */
export function encodePng(width, height, pixels, level = 6) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    // Each row starts with filter type 0 (none).
    pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Drawing ----

// 3x5 bitmap digits.
const DIGITS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

export class Canvas {
  constructor(width, height, [r, g, b]) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) this.pixels.set([r, g, b], i * 3);
  }

  rect(x0, y0, w, h, [r, g, b]) {
    for (let y = Math.max(0, y0); y < Math.min(this.height, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x0 + w); x++) this.pixels.set([r, g, b], (y * this.width + x) * 3);
    }
  }

  /** Draws `text` (digits only) centred on (cx, cy), each font pixel `scale` px wide. */
  number(text, cx, cy, scale, colour) {
    const width = text.length * 4 * scale - scale;
    let x = Math.round(cx - width / 2);
    const y = Math.round(cy - (5 * scale) / 2);
    for (const char of text) {
      DIGITS[char].forEach((row, dy) =>
        [...row].forEach((bit, dx) => bit === '1' && this.rect(x + dx * scale, y + dy * scale, scale, scale, colour)),
      );
      x += 4 * scale;
    }
  }

  png(level) {
    return encodePng(this.width, this.height, this.pixels, level);
  }
}

export const WHITE = [255, 255, 255];
export const BLACK = [20, 20, 20];

/** A soft colour that changes from page to page. */
export function pageColour(n) {
  const hue = (n * 47) % 360;
  const f = (k) => {
    const a = (k + hue / 30) % 12;
    return Math.round(255 * (0.75 - 0.25 * Math.max(-1, Math.min(a - 3, 9 - a, 1))));
  };
  return [f(0), f(8), f(4)];
}

