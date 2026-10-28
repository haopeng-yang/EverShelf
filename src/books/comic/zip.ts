import { inflateSync } from 'fflate';

import { decodeText } from '../decodeText';

// Reads a ZIP file (a .cbz is one) one entry at a time. Comic files are often
// hundreds of megabytes, so they are never loaded whole: the list of files is
// read from the "central directory" at the end of the ZIP, and each page is
// then read from its own offset only when it's needed.
//
// Format reference: PKWARE APPNOTE.TXT, sections 4.3.7 (local file header),
// 4.3.12 (central directory) and 4.3.16 (end of central directory record).

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
const END_RECORD_SIZE = 22;
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
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  // These all-ones values mean the real ones are in a ZIP64 record: files over 4 GB or 65,535 entries.
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new ZipError('tooLarge');
  if (directoryOffset + directorySize > source.size) throw new ZipError('damaged');

  const directory = await source.read(directoryOffset, directorySize);
  return parseCentralDirectory(directory, count);
}

/** Reads one file out of the ZIP, uncompressed. */
export async function readZipEntry(source: ByteSource, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new ZipError('encrypted');
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError('unsupported');
  // The local header repeats the name and has its own "extra" field, whose length can
  // differ from the central directory's, so read it to find where the data starts.
  const header = await source.read(entry.localHeaderOffset, 30);
  const view = viewOf(header);
  if (header.length < 30 || view.getUint32(0, true) !== LOCAL_SIGNATURE) throw new ZipError('damaged');
  const dataOffset = entry.localHeaderOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const raw = await source.read(dataOffset, entry.compressedSize);
  if (raw.length < entry.compressedSize) throw new ZipError('damaged');
  if (entry.method === 0) return raw;
  try {
    return inflateSync(raw, { out: new Uint8Array(entry.size) });
  } catch {
    throw new ZipError('damaged');
  }
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
      entries.push({
        name,
        method: view.getUint16(at + 10, true),
        compressedSize: view.getUint32(at + 20, true),
        size: view.getUint32(at + 24, true),
        localHeaderOffset: view.getUint32(at + 42, true),
        encrypted: (flags & 1) !== 0,
      });
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
