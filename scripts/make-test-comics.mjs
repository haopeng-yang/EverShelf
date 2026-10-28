// Generates CBZ files for testing the comic reader (ROADMAP-comics.md, Phase 0).
// Every page shows its number in large digits, so page order is easy to check.
//
//   node scripts/make-test-comics.mjs           small test files
//   node scripts/make-test-comics.mjs --large   also a ~300 MB CBZ for the memory test
//
// Output goes to test-comics/ (git-ignored). Copy the files to the phone to import them.

import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';

const OUT = new URL('../test-comics/', import.meta.url);

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
function encodePng(width, height, pixels, level = 6) {
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

class Canvas {
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

const WHITE = [255, 255, 255];
const BLACK = [20, 20, 20];

/** A soft colour that changes from page to page. */
function pageColour(n) {
  const hue = (n * 47) % 360;
  const f = (k) => {
    const a = (k + hue / 30) % 12;
    return Math.round(255 * (0.75 - 0.25 * Math.max(-1, Math.min(a - 3, 9 - a, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** An ordinary comic page: frame, big page number, small chapter number in the corner. */
function page(n, chapter = 1, width = 800, height = 1200) {
  const canvas = new Canvas(width, height, WHITE);
  canvas.rect(30, 30, width - 60, height - 60, pageColour(n));
  canvas.number(String(n), width / 2, height / 2, 40, BLACK);
  canvas.number(String(chapter), 90, 90, 8, BLACK);
  return canvas.png();
}

/** A tall webtoon strip, with its number repeated every 2,000 px. */
function strip(n, width = 800, height = 12000) {
  const canvas = new Canvas(width, height, WHITE);
  for (let y = 0; y < height; y += 400) canvas.rect(0, y, width, 200, pageColour(n * 30 + y / 400));
  for (let y = 1000; y < height; y += 2000) canvas.number(String(n), width / 2, y, 30, BLACK);
  return canvas.png();
}

/** Random pixels: barely compressible, to make a big file quickly. */
function noisePage(n, width = 800, height = 1200) {
  const canvas = new Canvas(width, height, WHITE);
  randomBytes(width * height * 3).copy(canvas.pixels);
  canvas.rect(200, 400, 400, 400, WHITE);
  canvas.number(String(n), width / 2, 600, 20, BLACK);
  return canvas.png(0);
}

// ---- Files ----

const pad = (n, width = 3) => String(n).padStart(width, '0');

function comicInfo({ title, series, number, writer, summary, manga }) {
  return strToU8(`<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>${title}</Title>
  <Series>${series}</Series>
  <Number>${number}</Number>
  <Writer>${writer}</Writer>
  <Summary>${summary}</Summary>
  <Manga>${manga}</Manga>
</ComicInfo>
`);
}

function save(name, files, level = 0) {
  // Images are already compressed, so most CBZs store them as they are (level 0).
  const bytes = zipSync(files, { level });
  writeFileSync(new URL(name, OUT), bytes);
  console.log(`${name.padEnd(28)} ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);
}

const range = (count) => Array.from({ length: count }, (_, i) => i + 1);

mkdirSync(OUT, { recursive: true });

// Left-to-right comic, no metadata: the title should come from the file name.
save('Test Comic LTR.cbz', Object.fromEntries(range(12).map((n) => [`page${pad(n)}.png`, page(n)])));

// Manga with ComicInfo.xml saying right to left.
save('Test Manga RTL.cbz', {
  'ComicInfo.xml': comicInfo({
    title: 'Test Manga',
    series: 'Test Manga',
    number: '1',
    writer: 'EverShelf Tests',
    summary: 'Generated pages. Read right to left: page 2 should be to the left of page 1.',
    manga: 'YesAndRightToLeft',
  }),
  ...Object.fromEntries(range(10).map((n) => [`${pad(n)}.png`, page(n)])),
});

// Webtoon: a few very tall strips, which should be read as a vertical scroll.
save('Test Webtoon.cbz', Object.fromEntries(range(4).map((n) => [`${pad(n, 2)}.png`, strip(n)])));

// Natural sort: 1.png … 10.png must read 1, 2 … 10, not 1, 10, 2.
save('Test Natural Sort.cbz', Object.fromEntries(range(10).map((n) => [`${n}.png`, page(n)])));

// Chapters as folders, plus junk that must be skipped.
save('Test Chapters.cbz', {
  ...Object.fromEntries(
    [1, 2, 3].flatMap((chapter) => range(4).map((n) => [`Chapter ${chapter}/${pad(n)}.png`, page(n, chapter)])),
  ),
  '__MACOSX/Chapter 1/._001.png': strToU8('junk'),
  'Chapter 1/.DS_Store': strToU8('junk'),
  'Thumbs.db': strToU8('junk'),
  'notes.txt': strToU8('Not a page.'),
});

// A series as several files, one per chapter, for the multi-file import.
for (const chapter of [1, 2, 10]) {
  save(`Test Series - Ch ${chapter}.cbz`, Object.fromEntries(range(3).map((n) => [`${pad(n)}.png`, page(n, chapter)])));
}

if (process.argv.includes('--large')) {
  // ~100 pages of ~2.9 MB each.
  save('Test Large.cbz', Object.fromEntries(range(100).map((n) => [`${pad(n)}.png`, noisePage(n)])));
}
