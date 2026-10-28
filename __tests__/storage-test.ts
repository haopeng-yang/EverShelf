/// <reference types="node" />
// Runs the app's real SQL against Node's built-in SQLite and checks that what
// is saved loads back exactly as the in-memory state.
import { DatabaseSync } from 'node:sqlite';

import { addItem, addShelf, addTag } from '../src/models/actions';
import { createDefaultState } from '../src/models/defaults';
import { shelfReducer, type ShelfAction } from '../src/models/shelfReducer';
import type { Chapter, Id, ShelfState } from '../src/models/types';
import {
  rowsToState,
  rowToBookmark,
  rowToBookSummary,
  rowToChapter,
  rowToProgress,
  type BookmarkRow,
  type BookSummaryRow,
  type ChapterRow,
  type ItemRow,
  type ProgressRow,
  type ShelfRow,
  type TagRow,
} from '../src/storage/rows';
import {
  CREATE_TABLES_V1,
  CREATE_TABLES_V2,
  CREATE_TABLES_V3,
  MIGRATE_V4,
  MIGRATE_V5,
  MIGRATE_V6,
  SELECT_BOOK_ITEM_IDS,
  SELECT_BOOK_SUMMARIES,
  SELECT_BOOKMARKS,
  SELECT_CHAPTERS,
  SELECT_ITEMS,
  SELECT_PROGRESS,
  SELECT_SETTINGS,
  SELECT_SHELVES,
  SELECT_TAGS,
  UPSERT_SETTING,
  shelfLockRepair,
} from '../src/storage/schema';
import {
  finishedStatements,
  insertBookmarkStatement,
  insertState,
  replaceChapters,
  restoreBookStatements,
  saveProgressStatement,
  statementsForAction,
  type Statement,
} from '../src/storage/statements';

function openTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrateAll(db);
  // Seeded after every upgrade, like migrate() in database.ts.
  run(db, insertState(createDefaultState()));
  return db;
}

function migrateAll(db: DatabaseSync) {
  db.exec(CREATE_TABLES_V1);
  db.exec(CREATE_TABLES_V2);
  db.exec(CREATE_TABLES_V3);
  db.exec(MIGRATE_V4);
  db.exec(MIGRATE_V5);
  db.exec(MIGRATE_V6);
}

function chapters(itemId: Id, titles: string[]): Chapter[] {
  return titles.map((title, position) => ({
    id: `${itemId}-ch${position}`,
    itemId,
    position,
    title,
    fileName: `${position}.txt`,
    charCount: 1000 + position,
  }));
}

function loadChapters(db: DatabaseSync, itemId: Id): Chapter[] {
  return db
    .prepare(SELECT_CHAPTERS)
    .all(itemId)
    .map((r) => rowToChapter({ ...r } as unknown as ChapterRow));
}

function loadProgress(db: DatabaseSync, itemId: Id) {
  const row = db.prepare(SELECT_PROGRESS).get(itemId);
  return row ? rowToProgress({ ...row } as unknown as ProgressRow) : null;
}

function run(db: DatabaseSync, statements: Statement[]) {
  for (const s of statements) db.prepare(s.sql).run(...s.params);
}

function load(db: DatabaseSync): ShelfState {
  // node:sqlite rows have a null prototype; spread them into plain objects.
  const all = <T,>(sql: string) => db.prepare(sql).all().map((r) => ({ ...r }) as T);
  return rowsToState(all<ShelfRow>(SELECT_SHELVES), all<ItemRow>(SELECT_ITEMS), all<TagRow>(SELECT_TAGS));
}

/** Mirrors ShelfProvider: reduce, then save only if something changed. */
function dispatch(db: DatabaseSync, state: ShelfState, action: ShelfAction): ShelfState {
  const next = shelfReducer(state, action);
  if (next !== state) run(db, statementsForAction(action, next));
  return next;
}

describe('SQLite storage', () => {
  it('a fresh database loads the default shelves', () => {
    expect(load(openTestDb())).toEqual(createDefaultState());
  });

  it('saves every kind of change and loads it back identically', () => {
    const db = openTestDb();
    let state = createDefaultState();
    const step = (action: ShelfAction) => {
      state = dispatch(db, state, action);
      expect(load(db)).toEqual(state);
    };

    step(addShelf('Funny Videos', ['Link']));
    const funny = state.shelves.at(-1)!;
    step({ type: 'shelf/rename', shelfId: funny.id, name: 'Funny Clips' });
    step({ type: 'shelf/setDefaultTags', shelfId: funny.id, defaultTagNames: ['Link', 'Platform'] });
    step({ type: 'shelf/move', shelfId: funny.id, toIndex: 1 });

    const books = state.shelves.find((s) => s.id === 'books')!;
    step(addItem(books, 'Dune', 'file:///covers/dune.jpg'));
    step(addItem(state.shelves.find((s) => s.id === funny.id)!, 'Cat video'));
    const dune = state.items[0];

    step(addTag(dune.id, 'Age Restricted', 'Recommended 15+'));
    step({ type: 'tag/update', itemId: dune.id, tagId: dune.tags[0].id, changes: { value: 'Frank Herbert' }, now: 1 });
    step({ type: 'tag/move', itemId: dune.id, tagId: dune.tags[0].id, toIndex: 3, now: 2 });
    step({ type: 'tag/remove', itemId: dune.id, tagId: dune.tags[1].id, now: 3 });
    step({ type: 'item/update', itemId: dune.id, changes: { title: 'Dune (1965)', coverUri: null }, now: 4 });
    const current = state.items.find((i) => i.id === dune.id)!;
    step({
      type: 'item/save',
      item: { ...current, title: 'Dune', tags: [{ id: 'new-tag', name: 'Rating', value: '5/5' }, current.tags[0]] },
      now: 5,
    });

    step({ type: 'shelf/remove', shelfId: funny.id });
    step({ type: 'item/remove', itemId: dune.id });
    expect(db.prepare('SELECT COUNT(*) AS n FROM tags').get()).toEqual(expect.objectContaining({ n: 0 }));
  });

  it('saves and overwrites settings', () => {
    const db = openTestDb();
    db.prepare(UPSERT_SETTING).run('themeMode', 'dark');
    db.prepare(UPSERT_SETTING).run('themeMode', 'light');
    db.prepare(UPSERT_SETTING).run('sortOrder', 'titleAsc');
    const rows = db.prepare(SELECT_SETTINGS).all().map((r) => ({ ...r }));
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: 'themeMode', value: 'light' },
        { key: 'sortOrder', value: 'titleAsc' },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('replaces the whole state', () => {
    const db = openTestDb();
    let replacement = shelfReducer({ shelves: [], items: [] }, addShelf('Games'));
    replacement = shelfReducer(replacement, addItem(replacement.shelves[0], 'Celeste'));
    const state = dispatch(db, createDefaultState(), { type: 'state/replace', state: replacement });
    expect(load(db)).toEqual(state);
  });
});

describe('Book storage', () => {
  /** A database with one item, "Dune", on the Books shelf. */
  function withBook() {
    const db = openTestDb();
    const state = dispatch(db, createDefaultState(), addItem(createDefaultState().shelves[0], 'Dune'));
    return { db, state, itemId: state.items[0].id };
  }

  it('saves chapters and loads them back in order', () => {
    const { db, itemId } = withBook();
    const saved = chapters(itemId, ['Prologue', 'Chapter 1', 'Chapter 2']);
    run(db, replaceChapters(itemId, [...saved].reverse()));
    expect(loadChapters(db, itemId)).toEqual(saved);
    expect(db.prepare(SELECT_BOOK_ITEM_IDS).all().map((r) => ({ ...r }))).toEqual([{ item_id: itemId }]);
  });

  it('replacing chapters drops the old ones and their progress', () => {
    const { db, itemId } = withBook();
    run(db, replaceChapters(itemId, chapters(itemId, ['Old 1', 'Old 2'])));
    run(db, [saveProgressStatement({ itemId, chapterId: `${itemId}-ch1`, paragraph: 10, percent: 0.5, updatedAt: 1 })]);

    const fresh = chapters(itemId, ['New']).map((c) => ({ ...c, id: 'new-ch' }));
    run(db, replaceChapters(itemId, fresh));
    expect(loadChapters(db, itemId)).toEqual(fresh);
    expect(loadProgress(db, itemId)).toBeNull();
  });

  it('saves and overwrites reading progress', () => {
    const { db, itemId } = withBook();
    run(db, replaceChapters(itemId, chapters(itemId, ['One', 'Two'])));
    run(db, [saveProgressStatement({ itemId, chapterId: `${itemId}-ch0`, paragraph: 12, percent: 0.5, updatedAt: 1 })]);
    run(db, [saveProgressStatement({ itemId, chapterId: `${itemId}-ch1`, paragraph: 40, percent: 0.5, updatedAt: 2 })]);
    expect(loadProgress(db, itemId)).toEqual({
      itemId,
      chapterId: `${itemId}-ch1`,
      paragraph: 40,
      percent: 0.5,
      updatedAt: 2,
      finishedAt: null,
    });
  });

  it('editing the item keeps its chapters; deleting it removes them', () => {
    const book = withBook();
    const { db, itemId } = book;
    const saved = chapters(itemId, ['One']);
    run(db, replaceChapters(itemId, saved));
    run(db, [saveProgressStatement({ itemId, chapterId: saved[0].id, paragraph: 0, percent: 0.5, updatedAt: 1 })]);

    const item = book.state.items[0];
    const state = dispatch(db, book.state, { type: 'item/save', item: { ...item, title: 'Dune (1965)' }, now: 5 });
    expect(loadChapters(db, itemId)).toEqual(saved);

    dispatch(db, state, { type: 'item/remove', itemId });
    expect(loadChapters(db, itemId)).toEqual([]);
    expect(loadProgress(db, itemId)).toBeNull();
  });

  it('replacing the whole state removes every book', () => {
    const { db, state, itemId } = withBook();
    run(db, replaceChapters(itemId, chapters(itemId, ['One'])));
    // A copy, as a restored backup would be: the reducer skips identical states.
    dispatch(db, state, { type: 'state/replace', state: { ...state } });
    expect(db.prepare(SELECT_BOOK_ITEM_IDS).all()).toEqual([]);
  });

  it('summarises every book with its progress, and marks books finished', () => {
    const { db, state, itemId } = withBook();
    run(db, replaceChapters(itemId, chapters(itemId, ['One', 'Two', 'Three'])));
    const summaries = () =>
      db
        .prepare(SELECT_BOOK_SUMMARIES)
        .all()
        .map((r) => rowToBookSummary({ ...r } as unknown as BookSummaryRow));

    // Opened never: no progress yet.
    expect(summaries()).toEqual([{ itemId, chapterCount: 3, percent: 0, lastReadAt: null, finished: false }]);

    run(db, [saveProgressStatement({ itemId, chapterId: `${itemId}-ch1`, paragraph: 3, percent: 0.4, updatedAt: 7 })]);
    expect(summaries()[0]).toEqual({ itemId, chapterCount: 3, percent: 0.4, lastReadAt: 7, finished: false });

    // Finishing keeps the position; saving a new position keeps "finished".
    run(db, finishedStatements(itemId, true, `${itemId}-ch2`, 9));
    expect(summaries()[0]).toMatchObject({ percent: 1, finished: true, lastReadAt: 7 });
    run(db, [saveProgressStatement({ itemId, chapterId: `${itemId}-ch0`, paragraph: 0, percent: 0, updatedAt: 10 })]);
    expect(summaries()[0]).toMatchObject({ finished: true });
    run(db, finishedStatements(itemId, false, `${itemId}-ch2`, 11));
    expect(summaries()[0]).toMatchObject({ percent: 0, finished: false, lastReadAt: 10 });

    // A book never opened can be marked finished too.
    const other = dispatch(db, state, addItem(state.shelves[0], 'Other')).items.at(-1)!.id;
    run(db, replaceChapters(other, chapters(other, ['Only'])));
    run(db, finishedStatements(other, true, `${other}-ch0`, 12));
    expect(summaries().find((s) => s.itemId === other)).toMatchObject({ percent: 1, finished: true });
  });

  it('saves bookmarks, and drops them with their chapter', () => {
    const { db, itemId } = withBook();
    run(db, replaceChapters(itemId, chapters(itemId, ['One', 'Two'])));
    const bookmark = {
      id: 'bm1',
      itemId,
      chapterId: `${itemId}-ch1`,
      paragraph: 4,
      excerpt: 'The lamp flickered.',
      createdAt: 3,
    };
    run(db, [insertBookmarkStatement(bookmark)]);
    const bookmarks = () =>
      db
        .prepare(SELECT_BOOKMARKS)
        .all(itemId)
        .map((r) => rowToBookmark({ ...r } as unknown as BookmarkRow));
    expect(bookmarks()).toEqual([bookmark]);

    run(db, replaceChapters(itemId, chapters(itemId, ['New'])));
    expect(bookmarks()).toEqual([]);
  });

  it('restores a book from a backup: chapters, progress, finished and bookmarks', () => {
    const { db, itemId } = withBook();
    run(
      db,
      restoreBookStatements(
        {
          itemId,
          chapters: [
            { id: 'r1', title: 'One', text: 'Alpha.\nBeta.' },
            { id: 'r2', title: 'Two', text: 'Gamma.' },
          ],
          progress: { chapterId: 'r2', paragraph: 0, percent: 0.7, updatedAt: 5, finishedAt: 8 },
          bookmarks: [{ id: 'bm', chapterId: 'r1', paragraph: 1, excerpt: 'Beta.', createdAt: 3 }],
        },
        (position) => `${position}.txt`,
      ),
    );
    expect(loadChapters(db, itemId).map((c) => [c.id, c.position, c.fileName, c.charCount])).toEqual([
      ['r1', 0, '0.txt', 12],
      ['r2', 1, '1.txt', 6],
    ]);
    expect(loadProgress(db, itemId)).toEqual({
      itemId,
      chapterId: 'r2',
      paragraph: 0,
      percent: 0.7,
      updatedAt: 5,
      finishedAt: 8,
    });
    expect(db.prepare(SELECT_BOOKMARKS).all(itemId)).toHaveLength(1);
  });
});

describe('Shelf locks', () => {
  it('saves, changes and removes a shelf password hash', () => {
    const db = openTestDb();
    let state = createDefaultState();
    const step = (action: ShelfAction) => {
      state = dispatch(db, state, action);
      expect(load(db)).toEqual(state);
    };
    step({ type: 'shelf/setLock', shelfId: 'books', lock: { salt: 'aa', hash: 'bb' } });
    expect(state.shelves[0].lock).toEqual({ salt: 'aa', hash: 'bb' });
    step({ type: 'shelf/rename', shelfId: 'books', name: 'Private' });
    expect(load(db).shelves[0].lock).toEqual({ salt: 'aa', hash: 'bb' });
    step({ type: 'shelf/setLock', shelfId: 'books', lock: { salt: 'cc', hash: 'dd' } });
    step({ type: 'shelf/setLock', shelfId: 'books', lock: null });
    expect('lock' in state.shelves[0]).toBe(false);
    step(addShelf('Secret'));
    step({ type: 'shelf/setLock', shelfId: state.shelves.at(-1)!.id, lock: { salt: 'ee', hash: 'ff' } });
  });

  it('upgrading an older database keeps its shelves, unlocked', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(CREATE_TABLES_V1);
    db.prepare("INSERT INTO shelves (id, name, position, default_tag_names) VALUES ('old', 'Old', 0, '[]')").run();
    db.exec(CREATE_TABLES_V2);
    db.exec(CREATE_TABLES_V3);
    db.exec(MIGRATE_V4);
    db.exec(MIGRATE_V5);
    db.exec(MIGRATE_V6);
    expect(load(db).shelves).toEqual([{ id: 'old', name: 'Old', defaultTagNames: [] }]);
  });

  it('repairs a database marked version 6 that is missing the lock columns', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(CREATE_TABLES_V1);
    db.exec(CREATE_TABLES_V2);
    db.exec(CREATE_TABLES_V3);
    db.exec(MIGRATE_V4);
    db.exec(MIGRATE_V5);
    // MIGRATE_V6 skipped, as happened with live reload.
    db.prepare("INSERT INTO shelves (id, name, position, default_tag_names) VALUES ('s', 'Shelf', 0, '[]')").run();
    const columns = () => db.prepare('PRAGMA table_info(shelves)').all().map((c) => String(c.name));

    for (const sql of shelfLockRepair(columns())) db.exec(sql);
    expect(load(db).shelves).toEqual([{ id: 's', name: 'Shelf', defaultTagNames: [] }]);
    // On a database that already has them, it does nothing.
    expect(shelfLockRepair(columns())).toEqual([]);
  });
});
