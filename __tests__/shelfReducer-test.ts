import { addItem, addShelf, addTag } from '../src/models/actions';
import { createDefaultState } from '../src/models/defaults';
import { moveInArray, selectItemsOnShelf, shelfReducer, type ShelfAction } from '../src/models/shelfReducer';
import type { ShelfState } from '../src/models/types';

function apply(state: ShelfState, ...actions: ShelfAction[]): ShelfState {
  return actions.reduce(shelfReducer, state);
}

function booksShelf(state: ShelfState) {
  return state.shelves.find((s) => s.id === 'books')!;
}

describe('shelves', () => {
  it('starts with Books, Movies, Manga, Anime', () => {
    expect(createDefaultState().shelves.map((s) => s.name)).toEqual(['Books', 'Movies', 'Manga', 'Anime']);
  });

  it('adds a new shelf at the end', () => {
    const state = apply(createDefaultState(), addShelf('  Funny Videos '));
    expect(state.shelves.at(-1)?.name).toBe('Funny Videos');
  });

  it('renames and reorders shelves', () => {
    let state = apply(createDefaultState(), { type: 'shelf/rename', shelfId: 'anime', name: 'Anime Series' });
    state = apply(state, { type: 'shelf/move', shelfId: 'anime', toIndex: 0 });
    expect(state.shelves.map((s) => s.name)).toEqual(['Anime Series', 'Books', 'Movies', 'Manga']);
  });

  it('removing a shelf removes its items too', () => {
    let state = createDefaultState();
    state = apply(state, addItem(booksShelf(state), 'Dune'));
    state = apply(state, { type: 'shelf/remove', shelfId: 'books' });
    expect(state.shelves.some((s) => s.id === 'books')).toBe(false);
    expect(state.items).toHaveLength(0);
  });
});

describe('items', () => {
  it("starts with the shelf's default tags", () => {
    let state = createDefaultState();
    state = apply(state, addItem(booksShelf(state), 'Dune'));
    const [item] = selectItemsOnShelf(state, 'books');
    expect(item.title).toBe('Dune');
    expect(item.tags.map((t) => [t.name, t.value])).toEqual([
      ['Author', ''],
      ['Date', ''],
      ['Description', ''],
    ]);
  });

  it('ignores items for a shelf that does not exist', () => {
    const state = createDefaultState();
    const next = apply(state, addItem({ id: 'nope', name: 'Nope', defaultTagNames: [] }, 'X'));
    expect(next).toBe(state);
  });

  it('moves an item to another shelf, keeping its tags', () => {
    let state = createDefaultState();
    state = apply(state, addItem(booksShelf(state), 'Dune'));
    const dune = state.items[0];
    state = apply(state, { type: 'item/move', itemId: dune.id, shelfId: 'movies' });
    expect(selectItemsOnShelf(state, 'books')).toHaveLength(0);
    expect(selectItemsOnShelf(state, 'movies')).toEqual([{ ...dune, shelfId: 'movies' }]);
  });

  it('ignores moves to the same shelf or one that does not exist', () => {
    let state = createDefaultState();
    state = apply(state, addItem(booksShelf(state), 'Dune'));
    const itemId = state.items[0].id;
    expect(apply(state, { type: 'item/move', itemId, shelfId: 'books' })).toBe(state);
    expect(apply(state, { type: 'item/move', itemId, shelfId: 'nope' })).toBe(state);
  });
});

describe('custom tags', () => {
  function stateWithDune() {
    const state = createDefaultState();
    return apply(state, addItem(booksShelf(state), 'Dune'));
  }

  it('adds a user-defined tag with a value', () => {
    let state = stateWithDune();
    const itemId = state.items[0].id;
    state = apply(state, addTag(itemId, 'Age Restricted', 'Recommended 15+'));
    expect(state.items[0].tags.at(-1)).toMatchObject({ name: 'Age Restricted', value: 'Recommended 15+' });
  });

  it('edits, moves and removes tags and bumps updatedAt', () => {
    let state = stateWithDune();
    const item = state.items[0];
    const [author, date] = item.tags;
    state = apply(
      state,
      { type: 'tag/update', itemId: item.id, tagId: author.id, changes: { value: 'Frank Herbert' }, now: 100 },
      { type: 'tag/move', itemId: item.id, tagId: author.id, toIndex: 2, now: 200 },
      { type: 'tag/remove', itemId: item.id, tagId: date.id, now: 300 },
    );
    const tags = state.items[0].tags;
    expect(tags.map((t) => t.name)).toEqual(['Description', 'Author']);
    expect(tags[1].value).toBe('Frank Herbert');
    expect(state.items[0].updatedAt).toBe(300);
  });
});

describe('item/save', () => {
  it('replaces title, cover and tags but keeps shelf and createdAt', () => {
    const initial = createDefaultState();
    let state = apply(initial, addItem(booksShelf(initial), 'Dune'));
    const original = state.items[0];
    const edited = {
      ...original,
      shelfId: 'movies',
      createdAt: 0,
      title: 'Dune Messiah',
      coverUri: 'file:///cover.jpg',
      tags: [{ id: 't1', name: 'Age Restricted', value: 'Recommended 15+' }],
    };
    state = apply(state, { type: 'item/save', item: edited, now: 500 });
    expect(state.items[0]).toEqual({
      ...original,
      title: 'Dune Messiah',
      coverUri: 'file:///cover.jpg',
      tags: edited.tags,
      updatedAt: 500,
    });
  });
});

describe('moveInArray', () => {
  it('clamps the target index', () => {
    expect(moveInArray(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
    expect(moveInArray(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
  });
});
