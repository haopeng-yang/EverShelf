import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { newItemDraft } from '../models/actions';
import { newId } from '../models/ids';
import type { Chapter, Item, Shelf } from '../models/types';
import type { ShelfDispatch } from '../state/ShelfProvider';
import { chapterFileName, deleteBookFiles, writeChapterText } from '../storage/bookFiles';
import { deleteCover, writeCoverBytes } from '../storage/covers';
import { saveChapters } from '../storage/database';
import { decodeText, type TextEncodingName } from './decodeText';
import { detectFormat, hasExtension } from './detectFormat';
import { parseEpub, type ParsedEpub } from './parseEpub';
import type { ParsedChapter } from './parseTxt';

/** A picked file, read but not saved yet. TXT is split later, so the split rule can still change. */
export type PickedBookFile =
  // name is '' when the picker gave no real file name (an Android content link).
  | { kind: 'txt'; name: string; text: string; encoding: TextEncodingName }
  | { kind: 'epub'; name: string; book: ParsedEpub };

export class UnsupportedFileError extends Error {}

/** Opens the system file picker for a .txt or .epub file. Null if the user cancels. */
export async function pickBookFile(): Promise<PickedBookFile | null> {
  // expo-file-system's own picker returns a File the app is allowed to read;
  // reading expo-document-picker's result with File was refused on Android
  // ("missing READ permission"). Any type is accepted, since some file
  // managers report book files as octet-stream; detectFormat checks the file.
  // This is the user's own file, so it is only read, never deleted.
  const picked = await File.pickFileAsync({ mimeTypes: '*/*' });
  if (picked.canceled || !picked.result) return null;
  const file = picked.result;
  // A content link's "name" is an id like "msf:1000033298"; don't show that as a file name.
  const name = hasExtension(file.name) ? file.name : '';
  const bytes = await readBytes(file);
  const format = detectFormat(bytes, file.name, file.type);
  if (!format) throw new UnsupportedFileError(name);
  if (format === 'epub') return { kind: 'epub', name, book: parseEpub(bytes) };
  const { text, encoding } = decodeText(bytes);
  return { kind: 'txt', name, text, encoding };
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
  let tags = draft.tags;
  for (const [name, rawValue] of Object.entries(book.tagValues)) {
    const value = rawValue.trim();
    if (!value) continue;
    // Fill the shelf's default tag if it has one with this name; otherwise add it.
    tags = tags.some((tag) => tag.name === name)
      ? tags.map((tag) => (tag.name === name ? { ...tag, value } : tag))
      : [...tags, { id: newId(), name, value }];
  }

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
