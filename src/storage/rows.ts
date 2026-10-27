import type { Item, Shelf, ShelfState, Tag } from '../models/types';

// Plain rows as they come out of the tables in schema.ts.

export interface ShelfRow {
  id: string;
  name: string;
  position: number;
  default_tag_names: string;
}

export interface ItemRow {
  id: string;
  shelf_id: string;
  title: string;
  cover_uri: string | null;
  created_at: number;
  updated_at: number;
}

export interface TagRow {
  id: string;
  item_id: string;
  name: string;
  value: string;
  position: number;
}

/** Builds app state from rows already sorted by the SELECT_* queries. */
export function rowsToState(shelfRows: ShelfRow[], itemRows: ItemRow[], tagRows: TagRow[]): ShelfState {
  const tagsByItem = new Map<string, TagRow[]>();
  for (const row of tagRows) {
    const list = tagsByItem.get(row.item_id) ?? [];
    list.push(row);
    tagsByItem.set(row.item_id, list);
  }

  const shelves: Shelf[] = shelfRows.map((row) => ({
    id: row.id,
    name: row.name,
    defaultTagNames: parseStringArray(row.default_tag_names),
  }));

  const items: Item[] = itemRows.map((row) => ({
    id: row.id,
    shelfId: row.shelf_id,
    title: row.title,
    coverUri: row.cover_uri,
    tags: (tagsByItem.get(row.id) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((t): Tag => ({ id: t.id, name: t.name, value: t.value })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return { shelves, items };
}

export function shelfToRow(shelf: Shelf, position: number): ShelfRow {
  return { id: shelf.id, name: shelf.name, position, default_tag_names: JSON.stringify(shelf.defaultTagNames) };
}

export function itemToRow(item: Item): ItemRow {
  return {
    id: item.id,
    shelf_id: item.shelfId,
    title: item.title,
    cover_uri: item.coverUri,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

export function tagToRow(itemId: string, tag: Tag, position: number): TagRow {
  return { id: tag.id, item_id: itemId, name: tag.name, value: tag.value, position };
}

function parseStringArray(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
