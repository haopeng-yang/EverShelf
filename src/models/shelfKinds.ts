import type { BookKind, FileKind, Id, ShelfKind } from './types';

// Which files may go on which shelf. Every check (import, Move, restore) goes
// through canHold, so the rule lives in one place.

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

/** The built-in shelves' kinds, by their fixed ids (see defaults.ts). */
const BUILT_IN_KINDS: Record<Id, ShelfKind> = { books: 'novel', manga: 'comic', movies: 'collection', anime: 'collection' };

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
