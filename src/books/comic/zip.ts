import { inflateSync } from 'fflate';

import { CRC32_START, updateCrc32 } from '../crc32';
import { decodeText } from '../decodeText';

// Reads a ZIP file (a .cbz is one) one entry at a time. Comic files are often
// hundreds of megabytes, so they are never loaded whole: the list of files is
// read from the "central directory" at the end of the ZIP, and each page is
// then read from its own offset only when it's needed.
//
// Format reference: PKWARE APPNOTE.TXT, sections 4.3.7 (local file header),
// 4.3.12 (central directory) and 4.3.16 (end of central directory record),
// and 4.3.14, 4.3.15 and 4.5.3 for ZIP64 (files or ZIPs over 4 GB, which
// EverShelf's own backups can be).

/** Anything that can read bytes at an offset: a FileHandle on the phone, a Uint8Array in tests. */
export interface ByteSource {
  size: number;
  /** May return fewer bytes than asked for at the end of the file. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface ZipEntry {
  /** Full path inside the ZIP, with forward slashes, e.g. "Chapter 1/001.jpg". */
  name: string;
  /** 0 = stored as is, 8 = deflate. Anything else isn't supported. */
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  encrypted: boolean;
  /** The CRC-32 of the uncompressed data. */
  crc: number;
}

export type ZipErrorCode = 'notZip' | 'tooLarge' | 'encrypted' | 'unsupported' | 'damaged';

export class ZipError extends Error {
  constructor(readonly code: ZipErrorCode) {
    super(`ZIP error: ${code}`);
  }
}

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const END_RECORD_SIZE = 22;
/** A size, offset or count with all bits set means the real value is in a ZIP64 record. */
const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
/** The end record is followed by a comment of at most 65,535 bytes. */
const MAX_END_SEARCH = END_RECORD_SIZE + 0xffff;

/** True if the bytes start like a ZIP file ("PK\3\4"), or an empty one ("PK\5\6"). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
}

/** Lists every file in the ZIP (folders are left out). */
export async function readZipEntries(source: ByteSource): Promise<ZipEntry[]> {
  const tailLength = Math.min(source.size, MAX_END_SEARCH);
  const tail = await source.read(source.size - tailLength, tailLength);
  const end = findEndRecord(tail);
  if (end === -1) throw new ZipError('notZip');

  const view = viewOf(tail);
  let count = view.getUint16(end + 10, true);
  let directorySize = view.getUint32(end + 12, true);
  let directoryOffset = view.getUint32(end + 16, true);
  if (count === MAX_16 || directorySize === MAX_32 || directoryOffset === MAX_32) {
    // The ZIP64 locator sits just before the end record and says where the ZIP64 end record is.
    const locatorAt = source.size - tailLength + end - ZIP64_LOCATOR_SIZE;
    const locator = viewOf(await source.read(locatorAt, ZIP64_LOCATOR_SIZE));
    if (locator.byteLength < ZIP64_LOCATOR_SIZE || locator.getUint32(0, true) !== ZIP64_LOCATOR_SIGNATURE) {
      throw new ZipError('damaged');
    }
    const record = viewOf(await source.read(uint64(locator, 8), 56));
    if (record.byteLength < 56 || record.getUint32(0, true) !== ZIP64_END_SIGNATURE) throw new ZipError('damaged');
    count = uint64(record, 32);
    directorySize = uint64(record, 40);
    directoryOffset = uint64(record, 48);
  }
  if (directoryOffset + directorySize > source.size) throw new ZipError('damaged');

  const directory = await source.read(directoryOffset, directorySize);
  return parseCentralDirectory(directory, count);
}

/** Reads one file out of the ZIP, uncompressed. */
export async function readZipEntry(source: ByteSource, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new ZipError('encrypted');
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError('unsupported');
  const dataOffset = await dataOffsetOf(source, entry);
  const raw = await source.read(dataOffset, entry.compressedSize);
  if (raw.length < entry.compressedSize) throw new ZipError('damaged');
  if (entry.method === 0) return raw;
  try {
    return inflateSync(raw, { out: new Uint8Array(entry.size) });
  } catch {
    throw new ZipError('damaged');
  }
}

/**
 * Copies a stored (uncompressed) file out of the ZIP a chunk at a time, for
 * files too big to hold in memory, and checks it against its CRC-32.
 */
export async function copyZipEntry(
  source: ByteSource,
  entry: ZipEntry,
  write: (chunk: Uint8Array) => Promise<void>,
  chunkSize = 1024 * 1024,
): Promise<void> {
  if (entry.encrypted) throw new ZipError('encrypted');
  if (entry.method !== 0) throw new ZipError('unsupported');
  const start = await dataOffsetOf(source, entry);
  let crc = CRC32_START;
  for (let done = 0; done < entry.size; ) {
    const chunk = await source.read(start + done, Math.min(chunkSize, entry.size - done));
    if (chunk.length === 0) throw new ZipError('damaged');
    crc = updateCrc32(crc, chunk);
    await write(chunk);
    done += chunk.length;
  }
  if (crc !== entry.crc) throw new ZipError('damaged');
}

/**
 * Where an entry's data starts. The local header repeats the name and has its
 * own "extra" field, whose length can differ from the central directory's, so
 * it is read to find out.
 */
async function dataOffsetOf(source: ByteSource, entry: ZipEntry): Promise<number> {
  const header = await source.read(entry.localHeaderOffset, 30);
  const view = viewOf(header);
  if (header.length < 30 || view.getUint32(0, true) !== LOCAL_SIGNATURE) throw new ZipError('damaged');
  return entry.localHeaderOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
}

/** A ByteSource over bytes already in memory (tests, and small files). */
export function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
  };
}

/** Offset of the end-of-central-directory record in `tail`, searching from the end; -1 if none. */
function findEndRecord(tail: Uint8Array): number {
  const view = viewOf(tail);
  for (let i = tail.length - END_RECORD_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === END_SIGNATURE) return i;
  }
  return -1;
}

function parseCentralDirectory(directory: Uint8Array, count: number): ZipEntry[] {
  const view = viewOf(directory);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > directory.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new ZipError('damaged');
    const flags = view.getUint16(at + 8, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const nameBytes = directory.subarray(at + 46, at + 46 + nameLength);
    // Names are UTF-8 when flag bit 11 is set. Without it they're officially
    // CP437, but in practice Chinese tools write GBK; decodeText tries strict
    // UTF-8 first and then GB18030, which covers both.
    const name = decodeText(nameBytes).text.replace(/\\/g, '/');
    if (!name.endsWith('/')) {
      let size = view.getUint32(at + 24, true);
      let compressedSize = view.getUint32(at + 20, true);
      let localHeaderOffset = view.getUint32(at + 42, true);
      if (size === MAX_32 || compressedSize === MAX_32 || localHeaderOffset === MAX_32) {
        // The real values are in the ZIP64 extra field, in this order, only for those that didn't fit.
        const zip64 = zip64Values(directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength));
        if (size === MAX_32) size = zip64.shift() ?? MAX_32;
        if (compressedSize === MAX_32) compressedSize = zip64.shift() ?? MAX_32;
        if (localHeaderOffset === MAX_32) localHeaderOffset = zip64.shift() ?? MAX_32;
      }
      entries.push({
        name,
        method: view.getUint16(at + 10, true),
        compressedSize,
        size,
        localHeaderOffset,
        encrypted: (flags & 1) !== 0,
        crc: view.getUint32(at + 16, true),
      });
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The 64-bit numbers in an entry's ZIP64 extra field (header id 1), or none if it has none. */
function zip64Values(extra: Uint8Array): number[] {
  const view = viewOf(extra);
  for (let at = 0; at + 4 <= extra.length; ) {
    const id = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (id === 1) {
      const values: number[] = [];
      for (let i = at + 4; i + 8 <= at + 4 + length && i + 8 <= extra.length; i += 8) values.push(uint64(view, i));
      return values;
    }
    at += 4 + length;
  }
  return [];
}

/** A little-endian 64-bit number; exact up to 2^53, far past any real file. */
function uint64(view: DataView, at: number): number {
  return view.getUint32(at, true) + view.getUint32(at + 4, true) * 0x100000000;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
