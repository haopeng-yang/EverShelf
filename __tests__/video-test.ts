import type { ByteSource } from '../src/books/comic/zip';
import { parseMatroska } from '../src/books/video/matroska';
import {
  readVideo,
  resolutionLabel,
  sniffVideo,
  VideoError,
  videoTitleFromFileName,
} from '../src/books/video/readVideo';
import { coverTime } from '../src/books/video/thumbnail';

jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('../src/storage/covers', () => ({ saveCover: jest.fn() }));

// Video files built byte by byte: only the headers matter, never the frames.

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

// ---- MP4 / QuickTime ----

function box(type: string, ...contents: (Uint8Array | number[])[]) {
  const body = concat(...contents);
  return concat(be32(body.length + 8), latin1(type), body);
}

/** A track header (version 0) with a picture size and, if turned, a quarter-turn matrix. */
function tkhd(width: number, height: number, turned = false, enabled = true) {
  const matrix = turned
    ? [...be32(0), ...be32(0x10000), ...be32(0), ...be32(0xffff0000), ...be32(0), ...be32(0), ...be32(0), ...be32(0), ...be32(0x40000000)]
    : [...be32(0x10000), ...be32(0), ...be32(0), ...be32(0), ...be32(0x10000), ...be32(0), ...be32(0), ...be32(0), ...be32(0x40000000)];
  return box('tkhd', [0, 0, 0, enabled ? 1 : 0], new Uint8Array(36), matrix, be32(width * 65536), be32(height * 65536));
}

function track(handler: 'soun' | 'vide', header = tkhd(0, 0)) {
  return box('trak', header, box('mdia', box('hdlr', [0, 0, 0, 0], [0, 0, 0, 0], latin1(handler), new Uint8Array(12))));
}

const item = (type: string, value: Uint8Array) => box(type, box('data', be32(1), [0, 0, 0, 0], value));

function mp4(brand: string | null, tracks: Uint8Array[], tags: Uint8Array[] = []) {
  const mvhd = box('mvhd', [0, 0, 0, 0], be32(0), be32(0), be32(600), be32(600 * 95), new Uint8Array(80));
  const meta = box('meta', [0, 0, 0, 0], box('hdlr', new Uint8Array(25)), box('ilst', ...tags));
  const moov = box('moov', mvhd, ...tracks, box('udta', meta));
  const mdat = box('mdat', new Uint8Array(500));
  return brand === null ? concat(moov, mdat) : concat(box('ftyp', latin1(brand), be32(0)), moov, mdat);
}

describe('readVideo: MP4 and QuickTime', () => {
  it('reads length, size and tags from an MP4 with video', async () => {
    const file = mp4('isom', [track('vide', tkhd(1920, 1080)), track('soun')], [
      item('©nam', utf8('Holiday 2024')),
      item('©day', utf8('2024-08-01')),
      item('desc', utf8('At the sea')),
    ]);
    expect(sniffVideo(file)).toBe('mp4');
    expect(await readVideo(source(file))).toEqual({
      format: 'mp4',
      extension: 'mp4',
      durationMs: 95000,
      width: 1920,
      height: 1080,
      title: 'Holiday 2024',
      year: '2024',
      description: 'At the sea',
      cover: null,
    });
  });

  it('turns the size of a phone video filmed upright', async () => {
    const info = await readVideo(source(mp4('qt  ', [track('vide', tkhd(1920, 1080, true))])));
    expect(info).toMatchObject({ format: 'mov', width: 1080, height: 1920 });
  });

  it('knows QuickTime without ftyp, and 3GPP by its brand', async () => {
    expect((await readVideo(source(mp4(null, [track('vide', tkhd(640, 480))])))).format).toBe('mov');
    expect((await readVideo(source(mp4('3gp5', [track('vide', tkhd(176, 144))])))).format).toBe('3gp');
  });

  it('refuses an MP4 with only sound, or only a disabled picture track', async () => {
    await expect(readVideo(source(mp4('M4A ', [track('soun')])))).rejects.toEqual(new VideoError('notVideo'));
    const chapterArt = mp4('M4B ', [track('soun'), track('vide', tkhd(300, 300, false, false))]);
    await expect(readVideo(source(chapterArt))).rejects.toBeInstanceOf(VideoError);
  });

  it('refuses something that is not a video at all', async () => {
    await expect(readVideo(source(utf8('just some text, nothing more')))).rejects.toBeInstanceOf(VideoError);
    expect(sniffVideo(utf8('just some text'))).toBeNull();
  });
});

// ---- Matroska / WebM ----

/** An element with an 8-byte size, so lengths never need packing; `unknown` makes it "unknown size". */
function el(id: number[], ...contents: (Uint8Array | number[])[]) {
  const body = concat(...contents);
  return concat(id, [0x01, 0, 0, 0, ...be32(body.length)], body);
}
function unknownSize(id: number[], ...contents: (Uint8Array | number[])[]) {
  return concat(id, [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], ...contents);
}
const uint = (n: number) => [n];
function float64(n: number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, n);
  return bytes;
}

const EBML = [0x1a, 0x45, 0xdf, 0xa3];
const SEGMENT = [0x18, 0x53, 0x80, 0x67];
const INFO = [0x15, 0x49, 0xa9, 0x66];
const TRACKS = [0x16, 0x54, 0xae, 0x6b];
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];

function matroska(docType: string, trackTypes: number[], segmentKnown = true) {
  const header = el(EBML, el([0x42, 0x82], latin1(docType)));
  const info = el(
    INFO,
    el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), // 1,000,000 ns: milliseconds
    el([0x44, 0x89], float64(5_400_000)),
    el([0x7b, 0xa9], utf8('Film Night')),
  );
  const tracks = el(
    TRACKS,
    ...trackTypes.map((type) =>
      el([0xae], el([0x83], uint(type)), ...(type === 1 ? [el([0xe0], el([0xb0], [0x05, 0x00]), el([0xba], [0x02, 0xd0]))] : [])),
    ),
  );
  const seekHead = el([0x11, 0x4d, 0x9b, 0x74], new Uint8Array(30));
  const cluster = el(CLUSTER, new Uint8Array(200));
  const children = [seekHead, el([0xec], new Uint8Array(10)), info, tracks, cluster];
  return concat(header, segmentKnown ? el(SEGMENT, ...children) : unknownSize(SEGMENT, ...children));
}

describe('readVideo: Matroska and WebM', () => {
  it('reads an MKV’s length, title and size from its header', async () => {
    const file = matroska('matroska', [1, 2]);
    expect(sniffVideo(file)).toBe('matroska');
    expect(await readVideo(source(file))).toEqual({
      format: 'mkv',
      extension: 'mkv',
      durationMs: 5_400_000,
      width: 1280,
      height: 720,
      title: 'Film Night',
      year: '',
      description: '',
      cover: null,
    });
  });

  it('knows WebM by its DocType, even when the segment size is unknown (a live recording)', async () => {
    expect(await readVideo(source(matroska('webm', [1], false)))).toMatchObject({ format: 'webm', durationMs: 5_400_000 });
  });

  it('refuses a Matroska file with only sound', async () => {
    await expect(readVideo(source(matroska('matroska', [2])))).rejects.toBeInstanceOf(VideoError);
  });

  it('accepts a file cut off before its tracks, leaving what it can’t see unknown', () => {
    const file = matroska('matroska', [1]);
    const cut = file.subarray(0, file.length - 260);
    expect(parseMatroska(cut)).toMatchObject({ docType: 'matroska', sawTracks: false, durationMs: 5_400_000 });
  });
});

describe('video names and labels', () => {
  it('makes titles from file names', () => {
    expect(videoTitleFromFileName('The.Long.Walk.2019.mp4')).toBe('The Long Walk 2019');
    expect(videoTitleFromFileName('my_holiday_clip.MOV')).toBe('my holiday clip');
    expect(videoTitleFromFileName('S01E03 - Pilot.mkv')).toBe('S01E03 - Pilot');
    expect(videoTitleFromFileName('')).toBe('');
  });

  it('names common sizes either way up', () => {
    expect(resolutionLabel(1920, 1080)).toBe('1080p');
    expect(resolutionLabel(1080, 1920)).toBe('1080p');
    expect(resolutionLabel(3840, 2160)).toBe('4K');
    expect(resolutionLabel(1000, 600)).toBe('1000×600');
    expect(resolutionLabel(null, 720)).toBe('');
  });

  it('takes the cover a tenth of the way in, but no later than 30 s', () => {
    expect(coverTime(60_000)).toBe(6);
    expect(coverTime(2 * 60 * 60 * 1000)).toBe(30);
    expect(coverTime(null)).toBe(1);
  });
});
