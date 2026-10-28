import { strToU8, zipSync } from 'fflate';

import { detectFormat, hasExtension, looksLikeText } from '../src/books/detectFormat';
import { parseTxt } from '../src/books/parseTxt';

describe('detectFormat', () => {
  const text = new TextEncoder().encode('Chapter 1\nThe lamp was lit.\n');
  const zip = zipSync({ mimetype: strToU8('application/epub+zip') });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

  it('trusts a real file extension', () => {
    expect(detectFormat(text, 'novel.txt', '')).toBe('txt');
    expect(detectFormat(zip, 'novel.EPUB', '')).toBe('epub');
    expect(detectFormat(text, 'novel.pdf', '')).toBeNull();
    expect(detectFormat(zip, 'Akira v01.CBZ', '')).toBe('comic');
    expect(detectFormat(zip, 'Akira v01.zip', '')).toBe('zip');
    expect(detectFormat(zip, 'Akira v01.cbr', '')).toBeNull();
  });

  it('looks at the file itself for Android content links with no extension', () => {
    expect(hasExtension('msf:1000033298')).toBe(false);
    expect(detectFormat(text, 'msf:1000033298', '')).toBe('txt');
    expect(detectFormat(text, 'msf:1000033298', 'application/octet-stream')).toBe('txt');
    // A ZIP could be an EPUB or a comic; importBook looks inside to tell.
    expect(detectFormat(zip, 'msf:1000033298', '')).toBe('zip');
    expect(detectFormat(new Uint8Array([1, 2]), 'document:12', 'application/epub+zip')).toBe('epub');
    expect(detectFormat(png, 'msf:42', 'image/png')).toBeNull();
  });

  it('recognises GBK and UTF-16 text as text', () => {
    expect(looksLikeText(new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x0d, 0x0a]))).toBe(true);
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toBe(true);
    expect(looksLikeText(new Uint8Array([]))).toBe(false);
  });
});

describe('titles without a file name', () => {
  it('uses a short first line, but not a chapter heading or a long sentence', () => {
    expect(parseTxt('《星河》\n第一章 出发\n他们出发了。', '').title).toBe('星河');
    expect(parseTxt('The Lamp\nChapter 1\nIt was lit.', '').title).toBe('The Lamp');
    expect(parseTxt('Chapter 1\nIt was lit.', '').title).toBe('');
    expect(parseTxt(`${'A very long opening sentence '.repeat(3)}.`, '').title).toBe('');
  });
});
