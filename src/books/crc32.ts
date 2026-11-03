// CRC-32 (the checksum ZIP files use), worked out in parts so a big file can
// be checked while it is copied, a chunk at a time.

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC of nothing; pass it to the first updateCrc32 call. */
export const CRC32_START = 0;

/** The CRC of `crc`'s bytes followed by `bytes`. */
export function updateCrc32(crc: number, bytes: Uint8Array): number {
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  return updateCrc32(CRC32_START, bytes);
}
