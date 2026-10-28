// Turns the raw bytes of a .txt file into a string. Novel files are often not
// UTF-8: Chinese ones are commonly saved as GBK/GB18030, and Windows tools
// sometimes write UTF-16. We trust a byte-order mark if there is one, try
// strict UTF-8 next, and fall back to GB18030 (a superset of GBK).

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
}

interface Decoder {
  decode(bytes: Uint8Array): string;
}

export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: decoder('utf-8', true).decode(bytes), encoding: 'utf-8' };
  } catch {
    // Not valid UTF-8. GB18030 decodes any byte sequence, so this never throws.
    return { text: decodeGb18030(bytes), encoding: 'gb18030' };
  }
}

function decodeGb18030(bytes: Uint8Array): string {
  try {
    // A phone's built-in decoder, if it has GB18030, is fastest.
    return new globalThis.TextDecoder('gb18030').decode(bytes);
  } catch {
    return decodeGbkFast(bytes) ?? new (fallbackTextDecoder())('gb18030', { fatal: false }).decode(bytes);
  }
}

/**
 * Decodes GBK (one- and two-byte GB18030) straight from the character table.
 * About 50× faster than the general JavaScript decoder, which matters for
 * 10 MB novels. Returns null if the file uses anything else (four-byte
 * GB18030 or invalid bytes), so the full decoder can handle it instead.
 */
export function decodeGbkFast(bytes: Uint8Array): string | null {
  const table = gbkTable();
  const out = new Uint16Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    const lead = bytes[i];
    if (lead < 0x80) {
      out[length++] = lead;
      continue;
    }
    if (lead === 0x80) {
      out[length++] = 0x20ac; // €
      continue;
    }
    const trail = bytes[i + 1];
    if (lead === 0xff || trail === undefined || trail < 0x40 || trail === 0x7f || trail === 0xff) return null;
    const code = table[(lead - 0x81) * 190 + trail - (trail < 0x7f ? 0x40 : 0x41)];
    if (code === 0) return null;
    out[length++] = code;
    i++;
  }
  // Build the string in slices; one huge String.fromCharCode call would overflow the stack.
  const parts: string[] = [];
  for (let start = 0; start < length; start += 8192) {
    parts.push(String.fromCharCode(...out.subarray(start, Math.min(start + 8192, length))));
  }
  return parts.join('');
}

let gbk: Uint16Array | null = null;

/**
 * GB18030-2022 gave 18 characters real Unicode code points (vertical
 * punctuation and a few CJK characters) that older tables, including the
 * library's, map to the private use area. pointer → code point.
 */
const GB18030_2022_CHANGES: [number, number][] = [
  [7182, 0xfe10], [7183, 0xfe12], [7184, 0xfe11], [7185, 0xfe13], [7186, 0xfe14], [7187, 0xfe15],
  [7188, 0xfe16], [7201, 0xfe17], [7202, 0xfe18], [7208, 0xfe19], [23775, 0x9fb4], [23783, 0x9fb5],
  [23788, 0x9fb6], [23789, 0x9fb7], [23795, 0x9fb8], [23812, 0x9fb9], [23829, 0x9fba], [23845, 0x9fbb],
];

/** GB18030 two-byte table: pointer → UTF-16 code unit (0 where unassigned). Every entry fits in 16 bits. */
function gbkTable(): Uint16Array {
  if (!gbk) {
    const index = encodingIndexes().gb18030 as (number | null)[];
    gbk = new Uint16Array(index.length);
    for (let i = 0; i < index.length; i++) gbk[i] = index[i] ?? 0;
    for (const [pointer, code] of GB18030_2022_CHANGES) gbk[pointer] = code;
  }
  return gbk;
}

function decoder(encoding: TextEncodingName, fatal = false): Decoder {
  // The built-in TextDecoder is much faster, but may only know UTF-8.
  const Native = globalThis.TextDecoder;
  if (Native) {
    try {
      return new Native(encoding, { fatal });
    } catch {
      // Encoding not supported natively; use the JavaScript one below.
    }
  }
  return new (fallbackTextDecoder())(encoding, { fatal });
}

type DecoderClass = new (encoding: string, options: { fatal: boolean }) => Decoder;
let fallback: DecoderClass | null = null;
let indexes: Record<string, unknown> | null = null;

/** The character tables (about 2 MB), loaded only when a file needs them. */
function encodingIndexes(): Record<string, unknown> {
  if (!indexes) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    indexes = (require('@zxing/text-encoding/cjs/encoding-indexes') as { encodingIndexes: Record<string, unknown> })
      .encodingIndexes;
  }
  return indexes;
}

/**
 * @zxing/text-encoding reads its character tables from a global when it first
 * loads, so the tables are set up first.
 */
function fallbackTextDecoder(): DecoderClass {
  if (!fallback) {
    (globalThis as Record<string, unknown>).TextEncodingIndexes = { encodingIndexes: encodingIndexes() };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fallback = (require('@zxing/text-encoding') as { TextDecoder: DecoderClass }).TextDecoder;
  }
  return fallback;
}
