import { translate } from '../i18n';
import { inferShelfKind, isShelfKind } from './shelfKinds';
import {
  AUDIO_FORMATS,
  READING_MODES,
  VIDEO_FORMATS,
  type Bookmark,
  type FileKind,
  type Id,
  type Item,
  type Page,
  type ReadingMode,
  type ReadingProgress,
  type Shelf,
  type ShelfKind,
  type ShelfState,
  type Tag,
  type Track,
  type Video,
} from './types';

// A backup's JSON holds every shelf and item. Covers are embedded as data
// URIs ("data:image/jpeg;base64,...") so the file works on another phone.
// Since version 2 it can also hold imported books: chapter text, reading
// position and bookmarks. Version 1 files (no books) still restore.
// Shelves have a `kind` since update 4. It was added without a new version
// number, because older apps just ignore it, and files without it still restore.
// Since version 3 the backup is a ZIP: the JSON is BACKUP_JSON_NAME, and it
// can also list comics, songs and videos, whose files sit beside it under
// files/<item id>/ (see mediaEntryName). Each list is left out when that kind
// wasn't chosen for the backup. A plain JSON backup from before still restores.
// A tag can carry `images`, as data URIs like covers. They were added without
// a new version number too: older apps ignore them.

export const BACKUP_FORMAT_VERSION = 3;

/** The JSON's name inside a backup ZIP. */
export const BACKUP_JSON_NAME = 'backup.json';

/** Where an item's stored file (a comic page, song or video) goes in a backup ZIP, e.g. "files/abc/2/14.jpg". */
export function mediaEntryName(itemId: Id, fileName: string): string {
  return `files/${itemId}/${fileName}`;
}

interface BackupItem extends Omit<Item, 'coverUri'> {
  cover: string | null;
}

/** One imported book. Chapters are in reading order; `text` is one paragraph per line. */
export interface BackupBook {
  itemId: Id;
  chapters: { id: Id; title: string; text: string }[];
  progress: Omit<ReadingProgress, 'itemId'> | null;
  bookmarks: Omit<Bookmark, 'itemId'>[];
}

/** Where a song or video was stopped, how often it's been played, and when a video was watched. */
export interface BackupPlayback {
  positionMs: number;
  updatedAt: number;
  playCount: number;
  lastPlayedAt: number | null;
  finishedAt: number | null;
}

/** An imported comic. Its page images are separate files in the ZIP. A chapter's fileName is its pages' folder. */
export interface BackupComic {
  itemId: Id;
  readingMode: ReadingMode;
  chapters: { id: Id; title: string; fileName: string }[];
  pages: Page[];
  progress: Omit<ReadingProgress, 'itemId'> | null;
}

/** An imported song or video; the file itself is separate in the ZIP. */
export type BackupSong = Track & { playback: BackupPlayback | null };
export type BackupVideo = Video & { playback: BackupPlayback | null };

/** Imported files to put in a backup, by kind. A kind left out isn't in the backup. */
export interface BackupMedia {
  books?: BackupBook[];
  comics?: BackupComic[];
  songs?: BackupSong[];
  videos?: BackupVideo[];
}

export interface BackupFile extends BackupMedia {
  app: 'EverShelf';
  version: number;
  exportedAt: string;
  shelves: Shelf[];
  items: BackupItem[];
}

export interface ParsedBackup {
  /**
   * Items have coverUri null; covers are restored separately from `covers`.
   * Tag images are still data URIs here, until restoreBackupCovers saves them.
   */
  state: ShelfState;
  /** Item id -> cover as a data URI. */
  covers: Map<Id, string>;
  books: BackupBook[];
  comics: BackupComic[];
  songs: BackupSong[];
  videos: BackupVideo[];
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
  | 'badTag'
  | 'badBook'
  | 'badMedia'
  | 'noBackupInZip';

/** A problem with a backup file. `code` + `params` let screens show it in any language; `message` is English. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    readonly params: { n?: number } = {},
  ) {
    super(translate('en', `backupError.${code}`, params));
  }
}

/**
 * `covers` maps item id -> cover data URI, for items that have one.
 * `tagImages` maps a tag image's stored URI -> its data URI; an image missing
 * from it is left out. Kinds left out of `media` aren't in the file.
 */
export function createBackup(
  state: ShelfState,
  covers: Map<Id, string>,
  exportedAt: Date,
  media: BackupMedia = {},
  tagImages: Map<string, string> = new Map(),
): BackupFile {
  return {
    app: 'EverShelf',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    shelves: state.shelves,
    items: state.items.map(({ coverUri: _coverUri, ...item }) => ({
      ...item,
      tags: item.tags.map(({ images: stored, ...tag }) => {
        const images = (stored ?? []).flatMap((uri) => tagImages.get(uri) ?? []);
        return images.length > 0 ? { ...tag, images } : tag;
      }),
      cover: covers.get(item.id) ?? null,
    })),
    ...media,
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

  if (data.books !== undefined && !Array.isArray(data.books)) throw new BackupError('badBook', { n: 1 });
  const books = (data.books ?? []).map((raw, i) => parseBook(raw, i + 1, itemIds));
  if (new Set(books.map((b) => b.itemId)).size !== books.length) throw new BackupError('badBook', { n: books.length });

  // Comics, songs and videos are numbered together in error messages.
  let mediaCount = 0;
  const list = <T>(raw: unknown, parse: (value: unknown, n: number) => T): T[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new BackupError('badMedia', { n: mediaCount + 1 });
    return raw.map((value) => parse(value, ++mediaCount));
  };
  const comics = list(data.comics, (raw, n) => parseComic(raw, n, itemIds));
  const songs = list(data.songs, (raw, n) => ({ ...parseTrack(raw, n, itemIds), playback: parsePlayback(raw) }));
  const videos = list(data.videos, (raw, n) => ({ ...parseVideo(raw, n, itemIds), playback: parsePlayback(raw) }));
  // An item can have at most one stored book, song or video.
  const withFiles = [...books, ...comics, ...songs, ...videos].map((m) => m.itemId);
  if (new Set(withFiles).size !== withFiles.length) throw new BackupError('badMedia', { n: mediaCount });

  // Shelves from before shelf kinds get the same guess as a database upgrade.
  const kindOfItem = new Map<Id, FileKind>([
    ...books.map((b): [Id, FileKind] => [b.itemId, 'novel']),
    ...comics.map((c): [Id, FileKind] => [c.itemId, 'comic']),
    ...songs.map((t): [Id, FileKind] => [t.itemId, 'music']),
    ...videos.map((v): [Id, FileKind] => [v.itemId, 'video']),
  ]);
  const typedShelves = shelves.map(
    (shelf): Shelf => ({
      ...shelf,
      kind:
        shelf.kind ??
        inferShelfKind(
          shelf.id,
          items.flatMap((item) => {
            const kind = kindOfItem.get(item.id);
            return item.shelfId === shelf.id && kind ? [kind] : [];
          }),
        ),
    }),
  );

  return { state: { shelves: typedShelves, items }, covers, books, comics, songs, videos };
}

/**
 * Chapters must be complete, since they are the book. A reading position or
 * bookmark that doesn't fit is just dropped: losing it is better than
 * refusing the whole backup.
 */
function parseBook(raw: unknown, n: number, itemIds: Set<Id>): BackupBook {
  if (!isObject(raw) || typeof raw.itemId !== 'string' || !itemIds.has(raw.itemId) || !Array.isArray(raw.chapters)) {
    throw new BackupError('badBook', { n });
  }
  const chapters = raw.chapters.map((c) => {
    if (!isObject(c) || typeof c.id !== 'string' || typeof c.title !== 'string' || typeof c.text !== 'string') {
      throw new BackupError('badBook', { n });
    }
    return { id: c.id, title: c.title, text: c.text };
  });
  const chapterIds = new Set(chapters.map((c) => c.id));
  if (chapters.length === 0 || chapterIds.size !== chapters.length) throw new BackupError('badBook', { n });

  const progress = parseProgress(raw.progress, chapterIds);

  const bookmarks = (Array.isArray(raw.bookmarks) ? raw.bookmarks : []).flatMap((b) =>
    isObject(b) &&
    typeof b.id === 'string' &&
    typeof b.chapterId === 'string' &&
    chapterIds.has(b.chapterId) &&
    typeof b.paragraph === 'number' &&
    typeof b.excerpt === 'string' &&
    typeof b.createdAt === 'number'
      ? [{ id: b.id, chapterId: b.chapterId, paragraph: Math.max(0, Math.floor(b.paragraph)), excerpt: b.excerpt, createdAt: b.createdAt }]
      : [],
  );

  return { itemId: raw.itemId, chapters, progress, bookmarks };
}

/** A reading position that doesn't fit the book is dropped: losing it is better than refusing the backup. */
function parseProgress(p: unknown, chapterIds: Set<Id>): Omit<ReadingProgress, 'itemId'> | null {
  return isObject(p) &&
    typeof p.chapterId === 'string' &&
    chapterIds.has(p.chapterId) &&
    typeof p.paragraph === 'number' &&
    typeof p.updatedAt === 'number'
    ? {
        chapterId: p.chapterId,
        paragraph: Math.max(0, Math.floor(p.paragraph)),
        percent: typeof p.percent === 'number' ? Math.min(1, Math.max(0, p.percent)) : 0,
        updatedAt: p.updatedAt,
        finishedAt: typeof p.finishedAt === 'number' ? p.finishedAt : null,
      }
    : null;
}

/**
 * A comic needs every chapter and page, since they are the comic. The files'
 * names are checked again when they're written back (see bookFiles.ts).
 */
function parseComic(raw: unknown, n: number, itemIds: Set<Id>): BackupComic {
  if (!isObject(raw) || typeof raw.itemId !== 'string' || !itemIds.has(raw.itemId)) throw new BackupError('badMedia', { n });
  if (!Array.isArray(raw.chapters) || !Array.isArray(raw.pages)) throw new BackupError('badMedia', { n });
  const chapters = raw.chapters.map((c) => {
    if (!isObject(c) || typeof c.id !== 'string' || typeof c.title !== 'string' || typeof c.fileName !== 'string') {
      throw new BackupError('badMedia', { n });
    }
    return { id: c.id, title: c.title, fileName: c.fileName };
  });
  const chapterIds = new Set(chapters.map((c) => c.id));
  if (chapters.length === 0 || chapterIds.size !== chapters.length) throw new BackupError('badMedia', { n });
  const pages = raw.pages.map((p): Page => {
    if (
      !isObject(p) ||
      typeof p.chapterId !== 'string' ||
      !chapterIds.has(p.chapterId) ||
      !isWhole(p.position) ||
      typeof p.fileName !== 'string' ||
      !isWhole(p.width) ||
      !isWhole(p.height)
    ) {
      throw new BackupError('badMedia', { n });
    }
    return { chapterId: p.chapterId, position: p.position, fileName: p.fileName, width: p.width, height: p.height };
  });
  return {
    itemId: raw.itemId,
    readingMode: READING_MODES.find((m) => m === raw.readingMode) ?? 'ltr',
    chapters,
    pages,
    progress: parseProgress(raw.progress, chapterIds),
  };
}

function parseTrack(raw: unknown, n: number, itemIds: Set<Id>): Track {
  if (!isObject(raw) || typeof raw.itemId !== 'string' || !itemIds.has(raw.itemId) || typeof raw.fileName !== 'string') {
    throw new BackupError('badMedia', { n });
  }
  const format = AUDIO_FORMATS.find((f) => f === raw.format);
  if (!format) throw new BackupError('badMedia', { n });
  return {
    itemId: raw.itemId,
    fileName: raw.fileName,
    format,
    durationMs: wholeOrNull(raw.durationMs),
    trackNumber: wholeOrNull(raw.trackNumber),
    discNumber: wholeOrNull(raw.discNumber),
    lyrics: typeof raw.lyrics === 'string' ? raw.lyrics : '',
  };
}

function parseVideo(raw: unknown, n: number, itemIds: Set<Id>): Video {
  if (!isObject(raw) || typeof raw.itemId !== 'string' || !itemIds.has(raw.itemId) || typeof raw.fileName !== 'string') {
    throw new BackupError('badMedia', { n });
  }
  const format = VIDEO_FORMATS.find((f) => f === raw.format);
  if (!format) throw new BackupError('badMedia', { n });
  return {
    itemId: raw.itemId,
    fileName: raw.fileName,
    format,
    durationMs: wholeOrNull(raw.durationMs),
    width: wholeOrNull(raw.width),
    height: wholeOrNull(raw.height),
    subtitleChoice: typeof raw.subtitleChoice === 'string' ? raw.subtitleChoice : null,
    audioChoice: typeof raw.audioChoice === 'string' ? raw.audioChoice : null,
  };
}

/** Like a reading position, a playback position that doesn't fit is dropped. */
function parsePlayback(raw: unknown): BackupPlayback | null {
  const p = isObject(raw) ? raw.playback : null;
  if (!isObject(p) || !isWhole(p.positionMs) || typeof p.updatedAt !== 'number') return null;
  return {
    positionMs: p.positionMs,
    updatedAt: p.updatedAt,
    playCount: isWhole(p.playCount) ? p.playCount : 0,
    lastPlayedAt: typeof p.lastPlayedAt === 'number' ? p.lastPlayedAt : null,
    finishedAt: typeof p.finishedAt === 'number' ? p.finishedAt : null,
  };
}

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function wholeOrNull(value: unknown): number | null {
  return isWhole(value) ? value : null;
}

/** `kind` is left out when the file has none (or one this version doesn't know); parseBackup fills it in. */
function parseShelf(raw: unknown, n: number): Omit<Shelf, 'kind'> & { kind?: ShelfKind } {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new BackupError('badShelf', { n });
  }
  const defaults = Array.isArray(raw.defaultTagNames) ? raw.defaultTagNames : [];
  // A locked shelf stays locked after a restore. A lock that isn't readable is
  // refused rather than dropped, which would quietly unlock the shelf.
  const lock = raw.lock;
  if (lock !== undefined && !(isObject(lock) && isHex(lock.salt) && isHex(lock.hash))) {
    throw new BackupError('badShelf', { n });
  }
  return {
    id: raw.id,
    name: raw.name,
    ...(isShelfKind(raw.kind) ? { kind: raw.kind } : {}),
    defaultTagNames: defaults.filter((n): n is string => typeof n === 'string'),
    ...(isObject(lock) ? { lock: { salt: lock.salt as string, hash: lock.hash as string } } : {}),
  };
}

/** `n` is the 1-based number of the item the tag belongs to. */
function parseTag(raw: unknown, n: number): Tag {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.value !== 'string') {
    throw new BackupError('badTag', { n });
  }
  // Images are optional: an unreadable one is dropped rather than refusing the backup.
  const images = (Array.isArray(raw.images) ? raw.images : []).filter(
    (image): image is string => typeof image === 'string' && image.startsWith('data:image/'),
  );
  return { id: raw.id, name: raw.name, value: raw.value, ...(images.length > 0 ? { images } : {}) };
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]+$/i.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** e.g. "evershelf-backup-2026-10-27.zip" */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `evershelf-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}
