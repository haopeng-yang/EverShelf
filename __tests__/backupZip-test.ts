import { strFromU8, strToU8, unzipSync } from 'fflate';

import { copyZipEntry, memorySource, readZipEntries, readZipEntry, ZipError } from '../src/books/comic/zip';
import { crc32, CRC32_START, updateCrc32 } from '../src/books/crc32';
import { ZipWriter, type ByteSink } from '../src/books/zipWriter';

/** A sink that keeps the ZIP in memory, like the web version's. */
function memorySink(): ByteSink & { bytes(): Uint8Array } {
  const chunks: number[] = [];
  return {
    write: async (bytes) => {
      for (const b of bytes) chunks.push(b);
    },
    patch: async (offset, bytes) => {
      bytes.forEach((b, i) => (chunks[offset + i] = b));
    },
    bytes: () => Uint8Array.from(chunks),
  };
}

/** Reads a stored file from memory in small chunks, as a phone reads one from disk. */
const reader = (data: Uint8Array) => async (offset: number, length: number) => data.subarray(offset, offset + length);

describe('crc32', () => {
  it('matches the standard check value, in one go or in parts', () => {
    const data = strToU8('123456789');
    expect(crc32(data)).toBe(0xcbf43926);
    expect(updateCrc32(updateCrc32(CRC32_START, data.subarray(0, 4)), data.subarray(4))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('ZipWriter', () => {
  const page = Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) % 256);

  async function sampleZip() {
    const sink = memorySink();
    const writer = new ZipWriter(sink);
    await writer.addBytes('backup.json', strToU8('{"app":"EverShelf","name":"灯塔"}'));
    await writer.addStored('files/abc/0/1.jpg', page.length, reader(page));
    await writer.addStored('files/abc/song.mp3', 0, reader(new Uint8Array()));
    await writer.finish();
    return sink.bytes();
  }

  it('writes a ZIP that other tools read', async () => {
    const files = unzipSync(await sampleZip());
    expect(Object.keys(files)).toEqual(['backup.json', 'files/abc/0/1.jpg', 'files/abc/song.mp3']);
    expect(strFromU8(files['backup.json'])).toBe('{"app":"EverShelf","name":"灯塔"}');
    expect(files['files/abc/0/1.jpg']).toEqual(page);
  });

  it('is read back by the app, copying stored files in chunks and checking them', async () => {
    const source = memorySource(await sampleZip());
    const entries = await readZipEntries(source);
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['backup.json', 8, 35],
      ['files/abc/0/1.jpg', 0, 3000],
      ['files/abc/song.mp3', 0, 0],
    ]);
    expect(strFromU8(await readZipEntry(source, entries[0]))).toContain('灯塔');

    const copied: Uint8Array[] = [];
    await copyZipEntry(source, entries[1], async (chunk) => void copied.push(chunk), 1024);
    expect(copied.map((c) => c.length)).toEqual([1024, 1024, 952]);
    expect(Uint8Array.from(copied.flatMap((c) => [...c]))).toEqual(page);
  });

  it('notices a damaged file when copying it', async () => {
    const zip = await sampleZip();
    const source = memorySource(zip);
    const entry = (await readZipEntries(source))[1];
    // Flip a byte in the middle of the page's data.
    zip[entry.localHeaderOffset + 30 + entry.name.length + 1500] ^= 0xff;
    await expect(copyZipEntry(source, entry, async () => {})).rejects.toEqual(new ZipError('damaged'));
  });

  it('refuses a file that changes size while being backed up', async () => {
    const writer = new ZipWriter(memorySink());
    await expect(writer.addStored('short.bin', 10, reader(new Uint8Array(4)))).rejects.toThrow('changed size');
  });

  it('adds ZIP64 records past 65,535 files, and reads them back', async () => {
    const sink = memorySink();
    const writer = new ZipWriter(sink);
    const count = 0xffff + 5;
    for (let i = 0; i < count; i++) await writer.addStored(`f/${i}`, 1, reader(Uint8Array.of(i % 256)));
    await writer.finish();
    const source = memorySource(sink.bytes());
    const entries = await readZipEntries(source);
    expect(entries).toHaveLength(count);
    expect(entries[count - 1].name).toBe(`f/${count - 1}`);
    expect(await readZipEntry(source, entries[count - 1])).toEqual(Uint8Array.of((count - 1) % 256));
    expect(Object.keys(unzipSync(sink.bytes()))).toHaveLength(count);
  }, 30000);
});
