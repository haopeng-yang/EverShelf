import * as DocumentPicker from 'expo-document-picker';
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
import { parseEpub, type ParsedEpub } from './parseEpub';
import type { ParsedChapter } from './parseTxt';

/** A picked file, read but not saved yet. TXT is split later, so the split rule can still change. */
export type PickedBookFile =
  | { kind: 'txt'; name: string; text: string; encoding: TextEncodingName }
  | { kind: 'epub'; name: string; book: ParsedEpub };

export class UnsupportedFileError extends Error {}

/** Opens the system file picker for a .txt or .epub file. Null if the user cancels. */
export async function pickBookFile(): Promise<PickedBookFile | null> {
  // Some file managers report book files as octet-stream, so accept anything
  // and check the extension ourselves.
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const extension = /\.(\w+)$/.exec(asset.name)?.[1]?.toLowerCase();
  if (extension !== 'txt' && extension !== 'epub') throw new UnsupportedFileError(asset.name);
  const file = new File(asset.uri);
  try {
    const bytes = await file.bytes();
    if (extension === 'epub') return { kind: 'epub', name: asset.name, book: parseEpub(bytes) };
    const { text, encoding } = decodeText(bytes);
    return { kind: 'txt', name: asset.name, text, encoding };
  } finally {
    try {
      // The picker's copy is only needed until it has been read.
      file.delete();
    } catch {
      // The system clears the cache eventually anyway.
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
