/// <reference types="node" />
// Runs the app's real SQL against Node's built-in SQLite and checks that what
// is saved loads back exactly as the in-memory state.
import { DatabaseSync } from 'node:sqlite';

import { addItem, addShelf, addTag } from '../src/models/actions';
import { createDefaultState } from '../src/models/defaults';
import { shelfReducer, type ShelfAction } from '../src/models/shelfReducer';
import type { ShelfState } from '../src/models/types';
import { rowsToState, type ItemRow, type ShelfRow, type TagRow } from '../src/storage/rows';
import { CREATE_TABLES_V1, SELECT_ITEMS, SELECT_SHELVES, SELECT_TAGS } from '../src/storage/schema';
import { insertState, statementsForAction, type Statement } from '../src/storage/statements';

function openTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(CREATE_TABLES_V1);
  run(db, insertState(createDefaultState()));
  return db;
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

    step({ type: 'shelf/remove', shelfId: funny.id });
    step({ type: 'item/remove', itemId: dune.id });
    expect(db.prepare('SELECT COUNT(*) AS n FROM tags').get()).toEqual(expect.objectContaining({ n: 0 }));
  });

  it('replaces the whole state', () => {
    const db = openTestDb();
    let replacement = shelfReducer({ shelves: [], items: [] }, addShelf('Games'));
    replacement = shelfReducer(replacement, addItem(replacement.shelves[0], 'Celeste'));
    const state = dispatch(db, createDefaultState(), { type: 'state/replace', state: replacement });
    expect(load(db)).toEqual(state);
  });
});
