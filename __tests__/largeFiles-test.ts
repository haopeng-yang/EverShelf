import { strToU8, zipSync } from 'fflate';

import { decodeText } from '../src/books/decodeText';
import { parseEpub } from '../src/books/parseEpub';
import { parseTxt } from '../src/books/parseTxt';
import { findInParagraphs } from '../src/books/searchBook';

// Large and odd files, generated here (no real books). The time limits are
// loose: a computer is several times faster than a phone, so these only catch
// something going badly wrong, like work that grows with the square of the size.

const SENTENCE = 'The quiet harbour town woke slowly under a grey and patient sky. ';

function timed<T>(label: string, work: () => T): T {
  const start = performance.now();
  const result = work();
  console.log(`${label}: ${Math.round(performance.now() - start)} ms`);
  return result;
}

describe('large files', () => {
  it('splits a ~10 MB English .txt with 2,000 chapters', () => {
    const chapter = (n: number) => `Chapter ${n}\n${Array.from({ length: 20 }, () => SENTENCE.repeat(4)).join('\n')}`;
    const text = Array.from({ length: 2000 }, (_, i) => chapter(i + 1)).join('\n');
    expect(text.length).toBeGreaterThan(9_000_000);

    const parsed = timed('parse 10 MB txt', () => parseTxt(text, 'big.txt'));
    expect(parsed.rule).toBe('headings');
    expect(parsed.chapters).toHaveLength(2000);
    expect(parsed.chapters[1999].title).toBe('Chapter 2000');
  }, 30_000);

  it('splits a long .txt with no headings by length', () => {
    const text = Array.from({ length: 30_000 }, () => SENTENCE).join('\n');
    const parsed = timed('split 2 MB by length', () => parseTxt(text, 'plain.txt'));
    expect(parsed.rule).toBe('length');
    expect(parsed.chapters.length).toBeGreaterThan(300);
    expect(parsed.chapters.every((c) => c.text.length > 0)).toBe(true);
  }, 30_000);

  it('decodes a ~2 MB GBK file', () => {
    // "第一章 你好" in GBK, repeated with line breaks.
    const unit = [0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xc4, 0xe3, 0xba, 0xc3, 0x0a];
    const bytes = new Uint8Array(unit.length * 170_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = unit[i % unit.length];

    const decoded = timed('decode 2 MB GBK (built-in decoder)', () => decodeText(bytes));
    expect(decoded.encoding).toBe('gb18030');
    expect(decoded.text.startsWith('第一章 你好\n')).toBe(true);

    // Phones may only have a UTF-8 decoder built in, so time the JavaScript one too.
    const native = globalThis.TextDecoder;
    const utf8Only = class extends native {
      constructor(label?: string, options?: TextDecoderOptions) {
        if (label && label !== 'utf-8') throw new RangeError(`Unsupported encoding ${label}`);
        super(label, options);
      }
    };
    globalThis.TextDecoder = utf8Only;
    try {
      const slow = timed('decode 2 MB GBK (no built-in GBK, as on a phone)', () => decodeText(bytes));
      expect(slow.text).toBe(decoded.text);
    } finally {
      globalThis.TextDecoder = native;
    }
  }, 60_000);

  it('opens an EPUB with 500 chapters', () => {
    const page = (n: number) =>
      `<html><body><h1>Part ${n}</h1>${Array.from({ length: 30 }, () => `<p>${SENTENCE}</p>`).join('')}</body></html>`;
    const files: Record<string, Uint8Array> = {
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
    };
    let manifest = '';
    let spine = '';
    for (let n = 1; n <= 500; n++) {
      files[`p${n}.xhtml`] = strToU8(page(n));
      manifest += `<item id="p${n}" href="p${n}.xhtml" media-type="application/xhtml+xml"/>`;
      spine += `<itemref idref="p${n}"/>`;
    }
    files['book.opf'] = strToU8(
      `<package><metadata><dc:title>Big</dc:title></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
    );

    const book = timed('parse 500-chapter epub', () => parseEpub(zipSync(files)));
    expect(book.chapters).toHaveLength(500);
    expect(book.chapters[499]).toMatchObject({ title: 'Part 500' });
  }, 30_000);

  it('searches a long chapter quickly', () => {
    const paragraphs = Array.from({ length: 50_000 }, (_, i) => (i % 1000 === 0 ? `${SENTENCE}lantern` : SENTENCE));
    const results = timed('search 50,000 paragraphs', () => findInParagraphs(paragraphs, 'LANTERN', 0));
    expect(results).toHaveLength(50);
  });
});

describe('odd files', () => {
  it('handles empty and whitespace-only text', () => {
    expect(parseTxt('', 'empty.txt').chapters).toEqual([]);
    expect(parseTxt(' \n\n \r\n', 'blank.txt').chapters).toEqual([]);
  });

  it('keeps a file of only headings as empty chapters', () => {
    const parsed = parseTxt('Chapter 1\nChapter 2\nChapter 3', 'headings.txt');
    expect(parsed.chapters.map((c) => [c.title, c.text])).toEqual([
      ['Chapter 1', ''],
      ['Chapter 2', ''],
      ['Chapter 3', ''],
    ]);
  });

  it('handles one enormous line with no line breaks', () => {
    const parsed = parseTxt(SENTENCE.repeat(20_000), 'one-line.txt');
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0].text.length).toBeGreaterThan(1_000_000);
  });
});
