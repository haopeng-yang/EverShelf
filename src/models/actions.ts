import { newId } from './ids';
import type { ShelfAction } from './shelfReducer';
import type { Id, Item, Shelf } from './types';

/**
 * Helpers that build actions with fresh ids and timestamps, so screens can
 * write e.g. dispatch(addTag(item.id, 'Age Restricted', 'Recommended 15+')).
 */

export function addShelf(name: string, defaultTagNames: string[] = ['Date', 'Description']): ShelfAction {
  const shelf: Shelf = { id: newId(), name: name.trim(), defaultTagNames };
  return { type: 'shelf/add', shelf };
}

/** New item starts with the shelf's default tags, values empty. */
export function addItem(shelf: Shelf, title: string, coverUri: string | null = null): ShelfAction {
  const now = Date.now();
  const item: Item = {
    id: newId(),
    shelfId: shelf.id,
    title: title.trim(),
    coverUri,
    tags: shelf.defaultTagNames.map((name) => ({ id: newId(), name, value: '' })),
    createdAt: now,
    updatedAt: now,
  };
  return { type: 'item/add', item };
}

export function addTag(itemId: Id, name: string, value = ''): ShelfAction {
  return { type: 'tag/add', itemId, tag: { id: newId(), name: name.trim(), value }, now: Date.now() };
}
