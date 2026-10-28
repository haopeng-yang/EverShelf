import type { Chapter, Id } from '../models/types';
import { readChapterText } from '../storage/bookFiles';

/** Characters of context shown on each side of a match. */
const CONTEXT = 30;

export interface SearchMatch {
  chapterIndex: number;
  paragraph: number;
  /** Text around the match, split so the match itself can be highlighted. */
  before: string;
  match: string;
  after: string;
}

/** Finds each paragraph containing `query` (case-insensitive); one result per paragraph. */
export function findInParagraphs(
  paragraphs: string[],
  query: string,
  chapterIndex: number,
  limit = Infinity,
): SearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SearchMatch[] = [];
  for (const [paragraph, text] of paragraphs.entries()) {
    if (results.length >= limit) break;
    const at = text.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    const start = Math.max(0, at - CONTEXT);
    const end = Math.min(text.length, at + needle.length + CONTEXT);
    results.push({
      chapterIndex,
      paragraph,
      before: (start > 0 ? '…' : '') + text.slice(start, at),
      match: text.slice(at, at + needle.length),
      after: text.slice(at + needle.length, end) + (end < text.length ? '…' : ''),
    });
  }
  return results;
}

/**
 * Searches every chapter, one file at a time, reporting results as they are
 * found. Stops at `limit` results, or when isCancelled() returns true (e.g. the
 * search text changed). Resolves to whether the limit was reached.
 */
export async function searchBook(
  itemId: Id,
  chapters: Chapter[],
  query: string,
  limit: number,
  onResults: (results: SearchMatch[]) => void,
  isCancelled: () => boolean,
): Promise<boolean> {
  let found = 0;
  for (const [index, chapter] of chapters.entries()) {
    if (isCancelled()) return false;
    const text = await readChapterText(itemId, chapter.fileName);
    if (!text || isCancelled()) continue;
    const results = findInParagraphs(text.split('\n').filter(Boolean), query, index, limit - found);
    if (results.length > 0) {
      found += results.length;
      onResults(results);
    }
    if (found >= limit) return true;
  }
  return false;
}
