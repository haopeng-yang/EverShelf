import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { fillTags, newItemDraft } from '../models/actions';
import { newId } from '../models/ids';
import type { Chapter, Item, Shelf } from '../models/types';
import type { ShelfDispatch } from '../state/ShelfProvider';
import { chapterFileName, deleteBookFiles, writeChapterText } from '../storage/bookFiles';
import { deleteCover, writeCoverBytes } from '../storage/covers';
import { saveChapters } from '../storage/database';
import { decodeText, type TextEncodingName } from './decodeText';
import { detectFormat, hasExtension } from './detectFormat';
import { openComic, zipEntryNames, type PickedComic } from './importComic';
import { parseEpub, type ParsedEpub } from './parseEpub';
import type { ParsedChapter } from './parseTxt';

/** A picked file, read but not saved yet. TXT is split later, so the split rule can still change. */
export type PickedBookFile =
  // name is '' when the picker gave no real file name (an Android content link).
  | { kind: 'txt'; name: string; text: string; encoding: TextEncodingName }
  | { kind: 'epub'; name: string; book: ParsedEpub }
  /** One or more .cbz/.zip files; name lists the picked file names. */
  | { kind: 'comic'; name: string; comic: PickedComic };

export class UnsupportedFileError extends Error {}

/** Several files were picked, but they aren't all comics (only comics import as a set). */
export class MixedFilesError extends Error {}

/**
 * Opens the system file picker for a .txt, .epub or comic (.cbz/.zip) file, or
 * several comic files that make up one series. Null if the user cancels.
 */
export async function pickBookFile(): Promise<PickedBookFile | null> {
  // expo-file-system's own picker returns a File the app is allowed to read;
  // reading expo-document-picker's result with File was refused on Android
  // ("missing READ permission"). Any type is accepted, since some file
  // managers report book files as octet-stream; detectFormat checks the file.
  // These are the user's own files, so they are only read, never deleted.
  const picked = await File.pickFileAsync({ mimeTypes: '*/*', multipleFiles: true });
  if (picked.canceled || !picked.result || picked.result.length === 0) return null;
  // A content link's "name" is an id like "msf:1000033298"; don't show that as a file name.
  const names = picked.result.map((file) => (hasExtension(file.name) ? file.name : ''));

  if (picked.result.length > 1) {
    for (const file of picked.result) {
      if ((await formatOf(file)) !== 'comic') throw new MixedFilesError();
    }
    return { kind: 'comic', name: names.filter(Boolean).join(', '), comic: await openComic(picked.result) };
  }

  const [file] = picked.result;
  const [name] = names;
  const format = await formatOf(file);
  if (!format) throw new UnsupportedFileError(name);
  if (format === 'comic') return { kind: 'comic', name, comic: await openComic([file]) };
  const bytes = await readBytes(file);
  if (format === 'epub') return { kind: 'epub', name, book: parseEpub(bytes) };
  const { text, encoding } = decodeText(bytes);
  return { kind: 'txt', name, text, encoding };
}

/**
 * Works out what a picked file is from its name, type and first bytes, without
 * reading it all (comics can be huge). A ZIP is an EPUB if it has an EPUB's
 * container file, and a comic otherwise.
 */
async function formatOf(file: File): Promise<'txt' | 'epub' | 'comic' | null> {
  const head = await readHead(file);
  const format = detectFormat(head, file.name, file.type);
  if (format !== 'zip') return format;
  try {
    const names = await zipEntryNames(file);
    return names.includes('META-INF/container.xml') ? 'epub' : 'comic';
  } catch {
    return null;
  }
}

/** The first few KB of a file, for detectFormat. */
async function readHead(file: File): Promise<Uint8Array> {
  try {
    const handle = file.open();
    try {
      return await handle.readBytes(4096);
    } finally {
      handle.close();
    }
  } catch {
    // Providers that can't be opened this way: fall back to reading it all, as before.
    return (await readBytes(file)).subarray(0, 4096);
  }
}

/** Reads a picked file, falling back to fetch for URIs the File API won't open (as the backup import does). */
async function readBytes(file: File): Promise<Uint8Array> {
  try {
    return await file.bytes();
  } catch (fileError) {
    console.warn('File API could not read the book, trying fetch', file.uri, fileError);
    try {
      return new Uint8Array(await (await fetch(file.uri)).arrayBuffer());
    } catch {
      throw fileError;
    }
  }
}

export interface BookToSave {
  shelf: Shelf;
  title: string;
  /** Values for tags by name, e.g. { Author: 'Mira Holt' }. Empty values are skipped. */
  tagValues: Record<string, string>;
  cover: { bytes: Uint8Array; extension: string } | null;
  chapters: ParsedChapter[];
}

/**
 * Adds the book to its shelf as a new item and saves its chapters.
 * Calls onProgress(done, total) as chapter files are written.
 * If anything fails, whatever was saved is removed again.
 */
export async function saveImportedBook(
  db: SQLiteDatabase,
  dispatch: ShelfDispatch,
  book: BookToSave,
  onProgress?: (done: number, total: number) => void,
): Promise<Item> {
  const draft = newItemDraft(book.shelf, book.title);
  const tags = fillTags(draft.tags, book.tagValues);

  const chapters: Chapter[] = book.chapters.map((chapter, position) => ({
    id: newId(),
    itemId: draft.id,
    position,
    title: chapter.title,
    fileName: chapterFileName(position),
    charCount: chapter.text.length,
  }));

  let coverUri: string | null = null;
  let itemAdded = false;
  try {
    if (book.cover) coverUri = await writeCoverBytes(book.cover.bytes, book.cover.extension);
    for (const [index, chapter] of chapters.entries()) {
      await writeChapterText(draft.id, chapter.fileName, book.chapters[index].text);
      onProgress?.(index + 1, chapters.length);
    }
    // Chapters reference the item, so it must be saved first.
    const item: Item = { ...draft, tags, coverUri };
    itemAdded = true;
    if (!(await dispatch({ type: 'item/add', item }))) throw new Error('Could not save the book');
    await saveChapters(db, item.id, chapters);
    return item;
  } catch (error) {
    if (itemAdded) void dispatch({ type: 'item/remove', itemId: draft.id });
    deleteBookFiles(draft.id);
    deleteCover(coverUri);
    throw error;
  }
}
