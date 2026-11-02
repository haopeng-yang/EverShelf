// Works out what a picked song file is and reads its tags and length, reading
// only the parts of the file that hold them (songs can be large FLACs).

import type { ByteSource } from '../comic/zip';
import { ascii, AudioError, EMPTY_TAGS, mergeTags, type AudioFormat, type AudioTags } from './audioTags';
import { readFlac } from './flac';
import { id3v2Length, parseId3v1, parseId3v2 } from './id3';
import { findFirstFrame, mp3DurationMs } from './mp3';
import { readMp4 } from './mp4';
import { readWav } from './wav';

/** ID3 tags bigger than this (huge cover art) are only read this far. */
const MAX_ID3 = 16 * 1024 * 1024;
/** How far past the tags to look for the first MP3 frame. */
const FRAME_SEARCH = 64 * 1024;

export interface AudioInfo extends AudioTags {
  format: AudioFormat;
  /** The extension to store the file with. */
  extension: string;
  /** Null when the file doesn't say; the player finds it out on first play. */
  durationMs: number | null;
}

/** File extensions of songs, and the format each one means. */
export const AUDIO_EXTENSIONS: Record<string, AudioFormat> = {
  mp3: 'mp3',
  m4a: 'm4a',
  mp4: 'm4a',
  aac: 'aac',
  flac: 'flac',
  wav: 'wav',
};

/**
 * The format from a file's first bytes, or null if it isn't a song this app
 * plays. Used when there's no extension, and to catch files whose extension lies.
 */
export function sniffAudio(head: Uint8Array): AudioFormat | null {
  if (head.length < 12) return null;
  if (ascii(head, 0, 4) === 'fLaC') return 'flac';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return 'wav';
  if (ascii(head, 4, 4) === 'ftyp') return 'm4a';
  // ADTS AAC: twelve one bits, layer 00.
  if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return 'aac';
  const tagLength = id3v2Length(head);
  if (tagLength > 0) {
    // Some taggers put an ID3 tag in front of FLAC too; that needs the bytes after the tag, so call it MP3 for now.
    return 'mp3';
  }
  // No tag: MP3 frames, perhaps after a little junk.
  if (findFirstFrame(head)) return 'mp3';
  return null;
}

/** Reads a song's format, tags and length. Throws AudioError if it isn't a playable song. */
export async function readAudio(source: ByteSource): Promise<AudioInfo> {
  const head = await source.read(0, 4096);
  const format = sniffAudio(head);
  if (!format) throw new AudioError('notAudio');

  if (format === 'flac') {
    const { tags, durationMs } = await readFlac(source, 0);
    return { ...tags, format, extension: 'flac', durationMs };
  }
  if (format === 'wav') {
    const { tags, durationMs } = await readWav(source);
    return { ...tags, format, extension: 'wav', durationMs };
  }
  if (format === 'm4a') {
    const info = await readMp4(source);
    if (info.hasVideo) throw new AudioError('video');
    if (!info.hasAudio) throw new AudioError('notAudio');
    return { ...info.tags, format, extension: 'm4a', durationMs: info.durationMs };
  }
  if (format === 'aac') return { ...EMPTY_TAGS, format, extension: 'aac', durationMs: null };
  return readMp3(source, head);
}

async function readMp3(source: ByteSource, head: Uint8Array): Promise<AudioInfo> {
  const claimed = id3v2Length(head);
  // A tag claiming to be longer than the file is damaged: read what's there.
  const tagLength = Math.min(claimed, source.size);
  const id3 = tagLength > 0 ? parseId3v2(await source.read(0, Math.min(tagLength, MAX_ID3))) : EMPTY_TAGS;

  // An ID3 tag in front of a FLAC file.
  if (tagLength > 0 && claimed <= source.size && ascii(await source.read(tagLength, 4), 0, 4) === 'fLaC') {
    const flac = await readFlac(source, tagLength);
    return { ...mergeTags(flac.tags, id3), format: 'flac', extension: 'flac', durationMs: flac.durationMs };
  }

  const id3v1 = source.size >= 128 ? parseId3v1(await source.read(source.size - 128, 128)) : EMPTY_TAGS;
  // Audio starts right after the tag; with a damaged tag size, look from just after the header.
  const searchFrom = claimed <= source.size ? tagLength : 10;
  const window = await source.read(searchFrom, FRAME_SEARCH);
  const frame = findFirstFrame(window);
  if (!frame) throw new AudioError('notAudio');

  const audioStart = searchFrom + frame.offset;
  const audioBytes = source.size - audioStart - (id3v1 === EMPTY_TAGS ? 0 : 128);
  return {
    ...mergeTags(id3, id3v1),
    format: 'mp3',
    extension: 'mp3',
    durationMs: mp3DurationMs(window, frame, audioBytes),
  };
}

/**
 * A title and track number from a file name, for songs without tags:
 * "05 - Song Name.mp3" → { title: "Song Name", trackNumber: 5 }.
 */
export function titleFromFileName(name: string): { title: string; trackNumber: number | null } {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{1,5}$/i, '');
  const match = /^(\d{1,3})\s*(?:[-._)]\s*|\s+)(.+)$/.exec(base);
  if (match) return { title: match[2].replace(/_/g, ' ').trim(), trackNumber: Number(match[1]) || null };
  return { title: base.replace(/_/g, ' ').trim(), trackNumber: null };
}
