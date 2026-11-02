/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ByteSource } from '../src/books/comic/zip';
import { AudioError, decodeLatin1OrGbk } from '../src/books/music/audioTags';
import { parseId3v1, parseId3v2 } from '../src/books/music/id3';
import { readAudio, sniffAudio, titleFromFileName } from '../src/books/music/readAudio';

// Song files built byte by byte, so every tag format can be checked without real music.

const source = (bytes: Uint8Array): ByteSource => ({
  size: bytes.length,
  read: async (offset, length) => bytes.subarray(offset, offset + length),
});

const concat = (...parts: (Uint8Array | number[])[]) => {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};
const latin1 = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
const utf8 = (text: string) => new TextEncoder().encode(text);
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const syncsafe = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);

// ---- MP3 ----

/** MPEG-1 Layer III, 128 kbit/s, 44.1 kHz, mono: 417 bytes of silence per frame. */
function mp3Frames(count: number, xingFrames?: number) {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0xc0]);
  const frames = Array.from({ length: count }, () => frame.slice());
  if (xingFrames !== undefined) frames[0].set([...latin1('Xing'), 0, 0, 0, 1, ...be32(xingFrames)], 4 + 17);
  return concat(...frames);
}

function id3v2(version: 3 | 4, frames: [string, Uint8Array][]) {
  const body = concat(
    ...frames.map(([id, data]) =>
      concat(latin1(id), version === 4 ? syncsafe(data.length) : be32(data.length), [0, 0], data),
    ),
  );
  return concat(latin1('ID3'), [version, 0, 0], syncsafe(body.length), body);
}
const text = (value: string | Uint8Array, encoding = 0): Uint8Array => {
  if (value instanceof Uint8Array) return concat([encoding], value);
  if (encoding === 1) {
    const units = [...value].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]);
    return concat([1, 0xff, 0xfe], units);
  }
  return concat([encoding], encoding === 3 ? utf8(value) : latin1(value));
};

function id3v1(title: string, artist: string, track: number) {
  const tag = new Uint8Array(128);
  tag.set(latin1('TAG'));
  tag.set(latin1(title), 3);
  tag.set(latin1(artist), 33);
  tag.set(latin1('2026'), 93);
  tag[126] = track;
  return tag;
}

describe('MP3 tags', () => {
  it('reads ID3v2.3 text, track, year, cover and lyrics', async () => {
    const tag = id3v2(3, [
      ['TIT2', text('Night Drive')],
      ['TPE1', text('The Band')],
      ['TALB', text('Roads')],
      ['TPE2', text('Various')],
      ['TRCK', text('3/12')],
      ['TPOS', text('2/2')],
      ['TYER', text('2019')],
      ['APIC', concat([0], latin1('image/jpeg\0'), [0], latin1('back\0'), JPEG)],
      ['APIC', concat([0], latin1('image/png\0'), [3], latin1('\0'), PNG)],
      ['USLT', concat([0], latin1('eng'), [0], latin1('Line one\nLine two'))],
    ]);
    const info = await readAudio(source(concat(tag, mp3Frames(100))));
    expect(info).toMatchObject({
      format: 'mp3',
      title: 'Night Drive',
      artist: 'The Band',
      album: 'Roads',
      albumArtist: 'Various',
      trackNumber: 3,
      discNumber: 2,
      year: '2019',
      lyrics: 'Line one\nLine two',
    });
    // The front cover (type 3) wins over the first picture.
    expect(info.cover).toEqual({ bytes: PNG, extension: 'png' });
    // 100 frames × 1152 samples at 44.1 kHz, from the bitrate: 100 × 417 bytes at 128 kbit/s.
    expect(info.durationMs).toBe(Math.round((100 * 417 * 8) / 128));
  });

  it('reads ID3v2.4 UTF-8 text, a full date, and an exact length from a Xing header', async () => {
    const tag = id3v2(4, [
      ['TIT2', text('Café ✓', 3)],
      ['TDRC', text('2026-11-02', 3)],
      ['TRCK', text('7', 3)],
    ]);
    const info = await readAudio(source(concat(tag, mp3Frames(10, 1000))));
    expect(info).toMatchObject({ title: 'Café ✓', year: '2026', trackNumber: 7 });
    expect(info.durationMs).toBe(Math.round((1000 * 1152 * 1000) / 44100));
  });

  it('reads UTF-16 and GBK Chinese, but keeps accented Latin-1 as it is', () => {
    const gbk = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]); // 中文测试
    const tags = parseId3v2(id3v2(3, [['TIT2', text(gbk)], ['TPE1', text('测试乐队', 1)], ['TALB', text('Mötley Crüe')]]));
    expect(tags).toMatchObject({ title: '中文测试', artist: '测试乐队', album: 'Mötley Crüe' });
    expect(decodeLatin1OrGbk(latin1('Beyoncé'))).toBe('Beyoncé');
  });

  it('falls back to ID3v1 at the end of the file', async () => {
    const info = await readAudio(source(concat(mp3Frames(20), id3v1('Old Song', 'Old Band', 7))));
    expect(info).toMatchObject({ title: 'Old Song', artist: 'Old Band', trackNumber: 7, year: '2026' });
    expect(parseId3v1(new Uint8Array(128))).toMatchObject({ title: '' });
  });

  it('survives a tag that claims to be longer than the file', async () => {
    const tag = id3v2(3, [['TIT2', text('Broken Tags')]]);
    tag.set(syncsafe(50_000_000), 6);
    const info = await readAudio(source(concat(tag, mp3Frames(20))));
    expect(info.title).toBe('Broken Tags');
    expect(info.format).toBe('mp3');
  });

  it('refuses a file that only has an .mp3 name', async () => {
    await expect(readAudio(source(utf8('This is a text file with an .mp3 name.\n')))).rejects.toEqual(
      new AudioError('notAudio'),
    );
  });
});

// ---- FLAC ----

function flacFile(comments: string[], picture?: Uint8Array) {
  const info = new Uint8Array(34);
  info.set([0x10, 0, 0x10, 0]); // block sizes
  // 44,100 Hz, mono, 16 bits, 441,000 samples (10 s).
  const rate = 44100;
  info[10] = rate >> 12;
  info[11] = (rate >> 4) & 255;
  info[12] = ((rate & 15) << 4) | (0 << 1) | (15 >> 4);
  info[13] = ((15 & 15) << 4) | 0;
  info.set(be32(441000), 14);
  const vendor = latin1('test');
  const vorbis = concat(le32(vendor.length), vendor, le32(comments.length), ...comments.map((c) => concat(le32(utf8(c).length), utf8(c))));
  const block = (type: number, data: Uint8Array, last: boolean) =>
    concat([(last ? 0x80 : 0) | type, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255], data);
  const mime = latin1('image/png');
  const pictureData = picture && concat(be32(3), be32(mime.length), mime, be32(0), be32(1), be32(1), be32(24), be32(0), be32(picture.length), picture);
  return concat(
    latin1('fLaC'),
    block(0, info, false),
    block(4, vorbis, !pictureData),
    ...(pictureData ? [block(6, pictureData, true)] : []),
    [0xff, 0xf8, 0x79, 0x08],
  );
}

describe('FLAC tags', () => {
  it('reads Vorbis comments, the cover and the exact length', async () => {
    const info = await readAudio(
      source(flacFile(['TITLE=Track 1', 'artist=EverShelf', 'ALBUM=Test Album', 'TRACKNUMBER=1/10', 'DATE=2026'], PNG)),
    );
    expect(info).toMatchObject({
      format: 'flac',
      extension: 'flac',
      title: 'Track 1',
      artist: 'EverShelf',
      album: 'Test Album',
      trackNumber: 1,
      year: '2026',
      durationMs: 10000,
    });
    expect(info.cover?.extension).toBe('png');
  });
});

// ---- WAV ----

describe('WAV', () => {
  it('works out the length, and reads LIST/INFO tags if there are any', async () => {
    const chunk = (id: string, data: Uint8Array) => concat(latin1(id), le32(data.length), data, data.length & 1 ? [0] : []);
    const fmt = concat([1, 0, 1, 0], le32(8000), le32(16000), [2, 0, 16, 0]);
    const listInfo = concat(latin1('INFO'), chunk('INAM', latin1('Tone\0')), chunk('IART', latin1('Me\0')));
    const wav = concat(latin1('RIFF'), le32(0), latin1('WAVE'), chunk('fmt ', fmt), chunk('LIST', listInfo), chunk('data', new Uint8Array(32000)));
    expect(await readAudio(source(wav))).toMatchObject({ format: 'wav', title: 'Tone', artist: 'Me', durationMs: 2000 });
  });
});

// ---- MP4 / M4A ----

function box(type: string, ...contents: (Uint8Array | number[])[]) {
  const body = concat(...contents);
  return concat(be32(body.length + 8), Uint8Array.from([...type].map((c) => c.charCodeAt(0))), body);
}
function track(handler: 'soun' | 'vide', enabled = true) {
  return box(
    'trak',
    box('tkhd', [0, 0, 0, enabled ? 1 : 0], new Uint8Array(80)),
    box('mdia', box('hdlr', [0, 0, 0, 0], [0, 0, 0, 0], latin1(handler), new Uint8Array(12))),
  );
}
const item = (type: string, dataType: number, value: Uint8Array | number[]) =>
  box(type, box('data', be32(dataType), [0, 0, 0, 0], value));

function mp4(tracks: Uint8Array[], moovFirst = true) {
  const mvhd = box('mvhd', [0, 0, 0, 0], be32(0), be32(0), be32(1000), be32(215000), new Uint8Array(80));
  const ilst = box(
    'ilst',
    item('©nam', 1, utf8('Apple Song')),
    item('©ART', 1, utf8('Fruit')),
    item('trkn', 0, [0, 0, 0, 4, 0, 9, 0, 0]),
    item('covr', 13, JPEG),
  );
  const meta = box('meta', [0, 0, 0, 0], box('hdlr', new Uint8Array(25)), ilst);
  const moov = box('moov', mvhd, ...tracks, box('udta', meta));
  const ftyp = box('ftyp', latin1('M4A '), be32(0));
  const mdat = box('mdat', new Uint8Array(1000));
  return moovFirst ? concat(ftyp, moov, mdat) : concat(ftyp, mdat, moov);
}

describe('M4A and MP4', () => {
  it('reads iTunes tags and the length, wherever moov is', async () => {
    for (const moovFirst of [true, false]) {
      const info = await readAudio(source(mp4([track('soun')], moovFirst)));
      expect(info).toMatchObject({ format: 'm4a', title: 'Apple Song', artist: 'Fruit', trackNumber: 4, durationMs: 215000 });
      expect(info.cover).toEqual({ bytes: JPEG, extension: 'jpg' });
    }
  });

  it('refuses a video, but not a disabled picture track', async () => {
    await expect(readAudio(source(mp4([track('soun'), track('vide')])))).rejects.toEqual(new AudioError('video'));
    await expect(readAudio(source(mp4([track('soun'), track('vide', false)])))).resolves.toMatchObject({ format: 'm4a' });
    await expect(readAudio(source(mp4([])))).rejects.toEqual(new AudioError('notAudio'));
  });
});

describe('sniffAudio and file names', () => {
  it('knows formats from their first bytes', () => {
    expect(sniffAudio(mp3Frames(3))).toBe('mp3');
    expect(sniffAudio(flacFile([]))).toBe('flac');
    expect(sniffAudio(mp4([track('soun')]))).toBe('m4a');
    expect(sniffAudio(PNG)).toBeNull();
    expect(sniffAudio(utf8('Just some text, long enough.'))).toBeNull();
  });

  it('takes a title and track number from the file name', () => {
    expect(titleFromFileName('05 - No Tags At All.mp3')).toEqual({ title: 'No Tags At All', trackNumber: 5 });
    expect(titleFromFileName('03_Song_Name.flac')).toEqual({ title: 'Song Name', trackNumber: 3 });
    expect(titleFromFileName('Test Album - Track 10.flac')).toEqual({ title: 'Test Album - Track 10', trackNumber: null });
    expect(titleFromFileName('1999.mp3')).toEqual({ title: '1999', trackNumber: null });
  });
});

// The files from scripts/make-test-songs.mjs, when they've been generated.
const SONGS = join(__dirname, '..', 'test-songs');
(existsSync(SONGS) ? describe : describe.skip)('generated test songs', () => {
  const read = (name: string) => readAudio(source(new Uint8Array(readFileSync(join(SONGS, name)))));

  it('reads every generated song, and refuses the fake one', async () => {
    const names = readdirSync(SONGS).filter((n) => /\.(mp3|flac|wav)$/.test(n) && !n.startsWith('Many') && !n.startsWith('Long'));
    for (const name of names) {
      if (name === 'Not Audio.mp3') await expect(read(name)).rejects.toEqual(new AudioError('notAudio'));
      else await expect(read(name)).resolves.toHaveProperty('format');
    }
    expect(await read('Test Album - Track 10.flac')).toMatchObject({ title: 'Track 10', trackNumber: 10, album: 'Test Album', durationMs: 9000 });
    expect(await read('Chinese GBK.mp3')).toMatchObject({ title: '中文测试歌曲', artist: '中文' });
    expect((await read('Huge Cover.mp3')).cover?.extension).toBe('png');
  });
});
