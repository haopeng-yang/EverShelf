// Generates audio files for testing music import and playback
// (ROADMAP-shelf-types-music.md, Phase 0). There's no MP3 or AAC encoder here,
// so MP3s are silent (valid frames of digital silence) and exist to test tags.
// The FLAC and WAV files play real tones, so playback, seeking and the queue
// can be heard.
//
//   node scripts/make-test-songs.mjs           small test files
//   node scripts/make-test-songs.mjs --large   also a 2-hour WAV (~58 MB) for seeking and resume
//   node scripts/make-test-songs.mjs --many    also 200 short MP3s for the big import test
//
// Output goes to test-songs/ (git-ignored). Copy the files to the phone to import them.
// Not generated, so get real ones: an iTunes .m4a with cover art, an audio-only
// .mp4, and a video .mp4 from a phone camera (it must be rejected).

import { mkdirSync, writeFileSync } from 'node:fs';

import { BLACK, Canvas, pageColour } from './test-images.mjs';

const OUT = new URL('../test-songs/', import.meta.url);
const RATE = 44100;

// ---- Tones ----

/** 16-bit mono samples: `notes` is a list of [frequency in Hz, seconds]; 0 Hz is a rest. */
function tones(notes, rate = RATE) {
  const total = notes.reduce((sum, [, seconds]) => sum + Math.round(seconds * rate), 0);
  const samples = new Int16Array(total);
  let at = 0;
  for (const [frequency, seconds] of notes) {
    const length = Math.round(seconds * rate);
    for (let i = 0; i < length; i++) {
      // A short fade in and out on every note, so they don't click.
      const fade = Math.min(1, i / (rate * 0.01), (length - i) / (rate * 0.01));
      samples[at + i] = frequency ? Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 9000 * fade) : 0;
    }
    at += length;
  }
  return samples;
}

/** Equal-tempered pitch, `steps` semitones above A4. */
const pitch = (steps) => 440 * 2 ** (steps / 12);

// ---- WAV ----

function wav(samples, rate = RATE, bits = 16) {
  const bytesPerSample = bits / 8;
  const data = Buffer.alloc(samples.length * bytesPerSample);
  // 8-bit WAV is unsigned, 16-bit is signed little-endian.
  samples.forEach((s, i) => (bits === 8 ? data.writeUInt8((s >> 8) + 128, i) : data.writeInt16LE(s, i * 2)));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * bytesPerSample, 28);
  header.writeUInt16LE(bytesPerSample, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ---- FLAC (uncompressed "verbatim" frames, which every decoder must accept) ----

function crc8(bytes) {
  let c = 0;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

function crc16(bytes) {
  let c = 0;
  for (const byte of bytes) {
    c ^= byte << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

/** FLAC's UTF-8-style frame number. */
function codedNumber(n) {
  if (n < 0x80) return [n];
  if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 0x3f)];
  return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
}

function metadataBlock(type, data, last) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0);
  header[0] = (last ? 0x80 : 0) | type;
  return Buffer.concat([header, data]);
}

/** Little-endian lengths, as in Ogg Vorbis. Keys are upper case: TITLE, ARTIST… */
function vorbisComment(tags) {
  const vendor = Buffer.from('EverShelf test generator');
  const parts = [u32le(vendor.length), vendor, u32le(Object.keys(tags).length)];
  for (const [key, value] of Object.entries(tags)) {
    const entry = Buffer.from(`${key}=${value}`);
    parts.push(u32le(entry.length), entry);
  }
  return Buffer.concat(parts);
}

function flacPicture(png, width, height) {
  const mime = Buffer.from('image/png');
  return Buffer.concat([
    u32be(3), // front cover
    u32be(mime.length),
    mime,
    u32be(0), // no description
    u32be(width),
    u32be(height),
    u32be(24),
    u32be(0),
    u32be(png.length),
    png,
  ]);
}

function flac(samples, tags, cover) {
  const BLOCK = 4096;
  const info = Buffer.alloc(34);
  info.writeUInt16BE(BLOCK, 0);
  info.writeUInt16BE(BLOCK, 2);
  // Bytes 4–9: frame sizes, 0 = unknown. Then 20 bits of sample rate, 3 of
  // channels - 1, 5 of bits per sample - 1 and 36 of total samples.
  const packed = (BigInt(RATE) << 44n) | (0n << 41n) | (15n << 36n) | BigInt(samples.length);
  info.writeBigUInt64BE(packed, 10);
  // Bytes 18–33: the MD5 of the audio. All zeros means "not computed".

  const blocks = [metadataBlock(0, info, false), metadataBlock(4, vorbisComment(tags), !cover)];
  if (cover) blocks.push(metadataBlock(6, flacPicture(cover.png, cover.width, cover.height), true));

  const frames = [];
  for (let start = 0, n = 0; start < samples.length; start += BLOCK, n++) {
    const block = samples.subarray(start, start + BLOCK);
    // Sync + fixed block size; block size from the end of the header (0111),
    // 44.1 kHz (1001); mono (0000), 16 bits (100).
    const header = Buffer.from([0xff, 0xf8, 0x79, 0x08, ...codedNumber(n), (block.length - 1) >> 8, (block.length - 1) & 0xff]);
    const body = Buffer.alloc(1 + block.length * 2);
    body[0] = 0x02; // verbatim subframe
    block.forEach((s, i) => body.writeInt16BE(s, 1 + i * 2));
    const frame = Buffer.concat([header, Buffer.from([crc8(header)]), body]);
    frames.push(frame, u16be(crc16(frame)));
  }
  return Buffer.concat([Buffer.from('fLaC'), ...blocks, ...frames]);
}

// ---- MP3 (silent) and ID3 tags ----

/** MPEG-1 Layer III, 128 kbit/s, 44.1 kHz, mono. All-zero side info decodes as silence. */
function silentMp3(seconds) {
  const FRAME_BYTES = 417; // 144 * 128000 / 44100, no padding
  const count = Math.ceil((seconds * RATE) / 1152);
  const frame = Buffer.alloc(FRAME_BYTES);
  frame.set([0xff, 0xfb, 0x90, 0xc0]);
  return Buffer.concat(Array.from({ length: count }, () => frame));
}

const syncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

/** Text in one of ID3's encodings: 0 Latin-1, 1 UTF-16 with BOM, 3 UTF-8 (v2.4 only), or raw bytes. */
function id3Text(text, encoding) {
  if (Buffer.isBuffer(text)) return Buffer.concat([Buffer.from([encoding]), text]);
  if (encoding === 1) return Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  return Buffer.concat([Buffer.from([encoding]), Buffer.from(text, encoding === 3 ? 'utf8' : 'latin1')]);
}

/**
 * An ID3v2 tag. `frames` is a list of [id, body]; v2.3 frame sizes are plain
 * numbers, v2.4 sizes are "syncsafe" (7 bits per byte).
 */
function id3v2(version, frames) {
  const body = Buffer.concat(
    frames.map(([id, data]) => {
      const header = Buffer.alloc(10);
      header.write(id, 0, 'ascii');
      if (version === 4) syncsafe(data.length).copy(header, 4);
      else header.writeUInt32BE(data.length, 4);
      return Buffer.concat([header, data]);
    }),
  );
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, version, 0, 0]), syncsafe(body.length), body]);
}

const textFrames = (tags, encoding) => Object.entries(tags).map(([id, value]) => [id, id3Text(value, encoding)]);

function apic(png) {
  return ['APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0'), Buffer.from([3, 0]), png])];
}

function uslt(lyrics) {
  return ['USLT', Buffer.concat([Buffer.from([0]), Buffer.from('eng'), Buffer.from([0]), Buffer.from(lyrics, 'latin1')])];
}

/** The 128-byte ID3v1 tag at the end of the file. */
function id3v1({ title, artist, album, year, track }) {
  const tag = Buffer.alloc(128);
  tag.write('TAG', 0, 'latin1');
  tag.write(title, 3, 30, 'latin1');
  tag.write(artist, 33, 30, 'latin1');
  tag.write(album, 63, 30, 'latin1');
  tag.write(year, 93, 4, 'latin1');
  tag[126] = track; // ID3v1.1: a zero byte at 125, then the track number
  tag[127] = 255; // no genre
  return tag;
}

// ---- Helpers ----

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
function u32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function u16be(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}

/** A square cover with a number on it, so you can see which cover belongs to which file. */
function cover(n, size = 500) {
  const canvas = new Canvas(size, size, pageColour(n));
  canvas.number(String(n), size / 2, size / 2, Math.round(size / 12), BLACK);
  return { png: canvas.png(), width: size, height: size };
}

function save(name, bytes) {
  writeFileSync(new URL(name, OUT), bytes);
  console.log(`${name.padEnd(36)} ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);
}

const range = (count) => Array.from({ length: count }, (_, i) => i + 1);
const ARTIST = 'EverShelf Test Band';

// ---- Files ----

mkdirSync(OUT, { recursive: true });

// An album of 10 FLAC tracks. Track n plays n short beeps at a rising pitch, so
// you can hear which one is playing. File names sort 1, 10, 2… as plain text,
// but the queue must follow the track numbers.
const albumCover = cover(1);
for (const n of range(10)) {
  const beeps = range(n).flatMap(() => [[pitch(n - 10), 0.25], [0, 0.25]]);
  save(
    `Test Album - Track ${n}.flac`,
    flac(tones([...beeps, [0, 1], [pitch(n - 10), 8 - n * 0.5]]), {
      TITLE: `Track ${n}`,
      ARTIST,
      ALBUM: 'Test Album',
      ALBUMARTIST: ARTIST,
      TRACKNUMBER: String(n),
      TRACKTOTAL: '10',
      DATE: '2026',
    }, albumCover),
  );
}

// A song with timed lyrics in a matching .lrc file: one line every two seconds,
// each line on a new note.
const lyricLines = ['First line', 'Second line', 'Third line', 'Fourth line', 'Fifth line', 'Last line'];
save('Lyrics Song.flac', flac(tones(lyricLines.map((_, i) => [pitch(i * 2 - 9), 2])), { TITLE: 'Lyrics Song', ARTIST }, cover(2)));
save(
  'Lyrics Song.lrc',
  Buffer.from(['[ti:Lyrics Song]', `[ar:${ARTIST}]`, ...lyricLines.map((line, i) => `[00:${String(i * 2).padStart(2, '0')}.00]${line}`), ''].join('\n')),
);

// Plain WAV, no tags: the title comes from the file name.
save('Tone.wav', wav(tones([[pitch(0), 1], [pitch(4), 1], [pitch(7), 1], [pitch(12), 2]])));

// Silent MP3s for the tag readers.
save(
  'Tagged ID3v2.3.mp3',
  Buffer.concat([
    id3v2(3, [
      ...textFrames({ TIT2: 'ID3v2.3 Song', TPE1: ARTIST, TALB: 'Tag Tests', TRCK: '1', TYER: '2026' }, 0),
      apic(cover(3).png),
      uslt('Plain lyrics without timestamps,\nstored inside the MP3.'),
    ]),
    silentMp3(10),
  ]),
);
save(
  'Tagged ID3v2.4.mp3',
  Buffer.concat([
    id3v2(4, textFrames({ TIT2: 'ID3v2.4 Song – UTF-8 ✓', TPE1: ARTIST, TALB: 'Tag Tests', TRCK: '3/12', TPOS: '1/2', TDRC: '2026-11-02' }, 3)),
    silentMp3(10),
  ]),
);
save(
  'Tagged ID3v1 only.mp3',
  Buffer.concat([silentMp3(10), id3v1({ title: 'ID3v1 Song', artist: ARTIST, album: 'Tag Tests', year: '2026', track: 7 })]),
);
// No tags: title "No Tags At All" and track 5, from the file name.
save('05 - No Tags At All.mp3', silentMp3(10));

// Chinese tags. Many real files store GBK bytes while claiming Latin-1 (encoding 0).
const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4, 0xb8, 0xe8, 0xc7, 0xfa]); // 中文测试歌曲
if (new TextDecoder('gbk').decode(gbk) !== '中文测试歌曲') throw new Error('GBK sample bytes are wrong');
save('Chinese GBK.mp3', Buffer.concat([id3v2(3, textFrames({ TIT2: gbk, TPE1: gbk.subarray(0, 4) }, 0)), silentMp3(10)]));
save('Chinese UTF-16.mp3', Buffer.concat([id3v2(3, textFrames({ TIT2: '中文测试歌曲', TPE1: '测试乐队' }, 1)), silentMp3(10)]));

// A 3000 × 3000 cover: it must be shrunk before it's saved as the item's cover.
save('Huge Cover.mp3', Buffer.concat([id3v2(3, [...textFrames({ TIT2: 'Huge Cover' }, 0), apic(cover(4, 3000).png)]), silentMp3(5)]));

// A tag that claims to be far longer than the file. The import must not crash.
const broken = id3v2(3, textFrames({ TIT2: 'Broken Tags' }, 0));
syncsafe(50_000_000).copy(broken, 6);
save('Broken Tags.mp3', Buffer.concat([broken, silentMp3(5)]));

// Not audio at all, despite the name.
save('Not Audio.mp3', Buffer.from('This is a text file with an .mp3 name.\n'));

if (process.argv.includes('--large')) {
  // 2 hours at 8 kHz, 8 bits. A beep at the start of every minute; the pitch
  // goes up every 10 minutes, so you can hear roughly where you are.
  const minutes = range(120).flatMap((m) => [[pitch(Math.floor((m - 1) / 10) - 6), 0.3], [0, 59.7]]);
  save('Long 2 Hours.wav', wav(tones(minutes, 8000), 8000, 8));
}

if (process.argv.includes('--many')) {
  for (const n of range(200)) {
    save(
      `Many ${String(n).padStart(3, '0')}.mp3`,
      Buffer.concat([id3v2(3, textFrames({ TIT2: `Many ${n}`, TPE1: ARTIST, TALB: 'Many Songs', TRCK: String(n) }, 0)), silentMp3(1)]),
    );
  }
}
