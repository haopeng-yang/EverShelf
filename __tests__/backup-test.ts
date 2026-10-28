import { addItem, addTag } from '../src/models/actions';
import { BackupError, backupFileName, createBackup, parseBackup, type BackupBook } from '../src/models/backup';
import { createDefaultState } from '../src/models/defaults';
import { shelfReducer } from '../src/models/shelfReducer';
import type { ShelfState } from '../src/models/types';

function sampleState(): ShelfState {
  let state = createDefaultState();
  state = shelfReducer(state, addItem(state.shelves[0], 'Dune', 'file:///covers/dune.jpg'));
  state = shelfReducer(state, addItem(state.shelves[1], 'Alien'));
  return shelfReducer(state, addTag(state.items[0].id, 'Age Restricted', 'Recommended 15+'));
}

const COVER = 'data:image/jpeg;base64,AAAA';

describe('backup', () => {
  it('round-trips shelves, items, tags and covers', () => {
    const state = sampleState();
    const dune = state.items[0];
    const file = createBackup(state, new Map([[dune.id, COVER]]), new Date('2026-10-27T10:00:00Z'));
    const parsed = parseBackup(JSON.stringify(file));

    expect(parsed.state.shelves).toEqual(state.shelves);
    expect(parsed.state.items).toEqual(state.items.map((i) => ({ ...i, coverUri: null })));
    expect(parsed.covers).toEqual(new Map([[dune.id, COVER]]));
    expect(file.exportedAt).toBe('2026-10-27T10:00:00.000Z');
    expect(JSON.stringify(file)).not.toContain('file:///');
  });

  it('rejects files that are not EverShelf backups', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"hello": 1}')).toThrow('not an EverShelf backup');
    expect(() => parseBackup('{"app":"EverShelf","version":99,"shelves":[],"items":[]}')).toThrow('newer version');
  });

  it('rejects damaged contents with a readable message', () => {
    const file = createBackup(sampleState(), new Map(), new Date());
    const orphan = { ...file, shelves: file.shelves.slice(1) };
    expect(() => parseBackup(JSON.stringify(orphan))).toThrow('the shelf of item 1 is missing');
    const badTag = { ...file, items: [{ ...file.items[0], tags: [{ id: 1 }] }] };
    expect(() => parseBackup(JSON.stringify(badTag))).toThrow('a tag on item 1');
    expect(() => parseBackup(JSON.stringify(badTag))).toThrow(
      expect.objectContaining({ code: 'badTag', params: { n: 1 } }),
    );
  });

  it('ignores covers that are not images', () => {
    const state = sampleState();
    const file = createBackup(state, new Map([[state.items[0].id, 'javascript:alert(1)']]), new Date());
    expect(parseBackup(JSON.stringify(file)).covers.size).toBe(0);
  });

  it('names files by date', () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe('evershelf-backup-2026-01-05.json');
  });
});

describe('backup with books', () => {
  const state = sampleState();
  const dune = state.items[0];
  const book: BackupBook = {
    itemId: dune.id,
    chapters: [
      { id: 'c1', title: 'Chapter 1', text: 'First line.\nSecond line.' },
      { id: 'c2', title: 'Chapter 2', text: 'Third line.' },
    ],
    progress: { chapterId: 'c2', paragraph: 0, percent: 0.6, updatedAt: 5, finishedAt: 9 },
    bookmarks: [{ id: 'b1', chapterId: 'c1', paragraph: 1, excerpt: 'Second line.', createdAt: 4 }],
  };
  const backupWith = (books: unknown) =>
    JSON.stringify({ ...createBackup(state, new Map(), new Date('2026-10-28T00:00:00Z')), books });

  it('round-trips book text, progress and bookmarks', () => {
    const file = createBackup(state, new Map(), new Date(), [book]);
    expect(parseBackup(JSON.stringify(file)).books).toEqual([book]);
  });

  it('leaves books out of a "shelf data only" backup, and reads version 1 files', () => {
    const file = createBackup(state, new Map(), new Date());
    expect('books' in file).toBe(false);
    expect(parseBackup(JSON.stringify({ ...file, version: 1 })).books).toEqual([]);
  });

  it('rejects books with missing chapters or for unknown items', () => {
    const code = (books: unknown) => {
      try {
        parseBackup(backupWith(books));
        return 'ok';
      } catch (error) {
        return error instanceof BackupError ? error.code : String(error);
      }
    };
    expect(code([book])).toBe('ok');
    expect(code([{ ...book, itemId: 'nope' }])).toBe('badBook');
    expect(code([{ ...book, chapters: [] }])).toBe('badBook');
    expect(code([{ ...book, chapters: [{ id: 'c1', title: 'x' }] }])).toBe('badBook');
    expect(code([book, book])).toBe('badBook');
    expect(code('not a list')).toBe('badBook');
  });

  it('drops a reading position or bookmark that points at a missing chapter', () => {
    const parsed = parseBackup(
      backupWith([
        {
          ...book,
          progress: { ...book.progress, chapterId: 'gone' },
          bookmarks: [...book.bookmarks, { ...book.bookmarks[0], id: 'b2', chapterId: 'gone' }],
        },
      ]),
    );
    expect(parsed.books[0].progress).toBeNull();
    expect(parsed.books[0].bookmarks.map((b) => b.id)).toEqual(['b1']);
  });
});

describe('backup with locked shelves', () => {
  it('keeps a shelf lock, and refuses a damaged one', () => {
    const state = sampleState();
    const locked = {
      ...state,
      shelves: state.shelves.map((s, i) => (i === 0 ? { ...s, lock: { salt: '0a1b', hash: 'ff00' } } : s)),
    };
    const file = createBackup(locked, new Map(), new Date());
    expect(parseBackup(JSON.stringify(file)).state.shelves).toEqual(locked.shelves);

    const damaged = { ...file, shelves: [{ ...file.shelves[0], lock: { salt: 'x', hash: 1 } }, ...file.shelves.slice(1)] };
    expect(() => parseBackup(JSON.stringify(damaged))).toThrow(BackupError);
  });
});
