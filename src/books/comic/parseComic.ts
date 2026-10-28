import type { ReadingMode } from '../../models/types';
import { decodeEntities } from '../parseEpub';

// Pure functions that turn the file names and first bytes inside comic files
// into an ordered list of chapters and pages. No file access, so they can be
// tested without a phone.

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp']);

/** The image extension of a file name, lower case, with "jpeg" as "jpg". Null if it isn't an image. */
export function imageExtension(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) return null;
  return extension === 'jpeg' ? 'jpg' : extension;
}

/** True for a picture that's part of the comic, not junk left by macOS or Windows. */
export function isPageName(name: string): boolean {
  const segments = name.split('/');
  if (segments.some((s) => s.startsWith('.') || s === '__MACOSX')) return false;
  if (segments.at(-1)?.toLowerCase() === 'thumbs.db') return false;
  return imageExtension(name) !== null;
}

/**
 * Compares names the way people number pages: "page2" before "page10".
 * Runs of digits compare as numbers; everything else ignores case.
 */
export function naturalCompare(a: string, b: string): number {
  const partsA = a.toLowerCase().match(/\d+|\D+/g) ?? [];
  const partsB = b.toLowerCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
    const x = partsA[i];
    const y = partsB[i];
    if (x === y) continue;
    const bothNumbers = /^\d/.test(x) && /^\d/.test(y);
    if (bothNumbers && Number(x) !== Number(y)) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return partsA.length - partsB.length;
}

/** One file the user picked, with the names of everything inside it. */
export interface ComicSource {
  /** Title to use if the whole file is one chapter. '' if unknown. */
  title: string;
  names: string[];
}

export interface PlannedPage {
  /** Index into the sources list. */
  source: number;
  /** The entry's name inside that source. */
  name: string;
}

export interface PlannedChapter {
  /** '' when there's nothing better than "Chapter N"; the import screen fills that in. */
  title: string;
  pages: PlannedPage[];
}

/**
 * Splits the pictures in the picked files into chapters, in reading order.
 * Sources are taken in the order given. Inside a source, pictures in different
 * folders become separate chapters named after the folder; a source whose
 * pictures are all in one folder is one chapter named after the source.
 */
export function planChapters(sources: ComicSource[]): PlannedChapter[] {
  return sources.flatMap((source, index) => {
    const folders = new Map<string, string[]>();
    for (const name of source.names.filter(isPageName)) {
      const folder = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
      folders.set(folder, [...(folders.get(folder) ?? []), name]);
    }
    const ordered = [...folders.keys()].sort(naturalCompare);
    return ordered.map((folder) => ({
      title: ordered.length === 1 ? source.title : (folder.split('/').at(-1) ?? '') || source.title,
      pages: (folders.get(folder) ?? []).sort(naturalCompare).map((name) => ({ source: index, name })),
    }));
  });
}

/** A file name without its folder or extension: "Comics/Akira v01.cbz" → "Akira v01". */
export function baseName(name: string): string {
  return (name.split('/').at(-1) ?? name).replace(/\.[a-z0-9]{1,5}$/i, '').trim();
}

/**
 * A title for a comic picked as several files, from what their names share:
 * "Akira - Ch 1", "Akira - Ch 2" → "Akira". '' if they share nothing useful.
 */
export function seriesTitle(names: string[]): string {
  const bases = names.map(baseName).filter(Boolean);
  if (bases.length === 0) return '';
  if (bases.length === 1) return bases[0];
  let prefix = bases[0];
  for (const base of bases.slice(1)) {
    while (!base.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  }
  // Drop the chapter or volume label the names were counting with.
  return prefix
    .replace(/\d+$/, '')
    // The label must follow a separator, so "Dev 1", "Dev 2" stays "Dev".
    .replace(/(?:^|[\s\-_.#:([]+)(?:ch|chap|chapter|ep|episode|vol|volume|v|第)?[\s\-_.#:([]*$/i, '')
    .trim();
}

/** A chapter's title from its file name, without the series title: "Akira - Ch 2" → "Ch 2". */
export function chapterTitle(fileName: string, series: string): string {
  const base = baseName(fileName);
  if (!series || !base.toLowerCase().startsWith(series.toLowerCase())) return base;
  return base.slice(series.length).replace(/^[\s\-_.:]+/, '') || base;
}

/** Width and height in pixels, read from the start of an image file. Null if unknown. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  const size = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  try {
    if (bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return size(view.getUint32(16), view.getUint32(20));
    if (ascii(0, 4) === 'GIF8') return size(view.getUint16(6, true), view.getUint16(8, true));
    if (ascii(0, 2) === 'BM') return size(view.getInt32(18, true), Math.abs(view.getInt32(22, true)));
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes, view);
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return webpSize(bytes, view, ascii);
    if (ascii(4, 4) === 'ftyp') return isoImageSize(bytes, view);
  } catch {
    // Too few bytes to read the header: fall through.
  }
  return null;
}

function jpegSize(bytes: Uint8Array, view: DataView) {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at++; // Padding before a marker.
      continue;
    }
    // Start-of-frame markers hold the size; C4, C8 and CC are other tables.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = view.getUint16(at + 5);
      const width = view.getUint16(at + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    // Markers without a length: restart markers, start of image, and TEM.
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) at += 2;
    else at += 2 + view.getUint16(at + 2);
  }
  return null;
}

function webpSize(bytes: Uint8Array, view: DataView, ascii: (at: number, length: number) => string) {
  const chunk = ascii(12, 4);
  if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  if (chunk === 'VP8L') {
    const [b0, b1, b2, b3] = bytes.subarray(21, 25);
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') {
    const u24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    return { width: 1 + u24(24), height: 1 + u24(27) };
  }
  return null;
}

/** AVIF and HEIC keep the size in "ispe" boxes; take the largest (the others are thumbnails). */
function isoImageSize(bytes: Uint8Array, view: DataView) {
  let best: { width: number; height: number } | null = null;
  for (let at = 0; at + 16 <= bytes.length; at++) {
    if (bytes[at] !== 0x69 || bytes[at + 1] !== 0x73 || bytes[at + 2] !== 0x70 || bytes[at + 3] !== 0x65) continue; // "ispe"
    const width = view.getUint32(at + 8);
    const height = view.getUint32(at + 12);
    if (!best || width * height > best.width * best.height) best = { width, height };
  }
  return best && best.width > 0 && best.height > 0 ? best : null;
}

/** What a ComicInfo.xml file says. Empty strings for missing fields. */
export interface ComicInfo {
  title: string;
  series: string;
  number: string;
  writer: string;
  summary: string;
  /** True only for <Manga>YesAndRightToLeft</Manga>. */
  rightToLeft: boolean;
}

/** Reads the ComicRack metadata file found in many CBZs. */
export function parseComicInfo(xml: string): ComicInfo {
  const field = (tag: string) => {
    const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
    if (!match) return '';
    const cdata = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(match[1]);
    return (cdata ? cdata[1] : decodeEntities(match[1])).trim();
  };
  return {
    title: field('Title'),
    series: field('Series'),
    number: field('Number'),
    writer: field('Writer'),
    summary: field('Summary'),
    rightToLeft: field('Manga').toLowerCase() === 'yesandrighttoleft',
  };
}

/** Pages this much taller than wide are webtoon strips, read by scrolling down. */
const STRIP_RATIO = 2.2;

/**
 * Picks how the comic is probably read. ComicInfo saying right to left wins;
 * then tall strips mean vertical (even on the Manga shelf, since webtoons are
 * strips); then the built-in Manga shelf means right to left.
 */
export function guessReadingMode(options: {
  rightToLeft: boolean;
  shelfId: string;
  sizes: ({ width: number; height: number } | null)[];
}): ReadingMode {
  if (options.rightToLeft) return 'rtl';
  const ratios = options.sizes.flatMap((s) => (s ? [s.height / s.width] : [])).sort((a, b) => a - b);
  if (ratios.length > 0 && ratios[Math.floor(ratios.length / 2)] >= STRIP_RATIO) return 'vertical';
  return options.shelfId === 'manga' ? 'rtl' : 'ltr';
}
