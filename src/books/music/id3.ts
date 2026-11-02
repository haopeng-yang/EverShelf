// Reads ID3 tags: ID3v2 (versions 2.2, 2.3 and 2.4) at the start of an MP3,
// and the old 128-byte ID3v1 at the end. Damaged tags give what could be read
// rather than an error: a song without a title still plays.

import { decodeAs } from '../decodeText';
import {
  ascii,
  clean,
  coverOf,
  decodeLatin1OrGbk,
  decodeUtf8,
  EMPTY_TAGS,
  leadingNumber,
  u32,
  yearOf,
  type AudioTags,
  type CoverImage,
} from './audioTags';

/** The 10-byte ID3v2 header: whether there's a tag, and how many bytes it takes up in total. */
export function id3v2Length(head: Uint8Array): number {
  if (head.length < 10 || ascii(head, 0, 3) !== 'ID3' || head[3] < 2 || head[3] > 4) return 0;
  const footer = head[3] === 4 && head[5] & 0x10 ? 10 : 0;
  return 10 + syncsafe(head, 6) + footer;
}

function syncsafe(bytes: Uint8Array, at: number): number {
  return ((bytes[at] & 0x7f) << 21) | ((bytes[at + 1] & 0x7f) << 14) | ((bytes[at + 2] & 0x7f) << 7) | (bytes[at + 3] & 0x7f);
}

/** Undoes "unsynchronisation": every FF 00 was written to stand for FF. */
function resync(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[length++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return out.subarray(0, length);
}

/** Frame ids in version 2.2 (three letters) and their 2.3/2.4 names. */
const V22_IDS: Record<string, string> = {
  TT2: 'TIT2',
  TP1: 'TPE1',
  TP2: 'TPE2',
  TAL: 'TALB',
  TRK: 'TRCK',
  TPA: 'TPOS',
  TYE: 'TYER',
  ULT: 'USLT',
  PIC: 'APIC',
};

/** Reads an ID3v2 tag. `tag` is the whole tag, header included; it may be cut short. */
export function parseId3v2(tag: Uint8Array): AudioTags {
  if (id3v2Length(tag) === 0) return EMPTY_TAGS;
  const version = tag[3];
  const flags = tag[5];
  let body = tag.subarray(10);
  // In 2.2 and 2.3 unsynchronisation covers the whole tag; 2.4 marks it per frame.
  if (version < 4 && flags & 0x80) body = resync(body);
  let at = 0;
  if (flags & 0x40 && version >= 3) {
    // Skip the extended header. Its size counts itself in 2.4 but not in 2.3.
    at = version === 4 ? syncsafe(body, 0) : u32(body, 0) + 4;
  }

  const frames = new Map<string, Uint8Array[]>();
  const headerLength = version === 2 ? 6 : 10;
  while (at + headerLength <= body.length) {
    const rawId = ascii(body, at, version === 2 ? 3 : 4);
    if (!/^[A-Z0-9]{3,4}$/.test(rawId)) break; // padding, or the end of what was readable
    let size: number;
    let frameFlags = 0;
    if (version === 2) size = (body[at + 3] << 16) | (body[at + 4] << 8) | body[at + 5];
    else {
      size = version === 4 ? syncsafe(body, at + 4) : u32(body, at + 4);
      // Some 2.4 writers used plain sizes. If the syncsafe one doesn't land on another frame, use plain.
      if (version === 4 && !looksLikeFrame(body, at + 10 + size) && looksLikeFrame(body, at + 10 + u32(body, at + 4))) {
        size = u32(body, at + 4);
      }
      frameFlags = (body[at + 8] << 8) | body[at + 9];
    }
    const start = at + headerLength;
    let data = body.subarray(start, Math.min(start + size, body.length));
    at = start + size;

    const id = version === 2 ? (V22_IDS[rawId] ?? rawId) : rawId;
    if (version === 3 && frameFlags & 0x00c0) continue; // compressed or encrypted
    if (version === 4) {
      if (frameFlags & 0x000c) continue; // compressed or encrypted
      if (frameFlags & 0x0001) data = data.subarray(4); // data length indicator
      if (frameFlags & 0x0002) data = resync(data);
    }
    const list = frames.get(id) ?? [];
    list.push(data);
    frames.set(id, list);
  }

  const text = (id: string) => {
    const data = frames.get(id)?.[0];
    // Version 2.4 can hold several values separated by zero bytes; the first is enough.
    return data && data.length > 1 ? clean(decodeId3Text(data.subarray(1), data[0]).split('\0')[0]) : '';
  };
  return {
    title: text('TIT2'),
    artist: text('TPE1'),
    album: text('TALB'),
    albumArtist: text('TPE2'),
    year: yearOf(text('TDRC') || text('TYER') || text('TORY')),
    trackNumber: leadingNumber(text('TRCK')),
    discNumber: leadingNumber(text('TPOS')),
    lyrics: lyricsOf(frames.get('USLT')?.[0]),
    cover: pictureOf(frames.get('APIC') ?? [], version),
  };
}

function looksLikeFrame(body: Uint8Array, at: number): boolean {
  return at === body.length || (at + 4 <= body.length && (body[at] === 0 || /^[A-Z0-9]{4}$/.test(ascii(body, at, 4))));
}

function decodeId3Text(bytes: Uint8Array, encoding: number): string {
  if (encoding === 1) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeAs(bytes.subarray(2), 'utf-16be');
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeAs(bytes.subarray(2), 'utf-16le');
    return decodeAs(bytes, 'utf-16le');
  }
  if (encoding === 2) return decodeAs(bytes, 'utf-16be');
  if (encoding === 3) return decodeUtf8(bytes);
  return decodeLatin1OrGbk(bytes);
}

/** Where the zero terminator of a string starting at `from` ends: one zero byte, or two (aligned) for UTF-16. */
function afterTerminator(bytes: Uint8Array, from: number, encoding: number): number {
  const wide = encoding === 1 || encoding === 2;
  for (let i = from; i < bytes.length; i += wide ? 2 : 1) {
    if (bytes[i] === 0 && (!wide || bytes[i + 1] === 0)) return i + (wide ? 2 : 1);
  }
  return bytes.length;
}

/** USLT: encoding, three-letter language, a description, then the lyrics. */
function lyricsOf(data: Uint8Array | undefined): string {
  if (!data || data.length < 5) return '';
  const encoding = data[0];
  const textStart = afterTerminator(data, 4, encoding);
  return clean(decodeId3Text(data.subarray(textStart), encoding));
}

/** APIC (or PIC in 2.2): the front cover if there is one, otherwise the first picture. */
function pictureOf(frames: Uint8Array[], version: number): CoverImage | null {
  let first: CoverImage | null = null;
  for (const data of frames) {
    const encoding = data[0];
    let mime: string;
    let at: number;
    if (version === 2) {
      mime = ascii(data, 1, 3); // "JPG" or "PNG"
      at = 4;
    } else {
      at = afterTerminator(data, 1, 0);
      mime = ascii(data, 1, at - 2);
    }
    const pictureType = data[at];
    const imageStart = afterTerminator(data, at + 1, encoding);
    const cover = coverOf(data.subarray(imageStart), mime);
    if (!cover) continue;
    if (pictureType === 3) return cover;
    first ??= cover;
  }
  return first;
}

/** The 128-byte ID3v1 tag at the very end of a file ("TAG" + fixed-size fields). */
export function parseId3v1(last128: Uint8Array): AudioTags {
  if (last128.length !== 128 || ascii(last128, 0, 3) !== 'TAG') return EMPTY_TAGS;
  const field = (at: number, length: number) => clean(decodeLatin1OrGbk(trimZeros(last128.subarray(at, at + length))));
  // ID3v1.1 puts the track number in the last byte of the comment, after a zero.
  const track = last128[125] === 0 && last128[126] > 0 ? last128[126] : null;
  return {
    ...EMPTY_TAGS,
    title: field(3, 30),
    artist: field(33, 30),
    album: field(63, 30),
    year: yearOf(field(93, 4)),
    trackNumber: track,
  };
}

function trimZeros(bytes: Uint8Array): Uint8Array {
  const end = bytes.indexOf(0);
  return end === -1 ? bytes : bytes.subarray(0, end);
}
