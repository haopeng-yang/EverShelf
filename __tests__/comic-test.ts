import { strToU8, zipSync, type Zippable } from 'fflate';

import {
  chapterTitle,
  guessReadingMode,
  imageSize,
  isPageName,
  naturalCompare,
  parseComicInfo,
  planChapters,
  seriesTitle,
} from '../src/books/comic/parseComic';
import { isZip, memorySource, readZipEntries, readZipEntry, ZipError } from '../src/books/comic/zip';

const bytes = (...values: number[]) => new Uint8Array(values);
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

describe('ZIP reader', () => {
  const files: Zippable = {
    'Chapter 1/001.png': new Uint8Array(5000).fill(7),
    'Chapter 1/002.png': [strToU8('stored page'), { level: 0 }],
    'ComicInfo.xml': strToU8('<ComicInfo><Title>Hi</Title></ComicInfo>'),
  };
  const zip = zipSync(files, { level: 6 });

  it('lists files (not folders) and reads each one, compressed or stored', async () => {
    const source = memorySource(zip);
    const entries = await readZipEntries(source);
    expect(entries.map((e) => e.name)).toEqual(['Chapter 1/001.png', 'Chapter 1/002.png', 'ComicInfo.xml']);
    expect(entries.map((e) => e.method)).toEqual([8, 0, 8]);
    expect(await readZipEntry(source, entries[0])).toEqual(new Uint8Array(5000).fill(7));
    expect(new TextDecoder().decode(await readZipEntry(source, entries[1]))).toBe('stored page');
  });

  it('finds the directory after a ZIP comment, and reads only what it needs', async () => {
    const withComment = new Uint8Array([...zip.subarray(0, -2), 5, 0, ...ascii('hello')]);
    const reads: number[] = [];
    const source = memorySource(withComment);
    const counting = { size: source.size, read: (offset: number, length: number) => (reads.push(length), source.read(offset, length)) };
    const entries = await readZipEntries(counting);
    expect(entries).toHaveLength(3);
    await readZipEntry(counting, entries[1]);
    // The tail, the directory, then one page's header and data: never the whole file at once.
    expect(Math.max(...reads.slice(1))).toBeLessThan(withComment.length);
  });

  it('decodes GBK file names from Chinese ZIP tools', async () => {
    // "第1话.jpg" in GBK, without the UTF-8 flag. fflate sets the flag only for non-ASCII
    // strings, so build the entry by hand from a stored ASCII one and swap the name bytes.
    const gbkName = bytes(0xb5, 0xda, 0x31, 0xbb, 0xb0, 0x2e, 0x6a, 0x70, 0x67);
    const plain = zipSync({ 'abcdefghi': [strToU8('x'), { level: 0 }] });
    const swapped = plain.slice();
    for (let i = 0; i + 9 <= swapped.length; i++) {
      if (String.fromCharCode(...swapped.subarray(i, i + 9)) === 'abcdefghi') swapped.set(gbkName, i);
    }
    const entries = await readZipEntries(memorySource(swapped));
    expect(entries[0].name).toBe('第1话.jpg');
  });

  it('rejects files that are not ZIPs, and recognises ZIP bytes', async () => {
    await expect(readZipEntries(memorySource(strToU8('just some text, no zip here')))).rejects.toEqual(new ZipError('notZip'));
    expect(isZip(zip)).toBe(true);
    expect(isZip(strToU8('PK no'))).toBe(false);
  });

  it('refuses encrypted entries', async () => {
    const source = memorySource(zip);
    const [entry] = await readZipEntries(source);
    await expect(readZipEntry(source, { ...entry, encrypted: true })).rejects.toEqual(new ZipError('encrypted'));
  });
});

describe('pages and chapters', () => {
  it('sorts numbers by value', () => {
    expect(['10.png', '2.png', '1.png', 'page10', 'page9', 'Page1'].sort(naturalCompare)).toEqual([
      '1.png',
      '2.png',
      '10.png',
      'Page1',
      'page9',
      'page10',
    ]);
  });

  it('skips junk and anything that is not a picture', () => {
    expect(isPageName('Chapter 1/001.JPEG')).toBe(true);
    expect(isPageName('__MACOSX/Chapter 1/._001.png')).toBe(false);
    expect(isPageName('Chapter 1/.DS_Store')).toBe(false);
    expect(isPageName('.hidden/001.png')).toBe(false);
    expect(isPageName('Thumbs.db')).toBe(false);
    expect(isPageName('notes.txt')).toBe(false);
    expect(isPageName('ComicInfo.xml')).toBe(false);
  });

  it('makes one chapter of a file with all its pages in one folder', () => {
    const chapters = planChapters([{ title: 'Akira', names: ['images/10.png', 'images/2.png', 'ComicInfo.xml', 'images/1.png'] }]);
    expect(chapters).toEqual([
      { title: 'Akira', pages: ['images/1.png', 'images/2.png', 'images/10.png'].map((name) => ({ source: 0, name })) },
    ]);
  });

  it('makes a chapter per folder, ordered naturally, named after the folder', () => {
    const chapters = planChapters([
      { title: 'Big', names: ['Vol 1/Chapter 10/1.png', 'Vol 1/Chapter 2/1.png', 'Vol 1/Chapter 2/2.png', '__MACOSX/x/1.png'] },
    ]);
    expect(chapters.map((c) => [c.title, c.pages.length])).toEqual([
      ['Chapter 2', 2],
      ['Chapter 10', 1],
    ]);
  });

  it('keeps several picked files in the order given', () => {
    const chapters = planChapters([
      { title: 'Ch 1', names: ['1.png'] },
      { title: 'Ch 2', names: ['1.png', '2.png'] },
    ]);
    expect(chapters.map((c) => [c.title, c.pages.map((p) => p.source)])).toEqual([
      ['Ch 1', [0]],
      ['Ch 2', [1, 1]],
    ]);
  });

  it('finds a series title shared by several files', () => {
    expect(seriesTitle(['Test Series - Ch 1.cbz', 'Test Series - Ch 2.cbz', 'Test Series - Ch 10.cbz'])).toBe('Test Series');
    expect(seriesTitle(['Naruto v01.cbz', 'Naruto v02.cbz'])).toBe('Naruto');
    expect(seriesTitle(['Dev 1.cbz', 'Dev 2.cbz'])).toBe('Dev');
    expect(seriesTitle(['某漫画 第1话.zip', '某漫画 第2话.zip'])).toBe('某漫画');
    expect(seriesTitle(['Alpha.cbz', 'Beta.cbz'])).toBe('');
    expect(seriesTitle(['Only One.cbz'])).toBe('Only One');
    expect(chapterTitle('Test Series - Ch 2.cbz', 'Test Series')).toBe('Ch 2');
    expect(chapterTitle('Other.cbz', 'Test Series')).toBe('Other');
  });
});

describe('image sizes', () => {
  it('reads PNG, GIF, BMP and JPEG headers', () => {
    const png = bytes(0x89, ...ascii('PNG\r\n\x1a\n'), 0, 0, 0, 13, ...ascii('IHDR'), ...be32(800), ...be32(1200));
    expect(imageSize(png)).toEqual({ width: 800, height: 1200 });
    expect(imageSize(bytes(...ascii('GIF89a'), 0x20, 0x03, 0xb0, 0x04))).toEqual({ width: 800, height: 1200 });
    const bmp = new Uint8Array(26);
    bmp.set(ascii('BM'));
    new DataView(bmp.buffer).setInt32(18, 640, true);
    new DataView(bmp.buffer).setInt32(22, -480, true);
    expect(imageSize(bmp)).toEqual({ width: 640, height: 480 });

    // Start of image, an APP0 segment to skip, then a baseline frame header.
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x04, 0xb0, 0x03, 0x20, 3, 0, 0, 0);
    expect(imageSize(jpeg)).toEqual({ width: 800, height: 1200 });
  });

  it('reads WebP (lossy, lossless, extended) and AVIF headers', () => {
    const riff = (chunk: string, body: number[]) => bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), 0, 0, 0, 0, ...body);
    // VP8: frame tag (3) + start code (3) then 14-bit width/height.
    expect(imageSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x20, 0x03, 0xb0, 0x04]))).toEqual({ width: 800, height: 1200 });
    // VP8L: signature byte, then width-1 and height-1 in 14 bits each.
    const w = 799;
    const h = 1199;
    const packed = w | (h << 14);
    expect(imageSize(riff('VP8L', [0x2f, packed & 0xff, (packed >> 8) & 0xff, (packed >> 16) & 0xff, (packed >> 24) & 0xff]))).toEqual({
      width: 800,
      height: 1200,
    });
    // VP8X: flags (4), then 24-bit width-1 and height-1.
    expect(imageSize(riff('VP8X', [0, 0, 0, 0, 0x1f, 0x03, 0, 0xaf, 0x04, 0]))).toEqual({ width: 800, height: 1200 });

    const box = (type: string, body: number[]) => [...be32(8 + body.length), ...ascii(type), ...body];
    const avif = bytes(
      ...box('ftyp', ascii('avif')),
      ...box('ispe', [0, 0, 0, 0, ...be32(160), ...be32(240)]), // thumbnail
      ...box('ispe', [0, 0, 0, 0, ...be32(800), ...be32(1200)]),
    );
    expect(imageSize(avif)).toEqual({ width: 800, height: 1200 });
  });

  it('gives up on unknown or cut-off data', () => {
    expect(imageSize(strToU8('not an image'))).toBeNull();
    expect(imageSize(bytes(0x89, ...ascii('PNG')))).toBeNull();
  });
});

describe('ComicInfo and reading mode', () => {
  it('reads the ComicRack fields', () => {
    const info = parseComicInfo(`<?xml version="1.0"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>The Beginning</Title><Series>Test &amp; Manga</Series><Number>1</Number>
  <Writer>EverShelf Tests</Writer><Summary><![CDATA[Read <b>right</b> to left.]]></Summary>
  <Manga>YesAndRightToLeft</Manga>
</ComicInfo>`);
    expect(info).toEqual({
      title: 'The Beginning',
      series: 'Test & Manga',
      number: '1',
      writer: 'EverShelf Tests',
      summary: 'Read <b>right</b> to left.',
      rightToLeft: true,
    });
    expect(parseComicInfo('<ComicInfo><Manga>Yes</Manga></ComicInfo>').rightToLeft).toBe(false);
  });

  it('guesses right to left, vertical strips, or left to right', () => {
    const page = { width: 800, height: 1200 };
    const strip = { width: 800, height: 12000 };
    expect(guessReadingMode({ rightToLeft: true, shelfId: 'books', sizes: [strip] })).toBe('rtl');
    expect(guessReadingMode({ rightToLeft: false, shelfId: 'manga', sizes: [strip, strip, page] })).toBe('vertical');
    expect(guessReadingMode({ rightToLeft: false, shelfId: 'manga', sizes: [page, null] })).toBe('rtl');
    expect(guessReadingMode({ rightToLeft: false, shelfId: 'books', sizes: [page] })).toBe('ltr');
    expect(guessReadingMode({ rightToLeft: false, shelfId: 'books', sizes: [] })).toBe('ltr');
  });
});
