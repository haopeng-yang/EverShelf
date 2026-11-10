import { strToU8 } from 'fflate';
import type { SQLiteDatabase } from 'expo-sqlite';

import { copyZipEntry } from '../books/comic/zip';
import { ZipWriter } from '../books/zipWriter';
import {
  BACKUP_JSON_NAME,
  backupFileName,
  createBackup,
  mediaEntryName,
  type BackupBook,
  type BackupComic,
  type BackupMedia,
  type BackupSong,
  type BackupVideo,
  type ParsedBackup,
} from '../models/backup';
import { tagImageUris } from '../models/images';
import type { FileKind, Id, Item, ShelfState, Tag } from '../models/types';
import { createBackupZip, freeSpace, type OpenedBackup } from './backupFiles';
import {
  chapterFileName,
  createStoredFile,
  deleteBookFiles,
  itemFolderSize,
  openStoredFile,
  pruneBooks,
  readChapterText,
  storedFileSize,
  writeChapterText,
} from './bookFiles';
import { readCoverAsDataUri, writeCoverFromDataUri } from './covers';
import {
  loadBookInfo,
  loadBookmarks,
  loadChapters,
  loadFileKinds,
  loadPages,
  loadPlayback,
  loadProgress,
  loadTrack,
  loadVideo,
  runStatements,
} from './database';
import { restoreBookStatements, restoreComicStatements, restoreSongStatements, restoreVideoStatements } from './statements';

/** The kinds of imported file a backup can include, each chosen separately. */
export type BackupKind = 'books' | 'comics' | 'songs' | 'videos';
export const BACKUP_KINDS: BackupKind[] = ['books', 'comics', 'songs', 'videos'];
export type BackupChoice = Record<BackupKind, boolean>;

/** How many items of a kind have imported files, and how much space those take. */
export interface BackupKindSize {
  count: number;
  bytes: number;
}

const KIND_OF_FILE: Record<FileKind, BackupKind> = { novel: 'books', comic: 'comics', music: 'songs', video: 'videos' };

/** A stored file to copy into the backup ZIP. */
interface FileToCopy {
  itemId: Id;
  fileName: string;
  size: number;
}

/** What each kind would add to a backup, for the export window. */
export async function measureBackup(db: SQLiteDatabase): Promise<Record<BackupKind, BackupKindSize>> {
  const sizes = Object.fromEntries(BACKUP_KINDS.map((k) => [k, { count: 0, bytes: 0 }])) as Record<BackupKind, BackupKindSize>;
  for (const [itemId, fileKind] of await loadFileKinds(db)) {
    const size = sizes[KIND_OF_FILE[fileKind]];
    size.count += 1;
    size.bytes += itemFolderSize(itemId);
  }
  return sizes;
}

/**
 * Builds a backup ZIP of everything, covers included, plus the imported files
 * of the chosen kinds, and hands it to the share sheet / download. Big files
 * are copied a chunk at a time; `onProgress` reports bytes copied so far.
 */
export async function exportBackup(
  db: SQLiteDatabase,
  state: ShelfState,
  choice: BackupChoice,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const covers = new Map<Id, string>();
  for (const item of state.items) {
    if (!item.coverUri) continue;
    const dataUri = await readCoverAsDataUri(item.coverUri);
    if (dataUri) covers.set(item.id, dataUri);
  }
  const tagImages = new Map<string, string>();
  for (const uri of state.items.flatMap(tagImageUris)) {
    const dataUri = await readCoverAsDataUri(uri);
    if (dataUri) tagImages.set(uri, dataUri);
  }

  const kinds = await loadFileKinds(db);
  const idsOf = (fileKind: FileKind) => state.items.filter((item) => kinds.get(item.id) === fileKind).map((item) => item.id);
  const media: BackupMedia = {};
  const files: FileToCopy[] = [];
  if (choice.books) media.books = await collectBooks(db, idsOf('novel'));
  if (choice.comics) media.comics = await collectComics(db, idsOf('comic'), files);
  if (choice.songs) media.songs = await collectSongs(db, idsOf('music'), files);
  if (choice.videos) media.videos = await collectVideos(db, idsOf('video'), files);

  const now = new Date();
  const json = strToU8(JSON.stringify(createBackup(state, covers, now, media, tagImages)));
  const total = json.length + files.reduce((sum, f) => sum + f.size, 0);
  const free = freeSpace();
  if (free !== null && total > free) throw new NotEnoughSpaceError(total, free);

  const zip = await createBackupZip(backupFileName(now));
  try {
    const writer = new ZipWriter(zip.sink);
    await writer.addBytes(BACKUP_JSON_NAME, json);
    let done = json.length;
    onProgress?.(done, total);
    for (const file of files) {
      const source = openStoredFile(file.itemId, file.fileName);
      try {
        await writer.addStored(mediaEntryName(file.itemId, file.fileName), file.size, source.read, (bytes) => {
          done += bytes;
          onProgress?.(done, total);
        });
      } finally {
        source.close();
      }
    }
    await writer.finish();
  } catch (error) {
    zip.discard();
    throw error;
  }
  await zip.share();
}

/** The phone doesn't have room for the backup. Sizes are in bytes. */
export class NotEnoughSpaceError extends Error {
  constructor(
    readonly needed: number,
    readonly free: number,
  ) {
    super(`Not enough free space for the backup: needs ${needed} bytes, ${free} free`);
  }
}

async function collectBooks(db: SQLiteDatabase, itemIds: Id[]): Promise<BackupBook[]> {
  const books: BackupBook[] = [];
  for (const itemId of itemIds) {
    const [chapters, progress, bookmarks] = await Promise.all([
      loadChapters(db, itemId),
      loadProgress(db, itemId),
      loadBookmarks(db, itemId),
    ]);
    const withText = [];
    for (const chapter of chapters) {
      // A missing file becomes an empty chapter, so the rest of the book still restores.
      const text = (await readChapterText(itemId, chapter.fileName)) ?? '';
      withText.push({ id: chapter.id, title: chapter.title, text });
    }
    books.push({
      itemId,
      chapters: withText,
      progress: progress && withoutItemId(progress),
      bookmarks: bookmarks.map(withoutItemId),
    });
  }
  return books;
}

/**
 * Comics, songs and videos whose files are all there; one with a file missing
 * is left out, and is backed up as a plain item. Their files go in `files`.
 */
async function collectComics(db: SQLiteDatabase, itemIds: Id[], files: FileToCopy[]): Promise<BackupComic[]> {
  const comics: BackupComic[] = [];
  for (const itemId of itemIds) {
    const [chapters, pages, info, progress] = await Promise.all([
      loadChapters(db, itemId),
      loadPages(db, itemId),
      loadBookInfo(db, itemId),
      loadProgress(db, itemId),
    ]);
    const pageFiles = filesIfAllThere(itemId, pages.map((p) => p.fileName));
    if (!pageFiles) continue;
    files.push(...pageFiles);
    comics.push({
      itemId,
      readingMode: info.readingMode,
      chapters: chapters.map((c) => ({ id: c.id, title: c.title, fileName: c.fileName })),
      pages,
      progress: progress && withoutItemId(progress),
    });
  }
  return comics;
}

async function collectSongs(db: SQLiteDatabase, itemIds: Id[], files: FileToCopy[]): Promise<BackupSong[]> {
  const songs: BackupSong[] = [];
  for (const itemId of itemIds) {
    const track = await loadTrack(db, itemId);
    const file = track && filesIfAllThere(itemId, [track.fileName]);
    if (!track || !file) continue;
    files.push(...file);
    songs.push({ ...track, playback: await loadPlayback(db, itemId) });
  }
  return songs;
}

async function collectVideos(db: SQLiteDatabase, itemIds: Id[], files: FileToCopy[]): Promise<BackupVideo[]> {
  const videos: BackupVideo[] = [];
  for (const itemId of itemIds) {
    const video = await loadVideo(db, itemId);
    const file = video && filesIfAllThere(itemId, [video.fileName]);
    if (!video || !file) continue;
    files.push(...file);
    videos.push({ ...video, playback: await loadPlayback(db, itemId) });
  }
  return videos;
}

function filesIfAllThere(itemId: Id, fileNames: string[]): FileToCopy[] | null {
  const found: FileToCopy[] = [];
  for (const fileName of fileNames) {
    const size = storedFileSize(itemId, fileName);
    if (size === null) {
      console.warn('Leaving files out of the backup: one is missing', itemId, fileName);
      return null;
    }
    found.push({ itemId, fileName, size });
  }
  return found;
}

function withoutItemId<T extends { itemId: Id }>({ itemId: _itemId, ...rest }: T): Omit<T, 'itemId'> {
  return rest;
}

/** Saves a parsed backup's covers and tag images into app storage and returns the state to load. */
export async function restoreBackupCovers(backup: ParsedBackup): Promise<ShelfState> {
  const write = async (dataUri: string, title: string): Promise<string | null> => {
    try {
      return await writeCoverFromDataUri(dataUri);
    } catch (error) {
      console.warn('Skipping unreadable image for', title, error);
      return null;
    }
  };
  const items: Item[] = [];
  for (const item of backup.state.items) {
    const dataUri = backup.covers.get(item.id);
    const coverUri = dataUri ? await write(dataUri, item.title) : null;
    const tags: Tag[] = [];
    for (const { images: dataUris, ...tag } of item.tags) {
      const images: string[] = [];
      for (const image of dataUris ?? []) {
        const uri = await write(image, item.title);
        if (uri) images.push(uri);
      }
      tags.push(images.length > 0 ? { ...tag, images } : tag);
    }
    items.push({ ...item, coverUri, tags });
  }
  return { ...backup.state, items };
}

/**
 * How many of each kind a backup can restore with their files: books are in
 * the JSON; a comic, song or video needs all its files in the ZIP.
 */
export function restorableCounts(backup: ParsedBackup, opened: OpenedBackup): Record<BackupKind, number> {
  return {
    books: backup.books.length,
    comics: backup.comics.filter((c) => hasFiles(opened, c.itemId, c.pages.map((p) => p.fileName))).length,
    songs: backup.songs.filter((s) => hasFiles(opened, s.itemId, [s.fileName])).length,
    videos: backup.videos.filter((v) => hasFiles(opened, v.itemId, [v.fileName])).length,
  };
}

function hasFiles(opened: OpenedBackup, itemId: Id, fileNames: string[]): boolean {
  return fileNames.every((name) => opened.entries.has(mediaEntryName(itemId, name)));
}

/**
 * Writes a backup's imported files back, with their rows: books' chapters,
 * and comics', songs' and videos' files copied out of the ZIP. Must run after
 * the backup's items are saved, since these belong to items. Item folders not
 * restored are deleted. An item that fails is skipped (and logged) so the
 * others still restore; it stays as a plain item. Returns how many of each
 * kind were restored.
 */
export async function restoreBackupFiles(
  db: SQLiteDatabase,
  backup: ParsedBackup,
  opened: OpenedBackup,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<BackupKind, number>> {
  const restored = new Set<Id>();
  const counts: Record<BackupKind, number> = { books: 0, comics: 0, songs: 0, videos: 0 };
  const restore = async (kind: BackupKind, itemId: Id, work: () => Promise<void>) => {
    try {
      deleteBookFiles(itemId);
      await work();
      restored.add(itemId);
      counts[kind] += 1;
    } catch (error) {
      console.warn('Could not restore', kind, itemId, error);
      deleteBookFiles(itemId);
    }
  };

  const comics = backup.comics.filter((c) => hasFiles(opened, c.itemId, c.pages.map((p) => p.fileName)));
  const songs = backup.songs.filter((s) => hasFiles(opened, s.itemId, [s.fileName]));
  const videos = backup.videos.filter((v) => hasFiles(opened, v.itemId, [v.fileName]));
  const sizeOf = (itemId: Id, fileName: string) => opened.entries.get(mediaEntryName(itemId, fileName))?.size ?? 0;
  const total =
    comics.reduce((sum, c) => sum + c.pages.reduce((s, p) => s + sizeOf(c.itemId, p.fileName), 0), 0) +
    [...songs, ...videos].reduce((sum, m) => sum + sizeOf(m.itemId, m.fileName), 0);
  let done = 0;
  const copy = async (itemId: Id, fileName: string) => {
    const entry = opened.entries.get(mediaEntryName(itemId, fileName));
    if (!entry || !opened.source) throw new Error(`Missing from the backup: ${fileName}`);
    const file = createStoredFile(itemId, fileName);
    try {
      await copyZipEntry(opened.source, entry, async (chunk) => {
        await file.write(chunk);
        done += chunk.length;
        onProgress?.(done, total);
      });
    } finally {
      file.close();
    }
  };

  for (const book of backup.books) {
    await restore('books', book.itemId, async () => {
      for (const [position, chapter] of book.chapters.entries()) {
        await writeChapterText(book.itemId, chapterFileName(position), chapter.text);
      }
      await runStatements(db, restoreBookStatements(book, chapterFileName));
    });
  }
  for (const comic of comics) {
    await restore('comics', comic.itemId, async () => {
      for (const page of comic.pages) await copy(comic.itemId, page.fileName);
      await runStatements(db, restoreComicStatements(comic));
    });
  }
  for (const song of songs) {
    await restore('songs', song.itemId, async () => {
      await copy(song.itemId, song.fileName);
      await runStatements(db, restoreSongStatements(song));
    });
  }
  for (const video of videos) {
    await restore('videos', video.itemId, async () => {
      await copy(video.itemId, video.fileName);
      await runStatements(db, restoreVideoStatements(video));
    });
  }
  pruneBooks(restored);
  return counts;
}
