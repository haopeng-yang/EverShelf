import { addItem, addShelf } from '../src/models/actions';
import { createDefaultState } from '../src/models/defaults';
import { mergeBackupState } from '../src/models/mergeBackup';
import { shelfReducer, type ShelfAction } from '../src/models/shelfReducer';
import type { ShelfState } from '../src/models/types';

function apply(state: ShelfState, ...actions: ShelfAction[]): ShelfState {
  return actions.reduce(shelfReducer, state);
}

function videos(state: ShelfState) {
  return state.shelves.find((s) => s.id === 'videos')!;
}

describe('mergeBackupState', () => {
  it('adds the items that are not here, keeping the ones that are', () => {
    let a = createDefaultState();
    a = apply(a, addItem(videos(a), 'Video 1'), addItem(videos(a), 'Video 2'));
    let b = createDefaultState();
    b = apply(b, addItem(b.shelves[0], 'Book 1'), addItem(videos(b), 'Video alpha'));

    const merge = mergeBackupState(a, b);
    expect(merge.shelves).toEqual([]);
    expect(merge.items.map((i) => i.title)).toEqual(['Book 1', 'Video alpha']);

    const merged = apply(a, { type: 'state/add', ...merge });
    expect(merged.items.map((i) => i.title)).toEqual(['Video 1', 'Video 2', 'Book 1', 'Video alpha']);
    expect(merged.shelves).toEqual(a.shelves);
  });

  it('adds nothing when the same backup is merged twice', () => {
    let a = createDefaultState();
    a = apply(a, addItem(videos(a), 'Video 1'));
    expect(mergeBackupState(a, a)).toEqual({ shelves: [], items: [] });
  });

  it('matches an unlocked shelf by name and kind, and adds a new one otherwise', () => {
    let a = apply(createDefaultState(), addShelf('Games'));
    let b = apply(createDefaultState(), addShelf('GAMES'), addShelf('Comics'));
    const games = b.shelves.find((s) => s.name === 'GAMES')!;
    const comics = b.shelves.find((s) => s.name === 'Comics')!;
    b = apply(b, addItem(games, 'Celeste'), addItem(comics, 'Akira'));

    const merge = mergeBackupState(a, b);
    expect(merge.shelves.map((s) => s.name)).toEqual(['Comics']);
    const aGames = a.shelves.find((s) => s.name === 'Games')!;
    expect(merge.items.find((i) => i.title === 'Celeste')?.shelfId).toBe(aGames.id);
    expect(merge.items.find((i) => i.title === 'Akira')?.shelfId).toBe(comics.id);
  });

  it('keeps a locked shelf separate even when the name matches', () => {
    const a = apply(createDefaultState(), addShelf('Private'));
    let b = apply(createDefaultState(), addShelf('Private'));
    const lock = { salt: 'aa', hash: 'bb' };
    const shelf = b.shelves.at(-1)!;
    b = apply(b, { type: 'shelf/setLock', shelfId: shelf.id, lock });
    expect(mergeBackupState(a, b).shelves.map((s) => s.id)).toEqual([shelf.id]);
  });
});
