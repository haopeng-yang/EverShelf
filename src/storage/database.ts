import { getLocales } from 'expo-localization';
import type { SQLiteDatabase } from 'expo-sqlite';

import { languageFromCode } from '../i18n';
import { createDefaultState } from '../models/defaults';
import type { Chapter, Id, ReadingProgress, ShelfState } from '../models/types';
import {
  rowsToState,
  rowToChapter,
  rowToProgress,
  type ChapterRow,
  type ItemRow,
  type ProgressRow,
  type ShelfRow,
  type TagRow,
} from './rows';
import {
  CREATE_TABLES_V1,
  CREATE_TABLES_V2,
  CREATE_TABLES_V3,
  MIGRATE_V4,
  SCHEMA_VERSION,
  SELECT_BOOK_ITEM_IDS,
  SELECT_CHAPTERS,
  SELECT_ITEMS,
  SELECT_PROGRESS,
  SELECT_SETTINGS,
  SELECT_SHELVES,
  SELECT_TAGS,
  UPSERT_SETTING,
} from './schema';
import { insertState, replaceChapters, saveProgressStatement, type Statement } from './statements';

export const DATABASE_NAME = 'evershelf.db';

/** Runs once when the database opens (SQLiteProvider onInit): creates or upgrades tables. */
export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  await db.withTransactionAsync(async () => {
    if (version < 1) {
      await db.execAsync(CREATE_TABLES_V1);
      // Seed the starting shelves only on a fresh install, so shelves the
      // user deletes later don't come back. They're named in the phone's language.
      const language = languageFromCode(getLocales()[0]?.languageCode);
      for (const s of insertState(createDefaultState(language))) await db.runAsync(s.sql, s.params);
    }
    if (version < 2) {
      await db.execAsync(CREATE_TABLES_V2);
    }
    if (version < 3) {
      await db.execAsync(CREATE_TABLES_V3);
    }
    if (version < 4) {
      await db.execAsync(MIGRATE_V4);
    }
    // Future upgrades go here: if (version < 5) { ... }
  });
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export async function loadState(db: SQLiteDatabase): Promise<ShelfState> {
  const [shelves, items, tags] = await Promise.all([
    db.getAllAsync<ShelfRow>(SELECT_SHELVES),
    db.getAllAsync<ItemRow>(SELECT_ITEMS),
    db.getAllAsync<TagRow>(SELECT_TAGS),
  ]);
  return rowsToState(shelves, items, tags);
}

export async function loadSettings(db: SQLiteDatabase): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(SELECT_SETTINGS);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function saveSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(UPSERT_SETTING, [key, value]);
}

/** A book's chapters in reading order. Empty if the item isn't a book. */
export async function loadChapters(db: SQLiteDatabase, itemId: Id): Promise<Chapter[]> {
  const rows = await db.getAllAsync<ChapterRow>(SELECT_CHAPTERS, [itemId]);
  return rows.map(rowToChapter);
}

/** Saves a book's chapter list, replacing any previous one (and its progress). */
export async function saveChapters(db: SQLiteDatabase, itemId: Id, chapters: Chapter[]): Promise<void> {
  await runStatements(db, replaceChapters(itemId, chapters));
}

/** Ids of every item that has chapters, i.e. every book. */
export async function loadBookItemIds(db: SQLiteDatabase): Promise<Set<Id>> {
  const rows = await db.getAllAsync<{ item_id: string }>(SELECT_BOOK_ITEM_IDS);
  return new Set(rows.map((r) => r.item_id));
}

export async function loadProgress(db: SQLiteDatabase, itemId: Id): Promise<ReadingProgress | null> {
  const row = await db.getFirstAsync<ProgressRow>(SELECT_PROGRESS, [itemId]);
  return row ? rowToProgress(row) : null;
}

export async function saveProgress(db: SQLiteDatabase, progress: ReadingProgress): Promise<void> {
  const s = saveProgressStatement(progress);
  await db.runAsync(s.sql, s.params);
}

/** Runs statements together so a change is saved completely or not at all. */
export async function runStatements(db: SQLiteDatabase, statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const s of statements) await db.runAsync(s.sql, s.params);
  });
}
