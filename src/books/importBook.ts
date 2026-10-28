import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { newItemDraft } from '../models/actions';
import { newId } from '../models/ids';
import type { Chapter, Item, Shelf } from '../models/types';
import type { ShelfDispatch } from '../state/ShelfProvider';
import { chapterFileName, deleteBookFiles, writeChapterText } from '../storage/bookFiles';
import { saveChapters } from '../storage/database';
import { decodeText, type TextEncodingName } from './decodeText';
import type { ParsedChapter } from './parseTxt';

export interface PickedBookFile {
  name: string;
  text: string;
  encoding: TextEncodingName;
}

export class UnsupportedFileError extends Error {}

/** Opens the system file picker for a .txt file. Null if the user cancels. */
export async function pickTxtFile(): Promise<PickedBookFile | null> {
  // Some file managers report .txt files as octet-stream, so accept anything
  // and check the extension ourselves.
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!/\.txt$/i.test(asset.name)) throw new UnsupportedFileError(asset.name);
  const file = new File(asset.uri);
  try {
    const { text, encoding } = decodeText(await file.bytes());
    return { name: asset.name, text, encoding };
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
  author: string;
  /** Name of the tag the author goes in (e.g. "Author" / "作者"). */
  authorTagName: string;
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
  const author = book.author.trim();
  const authorTag = draft.tags.find((tag) => tag.name === book.authorTagName);
  const tags = !author
    ? draft.tags
    : authorTag
      ? draft.tags.map((tag) => (tag === authorTag ? { ...tag, value: author } : tag))
      : [{ id: newId(), name: book.authorTagName, value: author }, ...draft.tags];
  const item: Item = { ...draft, tags };

  const chapters: Chapter[] = book.chapters.map((chapter, position) => ({
    id: newId(),
    itemId: item.id,
    position,
    title: chapter.title,
    fileName: chapterFileName(position),
    charCount: chapter.text.length,
  }));

  let itemAdded = false;
  try {
    for (const [index, chapter] of chapters.entries()) {
      await writeChapterText(item.id, chapter.fileName, book.chapters[index].text);
      onProgress?.(index + 1, chapters.length);
    }
    // Chapters reference the item, so it must be saved first.
    itemAdded = true;
    if (!(await dispatch({ type: 'item/add', item }))) throw new Error('Could not save the book');
    await saveChapters(db, item.id, chapters);
    return item;
  } catch (error) {
    if (itemAdded) void dispatch({ type: 'item/remove', itemId: item.id });
    deleteBookFiles(item.id);
    throw error;
  }
}
