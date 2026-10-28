// Turns the text of a .txt novel into a title, author and chapters. Pure
// functions, so they can be tested without a phone.
//
// Chapter text is stored as one paragraph per line, with no blank lines; the
// reader shows each line as a paragraph.

export type SplitRule = 'headings' | 'length';

export interface ParsedChapter {
  /** Empty for text before the first heading (a preface or title page). */
  title: string;
  text: string;
}

export interface ParsedTxt {
  title: string;
  author: string;
  chapters: ParsedChapter[];
  /** Which rule produced the chapters ('headings' falls back to 'length' if none are found). */
  rule: SplitRule;
  /** How many chapter headings were found, whatever rule was used. */
  headingCount: number;
}

/** Chapters split by length aim for about this many characters. */
export const CHAPTER_LENGTH = 5000;

const MAX_HEADING_LENGTH = 60;
const NUMBER = String.raw`(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z]+-[a-z]+)`;
const HEADING_PATTERNS = [
  // Chapter 12, CHAPTER XII, Chapter Twenty-One: The Storm, Ch. 3, Part 2, Book IV, Volume 1
  new RegExp(String.raw`^(?:chapter|ch\.|part|book|volume|vol\.)\s+${NUMBER}\b`, 'i'),
  /^(?:prologue|epilogue|interlude|afterword|foreword|preface)\b/i,
  // 第十二章, 第12回, 第三卷, 第一百零一节
  /^第\s*[0-9０-９零〇一二两三四五六七八九十百千万]+\s*[章回节卷集部篇话]/,
  /^(?:序章|序言|楔子|引子|尾声|后记|番外)/,
];

export function isChapterHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.length > MAX_HEADING_LENGTH) return false;
  return HEADING_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Parses a whole .txt file. fileName gives the fallback title.
 * With rule 'headings', a file with fewer than two headings is split by length instead.
 */
export function parseTxt(rawText: string, fileName: string, rule: SplitRule = 'headings'): ParsedTxt {
  const normalized = normalizeLineBreaks(rawText);
  const meta = findMetadata(normalized);
  const lines = unwrapParagraphs(stripGutenbergBoilerplate(normalized));
  const headingCount = lines.filter(isChapterHeading).length;
  const useHeadings = rule === 'headings' && headingCount >= 2;
  return {
    title: meta.title || titleFromFileName(fileName),
    author: meta.author,
    chapters: useHeadings ? splitByHeadings(lines) : splitByLength(lines),
    rule: useHeadings ? 'headings' : 'length',
    headingCount,
  };
}

function normalizeLineBreaks(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** Project Gutenberg files wrap the book in a licence header and footer; keep only the book. */
function stripGutenbergBoilerplate(text: string): string {
  const start = /^\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG.*$/im.exec(text);
  const end = /^\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG.*$/im.exec(text);
  if (!start) return text;
  return text.slice(start.index + start[0].length, end && end.index > start.index ? end.index : undefined);
}

/** Looks for "Title: …" / "Author: …" (or 书名：/作者：) lines near the top of the file. */
function findMetadata(text: string): { title: string; author: string } {
  const top = text.split('\n', 80);
  const find = (pattern: RegExp) => {
    for (const line of top) {
      const match = pattern.exec(line.trim());
      if (match) return match[1].trim();
    }
    return '';
  };
  return {
    title: find(/^(?:title|书名|書名|标题)\s*[:：]\s*(.+)$/i),
    author: find(/^(?:author|作者)\s*[:：]\s*(.+)$/i),
  };
}

/** "《Dune》作者：Frank Herbert.txt" → "Dune"; "my_novel.txt" → "my novel". */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const bracketed = /《([^》]+)》/.exec(base);
  if (bracketed) return bracketed[1].trim();
  return base.replace(/[_]+/g, ' ').trim() || fileName;
}

/**
 * Returns one paragraph per entry, with blank lines dropped.
 *
 * Some files put each paragraph on one line; others (like Project Gutenberg)
 * wrap lines at ~70 characters and separate paragraphs with blank lines. In
 * the second case the wrapped lines are joined back into paragraphs.
 */
export function unwrapParagraphs(text: string): string[] {
  const lines = text.split('\n').map((line) => line.trimEnd());
  if (!looksHardWrapped(lines)) {
    return lines.map((line) => line.trim()).filter((line) => line !== '');
  }
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) paragraphs.push(current.join(' '));
    current = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') flush();
    else if (isChapterHeading(trimmed)) {
      // Keep headings on their own, even without a blank line around them.
      flush();
      paragraphs.push(trimmed);
    } else current.push(trimmed);
  }
  flush();
  return paragraphs;
}

function looksHardWrapped(lines: string[]): boolean {
  const filled = lines.filter((line) => line.trim() !== '');
  if (filled.length < 20) return false;
  const blankRatio = (lines.length - filled.length) / filled.length;
  const lengths = filled.map((line) => line.length).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)];
  const longest = lengths[Math.floor(lengths.length * 0.95)];
  // Many lines of similar, medium length, with paragraphs separated by blank lines.
  return blankRatio > 0.05 && blankRatio < 0.8 && median >= 45 && longest <= 90;
}

function splitByHeadings(paragraphs: string[]): ParsedChapter[] {
  const chapters: ParsedChapter[] = [];
  let title = '';
  let body: string[] = [];
  const flush = () => {
    // Drop empty front matter, but keep a heading even if its chapter is empty.
    if (body.length > 0 || title !== '') chapters.push({ title, text: body.join('\n') });
  };
  for (const paragraph of paragraphs) {
    if (isChapterHeading(paragraph)) {
      flush();
      title = paragraph.trim();
      body = [];
    } else body.push(paragraph);
  }
  flush();
  return chapters;
}

function splitByLength(paragraphs: string[]): ParsedChapter[] {
  const chapters: ParsedChapter[] = [];
  let body: string[] = [];
  let length = 0;
  for (const paragraph of paragraphs) {
    body.push(paragraph);
    length += paragraph.length;
    if (length >= CHAPTER_LENGTH) {
      chapters.push({ title: '', text: body.join('\n') });
      body = [];
      length = 0;
    }
  }
  if (body.length > 0) chapters.push({ title: '', text: body.join('\n') });
  return chapters;
}
