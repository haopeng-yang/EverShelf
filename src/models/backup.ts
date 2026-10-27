import { translate } from '../i18n';
import type { Id, Item, Shelf, ShelfState, Tag } from './types';

// A backup is one JSON file holding every shelf and item. Covers are embedded
// as data URIs ("data:image/jpeg;base64,...") so the file works on another phone.

export const BACKUP_FORMAT_VERSION = 1;

interface BackupItem extends Omit<Item, 'coverUri'> {
  cover: string | null;
}

export interface BackupFile {
  app: 'EverShelf';
  version: number;
  exportedAt: string;
  shelves: Shelf[];
  items: BackupItem[];
}

export interface ParsedBackup {
  /** Items have coverUri null; covers are restored separately from `covers`. */
  state: ShelfState;
  /** Item id -> cover as a data URI. */
  covers: Map<Id, string>;
}

export type BackupErrorCode =
  | 'notJson'
  | 'notBackup'
  | 'newerVersion'
  | 'missingLists'
  | 'duplicateShelf'
  | 'badShelf'
  | 'badItem'
  | 'itemShelfMissing'
  | 'duplicateItem'
  | 'badTag';

/** A problem with a backup file. `code` + `params` let screens show it in any language; `message` is English. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    readonly params: { n?: number } = {},
  ) {
    super(translate('en', `backupError.${code}`, params));
  }
}

/** `covers` maps item id -> cover data URI, for items that have one. */
export function createBackup(state: ShelfState, covers: Map<Id, string>, exportedAt: Date): BackupFile {
  return {
    app: 'EverShelf',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    shelves: state.shelves,
    items: state.items.map(({ coverUri: _coverUri, ...item }) => ({ ...item, cover: covers.get(item.id) ?? null })),
  };
}

/** Reads and checks a backup file. Throws BackupError with a readable message if it isn't valid. */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('notJson');
  }
  if (!isObject(data) || data.app !== 'EverShelf') throw new BackupError('notBackup');
  if (typeof data.version !== 'number' || data.version > BACKUP_FORMAT_VERSION) {
    throw new BackupError('newerVersion');
  }
  if (!Array.isArray(data.shelves) || !Array.isArray(data.items)) throw new BackupError('missingLists');

  const shelves = data.shelves.map((s, i) => parseShelf(s, i + 1));
  const shelfIds = new Set(shelves.map((s) => s.id));
  if (shelfIds.size !== shelves.length) throw new BackupError('duplicateShelf');

  const covers = new Map<Id, string>();
  const itemIds = new Set<Id>();
  const items = data.items.map((raw, i): Item => {
    const n = i + 1;
    if (!isObject(raw)) throw new BackupError('badItem', { n });
    const { id, shelfId, title, cover, tags, createdAt, updatedAt } = raw;
    if (typeof id !== 'string' || typeof shelfId !== 'string' || typeof title !== 'string') {
      throw new BackupError('badItem', { n });
    }
    if (!shelfIds.has(shelfId)) throw new BackupError('itemShelfMissing', { n });
    if (itemIds.has(id)) throw new BackupError('duplicateItem', { n });
    itemIds.add(id);
    if (!Array.isArray(tags)) throw new BackupError('badItem', { n });
    if (typeof cover === 'string' && cover.startsWith('data:image/')) covers.set(id, cover);
    const now = Date.now();
    return {
      id,
      shelfId,
      title,
      coverUri: null,
      tags: tags.map((t) => parseTag(t, n)),
      createdAt: typeof createdAt === 'number' ? createdAt : now,
      updatedAt: typeof updatedAt === 'number' ? updatedAt : now,
    };
  });

  return { state: { shelves, items }, covers };
}

function parseShelf(raw: unknown, n: number): Shelf {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new BackupError('badShelf', { n });
  }
  const defaults = Array.isArray(raw.defaultTagNames) ? raw.defaultTagNames : [];
  return {
    id: raw.id,
    name: raw.name,
    defaultTagNames: defaults.filter((n): n is string => typeof n === 'string'),
  };
}

/** `n` is the 1-based number of the item the tag belongs to. */
function parseTag(raw: unknown, n: number): Tag {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.value !== 'string') {
    throw new BackupError('badTag', { n });
  }
  return { id: raw.id, name: raw.name, value: raw.value };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** e.g. "evershelf-backup-2026-10-27.json" */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `evershelf-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
