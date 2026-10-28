import type { Id, Item } from './types';

export type SortOrder = 'newest' | 'oldest' | 'titleAsc' | 'titleDesc' | 'updated' | 'lastRead';

/** Labels live in the translation files as sort.<order> and sortShort.<order>. */
export const SORT_ORDERS: SortOrder[] = ['newest', 'oldest', 'titleAsc', 'titleDesc', 'updated', 'lastRead'];

/**
 * Search items. Two forms:
 * - `dune herbert`: every word must appear in the title or any tag's name or value.
 * - `age restricted: 15`: some tag whose name contains "age restricted" has a value
 *   containing "15". "title: dune" searches the title.
 */
export function filterItems(items: Item[], query: string): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  const colon = q.indexOf(':');
  if (colon > 0) {
    const name = q.slice(0, colon).trim();
    const value = q.slice(colon + 1).trim();
    return items.filter((item) =>
      fields(item).some((f) => f.name.toLowerCase().includes(name) && f.value.toLowerCase().includes(value)),
    );
  }

  const words = q.split(/\s+/);
  return items.filter((item) => {
    const text = fields(item)
      .flatMap((f) => [f.name, f.value])
      .join('\n')
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/**
 * Returns a sorted copy. Ties keep the order items were added in.
 * 'lastRead' uses `lastReadAt` (item id → time); items never read go last.
 */
export function sortItems(items: Item[], order: SortOrder, lastReadAt: Map<Id, number | null> = new Map()): Item[] {
  const lastRead = (item: Item) => lastReadAt.get(item.id) ?? -Infinity;
  const byTitle = (a: Item, b: Item) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  const compare: Record<SortOrder, (a: Item, b: Item) => number> = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    titleAsc: byTitle,
    titleDesc: (a, b) => byTitle(b, a),
    updated: (a, b) => b.updatedAt - a.updatedAt,
    // Comparing first avoids Infinity − Infinity (NaN) when neither was read.
    lastRead: (a, b) => (lastRead(a) === lastRead(b) ? 0 : lastRead(b) > lastRead(a) ? 1 : -1),
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare[order](a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);
}

/** The title is searchable like a tag named "Title". */
function fields(item: Item): { name: string; value: string }[] {
  return [{ name: 'Title', value: item.title }, ...item.tags];
}
