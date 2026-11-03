// Works out what a picked video file is and reads its length, picture size
// and tags, reading only the boxes or header that hold them (videos are
// often several GB).

import type { VideoFormat } from '../../models/types';
import type { ByteSource } from '../comic/zip';
import { ascii, type CoverImage } from '../music/audioTags';
import { readMp4 } from '../music/mp4';
import { isMatroska, parseMatroska } from './matroska';

/** How much of a Matroska file to read for its Info and Tracks. */
const MATROSKA_HEAD = 256 * 1024;

export type VideoErrorCode = 'notVideo';

export class VideoError extends Error {
  constructor(readonly code: VideoErrorCode) {
    super(`Video error: ${code}`);
  }
}

export interface VideoInfo {
  format: VideoFormat;
  /** The extension to store the file with. */
  extension: string;
  /** Null when the file doesn't say; the player finds it out. */
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** From the file's own tags; '' when it has none. */
  title: string;
  year: string;
  description: string;
  cover: CoverImage | null;
}

/** File extensions of videos, and the container each one means. (.mp4 can also be a song: see detectFormat.) */
export const VIDEO_EXTENSIONS: Record<string, VideoFormat> = {
  mp4: 'mp4',
  m4v: 'mp4',
  mov: 'mov',
  qt: 'mov',
  '3gp': '3gp',
  mkv: 'mkv',
  webm: 'webm',
};

/** Containers iPhones and iPads can't play, so they're refused there at import. */
export const ANDROID_ONLY_FORMATS: VideoFormat[] = ['mkv', 'webm'];

/** Top-level boxes an MP4 or QuickTime file can start with. Old .mov files have no ftyp. */
const MP4_FIRST_BOXES = ['ftyp', 'moov', 'mdat', 'wide'];

/** True if the bytes look like the start of an MP4, M4A or QuickTime file: a song or a video. */
export function isMp4Family(head: Uint8Array): boolean {
  return head.length >= 8 && MP4_FIRST_BOXES.includes(ascii(head, 4, 4));
}

/** The container family from a file's first bytes, or null if it isn't a video container this app knows. */
export function sniffVideo(head: Uint8Array): 'mp4' | 'matroska' | null {
  if (isMp4Family(head)) return 'mp4';
  if (isMatroska(head)) return 'matroska';
  return null;
}

/** MP4 brands say which kind of MP4 it is: QuickTime, 3GPP or plain MP4. */
function mp4Format(head: Uint8Array): VideoFormat {
  if (ascii(head, 4, 4) !== 'ftyp') return 'mov';
  const brand = ascii(head, 8, 4);
  if (brand === 'qt  ') return 'mov';
  if (brand.startsWith('3g')) return '3gp';
  return 'mp4';
}

/** Reads a video's container, length, size and tags. Throws VideoError if it isn't a video. */
export async function readVideo(source: ByteSource): Promise<VideoInfo> {
  const head = await source.read(0, MATROSKA_HEAD);
  const family = sniffVideo(head);

  if (family === 'matroska') {
    const info = parseMatroska(head);
    // A file with Tracks but no video track is sound only (.mka, or a renamed one).
    if (!info || (info.sawTracks && !info.hasVideo)) throw new VideoError('notVideo');
    const format: VideoFormat = info.docType === 'webm' ? 'webm' : 'mkv';
    return {
      format,
      extension: format,
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
      title: info.title,
      year: '',
      description: '',
      cover: null,
    };
  }

  if (family === 'mp4') {
    const info = await readMp4(source);
    if (!info.hasVideo) throw new VideoError('notVideo');
    const format = mp4Format(head);
    return {
      format,
      extension: format,
      durationMs: info.durationMs,
      width: info.videoSize?.width ?? null,
      height: info.videoSize?.height ?? null,
      title: info.tags.title,
      year: info.tags.year,
      description: info.description,
      cover: info.tags.cover,
    };
  }

  throw new VideoError('notVideo');
}

/**
 * A title from a file name, for videos without a title tag:
 * "The.Long.Walk.2019.mp4" → "The Long Walk 2019", "S01E03 - Pilot.mkv" stays as it is.
 */
export function videoTitleFromFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{1,5}$/i, '');
  // Dots and underscores stand for spaces only in names that have no spaces.
  return (base.includes(' ') ? base : base.replace(/[._]+/g, ' ')).trim();
}

/** "1080p", "4K", or "1000×600" for an unusual size; "" when the size isn't known. */
export function resolutionLabel(width: number | null, height: number | null): string {
  if (!width || !height) return '';
  // Common sizes are named by their short side, whichever way the video is turned.
  const short = Math.min(width, height);
  const named = [2160, 1440, 1080, 720, 480, 360].find((h) => Math.abs(short - h) <= h * 0.05);
  if (named === 2160) return '4K';
  return named ? `${named}p` : `${width}×${height}`;
}
