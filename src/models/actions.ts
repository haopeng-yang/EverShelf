import { newId } from './ids';
import type { ShelfAction } from './shelfReducer';
import type { Id, Item, Shelf, ShelfKind, ShelfLock, Tag } from './types';

/**
 * Helpers that build actions with fresh ids and timestamps, so screens can
 * write e.g. dispatch(addTag(item.id, 'Age Restricted', 'Recommended 15+')).
 */

export function addShelf(
  name: string,
  defaultTagNames: string[] = ['Date', 'Description'],
  lock?: ShelfLock,
  kind: ShelfKind = 'collection',
): ShelfAction & { type: 'shelf/add' } {
  const shelf: Shelf = { id: newId(), name: name.trim(), kind, defaultTagNames, ...(lock ? { lock } : {}) };
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

/**
 * A new item for the "Add item" screen. It starts with the tag names of the
 * shelf's most recently added item, in the same order, with empty values, so
 * a run of similar items only needs the values filled in. On an empty shelf,
 * or when that item has no tags, it falls back to the shelf's default tags.
 */
export function newItemDraftLikeLast(shelf: Shelf, items: Item[]): Item {
  const draft = newItemDraft(shelf);
  let last: Item | undefined;
  for (const item of items) {
    if (item.shelfId === shelf.id && (!last || item.createdAt > last.createdAt)) last = item;
  }
  const names = last?.tags.map((tag) => tag.name.trim()).filter(Boolean) ?? [];
  if (names.length === 0) return draft;
  return { ...draft, tags: names.map((name) => ({ id: newId(), name, value: '' })) };
}

/**
 * Fills tags by name, e.g. { Author: 'Mira Holt' }: a tag the item already has
 * (from its shelf's defaults) gets the value; others are added. Empty values are skipped.
 */
export function fillTags(tags: Tag[], values: Record<string, string>): Tag[] {
  let result = tags;
  for (const [name, rawValue] of Object.entries(values)) {
    const value = rawValue.trim();
    if (!value) continue;
    result = result.some((tag) => tag.name === name)
      ? result.map((tag) => (tag.name === name ? { ...tag, value } : tag))
      : [...result, { id: newId(), name, value }];
  }
  return result;
}

export function addItem(shelf: Shelf, title: string, coverUri: string | null = null): ShelfAction {
  return { type: 'item/add', item: newItemDraft(shelf, title, coverUri) };
}

export function addTag(itemId: Id, name: string, value = ''): ShelfAction {
  return { type: 'tag/add', itemId, tag: { id: newId(), name: name.trim(), value }, now: Date.now() };
}
