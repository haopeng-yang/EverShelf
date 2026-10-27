// SQL for the on-device database. Kept free of expo-sqlite imports so tests can
// run the same SQL against Node's built-in SQLite.

/** Bump this and add a step in database.ts `migrate` whenever the tables change. */
export const SCHEMA_VERSION = 1;

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

export const SELECT_SHELVES = 'SELECT id, name, position, default_tag_names FROM shelves ORDER BY position, rowid';
export const SELECT_ITEMS =
  'SELECT id, shelf_id, title, cover_uri, created_at, updated_at FROM items ORDER BY created_at, rowid';
export const SELECT_TAGS = 'SELECT id, item_id, name, value, position FROM tags ORDER BY item_id, position';
