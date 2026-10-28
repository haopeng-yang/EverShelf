import type { Chapter } from '../models/types';

/**
 * How far through the book (0–1) the start of a paragraph is, by characters:
 * every earlier chapter, plus the earlier paragraphs of this one. `paragraphs`
 * is the chapter's text if loaded; without it the chapter counts from its start.
 */
export function bookPercent(chapters: Chapter[], chapterIndex: number, paragraphs: string[] | null, paragraph: number): number {
  const total = chapters.reduce((sum, c) => sum + c.charCount, 0);
  if (total === 0 || chapterIndex < 0) return 0;
  const before = chapters.slice(0, chapterIndex).reduce((sum, c) => sum + c.charCount, 0);
  // charCount includes the line breaks between paragraphs, so count them here too.
  const within = paragraphs ? paragraphs.slice(0, paragraph).reduce((sum, p) => sum + p.length + 1, 0) : 0;
  return Math.min(1, Math.max(0, (before + within) / total));
}

/** "42%"; anything started but under 1% shows as 1%, so it doesn't look unread. */
export function percentLabel(percent: number): string {
  if (percent > 0 && percent < 0.01) return '1%';
  return `${Math.floor(percent * 100)}%`;
}
