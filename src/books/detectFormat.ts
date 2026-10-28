// Works out whether a picked file is a .txt or an .epub. The name alone isn't
// enough: on Android, files picked from Downloads or Recent often come back as
// a content link like "msf:1000033298", with no extension at all.

export type BookFormat = 'txt' | 'epub';

/** True if `name` ends in something that looks like a file extension, e.g. ".txt". */
export function hasExtension(name: string): boolean {
  return /\.[a-z0-9]{1,5}$/i.test(name);
}

/**
 * The extension decides when there is one; otherwise the MIME type and the
 * first bytes do. Returns null for anything that isn't a TXT or EPUB.
 */
export function detectFormat(bytes: Uint8Array, name: string, mimeType: string): BookFormat | null {
  if (hasExtension(name)) {
    const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    return extension === 'txt' ? 'txt' : extension === 'epub' ? 'epub' : null;
  }
  // An EPUB is a zip file, and every zip starts with "PK\3\4".
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip || mimeType === 'application/epub+zip') return 'epub';
  if (mimeType.startsWith('text/') || looksLikeText(bytes)) return 'txt';
  return null;
}

/**
 * Text files have no zero bytes (except UTF-16, which starts with a byte-order
 * mark) and almost no control characters; images, PDFs and the like do.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return false;
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    // Tab, line feed, form feed and carriage return are normal in text.
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) control++;
  }
  return control / sample.length < 0.01;
}
