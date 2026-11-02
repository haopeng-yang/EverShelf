// Reads an MP4/M4A file's "moov" box: the length (mvhd), what kind of tracks
// it has (trak/mdia/hdlr) and the iTunes-style tags (udta/meta/ilst). moov
// can be at the start or the end of the file, so the top-level boxes are
// walked by their sizes; the audio itself ("mdat") is never read.

import type { ByteSource } from '../comic/zip';
import { ascii, clean, coverOf, decodeUtf8, EMPTY_TAGS, u32, yearOf, type AudioTags, type CoverImage } from './audioTags';

/** A moov bigger than this isn't read (a normal one is well under a few MB, even for long files). */
const MAX_MOOV = 64 * 1024 * 1024;

export interface Mp4Info {
  tags: AudioTags;
  durationMs: number | null;
  hasAudio: boolean;
  /** An enabled video track: this is a film or clip, not a song. */
  hasVideo: boolean;
}

interface Box {
  type: string;
  /** Where the box's contents start, and how long they are. */
  start: number;
  length: number;
}

/** The boxes directly inside bytes[from, to). */
function boxesIn(bytes: Uint8Array, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(bytes, at);
    let headerLength = 8;
    if (size === 1) {
      size = u32(bytes, at + 8) * 2 ** 32 + u32(bytes, at + 12);
      headerLength = 16;
    } else if (size === 0) size = to - at;
    if (size < headerLength || at + size > to) break;
    boxes.push({ type: boxType(bytes, at + 4), start: at + headerLength, length: size - headerLength });
    at += size;
  }
  return boxes;
}

/** Box types are four bytes; iTunes tags start with © (0xA9), which isn't ASCII. */
function boxType(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function child(bytes: Uint8Array, box: Box | undefined, type: string): Box | undefined {
  return box && boxesIn(bytes, box.start, box.start + box.length).find((b) => b.type === type);
}

/** Finds the top-level moov box and reads it. Null if the file has none (not an MP4). */
async function readMoov(source: ByteSource): Promise<Uint8Array | null> {
  let at = 0;
  while (at + 8 <= source.size) {
    const header = await source.read(at, 16);
    if (header.length < 8) return null;
    let size = u32(header, 0);
    let headerLength = 8;
    if (size === 1) {
      size = u32(header, 8) * 2 ** 32 + u32(header, 12);
      headerLength = 16;
    } else if (size === 0) size = source.size - at;
    if (size < headerLength) return null;
    if (ascii(header, 4, 4) === 'moov') {
      if (size > MAX_MOOV) return null;
      // Read it with its header, so boxesIn can treat it like any other box.
      return source.read(at, size);
    }
    at += size;
  }
  return null;
}

export async function readMp4(source: ByteSource): Promise<Mp4Info> {
  const bytes = await readMoov(source);
  if (!bytes) return { tags: EMPTY_TAGS, durationMs: null, hasAudio: false, hasVideo: false };
  const moov = boxesIn(bytes, 0, bytes.length)[0];

  let durationMs: number | null = null;
  const mvhd = child(bytes, moov, 'mvhd');
  if (mvhd) {
    // Version 0 has 32-bit times, version 1 has 64-bit ones.
    const v1 = bytes[mvhd.start] === 1;
    const timescale = u32(bytes, mvhd.start + (v1 ? 20 : 12));
    const duration = v1
      ? u32(bytes, mvhd.start + 24) * 2 ** 32 + u32(bytes, mvhd.start + 28)
      : u32(bytes, mvhd.start + 16);
    if (timescale > 0 && duration > 0) durationMs = Math.round((duration * 1000) / timescale);
  }

  let hasAudio = false;
  let hasVideo = false;
  for (const trak of boxesIn(bytes, moov.start, moov.start + moov.length).filter((b) => b.type === 'trak')) {
    const hdlr = child(bytes, child(bytes, trak, 'mdia'), 'hdlr');
    // hdlr: version and flags, a reserved word, then the handler type.
    const handler = hdlr ? ascii(bytes, hdlr.start + 8, 4) : '';
    if (handler === 'soun') hasAudio = true;
    // Audiobooks and some albums carry chapter pictures as a disabled video track; only an enabled one is video.
    const tkhd = child(bytes, trak, 'tkhd');
    const enabled = tkhd ? (bytes[tkhd.start + 3] & 1) === 1 : true;
    if (handler === 'vide' && enabled) hasVideo = true;
  }

  const meta = child(bytes, child(bytes, moov, 'udta'), 'meta') ?? child(bytes, moov, 'meta');
  return { tags: meta ? ilstTags(bytes, meta) : EMPTY_TAGS, durationMs, hasAudio, hasVideo };
}

function ilstTags(bytes: Uint8Array, meta: Box): AudioTags {
  // meta is usually a "full box" with 4 bytes of version and flags first; QuickTime's isn't.
  const skip = ascii(bytes, meta.start + 4, 4) === 'hdlr' ? 0 : 4;
  const inner: Box = { type: 'meta', start: meta.start + skip, length: meta.length - skip };
  const ilst = child(bytes, inner, 'ilst');
  if (!ilst) return EMPTY_TAGS;

  const values = new Map<string, { type: number; data: Uint8Array }>();
  for (const item of boxesIn(bytes, ilst.start, ilst.start + ilst.length)) {
    const data = child(bytes, item, 'data');
    // data: one byte of version, three of type (1 = UTF-8, 13 = JPEG, 14 = PNG), four of locale, then the value.
    if (data && !values.has(item.type)) {
      values.set(item.type, {
        type: u32(bytes, data.start) & 0xffffff,
        data: bytes.subarray(data.start + 8, data.start + data.length),
      });
    }
  }
  const text = (type: string) => {
    const value = values.get(type);
    return value ? clean(decodeUtf8(value.data)) : '';
  };
  /** trkn and disk: two reserved bytes, then the number, then the total. */
  const pair = (type: string) => {
    const value = values.get(type);
    const n = value && value.data.length >= 4 ? (value.data[2] << 8) | value.data[3] : 0;
    return n > 0 ? n : null;
  };
  const covr = values.get('covr');
  const cover: CoverImage | null = covr
    ? coverOf(covr.data, covr.type === 14 ? 'image/png' : covr.type === 13 ? 'image/jpeg' : '')
    : null;

  return {
    title: text('©nam'),
    artist: text('©ART'),
    album: text('©alb'),
    albumArtist: text('aART'),
    year: yearOf(text('©day')),
    trackNumber: pair('trkn'),
    discNumber: pair('disk'),
    lyrics: text('©lyr'),
    cover,
  };
}
