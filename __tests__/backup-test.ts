import { addItem, addShelf, addTag } from '../src/models/actions';
import {
  BackupError,
  backupFileName,
  createBackup,
  mediaEntryName,
  parseBackup,
  type BackupBook,
  type BackupComic,
  type BackupSong,
  type BackupVideo,
} from '../src/models/backup';
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

  it('embeds tag images as data URIs, leaving out unreadable or missing ones', () => {
    const state = sampleState();
    const dune = state.items[0];
    const FRAME = 'data:image/png;base64,BBBB';
    const withImages: ShelfState = {
      ...state,
      items: state.items.map((item) =>
        item.id === dune.id
          ? { ...item, tags: [{ ...item.tags[0], images: ['file:///covers/f1.png', 'file:///covers/gone.png'] }, ...item.tags.slice(1)] }
          : item,
      ),
    };
    const file = createBackup(withImages, new Map(), new Date(), {}, new Map([['file:///covers/f1.png', FRAME]]));
    expect(JSON.stringify(file)).not.toContain('file:///');

    const parsedTags = parseBackup(JSON.stringify(file)).state.items[0].tags;
    expect(parsedTags[0].images).toEqual([FRAME]);
    expect(parsedTags.slice(1).every((tag) => tag.images === undefined)).toBe(true);

    const tampered = JSON.parse(JSON.stringify(file));
    tampered.items[0].tags[0].images = ['javascript:alert(1)', 7];
    expect(parseBackup(JSON.stringify(tampered)).state.items[0].tags[0].images).toBeUndefined();
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
    expect(backupFileName(new Date(2026, 0, 5))).toBe('evershelf-backup-2026-01-05.zip');
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
    const file = createBackup(state, new Map(), new Date(), { books: [book] });
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

describe('backup with shelf kinds', () => {
  /** The default shelves, plus "Reading" with one book and an empty "Songs" music shelf. */
  function stateWithKinds() {
    let state = createDefaultState();
    state = shelfReducer(state, addShelf('Reading', [], undefined, 'novel'));
    state = shelfReducer(state, addShelf('Songs', [], undefined, 'music'));
    state = shelfReducer(state, addItem(state.shelves.find((s) => s.name === 'Reading')!, 'Emma'));
    const book: BackupBook = {
      itemId: state.items[0].id,
      chapters: [{ id: 'c1', title: 'Chapter 1', text: 'Text.' }],
      progress: null,
      bookmarks: [],
    };
    return { state, book };
  }

  it('keeps every shelf’s kind', () => {
    const { state, book } = stateWithKinds();
    const parsed = parseBackup(JSON.stringify(createBackup(state, new Map(), new Date(), { books: [book] })));
    expect(parsed.state.shelves).toEqual(state.shelves);
  });

  it('works out the kinds for a backup made before shelves had them', () => {
    const { state, book } = stateWithKinds();
    const file = createBackup(state, new Map(), new Date(), { books: [book] });
    const old = {
      ...file,
      // The first shelf has a kind this version doesn't know, as if from a newer app.
      shelves: file.shelves.map(({ kind: _kind, ...shelf }, i) => (i === 0 ? { ...shelf, kind: 'hologram' } : shelf)),
    };
    expect(parseBackup(JSON.stringify(old)).state.shelves.map((s) => s.kind)).toEqual([
      'novel', // books, by its id
      'collection', // movies
      'comic', // manga
      'collection', // anime
      'music', // music
      'video', // videos
      'novel', // Reading, by the book on it
      'collection', // Songs: empty, and not a built-in shelf
    ]);
  });
});

describe('backup with comics, songs and videos', () => {
  let state = createDefaultState();
  state = shelfReducer(state, addItem(state.shelves[2], 'Akira'));
  state = shelfReducer(state, addItem(state.shelves[4], 'Blue Song'));
  state = shelfReducer(state, addItem(state.shelves[5], 'Holiday'));
  const [akira, song, holiday] = state.items;
  const comic: BackupComic = {
    itemId: akira.id,
    readingMode: 'rtl',
    chapters: [{ id: 'k1', title: 'Vol. 1', fileName: '0' }],
    pages: [
      { chapterId: 'k1', position: 0, fileName: '0/0.jpg', width: 800, height: 1200 },
      { chapterId: 'k1', position: 1, fileName: '0/1.png', width: 800, height: 1200 },
    ],
    progress: { chapterId: 'k1', paragraph: 1, percent: 0.5, updatedAt: 3, finishedAt: null },
  };
  const track: BackupSong = {
    itemId: song.id,
    fileName: 'song.flac',
    format: 'flac',
    durationMs: 200000,
    trackNumber: 2,
    discNumber: null,
    lyrics: 'La la',
    playback: { positionMs: 5000, updatedAt: 7, playCount: 3, lastPlayedAt: 7, finishedAt: null },
  };
  const video: BackupVideo = {
    itemId: holiday.id,
    fileName: 'video.mp4',
    format: 'mp4',
    durationMs: null,
    width: 1920,
    height: 1080,
    subtitleChoice: 'off',
    audioChoice: null,
    playback: null,
  };
  const file = () => createBackup(state, new Map(), new Date(), { comics: [comic], songs: [track], videos: [video] });

  it('round-trips their details, positions and reading mode', () => {
    const parsed = parseBackup(JSON.stringify(file()));
    expect(parsed.comics).toEqual([comic]);
    expect(parsed.songs).toEqual([track]);
    expect(parsed.videos).toEqual([video]);
    expect(parsed.books).toEqual([]);
  });

  it('leaves out the kinds not chosen', () => {
    const songsOnly = createBackup(state, new Map(), new Date(), { songs: [track] });
    expect(Object.keys(songsOnly).filter((k) => ['books', 'comics', 'songs', 'videos'].includes(k))).toEqual(['songs']);
    expect(parseBackup(JSON.stringify(songsOnly)).comics).toEqual([]);
  });

  it('names the files inside the ZIP by item', () => {
    expect(mediaEntryName('abc', '0/1.png')).toBe('files/abc/0/1.png');
  });

  it('refuses damaged records, numbering comics, songs and videos together', () => {
    const code = (changes: object) => {
      try {
        parseBackup(JSON.stringify({ ...file(), ...changes }));
        return 'ok';
      } catch (error) {
        return error instanceof BackupError ? `${error.code} ${error.params.n}` : String(error);
      }
    };
    expect(code({})).toBe('ok');
    expect(code({ comics: [{ ...comic, pages: [{ ...comic.pages[0], chapterId: 'gone' }] }] })).toBe('badMedia 1');
    expect(code({ songs: [{ ...track, format: 'ogg' }] })).toBe('badMedia 2');
    expect(code({ videos: [{ ...video, itemId: 'nope' }] })).toBe('badMedia 3');
    // The same item can't be both a song and a video.
    expect(code({ videos: [{ ...video, itemId: song.id }] })).toBe('badMedia 3');
    expect(code({ songs: 'not a list' })).toBe('badMedia 2');
  });

  it('drops a playback position that is not readable', () => {
    const parsed = parseBackup(JSON.stringify({ ...file(), songs: [{ ...track, playback: { positionMs: -1 } }] }));
    expect(parsed.songs[0].playback).toBeNull();
  });

  it('works out shelf kinds from them for a backup without kinds', () => {
    const custom = shelfReducer(state, addShelf('Mixed', [], undefined, 'collection'));
    const onCustom = shelfReducer(custom, addItem(custom.shelves[6], 'Tune'));
    const tune = onCustom.items[3];
    const backup = createBackup(onCustom, new Map(), new Date(), { songs: [{ ...track, itemId: tune.id }] });
    const old = { ...backup, shelves: backup.shelves.map(({ kind: _kind, ...shelf }) => shelf) };
    expect(parseBackup(JSON.stringify(old)).state.shelves[6].kind).toBe('music');
  });
});
