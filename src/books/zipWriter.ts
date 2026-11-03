import { deflateSync } from 'fflate';

import { crc32, CRC32_START, updateCrc32 } from './crc32';

// Writes a ZIP file a piece at a time, for backups that can hold several GB of
// comics, songs and videos. Big files are copied in chunks and stored as they
// are (images, music and video are already compressed); only small things
// like the backup's JSON are compressed. Each file's checksum is only known
// once it has been copied, so its header is written first and the checksum
// filled in afterwards. ZIP64 records are added when a file, or the whole
// ZIP, passes 4 GB. Format reference: PKWARE APPNOTE.TXT (see comic/zip.ts).

/** Where the ZIP goes: written in order, with earlier bytes overwritten in place by `patch`. */
export interface ByteSink {
  write(bytes: Uint8Array): Promise<void>;
  patch(offset: number, bytes: Uint8Array): Promise<void>;
}

/** Reads a stored file in parts; may return fewer bytes than asked for only at the end. */
export type ChunkReader = (offset: number, length: number) => Promise<Uint8Array>;

const CHUNK_SIZE = 1024 * 1024;
/** Sizes and offsets at or over this need ZIP64. */
const LIMIT = 0xffffffff;
const VERSION = 20;
const VERSION_ZIP64 = 45;
/** Flag bit 11: names are UTF-8. */
const UTF8_FLAG = 0x0800;

interface WrittenEntry {
  name: Uint8Array;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export class ZipWriter {
  private position = 0;
  private readonly entries: WrittenEntry[] = [];
  private readonly encoder = new TextEncoder();

  constructor(private readonly sink: ByteSink) {}

  /** Bytes written so far. */
  get written(): number {
    return this.position;
  }

  /** Adds a file already in memory, compressed. */
  async addBytes(name: string, bytes: Uint8Array): Promise<void> {
    const compressed = deflateSync(bytes, { level: 6 });
    const entry = this.startEntry(name, 8, bytes.length, compressed.length);
    entry.crc = crc32(bytes);
    await this.writeLocalHeader(entry);
    await this.put(compressed);
  }

  /**
   * Adds a file of `size` bytes read in chunks, stored as it is. `onChunk`
   * reports each chunk's length, for progress.
   */
  async addStored(name: string, size: number, read: ChunkReader, onChunk?: (bytes: number) => void): Promise<void> {
    const entry = this.startEntry(name, 0, size, size);
    const header = await this.writeLocalHeader(entry);
    let crc = CRC32_START;
    let done = 0;
    while (done < size) {
      const chunk = await read(done, Math.min(CHUNK_SIZE, size - done));
      if (chunk.length === 0) break;
      crc = updateCrc32(crc, chunk);
      await this.put(chunk);
      done += chunk.length;
      onChunk?.(chunk.length);
    }
    if (done !== size) throw new Error(`${name} changed size while it was being backed up`);
    entry.crc = crc;
    // The checksum sits 14 bytes into the local header.
    await this.sink.patch(header + 14, uint32(crc));
  }

  /** Writes the list of files at the end. Nothing can be added after this. */
  async finish(): Promise<void> {
    const directoryOffset = this.position;
    for (const entry of this.entries) await this.put(centralRecord(entry));
    const directorySize = this.position - directoryOffset;
    const count = this.entries.length;

    if (count >= 0xffff || directoryOffset >= LIMIT || directorySize >= LIMIT) {
      const zip64End = this.position;
      const record = new Bytes(56);
      record.u32(0x06064b50).u64(44).u16(VERSION_ZIP64).u16(VERSION_ZIP64).u32(0).u32(0);
      record.u64(count).u64(count).u64(directorySize).u64(directoryOffset);
      await this.put(record.bytes);
      const locator = new Bytes(20);
      locator.u32(0x07064b50).u32(0).u64(zip64End).u32(1);
      await this.put(locator.bytes);
    }
    const end = new Bytes(22);
    end.u32(0x06054b50).u16(0).u16(0).u16(Math.min(count, 0xffff)).u16(Math.min(count, 0xffff));
    end.u32(Math.min(directorySize, LIMIT)).u32(Math.min(directoryOffset, LIMIT)).u16(0);
    await this.put(end.bytes);
  }

  private startEntry(name: string, method: number, size: number, compressedSize: number): WrittenEntry {
    const entry = { name: this.encoder.encode(name), method, crc: 0, compressedSize, size, offset: this.position };
    this.entries.push(entry);
    return entry;
  }

  /** Writes the entry's local header and returns where it starts. */
  private async writeLocalHeader(entry: WrittenEntry): Promise<number> {
    const big = entry.size >= LIMIT || entry.compressedSize >= LIMIT;
    const extra = big ? 20 : 0;
    const header = new Bytes(30 + entry.name.length + extra);
    header.u32(0x04034b50).u16(big ? VERSION_ZIP64 : VERSION).u16(UTF8_FLAG).u16(entry.method);
    header.u16(0).u16(0x21); // Time and date: 00:00, 1980-01-01. The backup's JSON has the real date.
    header.u32(entry.crc);
    header.u32(big ? LIMIT : entry.compressedSize).u32(big ? LIMIT : entry.size);
    header.u16(entry.name.length).u16(extra).raw(entry.name);
    if (big) header.u16(1).u16(16).u64(entry.size).u64(entry.compressedSize);
    const start = this.position;
    await this.put(header.bytes);
    return start;
  }

  private async put(bytes: Uint8Array): Promise<void> {
    await this.sink.write(bytes);
    this.position += bytes.length;
  }
}

function centralRecord(entry: WrittenEntry): Uint8Array {
  // ZIP64 values go in an extra field, in this order, only for those that don't fit.
  const zip64: number[] = [];
  if (entry.size >= LIMIT) zip64.push(entry.size);
  if (entry.compressedSize >= LIMIT) zip64.push(entry.compressedSize);
  if (entry.offset >= LIMIT) zip64.push(entry.offset);
  const extra = zip64.length > 0 ? 4 + zip64.length * 8 : 0;
  const version = zip64.length > 0 ? VERSION_ZIP64 : VERSION;

  const record = new Bytes(46 + entry.name.length + extra);
  record.u32(0x02014b50).u16(version).u16(version).u16(UTF8_FLAG).u16(entry.method);
  record.u16(0).u16(0x21).u32(entry.crc);
  record.u32(Math.min(entry.compressedSize, LIMIT)).u32(Math.min(entry.size, LIMIT));
  record.u16(entry.name.length).u16(extra).u16(0).u16(0).u16(0).u32(0);
  record.u32(Math.min(entry.offset, LIMIT)).raw(entry.name);
  if (zip64.length > 0) {
    record.u16(1).u16(zip64.length * 8);
    for (const value of zip64) record.u64(value);
  }
  return record.bytes;
}

function uint32(value: number): Uint8Array {
  return new Bytes(4).u32(value).bytes;
}

/** Little-endian bytes written in order. */
class Bytes {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private at = 0;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }

  u16(value: number): this {
    this.view.setUint16(this.at, value, true);
    this.at += 2;
    return this;
  }

  u32(value: number): this {
    this.view.setUint32(this.at, value >>> 0, true);
    this.at += 4;
    return this;
  }

  /** Numbers past 2^53 can't occur: no phone holds a file that big. */
  u64(value: number): this {
    this.view.setUint32(this.at, value % 0x100000000, true);
    this.view.setUint32(this.at + 4, Math.floor(value / 0x100000000), true);
    this.at += 8;
    return this;
  }

  raw(bytes: Uint8Array): this {
    this.bytes.set(bytes, this.at);
    this.at += bytes.length;
    return this;
  }
}
