import type { SQLiteDatabase } from 'expo-sqlite';

import { backupFileName, createBackup, type BackupBook, type ParsedBackup } from '../models/backup';
import type { Id, Item, ShelfState } from '../models/types';
import { shareBackupFile } from './backupFiles';
import { chapterFileName, deleteBookFiles, pruneBooks, readChapterText, writeChapterText } from './bookFiles';
import { readCoverAsDataUri, writeCoverFromDataUri } from './covers';
import { loadBookItemIds, loadBookmarks, loadChapters, loadProgress, runStatements } from './database';
import { restoreBookStatements } from './statements';

/**
 * Builds a backup of everything, covers included, and hands it to the share
 * sheet / download. With includeBooks, imported books' text, reading position
 * and bookmarks go in too (a much bigger file).
 */
export async function exportBackup(db: SQLiteDatabase, state: ShelfState, includeBooks: boolean): Promise<void> {
  const covers = new Map<Id, string>();
  for (const item of state.items) {
    if (!item.coverUri) continue;
    const dataUri = await readCoverAsDataUri(item.coverUri);
    if (dataUri) covers.set(item.id, dataUri);
  }
  const books = includeBooks ? await collectBooks(db, state) : null;
  const now = new Date();
  await shareBackupFile(backupFileName(now), JSON.stringify(createBackup(state, covers, now, books)));
}

async function collectBooks(db: SQLiteDatabase, state: ShelfState): Promise<BackupBook[]> {
  const bookIds = await loadBookItemIds(db);
  const books: BackupBook[] = [];
  for (const item of state.items) {
    if (!bookIds.has(item.id)) continue;
    const [chapters, progress, bookmarks] = await Promise.all([
      loadChapters(db, item.id),
      loadProgress(db, item.id),
      loadBookmarks(db, item.id),
    ]);
    const withText = [];
    for (const chapter of chapters) {
      // A missing file becomes an empty chapter, so the rest of the book still restores.
      const text = (await readChapterText(item.id, chapter.fileName)) ?? '';
      withText.push({ id: chapter.id, title: chapter.title, text });
    }
    books.push({
      itemId: item.id,
      chapters: withText,
      progress: progress && {
        chapterId: progress.chapterId,
        paragraph: progress.paragraph,
        percent: progress.percent,
        updatedAt: progress.updatedAt,
        finishedAt: progress.finishedAt,
      },
      bookmarks: bookmarks.map(({ itemId: _itemId, ...bookmark }) => bookmark),
    });
  }
  return books;
}

/** Saves a parsed backup's covers into app storage and returns the state to load. */
export async function restoreBackupCovers(backup: ParsedBackup): Promise<ShelfState> {
  const items: Item[] = [];
  for (const item of backup.state.items) {
    const dataUri = backup.covers.get(item.id);
    let coverUri: string | null = null;
    if (dataUri) {
      try {
        coverUri = await writeCoverFromDataUri(dataUri);
      } catch (error) {
        console.warn('Skipping unreadable cover for', item.title, error);
      }
    }
    items.push({ ...item, coverUri });
  }
  return { ...backup.state, items };
}

/**
 * Writes a backup's books back: chapter files, then their rows. Must run after
 * the backup's items are saved, since chapters belong to items. Book folders
 * not in the backup are deleted. Returns how many books were restored; a book
 * that fails is skipped (and logged) so the others still restore.
 */
export async function restoreBackupBooks(db: SQLiteDatabase, backup: ParsedBackup): Promise<number> {
  const restored = new Set<Id>();
  for (const book of backup.books) {
    try {
      deleteBookFiles(book.itemId);
      for (const [position, chapter] of book.chapters.entries()) {
        await writeChapterText(book.itemId, chapterFileName(position), chapter.text);
      }
      await runStatements(db, restoreBookStatements(book, chapterFileName));
      restored.add(book.itemId);
    } catch (error) {
      console.warn('Could not restore book', book.itemId, error);
      deleteBookFiles(book.itemId);
    }
  }
  pruneBooks(restored);
  return restored.size;
}
