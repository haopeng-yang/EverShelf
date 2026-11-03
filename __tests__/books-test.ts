import { editParagraph, splitParagraphs } from '../src/books/editText';
import { bookPercent, percentLabel } from '../src/books/progress';
import { findInParagraphs } from '../src/books/searchBook';
import type { Bookmark, Chapter } from '../src/models/types';

const chapter = (position: number, charCount: number): Chapter => ({
  id: `ch${position}`,
  itemId: 'book',
  position,
  title: `Chapter ${position + 1}`,
  fileName: `${position}.txt`,
  charCount,
});

describe('bookPercent', () => {
  const chapters = [chapter(0, 100), chapter(1, 300), chapter(2, 600)];

  it('counts earlier chapters and earlier paragraphs', () => {
    expect(bookPercent(chapters, 0, null, 0)).toBe(0);
    expect(bookPercent(chapters, 1, null, 0)).toBe(0.1);
    // Paragraphs of 99 characters plus a line break each: 2 of them = 200 characters.
    const paragraphs = ['a'.repeat(99), 'b'.repeat(99), 'c'.repeat(99)];
    expect(bookPercent(chapters, 2, paragraphs, 2)).toBeCloseTo(0.6);
  });

  it('stays between 0 and 1', () => {
    expect(bookPercent([], 0, null, 0)).toBe(0);
    expect(bookPercent(chapters, 2, ['x'.repeat(5000)], 1)).toBe(1);
  });
});

describe('percentLabel', () => {
  it('rounds down, but shows a started book as at least 1%', () => {
    expect(percentLabel(0)).toBe('0%');
    expect(percentLabel(0.004)).toBe('1%');
    expect(percentLabel(0.429)).toBe('42%');
    expect(percentLabel(1)).toBe('100%');
  });
});

describe('findInParagraphs', () => {
  const paragraphs = [
    'The lighthouse keeper climbed the stairs.',
    'Nothing here.',
    `${'Long opening words that go on for a while before '.repeat(2)}the LIGHTHOUSE appears and then more words follow after it for a while.`,
    '灯塔在远处闪烁。',
  ];

  it('finds matches case-insensitively, with context around them', () => {
    const results = findInParagraphs(paragraphs, 'lighthouse', 4);
    expect(results.map((r) => r.paragraph)).toEqual([0, 2]);
    expect(results[0]).toEqual({
      chapterIndex: 4,
      paragraph: 0,
      before: 'The ',
      match: 'lighthouse',
      after: ' keeper climbed the stairs.',
    });
    expect(results[1].match).toBe('LIGHTHOUSE');
    expect(results[1].before.startsWith('…')).toBe(true);
    expect(results[1].after.endsWith('…')).toBe(true);
  });

  it('works for Chinese, respects the limit, and ignores blank searches', () => {
    expect(findInParagraphs(paragraphs, '灯塔', 0)).toHaveLength(1);
    expect(findInParagraphs(paragraphs, 'lighthouse', 0, 1)).toHaveLength(1);
    expect(findInParagraphs(paragraphs, '   ', 0)).toEqual([]);
  });
});

describe('editParagraph', () => {
  const paragraphs = ['First.', 'Secnod.', 'Third.', 'Fourth.'];
  const bookmark = (id: string, paragraph: number): Bookmark => ({
    id,
    itemId: 'book',
    chapterId: 'ch0',
    paragraph,
    excerpt: paragraphs[paragraph],
    createdAt: 1,
  });

  it('fixes a paragraph in place, updating a bookmark on it', () => {
    const edit = editParagraph(paragraphs, 1, 'Second.', [bookmark('a', 1), bookmark('b', 3)]);
    expect(edit.paragraphs).toEqual(['First.', 'Second.', 'Third.', 'Fourth.']);
    expect(edit.text).toBe('First.\nSecond.\nThird.\nFourth.');
    expect(edit.moved).toEqual([{ ...bookmark('a', 1), excerpt: 'Second.' }]);
    expect(edit.removed).toEqual([]);
  });

  it('splits a paragraph on new lines and moves later bookmarks down', () => {
    const edit = editParagraph(paragraphs, 1, 'Sec-\r\n\r\nond.', [bookmark('a', 0), bookmark('b', 3)]);
    expect(edit.paragraphs).toEqual(['First.', 'Sec-', 'ond.', 'Third.', 'Fourth.']);
    expect(edit.moved).toEqual([{ ...bookmark('b', 3), paragraph: 4 }]);
  });

  it('deletes a cleared paragraph, its bookmark, and moves later ones up', () => {
    const edit = editParagraph(paragraphs, 1, '', [bookmark('a', 1), bookmark('b', 2)]);
    expect(edit.paragraphs).toEqual(['First.', 'Third.', 'Fourth.']);
    expect(edit.removed).toEqual([bookmark('a', 1)]);
    expect(edit.moved).toEqual([{ ...bookmark('b', 2), paragraph: 1 }]);
  });

  it('reads text the same way as the reader shows it', () => {
    expect(splitParagraphs('One\n\nTwo\n')).toEqual(['One', 'Two']);
    expect(splitParagraphs(editParagraph(paragraphs, 0, 'Uno', []).text)).toEqual(['Uno', 'Secnod.', 'Third.', 'Fourth.']);
  });
});
