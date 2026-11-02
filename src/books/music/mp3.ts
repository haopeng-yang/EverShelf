// Finds the first MPEG audio frame of an MP3 and works out the song's length
// from it: exactly from a Xing/Info or VBRI header if the encoder wrote one,
// otherwise from the bitrate and file size (right for constant-bitrate files).

import { ascii, u32 } from './audioTags';

/** kbit/s by bitrate index, for Layer III: MPEG-1, then MPEG-2 and 2.5. */
const BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = { v1: [44100, 48000, 32000], v2: [22050, 24000, 16000], v25: [11025, 12000, 8000] };

export interface Mp3Frame {
  /** Offset of the frame within the bytes it was found in. */
  offset: number;
  length: number;
  sampleRate: number;
  /** kbit/s */
  bitrate: number;
  samplesPerFrame: number;
  mpeg1: boolean;
  mono: boolean;
}

/** Reads a Layer III frame header at `at`, or null if there isn't one. */
export function frameAt(bytes: Uint8Array, at: number): Mp3Frame | null {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (bytes[at + 1] >> 3) & 3; // 0: 2.5, 2: 2, 3: 1
  const layerBits = (bytes[at + 1] >> 1) & 3; // 1: Layer III
  const bitrateIndex = bytes[at + 2] >> 4;
  const rateIndex = (bytes[at + 2] >> 2) & 3;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const mpeg1 = versionBits === 3;
  const bitrate = (mpeg1 ? BITRATES.v1 : BITRATES.v2)[bitrateIndex];
  const sampleRate = (mpeg1 ? SAMPLE_RATES.v1 : versionBits === 2 ? SAMPLE_RATES.v2 : SAMPLE_RATES.v25)[rateIndex];
  const padding = (bytes[at + 2] >> 1) & 1;
  const samplesPerFrame = mpeg1 ? 1152 : 576;
  const length = Math.floor(((samplesPerFrame / 8) * bitrate * 1000) / sampleRate) + padding;
  return { offset: at, length, sampleRate, bitrate, samplesPerFrame, mpeg1, mono: bytes[at + 3] >> 6 === 3 };
}

/**
 * The first real frame in `bytes`: one whose following frame also starts
 * where it should, so stray FF bytes in tag padding aren't mistaken for audio.
 */
export function findFirstFrame(bytes: Uint8Array): Mp3Frame | null {
  for (let at = 0; at + 4 <= bytes.length; at++) {
    if (bytes[at] !== 0xff) continue;
    const frame = frameAt(bytes, at);
    if (!frame) continue;
    const next = at + frame.length;
    // The next frame header may be past what was read; then one good header has to do.
    if (next + 4 > bytes.length || frameAt(bytes, next)) return frame;
  }
  return null;
}

/**
 * The length in milliseconds. `bytes` start at the first frame; `audioBytes`
 * is the size of the audio part of the file (without tags), for the
 * constant-bitrate estimate.
 */
export function mp3DurationMs(bytes: Uint8Array, frame: Mp3Frame, audioBytes: number): number {
  const at = frame.offset;
  // The Xing/Info header sits after the side information, whose size depends on version and channels.
  const sideInfo = frame.mpeg1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
  const xing = at + 4 + sideInfo;
  const tag = ascii(bytes, xing, 4);
  if ((tag === 'Xing' || tag === 'Info') && bytes[xing + 7] & 1) {
    const frames = u32(bytes, xing + 8);
    if (frames > 0) return Math.round((frames * frame.samplesPerFrame * 1000) / frame.sampleRate);
  }
  if (ascii(bytes, at + 36, 4) === 'VBRI') {
    const frames = u32(bytes, at + 36 + 14);
    if (frames > 0) return Math.round((frames * frame.samplesPerFrame * 1000) / frame.sampleRate);
  }
  return Math.round((audioBytes * 8) / frame.bitrate);
}
