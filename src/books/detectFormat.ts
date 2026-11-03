// Works out whether a picked file is a .txt, an .epub, a comic, a song or a video. The name alone isn't
// enough: on Android, files picked from Downloads or Recent often come back as
// a content link like "msf:1000033298", with no extension at all.

import { isZip } from './comic/zip';
import { AUDIO_EXTENSIONS, sniffAudio } from './music/readAudio';
import { isMp4Family, sniffVideo, VIDEO_EXTENSIONS } from './video/readVideo';

/**
 * 'zip' means a ZIP that could be an EPUB or a comic, and 'mp4' an MP4 that
 * could be a song or a video: look inside to tell. 'audio' is any song and
 * 'video' any other video.
 */
export type BookFormat = 'txt' | 'epub' | 'comic' | 'zip' | 'audio' | 'mp4' | 'video';

/** True if `name` ends in something that looks like a file extension, e.g. ".txt". */
export function hasExtension(name: string): boolean {
  return /\.[a-z0-9]{1,5}$/i.test(name);
}

const EXTENSIONS: Record<string, BookFormat> = {
  txt: 'txt',
  epub: 'epub',
  cbz: 'comic',
  zip: 'zip',
  ...Object.fromEntries(Object.keys(AUDIO_EXTENSIONS).map((extension) => [extension, 'audio' as const])),
  ...Object.fromEntries(Object.keys(VIDEO_EXTENSIONS).map((extension) => [extension, 'video' as const])),
  mp4: 'mp4',
};

/**
 * The extension decides when there is one; otherwise the MIME type and the
 * first bytes do. Returns null for anything that isn't a TXT, EPUB, ZIP, song or video.
 * A song's or video's real format (and whether it is one at all) is checked when it's read.
 */
export function detectFormat(bytes: Uint8Array, name: string, mimeType: string): BookFormat | null {
  if (hasExtension(name)) return EXTENSIONS[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? null;
  if (mimeType === 'application/epub+zip') return 'epub';
  if (mimeType === 'application/vnd.comicbook+zip' || mimeType === 'application/x-cbz') return 'comic';
  // EPUBs and comics are both ZIP files, and every ZIP starts with "PK\3\4".
  if (isZip(bytes)) return 'zip';
  if (isMp4Family(bytes)) return mimeType.startsWith('audio/') ? 'audio' : 'mp4';
  if (mimeType.startsWith('video/') || sniffVideo(bytes)) return 'video';
  if (mimeType.startsWith('audio/') || sniffAudio(bytes)) return 'audio';
  if (mimeType.startsWith('text/') || looksLikeText(bytes)) return 'txt';
  return null;
}

/**
 * Text files have no zero bytes (except UTF-16, which starts with a byte-order
 * mark) and almost no control characters; images, PDFs and the like do.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return false;
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    // Tab, line feed, form feed and carriage return are normal in text.
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) control++;
  }
  return control / sample.length < 0.01;
}
