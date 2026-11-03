import { getLocales } from 'expo-localization';
import type { SQLiteDatabase } from 'expo-sqlite';

import { languageFromCode } from '../i18n';
import { createDefaultState } from '../models/defaults';
import {
  DEFAULT_READING_MODE,
  type BookInfo,
  type Bookmark,
  type BookSummary,
  type Chapter,
  type FileKind,
  type Id,
  type Page,
  type ReadingMode,
  type ReadingProgress,
  type ShelfState,
  type Track,
  type Video,
  type VideoSummary,
} from '../models/types';
import {
  rowsToState,
  rowToBookInfo,
  rowToBookmark,
  rowToBookSummary,
  rowToChapter,
  rowToPage,
  rowToProgress,
  rowToFileKind,
  rowToTrack,
  rowToVideo,
  rowToVideoSummary,
  type VideoRow,
  type VideoSummaryRow,
  type BookInfoRow,
  type BookmarkRow,
  type BookSummaryRow,
  type ChapterRow,
  type FileKindRow,
  type ItemRow,
  type PageRow,
  type ProgressRow,
  type ShelfBookKindRow,
  type ShelfRow,
  type TagRow,
  type TrackRow,
} from './rows';
import {
  CREATE_TABLES_V1,
  CREATE_TABLES_V2,
  CREATE_TABLES_V3,
  DELETE_BOOKMARK,
  MIGRATE_V4,
  MIGRATE_V5,
  MIGRATE_V6,
  MIGRATE_V8,
  MIGRATE_V10,
  migrateV11,
  migrateV12,
  SET_AUDIO_CHOICE,
  SET_SUBTITLE_CHOICE,
  SET_VIDEO_FINISHED,
  SCHEMA_VERSION,
  FINISH_VIDEO,
  SAVE_WATCH_POSITION,
  SELECT_VIDEO,
  SELECT_VIDEO_SUMMARIES,
  SET_VIDEO_DURATION,
  SET_READING_MODE,
  SELECT_BOOK_INFO,
  SELECT_BOOK_ITEM_IDS,
  SELECT_BOOK_SUMMARIES,
  SELECT_BOOKMARKS,
  SELECT_CHAPTERS,
  SELECT_FILE_KINDS,
  SELECT_ITEMS,
  SELECT_PAGES,
  SELECT_PROGRESS,
  SELECT_SETTINGS,
  SELECT_SHELF_BOOK_KINDS,
  SELECT_SHELVES,
  SELECT_TAGS,
  SELECT_TRACK,
  SELECT_TRACKS,
  SELECT_PLAYBACK_POSITION,
  SET_TRACK_DURATION,
  UPSERT_PLAYBACK_POSITION,
  COUNT_PLAY,
  shelfKindColumn,
  shelfLockRepair,
  UPSERT_SETTING,
} from './schema';
import {
  finishedStatements,
  insertBookmarkStatement,
  insertTrackStatement,
  insertVideoStatement,
  insertState,
  replaceChapters,
  saveComicStatements,
  saveProgressStatement,
  shelfKindStatements,
  type Statement,
} from './statements';

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
    if (version < 5) {
      await db.execAsync(MIGRATE_V5);
    }
    if (version < 6) {
      await db.execAsync(MIGRATE_V6);
    }
    if (version < 7) {
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(shelves)');
      for (const sql of shelfLockRepair(columns.map((c) => c.name))) await db.execAsync(sql);
    }
    if (version < 8) {
      await db.execAsync(MIGRATE_V8);
    }
    if (version < 9) {
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(shelves)');
      for (const sql of shelfKindColumn(columns.map((c) => c.name))) await db.execAsync(sql);
      const rows = await db.getAllAsync<ShelfBookKindRow>(SELECT_SHELF_BOOK_KINDS);
      for (const s of shelfKindStatements(rows)) await db.runAsync(s.sql, s.params);
    }
    if (version < 10) {
      await db.execAsync(MIGRATE_V10);
    }
    if (version < 11) {
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(playback_progress)');
      for (const sql of migrateV11(columns.map((c) => c.name))) await db.execAsync(sql);
    }
    if (version < 12) {
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(videos)');
      for (const sql of migrateV12(columns.map((c) => c.name))) await db.execAsync(sql);
    }
    // Future upgrades go here: if (version < 13) { ... }

    // Seed the starting shelves only on a fresh install, so shelves the user
    // deletes later don't come back. They're named in the phone's language.
    // This runs after every upgrade, because the inserts use the newest columns.
    if (version < 1) {
      const language = languageFromCode(getLocales()[0]?.languageCode);
      for (const s of insertState(createDefaultState(language))) await db.runAsync(s.sql, s.params);
    }
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

/** What kind of file each item with one is (novel, comic or song). Manual entries aren't in the map. */
export async function loadFileKinds(db: SQLiteDatabase): Promise<Map<Id, FileKind>> {
  const rows = await db.getAllAsync<FileKindRow>(SELECT_FILE_KINDS);
  return new Map(rows.map((row) => [row.item_id, rowToFileKind(row)]));
}

/** A song's stored file and track info, or null if the item isn't a song. */
export async function loadTrack(db: SQLiteDatabase, itemId: Id): Promise<Track | null> {
  const row = await db.getFirstAsync<TrackRow>(SELECT_TRACK, [itemId]);
  return row ? rowToTrack(row) : null;
}

/** Every song's track info, by item id. */
export async function loadTracks(db: SQLiteDatabase): Promise<Map<Id, Track>> {
  const rows = await db.getAllAsync<TrackRow>(SELECT_TRACKS);
  return new Map(rows.map((row) => [row.item_id, rowToTrack(row)]));
}

/** Saves a length the player found out, for songs whose file didn't say. */
export async function setTrackDuration(db: SQLiteDatabase, itemId: Id, durationMs: number): Promise<void> {
  await db.runAsync(SET_TRACK_DURATION, [Math.round(durationMs), itemId]);
}

/** Where a song was stopped, in ms, or null if it never was. */
export async function loadPlaybackPosition(db: SQLiteDatabase, itemId: Id): Promise<number | null> {
  const row = await db.getFirstAsync<{ position_ms: number }>(SELECT_PLAYBACK_POSITION, [itemId]);
  return row?.position_ms ?? null;
}

export async function savePlaybackPosition(db: SQLiteDatabase, itemId: Id, positionMs: number): Promise<void> {
  await db.runAsync(UPSERT_PLAYBACK_POSITION, [itemId, Math.round(positionMs), Date.now()]);
}

/** Counts a play of the song, for "Most played" later. */
export async function countPlay(db: SQLiteDatabase, itemId: Id): Promise<void> {
  const now = Date.now();
  await db.runAsync(COUNT_PLAY, [itemId, now, now]);
}

/** A video's stored file and info, or null if the item isn't a video. */
export async function loadVideo(db: SQLiteDatabase, itemId: Id): Promise<Video | null> {
  const row = await db.getFirstAsync<VideoRow>(SELECT_VIDEO, [itemId]);
  return row ? rowToVideo(row) : null;
}

/** Every video's length and watching progress, by item id. */
export async function loadVideoSummaries(db: SQLiteDatabase): Promise<Map<Id, VideoSummary>> {
  const rows = await db.getAllAsync<VideoSummaryRow>(SELECT_VIDEO_SUMMARIES);
  return new Map(rows.map((row) => [row.item_id, rowToVideoSummary(row)]));
}

export async function saveVideo(db: SQLiteDatabase, video: Video): Promise<void> {
  const s = insertVideoStatement(video);
  await db.runAsync(s.sql, s.params);
}

/** Saves a length the player found out, for videos whose file didn't say. */
export async function setVideoDuration(db: SQLiteDatabase, itemId: Id, durationMs: number): Promise<void> {
  await db.runAsync(SET_VIDEO_DURATION, [Math.round(durationMs), itemId]);
}

/** Saves where a video was stopped, in ms. */
export async function saveWatchPosition(db: SQLiteDatabase, itemId: Id, positionMs: number): Promise<void> {
  const now = Date.now();
  await db.runAsync(SAVE_WATCH_POSITION, [itemId, Math.round(positionMs), now, now]);
}

/** Marks a video watched or not watched by hand. Marking it watched also moves it back to the start. */
export async function setVideoFinished(db: SQLiteDatabase, itemId: Id, finished: boolean): Promise<void> {
  const now = Date.now();
  await db.runAsync(SET_VIDEO_FINISHED, [itemId, now, finished ? now : null]);
}

/** Remembers the subtitle or audio track picked for a video (a trackKey, or TRACK_OFF for no subtitles). */
export async function saveTrackChoice(db: SQLiteDatabase, itemId: Id, kind: 'subtitle' | 'audio', choice: string): Promise<void> {
  await db.runAsync(kind === 'subtitle' ? SET_SUBTITLE_CHOICE : SET_AUDIO_CHOICE, [choice, itemId]);
}

/** A video was played to the end: marks it watched and counts a play. */
export async function finishVideo(db: SQLiteDatabase, itemId: Id): Promise<void> {
  const now = Date.now();
  await db.runAsync(FINISH_VIDEO, [itemId, now, now, now]);
}

export async function saveTrack(db: SQLiteDatabase, track: Track): Promise<void> {
  const s = insertTrackStatement(track);
  await db.runAsync(s.sql, s.params);
}

/** Whether a book is text or a comic, and how a comic is read. Books with nothing stored are text. */
export async function loadBookInfo(db: SQLiteDatabase, itemId: Id): Promise<BookInfo> {
  const row = await db.getFirstAsync<BookInfoRow>(SELECT_BOOK_INFO, [itemId]);
  return row ? rowToBookInfo(row) : { itemId, kind: 'text', readingMode: DEFAULT_READING_MODE };
}

/** Saves a whole comic: kind and reading mode, chapters and pages, replacing what was there. */
export async function saveComic(db: SQLiteDatabase, info: BookInfo, chapters: Chapter[], pages: Page[]): Promise<void> {
  await runStatements(db, saveComicStatements(info, chapters, pages));
}

export async function setReadingMode(db: SQLiteDatabase, itemId: Id, readingMode: ReadingMode): Promise<void> {
  await db.runAsync(SET_READING_MODE, [readingMode, itemId]);
}

/** Every page of a comic in reading order. Empty for a novel. */
export async function loadPages(db: SQLiteDatabase, itemId: Id): Promise<Page[]> {
  const rows = await db.getAllAsync<PageRow>(SELECT_PAGES, [itemId]);
  return rows.map(rowToPage);
}

export async function loadProgress(db: SQLiteDatabase, itemId: Id): Promise<ReadingProgress | null> {
  const row = await db.getFirstAsync<ProgressRow>(SELECT_PROGRESS, [itemId]);
  return row ? rowToProgress(row) : null;
}

export async function saveProgress(db: SQLiteDatabase, progress: Omit<ReadingProgress, 'finishedAt'>): Promise<void> {
  const s = saveProgressStatement(progress);
  await db.runAsync(s.sql, s.params);
}

/** Progress for every book, for badges, the Continue reading row and sorting. */
export async function loadBookSummaries(db: SQLiteDatabase): Promise<Map<Id, BookSummary>> {
  const rows = await db.getAllAsync<BookSummaryRow>(SELECT_BOOK_SUMMARIES);
  return new Map(rows.map((row) => [row.item_id, rowToBookSummary(row)]));
}

/**
 * Marks a book finished (or not). A book that was never opened gets a
 * position at its last chapter first, since finished is kept with the position.
 */
export async function setBookFinished(
  db: SQLiteDatabase,
  itemId: Id,
  finished: boolean,
  lastChapterId: Id,
): Promise<void> {
  await runStatements(db, finishedStatements(itemId, finished, lastChapterId, Date.now()));
}

export async function loadBookmarks(db: SQLiteDatabase, itemId: Id): Promise<Bookmark[]> {
  const rows = await db.getAllAsync<BookmarkRow>(SELECT_BOOKMARKS, [itemId]);
  return rows.map(rowToBookmark);
}

export async function addBookmark(db: SQLiteDatabase, bookmark: Bookmark): Promise<void> {
  const s = insertBookmarkStatement(bookmark);
  await db.runAsync(s.sql, s.params);
}

export async function removeBookmark(db: SQLiteDatabase, bookmarkId: Id): Promise<void> {
  await db.runAsync(DELETE_BOOKMARK, [bookmarkId]);
}

/** Runs statements together so a change is saved completely or not at all. */
export async function runStatements(db: SQLiteDatabase, statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const s of statements) await db.runAsync(s.sql, s.params);
  });
}
