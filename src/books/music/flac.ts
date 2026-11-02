// Reads a FLAC file's metadata blocks: STREAMINFO for the length, Vorbis
// comments for the tags and PICTURE for the cover. The blocks come first in
// the file, so the audio itself is never read.

import type { ByteSource } from '../comic/zip';
import {
  ascii,
  clean,
  coverOf,
  decodeUtf8,
  EMPTY_TAGS,
  leadingNumber,
  u32,
  u32le,
  yearOf,
  type AudioTags,
  type CoverImage,
} from './audioTags';

/** Pictures bigger than this are skipped rather than read into memory. */
const MAX_PICTURE = 16 * 1024 * 1024;

export interface FlacInfo {
  tags: AudioTags;
  durationMs: number | null;
}

/** `start` is where "fLaC" is (after an ID3 tag some taggers put in front). */
export async function readFlac(source: ByteSource, start: number): Promise<FlacInfo> {
  let at = start + 4;
  let durationMs: number | null = null;
  let comments = new Map<string, string>();
  let cover: CoverImage | null = null;
  let firstPicture: CoverImage | null = null;

  for (;;) {
    const header = await source.read(at, 4);
    if (header.length < 4) break;
    const last = (header[0] & 0x80) !== 0;
    const type = header[0] & 0x7f;
    const length = (header[1] << 16) | (header[2] << 8) | header[3];
    const dataAt = at + 4;
    if (type === 0 && length >= 18) {
      const info = await source.read(dataAt, 18);
      // 20 bits of sample rate, then 3 + 5 bits of channels and depth, then 36 bits of sample count.
      const rate = (info[10] << 12) | (info[11] << 4) | (info[12] >> 4);
      const samples = (info[13] & 0x0f) * 2 ** 32 + u32(info, 14);
      if (rate > 0 && samples > 0) durationMs = Math.round((samples * 1000) / rate);
    } else if (type === 4) {
      comments = vorbisComments(await source.read(dataAt, length));
    } else if (type === 6 && length <= MAX_PICTURE) {
      const picture = parsePicture(await source.read(dataAt, length));
      if (picture?.front) cover ??= picture.cover;
      else if (picture) firstPicture ??= picture.cover;
    }
    at = dataAt + length;
    if (last || type === 127 || at >= source.size) break;
  }

  return { tags: tagsFromComments(comments, cover ?? firstPicture), durationMs };
}

/** Vorbis comments: little-endian lengths, then "KEY=value" entries. Keys are case-insensitive. */
export function vorbisComments(data: Uint8Array): Map<string, string> {
  const comments = new Map<string, string>();
  let at = 4 + u32le(data, 0); // skip the vendor string
  const count = u32le(data, at);
  at += 4;
  for (let i = 0; i < count && at + 4 <= data.length; i++) {
    const length = u32le(data, at);
    const entry = decodeUtf8(data.subarray(at + 4, at + 4 + length));
    at += 4 + length;
    const equals = entry.indexOf('=');
    if (equals <= 0) continue;
    const key = entry.slice(0, equals).toUpperCase();
    // Keep the first value when a key repeats (e.g. several ARTIST entries).
    if (!comments.has(key)) comments.set(key, entry.slice(equals + 1));
  }
  return comments;
}

/** Tags from Vorbis comments, which Ogg files use too. */
export function tagsFromComments(comments: Map<string, string>, cover: CoverImage | null): AudioTags {
  const get = (...keys: string[]) => clean(keys.map((k) => comments.get(k) ?? '').find(Boolean) ?? '');
  return {
    ...EMPTY_TAGS,
    title: get('TITLE'),
    artist: get('ARTIST'),
    album: get('ALBUM'),
    albumArtist: get('ALBUMARTIST', 'ALBUM ARTIST'),
    year: yearOf(get('DATE', 'YEAR', 'ORIGINALDATE')),
    trackNumber: leadingNumber(get('TRACKNUMBER')),
    discNumber: leadingNumber(get('DISCNUMBER')),
    lyrics: get('LYRICS', 'UNSYNCEDLYRICS'),
    cover,
  };
}

/** A PICTURE block: big-endian picture type, MIME type, description, size fields, then the image. */
function parsePicture(data: Uint8Array): { cover: CoverImage; front: boolean } | null {
  if (data.length < 32) return null;
  const pictureType = u32(data, 0);
  const mimeLength = u32(data, 4);
  const mime = ascii(data, 8, mimeLength);
  let at = 8 + mimeLength;
  at += 4 + u32(data, at); // description
  at += 16; // width, height, depth, colours
  const length = u32(data, at);
  const cover = coverOf(data.subarray(at + 4, at + 4 + length), mime);
  return cover ? { cover, front: pictureType === 3 } : null;
}
