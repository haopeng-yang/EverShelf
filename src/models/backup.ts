import { translate } from '../i18n';
import type { Bookmark, Id, Item, ReadingProgress, Shelf, ShelfState, Tag } from './types';

// A backup is one JSON file holding every shelf and item. Covers are embedded
// as data URIs ("data:image/jpeg;base64,...") so the file works on another phone.
// Since version 2 it can also hold imported books: chapter text, reading
// position and bookmarks. Version 1 files (no books) still restore.

export const BACKUP_FORMAT_VERSION = 2;

interface BackupItem extends Omit<Item, 'coverUri'> {
  cover: string | null;
}

/** One imported book. Chapters are in reading order; `text` is one paragraph per line. */
export interface BackupBook {
  itemId: Id;
  chapters: { id: Id; title: string; text: string }[];
  progress: Omit<ReadingProgress, 'itemId'> | null;
  bookmarks: Omit<Bookmark, 'itemId'>[];
}

export interface BackupFile {
  app: 'EverShelf';
  version: number;
  exportedAt: string;
  shelves: Shelf[];
  items: BackupItem[];
  /** Missing in version 1 files, and when exported without books. */
  books?: BackupBook[];
}

export interface ParsedBackup {
  /** Items have coverUri null; covers are restored separately from `covers`. */
  state: ShelfState;
  /** Item id -> cover as a data URI. */
  covers: Map<Id, string>;
  books: BackupBook[];
}

export type BackupErrorCode =
  | 'notJson'
  | 'notBackup'
  | 'newerVersion'
  | 'missingLists'
  | 'duplicateShelf'
  | 'badShelf'
  | 'badItem'
  | 'itemShelfMissing'
  | 'duplicateItem'
  | 'badTag'
  | 'badBook';

/** A problem with a backup file. `code` + `params` let screens show it in any language; `message` is English. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    readonly params: { n?: number } = {},
  ) {
    super(translate('en', `backupError.${code}`, params));
  }
}

/**
 * `covers` maps item id -> cover data URI, for items that have one.
 * `books` is left out of the file when null (a "shelf data only" backup).
 */
export function createBackup(
  state: ShelfState,
  covers: Map<Id, string>,
  exportedAt: Date,
  books: BackupBook[] | null = null,
): BackupFile {
  return {
    app: 'EverShelf',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    shelves: state.shelves,
    items: state.items.map(({ coverUri: _coverUri, ...item }) => ({ ...item, cover: covers.get(item.id) ?? null })),
    ...(books ? { books } : {}),
  };
}

/** Reads and checks a backup file. Throws BackupError with a readable message if it isn't valid. */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('notJson');
  }
  if (!isObject(data) || data.app !== 'EverShelf') throw new BackupError('notBackup');
  if (typeof data.version !== 'number' || data.version > BACKUP_FORMAT_VERSION) {
    throw new BackupError('newerVersion');
  }
  if (!Array.isArray(data.shelves) || !Array.isArray(data.items)) throw new BackupError('missingLists');

  const shelves = data.shelves.map((s, i) => parseShelf(s, i + 1));
  const shelfIds = new Set(shelves.map((s) => s.id));
  if (shelfIds.size !== shelves.length) throw new BackupError('duplicateShelf');

  const covers = new Map<Id, string>();
  const itemIds = new Set<Id>();
  const items = data.items.map((raw, i): Item => {
    const n = i + 1;
    if (!isObject(raw)) throw new BackupError('badItem', { n });
    const { id, shelfId, title, cover, tags, createdAt, updatedAt } = raw;
    if (typeof id !== 'string' || typeof shelfId !== 'string' || typeof title !== 'string') {
      throw new BackupError('badItem', { n });
    }
    if (!shelfIds.has(shelfId)) throw new BackupError('itemShelfMissing', { n });
    if (itemIds.has(id)) throw new BackupError('duplicateItem', { n });
    itemIds.add(id);
    if (!Array.isArray(tags)) throw new BackupError('badItem', { n });
    if (typeof cover === 'string' && cover.startsWith('data:image/')) covers.set(id, cover);
    const now = Date.now();
    return {
      id,
      shelfId,
      title,
      coverUri: null,
      tags: tags.map((t) => parseTag(t, n)),
      createdAt: typeof createdAt === 'number' ? createdAt : now,
      updatedAt: typeof updatedAt === 'number' ? updatedAt : now,
    };
  });

  if (data.books !== undefined && !Array.isArray(data.books)) throw new BackupError('badBook', { n: 1 });
  const books = (data.books ?? []).map((raw, i) => parseBook(raw, i + 1, itemIds));
  if (new Set(books.map((b) => b.itemId)).size !== books.length) throw new BackupError('badBook', { n: books.length });

  return { state: { shelves, items }, covers, books };
}

/**
 * Chapters must be complete, since they are the book. A reading position or
 * bookmark that doesn't fit is just dropped: losing it is better than
 * refusing the whole backup.
 */
function parseBook(raw: unknown, n: number, itemIds: Set<Id>): BackupBook {
  if (!isObject(raw) || typeof raw.itemId !== 'string' || !itemIds.has(raw.itemId) || !Array.isArray(raw.chapters)) {
    throw new BackupError('badBook', { n });
  }
  const chapters = raw.chapters.map((c) => {
    if (!isObject(c) || typeof c.id !== 'string' || typeof c.title !== 'string' || typeof c.text !== 'string') {
      throw new BackupError('badBook', { n });
    }
    return { id: c.id, title: c.title, text: c.text };
  });
  const chapterIds = new Set(chapters.map((c) => c.id));
  if (chapters.length === 0 || chapterIds.size !== chapters.length) throw new BackupError('badBook', { n });

  const p = raw.progress;
  const progress =
    isObject(p) &&
    typeof p.chapterId === 'string' &&
    chapterIds.has(p.chapterId) &&
    typeof p.paragraph === 'number' &&
    typeof p.updatedAt === 'number'
      ? {
          chapterId: p.chapterId,
          paragraph: Math.max(0, Math.floor(p.paragraph)),
          percent: typeof p.percent === 'number' ? Math.min(1, Math.max(0, p.percent)) : 0,
          updatedAt: p.updatedAt,
          finishedAt: typeof p.finishedAt === 'number' ? p.finishedAt : null,
        }
      : null;

  const bookmarks = (Array.isArray(raw.bookmarks) ? raw.bookmarks : []).flatMap((b) =>
    isObject(b) &&
    typeof b.id === 'string' &&
    typeof b.chapterId === 'string' &&
    chapterIds.has(b.chapterId) &&
    typeof b.paragraph === 'number' &&
    typeof b.excerpt === 'string' &&
    typeof b.createdAt === 'number'
      ? [{ id: b.id, chapterId: b.chapterId, paragraph: Math.max(0, Math.floor(b.paragraph)), excerpt: b.excerpt, createdAt: b.createdAt }]
      : [],
  );

  return { itemId: raw.itemId, chapters, progress, bookmarks };
}

function parseShelf(raw: unknown, n: number): Shelf {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new BackupError('badShelf', { n });
  }
  const defaults = Array.isArray(raw.defaultTagNames) ? raw.defaultTagNames : [];
  // A locked shelf stays locked after a restore. A lock that isn't readable is
  // refused rather than dropped, which would quietly unlock the shelf.
  const lock = raw.lock;
  if (lock !== undefined && !(isObject(lock) && isHex(lock.salt) && isHex(lock.hash))) {
    throw new BackupError('badShelf', { n });
  }
  return {
    id: raw.id,
    name: raw.name,
    defaultTagNames: defaults.filter((n): n is string => typeof n === 'string'),
    ...(isObject(lock) ? { lock: { salt: lock.salt as string, hash: lock.hash as string } } : {}),
  };
}

/** `n` is the 1-based number of the item the tag belongs to. */
function parseTag(raw: unknown, n: number): Tag {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.value !== 'string') {
    throw new BackupError('badTag', { n });
  }
  return { id: raw.id, name: raw.name, value: raw.value };
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]+$/i.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** e.g. "evershelf-backup-2026-10-27.json" */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `evershelf-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
