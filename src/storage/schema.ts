// SQL for the on-device database. Kept free of expo-sqlite imports so tests can
// run the same SQL against Node's built-in SQLite.

/** Bump this and add a step in database.ts `migrate` whenever the tables change. */
export const SCHEMA_VERSION = 7;

export const CREATE_TABLES_V1 = `
CREATE TABLE shelves (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  default_tag_names TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE items (
  id TEXT PRIMARY KEY NOT NULL,
  shelf_id TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  cover_uri TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX items_shelf_id ON items(shelf_id);
CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX tags_item_id ON tags(item_id);
`;

/** Version 2: app preferences such as theme and sort order, as key/value text. */
export const CREATE_TABLES_V2 = `
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

/**
 * Version 3: books. An item with chapters is a readable book; chapter text is
 * stored in files, not here. Both tables cascade when the item is deleted.
 */
export const CREATE_TABLES_V3 = `
CREATE TABLE chapters (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  char_count INTEGER NOT NULL
);
CREATE INDEX chapters_item_id ON chapters(item_id, position);
CREATE TABLE reading_progress (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  scroll_offset REAL NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/**
 * Version 4: progress is a paragraph number, not a pixel offset. Nothing had
 * been saved in pixels yet (there was no reader), so old values are cleared.
 */
export const MIGRATE_V4 = `
ALTER TABLE reading_progress RENAME COLUMN scroll_offset TO paragraph;
UPDATE reading_progress SET paragraph = 0;
`;

/**
 * Version 5: how far through the book the reader is (0–1, for progress
 * badges), when it was marked finished, and bookmarks.
 */
export const MIGRATE_V5 = `
ALTER TABLE reading_progress ADD COLUMN percent REAL NOT NULL DEFAULT 0;
ALTER TABLE reading_progress ADD COLUMN finished_at INTEGER;
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  paragraph INTEGER NOT NULL,
  excerpt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX bookmarks_item_id ON bookmarks(item_id);
`;

/** Version 6: an optional password per shelf, kept as a salted hash. */
export const MIGRATE_V6 = `
ALTER TABLE shelves ADD COLUMN lock_salt TEXT;
ALTER TABLE shelves ADD COLUMN lock_hash TEXT;
`;

/**
 * Version 7 repairs databases marked version 6 without the lock columns (this
 * happened while developing with live reload: the version number changed
 * before the step that adds the columns existed). Given the shelves table's
 * column names, returns the statements that add whichever are missing.
 */
export function shelfLockRepair(existingColumns: string[]): string[] {
  return ['lock_salt', 'lock_hash']
    .filter((column) => !existingColumns.includes(column))
    .map((column) => `ALTER TABLE shelves ADD COLUMN ${column} TEXT`);
}

/** One row per book (item with chapters), with its progress if it has been opened. */
export const SELECT_BOOK_SUMMARIES = `
SELECT c.item_id, COUNT(*) AS chapter_count, p.chapter_id, p.percent, p.updated_at, p.finished_at
FROM chapters c LEFT JOIN reading_progress p ON p.item_id = c.item_id
GROUP BY c.item_id`;
export const SELECT_BOOKMARKS =
  'SELECT id, item_id, chapter_id, paragraph, excerpt, created_at FROM bookmarks WHERE item_id = ? ORDER BY created_at';
export const INSERT_BOOKMARK =
  'INSERT INTO bookmarks (id, item_id, chapter_id, paragraph, excerpt, created_at) VALUES (?, ?, ?, ?, ?, ?)';
export const DELETE_BOOKMARK = 'DELETE FROM bookmarks WHERE id = ?';
export const SET_FINISHED = 'UPDATE reading_progress SET finished_at = ? WHERE item_id = ?';

export const SELECT_CHAPTERS =
  'SELECT id, item_id, position, title, file_name, char_count FROM chapters WHERE item_id = ? ORDER BY position';
export const SELECT_BOOK_ITEM_IDS = 'SELECT DISTINCT item_id FROM chapters';
export const SELECT_PROGRESS =
  'SELECT item_id, chapter_id, paragraph, percent, updated_at, finished_at FROM reading_progress WHERE item_id = ?';
export const UPSERT_PROGRESS = `INSERT INTO reading_progress (item_id, chapter_id, paragraph, percent, updated_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(item_id) DO UPDATE SET chapter_id = excluded.chapter_id, paragraph = excluded.paragraph,
  percent = excluded.percent, updated_at = excluded.updated_at`;

export const SELECT_SETTINGS = 'SELECT key, value FROM settings';
export const UPSERT_SETTING =
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';

export const SELECT_SHELVES =
  'SELECT id, name, position, default_tag_names, lock_salt, lock_hash FROM shelves ORDER BY position, rowid';
export const SELECT_ITEMS =
  'SELECT id, shelf_id, title, cover_uri, created_at, updated_at FROM items ORDER BY created_at, rowid';
export const SELECT_TAGS = 'SELECT id, item_id, name, value, position FROM tags ORDER BY item_id, position';
