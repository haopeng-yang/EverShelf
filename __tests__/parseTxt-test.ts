import { decodeGbkFast, decodeText } from '../src/books/decodeText';
import { CHAPTER_LENGTH, isChapterHeading, parseTxt, titleFromFileName, unwrapParagraphs } from '../src/books/parseTxt';

describe('decodeText', () => {
  it('reads UTF-8, with or without a byte-order mark', () => {
    const bytes = new TextEncoder().encode('Hello 你好');
    expect(decodeText(bytes)).toEqual({ text: 'Hello 你好', encoding: 'utf-8' });
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]))).toEqual({ text: 'Hello 你好', encoding: 'utf-8' });
  });

  it('reads UTF-16 with a byte-order mark', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x60, 0x4f]))).toEqual({ text: 'A你', encoding: 'utf-16le' });
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x4f, 0x60]))).toEqual({ text: 'A你', encoding: 'utf-16be' });
  });

  it('falls back to GB18030 for Chinese files that are not UTF-8', () => {
    // "第一章 你好" saved as GBK
    const gbk = [0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xc4, 0xe3, 0xba, 0xc3];
    expect(decodeText(new Uint8Array(gbk))).toEqual({ text: '第一章 你好', encoding: 'gb18030' });
  });
});

describe('isChapterHeading', () => {
  it.each([
    'Chapter 1',
    'CHAPTER XII',
    'Chapter Twenty-One: The Storm',
    'Ch. 3 - Morning',
    'Part 2',
    'Prologue',
    '第一章 出发',
    '第12回',
    '第 三 卷',
    '楔子',
    '番外 一',
  ])('accepts %s', (line) => expect(isChapterHeading(line)).toBe(true));

  it.each([
    '',
    'The chapter ended quietly.',
    'Part of the plan was simple.',
    '第一次见面的时候，他们都没有说话。',
    `Chapter 1 ${'very long '.repeat(10)}`,
  ])('rejects %s', (line) => expect(isChapterHeading(line)).toBe(false));
});

describe('titleFromFileName', () => {
  it('uses the name inside 《》 or the file name', () => {
    expect(titleFromFileName('《星河》作者：某人.txt')).toBe('星河');
    expect(titleFromFileName('my_first_novel.txt')).toBe('my first novel');
  });
});

describe('unwrapParagraphs', () => {
  it('keeps one-paragraph-per-line files as they are, dropping blank lines', () => {
    expect(unwrapParagraphs('First paragraph.\n\n  Second paragraph.\nThird.')).toEqual([
      'First paragraph.',
      'Second paragraph.',
      'Third.',
    ]);
  });

  it('joins hard-wrapped lines back into paragraphs', () => {
    const line = 'This line of sample text is wrapped at roughly sixty characters';
    const paragraph = [line, line, line].join('\n');
    const text = ['CHAPTER I', '', ...Array.from({ length: 10 }, () => [paragraph, ''].join('\n'))].join('\n');
    const paragraphs = unwrapParagraphs(text);
    expect(paragraphs[0]).toBe('CHAPTER I');
    expect(paragraphs).toHaveLength(11);
    expect(paragraphs[1]).toBe([line, line, line].join(' '));
  });
});

describe('parseTxt', () => {
  it('splits on chapter headings and keeps a preface', () => {
    const text = 'A short note before the story.\n第一章 出发\n他们出发了。\n天很蓝。\n第二章 到达\n他们到了。';
    const parsed = parseTxt(text, '《旅程》.txt');
    expect(parsed.title).toBe('旅程');
    expect(parsed.rule).toBe('headings');
    expect(parsed.headingCount).toBe(2);
    expect(parsed.chapters).toEqual([
      { title: '', text: 'A short note before the story.' },
      { title: '第一章 出发', text: '他们出发了。\n天很蓝。' },
      { title: '第二章 到达', text: '他们到了。' },
    ]);
  });

  it('reads Title and Author lines and handles Windows line breaks', () => {
    const text = 'Title: The Lamp\r\nAuthor: A. Writer\r\n\r\nChapter 1\r\nIt was lit.\r\nChapter 2\r\nIt went out.';
    const parsed = parseTxt(text, 'lamp.txt');
    expect(parsed.title).toBe('The Lamp');
    expect(parsed.author).toBe('A. Writer');
    expect(parsed.chapters.map((c) => c.title)).toEqual(['', 'Chapter 1', 'Chapter 2']);
  });

  it('keeps only the book from a Project Gutenberg file', () => {
    const text = [
      'The Project Gutenberg eBook of The Lamp',
      'Title: The Lamp',
      'Author: A. Writer',
      '*** START OF THE PROJECT GUTENBERG EBOOK THE LAMP ***',
      'Chapter 1',
      'It was lit.',
      'Chapter 2',
      'It went out.',
      '*** END OF THE PROJECT GUTENBERG EBOOK THE LAMP ***',
      'Licence text.',
    ].join('\n');
    const parsed = parseTxt(text, 'pg123.txt');
    expect(parsed.title).toBe('The Lamp');
    expect(parsed.chapters).toEqual([
      { title: 'Chapter 1', text: 'It was lit.' },
      { title: 'Chapter 2', text: 'It went out.' },
    ]);
  });

  it('splits by length when there are no headings, or when asked to', () => {
    const paragraph = 'x'.repeat(1000);
    const text = Array.from({ length: 12 }, () => paragraph).join('\n');
    const parsed = parseTxt(text, 'plain.txt');
    expect(parsed.rule).toBe('length');
    expect(parsed.chapters.map((c) => c.text.replace(/\n/g, '').length)).toEqual([
      CHAPTER_LENGTH,
      CHAPTER_LENGTH,
      12000 - 2 * CHAPTER_LENGTH,
    ]);

    const withHeadings = 'Chapter 1\nOne.\nChapter 2\nTwo.';
    expect(parseTxt(withHeadings, 'a.txt', 'length').rule).toBe('length');
    expect(parseTxt(withHeadings, 'a.txt', 'length').headingCount).toBe(2);
  });
});

describe('decodeGbkFast', () => {
  it('matches the full decoder on every two-byte GBK character', () => {
    const bytes: number[] = [0x41, 0x80];
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      for (let trail = 0x40; trail <= 0xfe; trail++) if (trail !== 0x7f) bytes.push(lead, trail);
    }
    const all = new Uint8Array(bytes);
    const expected = new TextDecoder('gb18030').decode(all);
    expect(decodeGbkFast(all)).toBe(expected);
  });

  it('gives up on four-byte GB18030 and invalid bytes, so the full decoder is used', () => {
    expect(decodeGbkFast(new Uint8Array([0x81, 0x30, 0x81, 0x30]))).toBeNull();
    expect(decodeGbkFast(new Uint8Array([0xb5]))).toBeNull();
    expect(decodeGbkFast(new Uint8Array([0xff, 0x41]))).toBeNull();
  });
});
