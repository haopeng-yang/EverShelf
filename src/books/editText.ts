import type { Bookmark } from '../models/types';

/** Characters of a paragraph kept with its bookmark, for the bookmark list. */
export const BOOKMARK_EXCERPT = 80;

/** A chapter's text as the reader shows it: one paragraph per non-empty line. */
export function splitParagraphs(text: string): string[] {
  return text.split('\n').filter(Boolean);
}

export interface ParagraphEdit {
  paragraphs: string[];
  /** The chapter's text to save, and its length for the chapter's character count. */
  text: string;
  /** Bookmarks in this chapter that moved or whose paragraph changed, with their new place and excerpt. */
  moved: Bookmark[];
  /** Bookmarks whose paragraph was deleted. */
  removed: Bookmark[];
}

/**
 * Replaces one paragraph with edited text. New lines in the text split it
 * into several paragraphs; clearing it deletes the paragraph. Bookmarks after
 * it move with their paragraphs, and one on it stays on its first line.
 */
export function editParagraph(
  paragraphs: string[],
  index: number,
  edited: string,
  bookmarks: Bookmark[],
): ParagraphEdit {
  const replacement = splitParagraphs(edited.replace(/\r\n?/g, '\n'));
  const next = [...paragraphs.slice(0, index), ...replacement, ...paragraphs.slice(index + 1)];
  const shift = replacement.length - 1;
  const moved: Bookmark[] = [];
  const removed: Bookmark[] = [];
  for (const bookmark of bookmarks) {
    if (bookmark.paragraph === index) {
      if (replacement.length === 0) removed.push(bookmark);
      else moved.push({ ...bookmark, excerpt: replacement[0].slice(0, BOOKMARK_EXCERPT) });
    } else if (bookmark.paragraph > index && shift !== 0) {
      moved.push({ ...bookmark, paragraph: bookmark.paragraph + shift });
    }
  }
  return { paragraphs: next, text: next.join('\n'), moved, removed };
}
