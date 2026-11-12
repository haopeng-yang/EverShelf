import type { Id, Item, Shelf, ShelfState } from './types';

/** What merging a backup into the current shelves adds. */
export interface BackupMerge {
  /** Backup shelves that aren't here yet, to add after the current ones. */
  shelves: Shelf[];
  /** Backup items that aren't here yet, moved onto the matching shelf here. */
  items: Item[];
}

/**
 * Works out what a backup adds to the current shelves without changing
 * anything already here. A backup shelf matches a current one with the same
 * id, or else (when neither is locked) the same name and kind, so the same
 * shelf made on two phones becomes one. Items already here (same id) are
 * left as they are; the rest go onto their shelf's match.
 */
export function mergeBackupState(current: ShelfState, backup: ShelfState): BackupMerge {
  const shelfIds = new Map<Id, Id>();
  const shelves: Shelf[] = [];
  const nameKey = (s: Shelf) => `${s.kind}\u0000${s.name.trim().toLowerCase()}`;
  const unlockedByName = new Map(current.shelves.filter((s) => !s.lock).map((s) => [nameKey(s), s.id]));
  for (const shelf of backup.shelves) {
    const match = current.shelves.some((s) => s.id === shelf.id)
      ? shelf.id
      : shelf.lock
        ? undefined
        : unlockedByName.get(nameKey(shelf));
    if (match) {
      shelfIds.set(shelf.id, match);
    } else {
      shelfIds.set(shelf.id, shelf.id);
      shelves.push(shelf);
    }
  }

  const itemIds = new Set(current.items.map((i) => i.id));
  const items = backup.items
    .filter((item) => !itemIds.has(item.id) && shelfIds.has(item.shelfId))
    .map((item) => ({ ...item, shelfId: shelfIds.get(item.shelfId)! }));
  return { shelves, items };
}
