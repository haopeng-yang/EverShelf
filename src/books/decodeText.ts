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
    return { text: decoder('gb18030').decode(bytes), encoding: 'gb18030' };
  }
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

/**
 * @zxing/text-encoding reads its character tables (about 2 MB) from a global
 * when it first loads, so the tables are set up first, and only when a file
 * actually needs them.
 */
function fallbackTextDecoder(): DecoderClass {
  if (!fallback) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const indexes = require('@zxing/text-encoding/cjs/encoding-indexes') as { encodingIndexes: unknown };
    (globalThis as Record<string, unknown>).TextEncodingIndexes = { encodingIndexes: indexes.encodingIndexes };
    fallback = (require('@zxing/text-encoding') as { TextDecoder: DecoderClass }).TextDecoder;
    /* eslint-enable @typescript-eslint/no-require-imports */
  }
  return fallback;
}
