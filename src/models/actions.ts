import { newId } from './ids';
import type { ShelfAction } from './shelfReducer';
import type { Id, Item, Shelf, ShelfLock } from './types';

/**
 * Helpers that build actions with fresh ids and timestamps, so screens can
 * write e.g. dispatch(addTag(item.id, 'Age Restricted', 'Recommended 15+')).
 */

export function addShelf(
  name: string,
  defaultTagNames: string[] = ['Date', 'Description'],
  lock?: ShelfLock,
): ShelfAction & { type: 'shelf/add' } {
  const shelf: Shelf = { id: newId(), name: name.trim(), defaultTagNames, ...(lock ? { lock } : {}) };
  return { type: 'shelf/add', shelf };
}

/** A new, unsaved item that starts with the shelf's default tags, values empty. */
export function newItemDraft(shelf: Shelf, title = '', coverUri: string | null = null): Item {
  const now = Date.now();
  return {
    id: newId(),
    shelfId: shelf.id,
    title: title.trim(),
    coverUri,
    tags: shelf.defaultTagNames.map((name) => ({ id: newId(), name, value: '' })),
    createdAt: now,
    updatedAt: now,
  };
}

export function addItem(shelf: Shelf, title: string, coverUri: string | null = null): ShelfAction {
  return { type: 'item/add', item: newItemDraft(shelf, title, coverUri) };
}

export function addTag(itemId: Id, name: string, value = ''): ShelfAction {
  return { type: 'tag/add', itemId, tag: { id: newId(), name: name.trim(), value }, now: Date.now() };
}
