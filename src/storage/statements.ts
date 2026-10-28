import type { BackupBook } from '../models/backup';
import type { ShelfAction } from '../models/shelfReducer';
import type { Bookmark, Chapter, Id, Item, ReadingProgress, Shelf, ShelfState } from '../models/types';
import { chapterToRow, itemToRow, shelfToRow, tagToRow } from './rows';
import { INSERT_BOOKMARK, SET_FINISHED, UPSERT_PROGRESS } from './schema';

export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params: SqlValue[];
}

/**
 * The SQL that saves one action, given the state *after* the reducer ran.
 * Only called for actions that changed the state.
 *
 * Updates use UPDATE rather than INSERT OR REPLACE: REPLACE deletes the old
 * row first, which would cascade-delete a shelf's items or an item's tags.
 */
export function statementsForAction(action: ShelfAction, next: ShelfState): Statement[] {
  switch (action.type) {
    case 'shelf/add': {
      const index = next.shelves.findIndex((s) => s.id === action.shelf.id);
      return index === -1 ? [] : [insertShelf(next.shelves[index], index)];
    }

    case 'shelf/rename':
    case 'shelf/setDefaultTags':
    case 'shelf/setLock': {
      const index = next.shelves.findIndex((s) => s.id === action.shelfId);
      return index === -1 ? [] : [updateShelf(next.shelves[index], index)];
    }

    case 'shelf/move':
      return next.shelves.map((s, index) => ({
        sql: 'UPDATE shelves SET position = ? WHERE id = ?',
        params: [index, s.id],
      }));

    case 'shelf/remove':
      return [{ sql: 'DELETE FROM shelves WHERE id = ?', params: [action.shelfId] }];

    case 'item/add': {
      const item = next.items.find((i) => i.id === action.item.id);
      return item ? insertItem(item) : [];
    }

    case 'item/update': {
      const item = next.items.find((i) => i.id === action.itemId);
      if (!item) return [];
      return [
        {
          sql: 'UPDATE items SET title = ?, cover_uri = ?, updated_at = ? WHERE id = ?',
          params: [item.title, item.coverUri, item.updatedAt, item.id],
        },
      ];
    }

    case 'item/save': {
      const item = next.items.find((i) => i.id === action.item.id);
      if (!item) return [];
      return [
        {
          sql: 'UPDATE items SET title = ?, cover_uri = ?, updated_at = ? WHERE id = ?',
          params: [item.title, item.coverUri, item.updatedAt, item.id],
        },
        { sql: 'DELETE FROM tags WHERE item_id = ?', params: [item.id] },
        ...insertTags(item),
      ];
    }

    case 'item/remove':
      return [{ sql: 'DELETE FROM items WHERE id = ?', params: [action.itemId] }];

    case 'tag/add':
    case 'tag/update':
    case 'tag/move':
    case 'tag/remove': {
      // An item has only a handful of tags, so rewriting them all keeps
      // positions correct without per-action bookkeeping.
      const item = next.items.find((i) => i.id === action.itemId);
      if (!item) return [];
      return [
        { sql: 'UPDATE items SET updated_at = ? WHERE id = ?', params: [item.updatedAt, item.id] },
        { sql: 'DELETE FROM tags WHERE item_id = ?', params: [item.id] },
        ...insertTags(item),
      ];
    }

    case 'state/replace':
      return [{ sql: 'DELETE FROM shelves', params: [] }, ...insertState(next)];
  }
}

/** Inserts a whole state into empty tables (first-run seeding and imports). */
export function insertState(state: ShelfState): Statement[] {
  return [
    ...state.shelves.map((s, index) => insertShelf(s, index)),
    ...state.items.flatMap(insertItem),
  ];
}

/**
 * Replaces a book's chapter list. Removing the old chapters also clears the
 * book's reading progress (it points at a chapter that no longer exists).
 */
export function replaceChapters(itemId: Id, chapters: Chapter[]): Statement[] {
  return [
    { sql: 'DELETE FROM chapters WHERE item_id = ?', params: [itemId] },
    ...chapters.map((chapter) => {
      const row = chapterToRow(chapter);
      return {
        sql: 'INSERT INTO chapters (id, item_id, position, title, file_name, char_count) VALUES (?, ?, ?, ?, ?, ?)',
        params: [row.id, row.item_id, row.position, row.title, row.file_name, row.char_count],
      };
    }),
  ];
}

/** Saves the reading position. Whether the book is finished is kept as it was. */
export function saveProgressStatement(progress: Omit<ReadingProgress, 'finishedAt'>): Statement {
  return {
    sql: UPSERT_PROGRESS,
    params: [progress.itemId, progress.chapterId, progress.paragraph, progress.percent, progress.updatedAt],
  };
}

export function insertBookmarkStatement(bookmark: Bookmark): Statement {
  return {
    sql: INSERT_BOOKMARK,
    params: [bookmark.id, bookmark.itemId, bookmark.chapterId, bookmark.paragraph, bookmark.excerpt, bookmark.createdAt],
  };
}

function insertShelf(shelf: Shelf, position: number): Statement {
  const row = shelfToRow(shelf, position);
  return {
    sql: 'INSERT INTO shelves (id, name, position, default_tag_names, lock_salt, lock_hash) VALUES (?, ?, ?, ?, ?, ?)',
    params: [row.id, row.name, row.position, row.default_tag_names, row.lock_salt, row.lock_hash],
  };
}

function updateShelf(shelf: Shelf, position: number): Statement {
  const row = shelfToRow(shelf, position);
  return {
    sql: 'UPDATE shelves SET name = ?, position = ?, default_tag_names = ?, lock_salt = ?, lock_hash = ? WHERE id = ?',
    params: [row.name, row.position, row.default_tag_names, row.lock_salt, row.lock_hash, row.id],
  };
}

function insertItem(item: Item): Statement[] {
  const row = itemToRow(item);
  return [
    {
      sql: 'INSERT INTO items (id, shelf_id, title, cover_uri, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      params: [row.id, row.shelf_id, row.title, row.cover_uri, row.created_at, row.updated_at],
    },
    ...insertTags(item),
  ];
}

function insertTags(item: Item): Statement[] {
  return item.tags.map((tag, index) => {
    const row = tagToRow(item.id, tag, index);
    return {
      sql: 'INSERT INTO tags (id, item_id, name, value, position) VALUES (?, ?, ?, ?, ?)',
      params: [row.id, row.item_id, row.name, row.value, row.position],
    };
  });
}

/** See setBookFinished in database.ts. */
export function finishedStatements(itemId: Id, finished: boolean, lastChapterId: Id, now: number): Statement[] {
  if (!finished) return [{ sql: SET_FINISHED, params: [null, itemId] }];
  return [
    {
      sql: 'INSERT OR IGNORE INTO reading_progress (item_id, chapter_id, paragraph, percent, updated_at) VALUES (?, ?, 0, 1, ?)',
      params: [itemId, lastChapterId, now],
    },
    { sql: SET_FINISHED, params: [now, itemId] },
  ];
}

/**
 * Saves one book from a backup: its chapters (files are written separately),
 * reading position, finished state and bookmarks. `fileName` gives each
 * chapter's file name from its position.
 */
export function restoreBookStatements(book: BackupBook, fileName: (position: number) => string): Statement[] {
  const chapters: Chapter[] = book.chapters.map((c, position) => ({
    id: c.id,
    itemId: book.itemId,
    position,
    title: c.title,
    fileName: fileName(position),
    charCount: c.text.length,
  }));
  const statements = replaceChapters(book.itemId, chapters);
  const progress = book.progress;
  if (progress) {
    statements.push(saveProgressStatement({ ...progress, itemId: book.itemId }));
    if (progress.finishedAt !== null) {
      statements.push(...finishedStatements(book.itemId, true, progress.chapterId, progress.finishedAt));
    }
  }
  for (const bookmark of book.bookmarks) statements.push(insertBookmarkStatement({ ...bookmark, itemId: book.itemId }));
  return statements;
}
