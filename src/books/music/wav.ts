// Reads a WAV file's chunks: "fmt " and "data" for the length, and the
// optional LIST/INFO or "id3 " chunks for tags. Most WAVs have no tags.

import type { ByteSource } from '../comic/zip';
import { ascii, clean, decodeLatin1OrGbk, EMPTY_TAGS, leadingNumber, mergeTags, u32le, yearOf, type AudioTags } from './audioTags';
import { parseId3v2 } from './id3';

/** Tag chunks bigger than this are skipped (they'd be pictures, not text). */
const MAX_TAG_CHUNK = 16 * 1024 * 1024;

export interface WavInfo {
  tags: AudioTags;
  durationMs: number | null;
}

export async function readWav(source: ByteSource): Promise<WavInfo> {
  let at = 12; // after "RIFF", the size and "WAVE"
  let byteRate = 0;
  let dataBytes = 0;
  let info = EMPTY_TAGS;
  let id3 = EMPTY_TAGS;
  while (at + 8 <= source.size) {
    const header = await source.read(at, 8);
    if (header.length < 8) break;
    const id = ascii(header, 0, 4);
    const length = u32le(header, 4);
    const dataAt = at + 8;
    if (id === 'fmt ') byteRate = u32le(await source.read(dataAt, 16), 8);
    else if (id === 'data') dataBytes = Math.min(length, source.size - dataAt);
    else if (id === 'LIST' && length <= MAX_TAG_CHUNK) info = listInfo(await source.read(dataAt, length));
    else if ((id === 'id3 ' || id === 'ID3 ') && length <= MAX_TAG_CHUNK) id3 = parseId3v2(await source.read(dataAt, length));
    // Chunks are padded to an even length.
    at = dataAt + length + (length & 1);
  }
  return {
    tags: mergeTags(id3, info),
    durationMs: byteRate > 0 && dataBytes > 0 ? Math.round((dataBytes * 1000) / byteRate) : null,
  };
}

/** A LIST chunk of type INFO: INAM (title), IART (artist), IPRD (album), ICRD (date), ITRK (track). */
function listInfo(data: Uint8Array): AudioTags {
  if (ascii(data, 0, 4) !== 'INFO') return EMPTY_TAGS;
  const fields = new Map<string, string>();
  let at = 4;
  while (at + 8 <= data.length) {
    const id = ascii(data, at, 4);
    const length = u32le(data, at + 4);
    fields.set(id, clean(decodeLatin1OrGbk(data.subarray(at + 8, at + 8 + length))));
    at += 8 + length + (length & 1);
  }
  return {
    ...EMPTY_TAGS,
    title: fields.get('INAM') ?? '',
    artist: fields.get('IART') ?? '',
    album: fields.get('IPRD') ?? '',
    year: yearOf(fields.get('ICRD') ?? ''),
    trackNumber: leadingNumber(fields.get('ITRK') ?? fields.get('IPRT') ?? ''),
  };
}
