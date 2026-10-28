import type { Id, Item, Shelf, ShelfLock, ShelfState, Tag } from './types';

/**
 * Every change to the shelf data goes through one of these actions.
 * The reducer is pure (no ids or clocks inside it), so actions carry any
 * new ids and timestamps; see actions.ts for helpers that fill them in.
 */
export type ShelfAction =
  | { type: 'shelf/add'; shelf: Shelf }
  | { type: 'shelf/rename'; shelfId: Id; name: string }
  | { type: 'shelf/setDefaultTags'; shelfId: Id; defaultTagNames: string[] }
  /** Adds, changes (lock) or removes (null) a shelf's password. */
  | { type: 'shelf/setLock'; shelfId: Id; lock: ShelfLock | null }
  | { type: 'shelf/move'; shelfId: Id; toIndex: number }
  | { type: 'shelf/remove'; shelfId: Id }
  | { type: 'item/add'; item: Item }
  | { type: 'item/update'; itemId: Id; changes: Partial<Pick<Item, 'title' | 'coverUri'>>; now: number }
  /** Saves an edited copy of an existing item: its title, cover and whole tag list. */
  | { type: 'item/save'; item: Item; now: number }
  | { type: 'item/remove'; itemId: Id }
  | { type: 'tag/add'; itemId: Id; tag: Tag; now: number }
  | { type: 'tag/update'; itemId: Id; tagId: Id; changes: Partial<Pick<Tag, 'name' | 'value'>>; now: number }
  | { type: 'tag/move'; itemId: Id; tagId: Id; toIndex: number; now: number }
  | { type: 'tag/remove'; itemId: Id; tagId: Id; now: number }
  | { type: 'state/replace'; state: ShelfState };

export function shelfReducer(state: ShelfState, action: ShelfAction): ShelfState {
  switch (action.type) {
    case 'shelf/add':
      return { ...state, shelves: [...state.shelves, action.shelf] };

    case 'shelf/rename':
      return updateShelf(state, action.shelfId, (s) => ({ ...s, name: action.name }));

    case 'shelf/setDefaultTags':
      return updateShelf(state, action.shelfId, (s) => ({ ...s, defaultTagNames: action.defaultTagNames }));

    case 'shelf/setLock':
      return updateShelf(state, action.shelfId, ({ lock: _old, ...s }) => (action.lock ? { ...s, lock: action.lock } : s));

    case 'shelf/move': {
      const from = state.shelves.findIndex((s) => s.id === action.shelfId);
      if (from === -1) return state;
      return { ...state, shelves: moveInArray(state.shelves, from, action.toIndex) };
    }

    case 'shelf/remove':
      // Removing a shelf also removes everything on it.
      return {
        shelves: state.shelves.filter((s) => s.id !== action.shelfId),
        items: state.items.filter((i) => i.shelfId !== action.shelfId),
      };

    case 'item/add':
      if (!state.shelves.some((s) => s.id === action.item.shelfId)) return state;
      return { ...state, items: [...state.items, action.item] };

    case 'item/update':
      return updateItem(state, action.itemId, action.now, (i) => ({ ...i, ...action.changes }));

    case 'item/save': {
      const { title, coverUri, tags } = action.item;
      return updateItem(state, action.item.id, action.now, (i) => ({ ...i, title, coverUri, tags }));
    }

    case 'item/remove':
      return { ...state, items: state.items.filter((i) => i.id !== action.itemId) };

    case 'tag/add':
      return updateItem(state, action.itemId, action.now, (i) => ({ ...i, tags: [...i.tags, action.tag] }));

    case 'tag/update':
      return updateItem(state, action.itemId, action.now, (i) => ({
        ...i,
        tags: i.tags.map((t) => (t.id === action.tagId ? { ...t, ...action.changes } : t)),
      }));

    case 'tag/move':
      return updateItem(state, action.itemId, action.now, (i) => {
        const from = i.tags.findIndex((t) => t.id === action.tagId);
        return from === -1 ? i : { ...i, tags: moveInArray(i.tags, from, action.toIndex) };
      });

    case 'tag/remove':
      return updateItem(state, action.itemId, action.now, (i) => ({
        ...i,
        tags: i.tags.filter((t) => t.id !== action.tagId),
      }));

    case 'state/replace':
      return action.state;
  }
}

function updateShelf(state: ShelfState, shelfId: Id, update: (shelf: Shelf) => Shelf): ShelfState {
  if (!state.shelves.some((s) => s.id === shelfId)) return state;
  return { ...state, shelves: state.shelves.map((s) => (s.id === shelfId ? update(s) : s)) };
}

function updateItem(state: ShelfState, itemId: Id, now: number, update: (item: Item) => Item): ShelfState {
  if (!state.items.some((i) => i.id === itemId)) return state;
  return {
    ...state,
    items: state.items.map((i) => (i.id === itemId ? { ...update(i), updatedAt: now } : i)),
  };
}

/** Returns a copy with the element at `from` moved to `to` (clamped to the array bounds). */
export function moveInArray<T>(array: T[], from: number, to: number): T[] {
  const result = [...array];
  const [moved] = result.splice(from, 1);
  const target = Math.max(0, Math.min(to, result.length));
  result.splice(target, 0, moved);
  return result;
}

/** Items on one shelf, in the order they were added. */
export function selectItemsOnShelf(state: ShelfState, shelfId: Id): Item[] {
  return state.items.filter((i) => i.shelfId === shelfId);
}
