import { Directory, File, Paths } from 'expo-file-system';

import type { Id } from '../models/types';

// Chapter text is stored as one UTF-8 file per chapter in
// <documents>/books/<itemId>/, so the database stays small and a long book
// never has to be loaded into memory all at once. Comic pages and song files
// live in the same per-item folder, so deleting an item, and the cleanup after
// a restore, cover them too. bookFiles.web.ts is used on web instead, where
// there is no file system.

function booksDirectory(): Directory {
  return new Directory(Paths.document, 'books');
}

function bookDirectory(itemId: Id): Directory {
  // Ids can come from backup files, so never let one reach outside books/.
  if (!/^[\w-]+$/.test(itemId)) throw new Error(`Invalid item id for book files: ${itemId}`);
  return new Directory(booksDirectory(), itemId);
}

/** File name for the chapter at a 0-based position. */
export function chapterFileName(position: number): string {
  return `${position}.txt`;
}

/** Folder for the comic chapter at a 0-based position; its pages go inside. */
export function comicChapterFolder(position: number): string {
  return String(position);
}

/** File name of a comic page, e.g. "2/14.jpg" for chapter 2, page 14. */
export function pageFileName(chapterPosition: number, pagePosition: number, extension: string): string {
  return `${comicChapterFolder(chapterPosition)}/${pagePosition}.${extension.toLowerCase()}`;
}

/** The page image's file URI, for showing it. Null if the name isn't a page file name. */
export function pageUri(itemId: Id, fileName: string): string | null {
  return pageFile(itemId, fileName)?.file.uri ?? null;
}

/** Writes (or overwrites) one comic page's image. */
export async function writePageBytes(itemId: Id, fileName: string, bytes: Uint8Array): Promise<void> {
  const page = pageFile(itemId, fileName);
  if (!page) throw new Error(`Invalid page file name: ${fileName}`);
  page.folder.create({ idempotent: true, intermediates: true });
  page.file.create({ overwrite: true });
  await page.file.write(bytes);
}

function pageFile(itemId: Id, fileName: string): { folder: Directory; file: File } | null {
  // Like ids, page names can come from backups, so never let one reach outside the book's folder.
  const match = /^(\d+)\/(\d+\.[a-z0-9]+)$/.exec(fileName);
  if (!match) return null;
  const folder = new Directory(bookDirectory(itemId), match[1]);
  return { folder, file: new File(folder, match[2]) };
}

/** File name of a song in its item's folder, e.g. "song.flac". */
export function songFileName(extension: string): string {
  return `song.${extension.toLowerCase()}`;
}

/** File name of a video in its item's folder, e.g. "video.mp4". */
export function videoFileName(extension: string): string {
  return `video.${extension.toLowerCase()}`;
}

function mediaFile(itemId: Id, fileName: string): File {
  // Names come from the database (and maybe backups later): only song.<ext> or video.<ext>.
  if (!/^(song|video)\.[a-z0-9]{1,5}$/.test(fileName)) throw new Error(`Invalid media file name: ${fileName}`);
  return new File(bookDirectory(itemId), fileName);
}

/**
 * Puts a picked song or video into its item's folder. A temporary copy (one
 * the app made, or iOS's copy of the pick) is moved; the user's own file is
 * copied. Either way the native side does it, so the file never passes
 * through memory.
 */
export async function storeMediaFile(itemId: Id, fileName: string, from: File, temporary: boolean): Promise<void> {
  const directory = bookDirectory(itemId);
  directory.create({ idempotent: true, intermediates: true });
  const destination = mediaFile(itemId, fileName);
  if (temporary) await from.move(destination, { overwrite: true });
  else await from.copy(destination, { overwrite: true });
}

/** The stored song's or video's file URI, for the player. */
export function mediaUri(itemId: Id, fileName: string): string {
  return mediaFile(itemId, fileName).uri;
}

/** Writes (or overwrites) one chapter's text. */
export async function writeChapterText(itemId: Id, fileName: string, text: string): Promise<void> {
  const directory = bookDirectory(itemId);
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, fileName);
  file.create({ overwrite: true });
  await file.write(text);
}

/** Reads one chapter's text. Null if the file is missing. */
export async function readChapterText(itemId: Id, fileName: string): Promise<string | null> {
  try {
    const file = new File(bookDirectory(itemId), fileName);
    if (!file.exists) return null;
    return await file.text();
  } catch (error) {
    console.warn('Could not read chapter', itemId, fileName, error);
    return null;
  }
}

/** Deletes all of a book's chapter files. Safe to call for items that aren't books. */
export function deleteBookFiles(itemId: Id): void {
  try {
    const directory = bookDirectory(itemId);
    if (directory.exists) directory.delete();
  } catch (error) {
    console.warn('Could not delete book files', itemId, error);
  }
}

/** Deletes book folders that no chapter rows point to any more (e.g. after restoring a backup). */
export function pruneBooks(bookItemIds: Set<Id>): void {
  const directory = booksDirectory();
  let entries: ReturnType<Directory['list']>;
  try {
    if (!directory.exists) return;
    entries = directory.list();
  } catch (error) {
    // Leftover files only waste space, so never let cleanup fail an import.
    console.warn('Could not list books for cleanup', error);
    return;
  }
  for (const entry of entries) {
    if (entry instanceof Directory && !bookItemIds.has(entry.name)) {
      try {
        entry.delete();
      } catch (error) {
        console.warn('Could not delete unused book folder', entry.uri, error);
      }
    }
  }
}
