import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { fillTags, newItemDraft } from '../models/actions';
import { newId } from '../models/ids';
import type { Chapter, Item, Page, ReadingMode, Shelf } from '../models/types';
import type { ShelfDispatch } from '../state/ShelfProvider';
import { comicChapterFolder, deleteBookFiles, pageFileName, writePageBytes } from '../storage/bookFiles';
import { deleteCover, writeCoverBytes } from '../storage/covers';
import { saveComic } from '../storage/database';
import {
  baseName,
  chapterTitle,
  imageExtension,
  imageSize,
  naturalCompare,
  parseComicInfo,
  planChapters,
  seriesTitle,
  type ComicInfo,
  type PlannedChapter,
} from './comic/parseComic';
import { readZipEntries, readZipEntry, type ByteSource, type ZipEntry } from './comic/zip';
import { decodeText } from './decodeText';
import { hasExtension } from './detectFormat';

// Imports .cbz/.zip comics. Unlike novels, a comic file is never read into
// memory whole: each page is read from the file, written to its own image
// file, and dropped, so a 500 MB file needs only a few MB at a time.

/** Pages looked at when picking, to guess the reading mode from their shape. */
const SAMPLE_PAGES = 6;
/** Room left free on the phone after an import, on top of the pages themselves. */
const SPARE_SPACE = 50 * 1024 * 1024;

export type ComicErrorCode = 'noPages' | 'noSpace';

export class ComicError extends Error {
  constructor(readonly code: ComicErrorCode) {
    super(`Comic error: ${code}`);
  }
}

/** One picked file and the list of what's inside it. */
interface ComicFile {
  file: File;
  /** '' when the picker gave no real file name (an Android content link). */
  name: string;
  entries: Map<string, ZipEntry>;
  /** True if `file` is a copy in the cache that must be deleted afterwards. */
  temporary: boolean;
}

/** One or more picked comic files, read but not saved yet. Call disposeComic when done with it. */
export interface PickedComic {
  files: ComicFile[];
  chapters: PlannedChapter[];
  pageCount: number;
  title: string;
  author: string;
  description: string;
  cover: { bytes: Uint8Array; extension: string } | null;
  /** From ComicInfo.xml: the comic says it reads right to left. */
  rightToLeft: boolean;
  /** Sizes of the first few pages, for guessReadingMode. */
  sampleSizes: ({ width: number; height: number } | null)[];
}

/**
 * Reads the list of pages in one or more ZIP/CBZ files picked together. Several
 * files become one comic with a chapter per file (sorted by name when the names
 * are known; in the picked order otherwise).
 */
export async function openComic(picked: File[]): Promise<PickedComic> {
  const files: ComicFile[] = [];
  try {
    for (const file of picked) files.push(await openComicFile(file));
    if (files.every((f) => f.name)) files.sort((a, b) => naturalCompare(a.name, b.name));

    const first = files[0];
    const infoEntry = [...first.entries.values()].find((e) => e.name.toLowerCase() === 'comicinfo.xml');
    const info: ComicInfo | null = infoEntry
      ? await withSource(first.file, async (source) => parseComicInfo(decodeText(await readZipEntry(source, infoEntry)).text))
      : null;

    const series = files.length > 1 ? info?.series || seriesTitle(files.map((f) => f.name)) : '';
    const chapters = planChapters(
      files.map((f) => ({
        title: files.length > 1 && f.name ? chapterTitle(f.name, series) : '',
        names: [...f.entries.keys()],
      })),
    );
    const pages = chapters.flatMap((c) => c.pages);
    if (pages.length === 0) throw new ComicError('noPages');

    const samples: Uint8Array[] = [];
    for (const page of pages.slice(0, SAMPLE_PAGES)) samples.push(await readPage(files, page));
    const coverExtension = imageExtension(pages[0].name);

    return {
      files,
      chapters,
      pageCount: pages.length,
      title: files.length > 1 ? series : info?.series || info?.title || baseName(first.name),
      author: info?.writer ?? '',
      description: info?.summary ?? '',
      cover: coverExtension ? { bytes: samples[0], extension: coverExtension } : null,
      rightToLeft: info?.rightToLeft ?? false,
      sampleSizes: samples.map(imageSize),
    };
  } catch (error) {
    disposeFiles(files);
    throw error;
  }
}

/** Deletes any cache copies made while picking. Safe to call more than once. */
export function disposeComic(comic: PickedComic): void {
  disposeFiles(comic.files);
}

export interface ComicToSave {
  shelf: Shelf;
  title: string;
  /** Values for tags by name, e.g. { Author: 'Mira Holt' }. Empty values are skipped. */
  tagValues: Record<string, string>;
  comic: PickedComic;
  readingMode: ReadingMode;
  /** One per planned chapter, already filled in where the plan had none. */
  chapterTitles: string[];
}

/**
 * Adds the comic to its shelf as a new item and saves every page as an image
 * file. Calls onProgress(done, total) per page. If anything fails, whatever was
 * saved is removed again.
 */
export async function saveImportedComic(
  db: SQLiteDatabase,
  dispatch: ShelfDispatch,
  toSave: ComicToSave,
  onProgress?: (done: number, total: number) => void,
): Promise<Item> {
  const { comic } = toSave;
  const needed = comic.chapters.flatMap((c) => c.pages).reduce((sum, p) => sum + (entryOf(comic.files, p)?.size ?? 0), 0);
  if (Paths.availableDiskSpace < needed + SPARE_SPACE) throw new ComicError('noSpace');

  const draft = newItemDraft(toSave.shelf, toSave.title);
  const chapters: Chapter[] = [];
  const pages: Page[] = [];
  let coverUri: string | null = null;
  let itemAdded = false;
  try {
    if (comic.cover) coverUri = await writeCoverBytes(comic.cover.bytes, comic.cover.extension);
    let done = 0;
    for (const [position, planned] of comic.chapters.entries()) {
      const chapter: Chapter = {
        id: newId(),
        itemId: draft.id,
        position,
        title: toSave.chapterTitles[position] ?? '',
        fileName: comicChapterFolder(position),
        charCount: planned.pages.length,
      };
      chapters.push(chapter);
      for (const [pagePosition, page] of planned.pages.entries()) {
        const bytes = await readPage(comic.files, page);
        const fileName = pageFileName(position, pagePosition, imageExtension(page.name) ?? 'jpg');
        await writePageBytes(draft.id, fileName, bytes);
        const size = imageSize(bytes);
        pages.push({ chapterId: chapter.id, position: pagePosition, fileName, width: size?.width ?? 0, height: size?.height ?? 0 });
        onProgress?.(++done, comic.pageCount);
      }
    }
    // Chapters reference the item, so it must be saved first.
    const item: Item = { ...draft, tags: fillTags(draft.tags, toSave.tagValues), coverUri };
    itemAdded = true;
    if (!(await dispatch({ type: 'item/add', item }))) throw new Error('Could not save the comic');
    await saveComic(db, { itemId: item.id, kind: 'comic', readingMode: toSave.readingMode }, chapters, pages);
    return item;
  } catch (error) {
    if (itemAdded) void dispatch({ type: 'item/remove', itemId: draft.id });
    deleteBookFiles(draft.id);
    deleteCover(coverUri);
    throw error;
  }
}

/** Names of everything inside a ZIP file, read from its end without loading the whole file. */
export async function zipEntryNames(file: File): Promise<string[]> {
  const opened = await openComicFile(file);
  disposeFiles([opened]);
  return [...opened.entries.keys()];
}

async function openComicFile(file: File): Promise<ComicFile> {
  const name = hasExtension(file.name) ? file.name : '';
  const opened = await openReadable(file);
  try {
    const entries = await withSource(opened.file, readZipEntries);
    return { file: opened.file, name, entries: new Map(entries.map((e) => [e.name, e])), temporary: opened.temporary };
  } catch (error) {
    if (opened.temporary) deleteQuietly(opened.file);
    throw error;
  }
}

/**
 * Makes sure the file can be opened for reading at any offset. Some Android
 * providers refuse that for content links; those are copied to the cache first.
 */
async function openReadable(file: File): Promise<{ file: File; temporary: boolean }> {
  try {
    file.open().close();
    return { file, temporary: false };
  } catch (error) {
    console.warn('Could not open the comic directly, copying it first', file.uri, error);
    const copy = new File(Paths.cache, `comic-${newId()}.zip`);
    await file.copy(copy);
    return { file: copy, temporary: true };
  }
}

/** Opens the file, runs `work` with a ByteSource over it, and closes it again. */
async function withSource<T>(file: File, work: (source: ByteSource) => Promise<T>): Promise<T> {
  const handle = file.open();
  try {
    const source: ByteSource = {
      size: handle.size ?? file.size,
      read: async (offset, length) => {
        // One read at a time: the handle has a single position.
        handle.offset = offset;
        return handle.readBytes(length);
      },
    };
    return await work(source);
  } finally {
    handle.close();
  }
}

function entryOf(files: ComicFile[], page: { source: number; name: string }): ZipEntry | undefined {
  return files[page.source]?.entries.get(page.name);
}

async function readPage(files: ComicFile[], page: { source: number; name: string }): Promise<Uint8Array> {
  const entry = entryOf(files, page);
  if (!entry) throw new Error(`Missing page ${page.name}`);
  return withSource(files[page.source].file, (source) => readZipEntry(source, entry));
}

function disposeFiles(files: ComicFile[]): void {
  for (const f of files) if (f.temporary) deleteQuietly(f.file);
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch (error) {
    console.warn('Could not delete a temporary comic copy', file.uri, error);
  }
}
