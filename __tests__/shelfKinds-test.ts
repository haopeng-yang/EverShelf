import { addItem } from '../src/models/actions';
import { createDefaultState } from '../src/models/defaults';
import {
  canChangeKind,
  canHold,
  fileKindOfBook,
  inferShelfKind,
  isShelfKind,
  misplacedItems,
  moveTargets,
} from '../src/models/shelfKinds';
import { shelfReducer } from '../src/models/shelfReducer';
import type { BookKind, BookSummary, Id } from '../src/models/types';

describe('canHold', () => {
  it('only lets files onto a shelf of the same kind', () => {
    expect(canHold('novel', 'novel')).toBe(true);
    expect(canHold('novel', 'comic')).toBe(false);
    expect(canHold('comic', 'music')).toBe(false);
    expect(canHold('music', 'music')).toBe(true);
    expect(canHold('collection', 'novel')).toBe(false);
  });

  it('lets manual entries onto every shelf', () => {
    for (const kind of ['collection', 'novel', 'comic', 'music'] as const) expect(canHold(kind, null)).toBe(true);
  });
});

describe('inferShelfKind', () => {
  it('knows empty built-in shelves by their id', () => {
    expect(inferShelfKind('books', [])).toBe('novel');
    expect(inferShelfKind('manga', [])).toBe('comic');
    expect(inferShelfKind('movies', [])).toBe('collection');
    expect(inferShelfKind('anime', [])).toBe('collection');
  });

  it('makes an empty shelf of the user’s own a collection', () => {
    expect(inferShelfKind('a1b2c3', [])).toBe('collection');
  });

  it('picks the kind most files on the shelf have', () => {
    expect(inferShelfKind('a1b2c3', ['comic'])).toBe('comic');
    expect(inferShelfKind('a1b2c3', ['novel', 'comic', 'comic'])).toBe('comic');
    expect(inferShelfKind('movies', ['novel'])).toBe('novel');
    expect(inferShelfKind('manga', ['novel', 'novel', 'comic'])).toBe('novel');
  });

  it('breaks a tie with the built-in kind, or else novels first', () => {
    expect(inferShelfKind('manga', ['novel', 'comic'])).toBe('comic');
    expect(inferShelfKind('books', ['comic', 'novel'])).toBe('novel');
    expect(inferShelfKind('a1b2c3', ['comic', 'novel'])).toBe('novel');
    expect(inferShelfKind('a1b2c3', ['music', 'comic'])).toBe('comic');
  });
});

describe('helpers', () => {
  it('knows which values are shelf kinds', () => {
    expect(isShelfKind('music')).toBe(true);
    expect(isShelfKind('hologram')).toBe(false);
    expect(isShelfKind(undefined)).toBe(false);
  });

  it('calls a text book a novel', () => {
    expect(fileKindOfBook('text')).toBe('novel');
    expect(fileKindOfBook('comic')).toBe('comic');
  });
});

describe('shelves and their items', () => {
  /** Books (novel shelf) with a novel, a comic and a manual entry; Manga, Movies and Anime empty. */
  function library() {
    let state = createDefaultState();
    const [books] = state.shelves;
    for (const title of ['Dune', 'Akira', 'Wishlist book']) state = shelfReducer(state, addItem(books, title));
    const [dune, akira, wish] = state.items;
    const summary = (itemId: Id, kind: BookKind): BookSummary => ({
      itemId,
      kind,
      chapterCount: 1,
      percent: 0,
      lastReadAt: null,
      finished: false,
    });
    const summaries = new Map([
      [dune.id, summary(dune.id, 'text')],
      [akira.id, summary(akira.id, 'comic')],
    ]);
    return { state, books, dune, akira, wish, summaries };
  }

  it('finds the items that don’t fit their shelf', () => {
    const { state, books, akira, summaries } = library();
    expect(misplacedItems(books, state.items, summaries)).toEqual([akira]);
    expect(misplacedItems(books, state.items, new Map())).toEqual([]);
  });

  it('only offers Move targets that can hold every item', () => {
    const { state, dune, akira, wish, summaries } = library();
    const ids = (items: typeof state.items) => moveTargets(state.shelves, 'books', items, summaries).map((s) => s.id);
    expect(ids([akira])).toEqual(['manga']);
    expect(ids([wish])).toEqual(['movies', 'manga', 'anime']);
    expect(ids([dune, wish])).toEqual([]);
    expect(ids([dune, akira])).toEqual([]);
  });

  it('only lets a shelf change to a kind its files fit', () => {
    const { state, dune, akira, wish, summaries } = library();
    expect(canChangeKind('comic', [akira, wish], summaries)).toBe(true);
    expect(canChangeKind('collection', [wish], summaries)).toBe(true);
    expect(canChangeKind('collection', [dune], summaries)).toBe(false);
    expect(canChangeKind('novel', state.items, summaries)).toBe(false);
    expect(canChangeKind('music', [], summaries)).toBe(true);
  });
});
