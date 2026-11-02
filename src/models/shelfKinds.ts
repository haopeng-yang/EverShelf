import type { BookKind, FileKind, Id, Item, Shelf, ShelfKind } from './types';

// Which files may go on which shelf. Every check (import, Move, restore) goes
// through canHold, so the rule lives in one place.

/** Every shelf kind, in the order the shelf editor lists them. */
export const SHELF_KINDS: ShelfKind[] = ['collection', 'novel', 'comic', 'music'];

export function isShelfKind(value: unknown): value is ShelfKind {
  return SHELF_KINDS.some((kind) => kind === value);
}

/** An imported book's file kind: a text book is a novel. */
export function fileKindOfBook(kind: BookKind): FileKind {
  return kind === 'comic' ? 'comic' : 'novel';
}

/** Whether a shelf may hold an item. `fileKind` is null for a manual entry, which fits on any shelf. */
export function canHold(shelfKind: ShelfKind, fileKind: FileKind | null): boolean {
  return fileKind === null || shelfKind === fileKind;
}

/** What kind of file an item is, from loadFileKinds. Null for a manual entry. */
export function itemFileKind(itemId: Id, fileKinds: ReadonlyMap<Id, FileKind>): FileKind | null {
  return fileKinds.get(itemId) ?? null;
}

/** The items that don't fit on their shelf, e.g. comics left on a novel shelf by the upgrade or a restore. */
export function misplacedItems(shelf: Shelf, items: Item[], fileKinds: ReadonlyMap<Id, FileKind>): Item[] {
  return items.filter((item) => !canHold(shelf.kind, itemFileKind(item.id, fileKinds)));
}

/** The shelves, other than `fromShelfId`, that can hold every one of `items`. */
export function moveTargets(
  shelves: Shelf[],
  fromShelfId: Id,
  items: Item[],
  fileKinds: ReadonlyMap<Id, FileKind>,
): Shelf[] {
  const kinds = items.map((item) => itemFileKind(item.id, fileKinds));
  return shelves.filter((s) => s.id !== fromShelfId && kinds.every((kind) => canHold(s.kind, kind)));
}

/** Whether a shelf can become `kind`: only if every file already on it would still fit. */
export function canChangeKind(kind: ShelfKind, items: Item[], fileKinds: ReadonlyMap<Id, FileKind>): boolean {
  return items.every((item) => canHold(kind, itemFileKind(item.id, fileKinds)));
}

/** The built-in shelves' kinds, by their fixed ids (see defaults.ts). */
const BUILT_IN_KINDS: Record<Id, ShelfKind> = {
  books: 'novel',
  manga: 'comic',
  movies: 'collection',
  anime: 'collection',
  music: 'music',
};

/** When files of two kinds tie, the first of these wins (unless the built-in kind is one of them). */
const TIE_ORDER: FileKind[] = ['novel', 'comic', 'music'];

/**
 * The kind for a shelf that was made before shelves had kinds (an upgrade, or
 * an old backup). `fileKinds` has one entry per imported file on the shelf.
 * The kind with the most files wins; the ones that don't fit stay on the
 * shelf and are pointed out to the user later. A shelf with no files is
 * known by its built-in id, or else is a collection.
 */
export function inferShelfKind(shelfId: Id, fileKinds: FileKind[]): ShelfKind {
  const builtIn = BUILT_IN_KINDS[shelfId] as ShelfKind | undefined;
  if (fileKinds.length === 0) return builtIn ?? 'collection';

  const counts = new Map<FileKind, number>();
  for (const kind of fileKinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const most = Math.max(...counts.values());
  const tied = TIE_ORDER.filter((kind) => counts.get(kind) === most);
  return tied.find((kind) => kind === builtIn) ?? tied[0];
}
