import type { Chapter, Page } from '../../models/types';

// Pure helpers for the comic reader: one list of every page in the book, and
// conversions between a place in it and the saved progress.

/** A page with where it sits in the book. */
export interface BookPage extends Page {
  /** Index into the book's chapters. */
  chapterIndex: number;
  /** 0-based index among all pages of the book. */
  index: number;
}

/** Shape used when a page's size couldn't be read: a typical comic page. */
const FALLBACK_RATIO = 1.5;

/** Every page in reading order, given pages already sorted by chapter then page (as loadPages returns them). */
export function bookPages(chapters: Chapter[], pages: Page[]): BookPage[] {
  const chapterIndex = new Map(chapters.map((c, i) => [c.id, i]));
  return pages
    .filter((p) => chapterIndex.has(p.chapterId))
    .map((p, index) => ({ ...p, chapterIndex: chapterIndex.get(p.chapterId) ?? 0, index }));
}

/** Where to open the book: the saved page, or the first page. */
export function startPage(pages: BookPage[], saved: { chapterId: string; paragraph: number } | null): number {
  if (!saved) return 0;
  const inChapter = pages.filter((p) => p.chapterId === saved.chapterId);
  if (inChapter.length === 0) return 0;
  return inChapter[Math.min(Math.max(saved.paragraph, 0), inChapter.length - 1)].index;
}

/** How far through the book (0–1) a page is. The last page counts as all the way. */
export function comicPercent(index: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(1, Math.max(0, (index + 1) / total));
}

/** The first page of each chapter, by chapter index; -1 for a chapter with no pages. */
export function chapterStarts(chapterCount: number, pages: BookPage[]): number[] {
  const starts = new Array<number>(chapterCount).fill(-1);
  for (const page of pages) if (starts[page.chapterIndex] === -1) starts[page.chapterIndex] = page.index;
  return starts;
}

/** Height over width, for laying a page out before its image loads. */
export function pageRatio(page: Pick<Page, 'width' | 'height'>): number {
  return page.width > 0 && page.height > 0 ? page.height / page.width : FALLBACK_RATIO;
}

/**
 * Top offset of every page in a vertical strip `width` wide, plus the total
 * height at the end, so FlatList can jump straight to any page.
 */
export function stripOffsets(pages: Pick<Page, 'width' | 'height'>[], width: number): number[] {
  const offsets = [0];
  for (const page of pages) offsets.push(offsets[offsets.length - 1] + Math.round(width * pageRatio(page)));
  return offsets;
}
