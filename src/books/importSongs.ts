import { Paths, type File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { fillTags, newItemDraft } from '../models/actions';
import type { Item, Shelf, Track } from '../models/types';
import type { ShelfDispatch } from '../state/ShelfProvider';
import { deleteBookFiles, songFileName, storeMediaFile } from '../storage/bookFiles';
import { deleteCover, writeCoverBytes } from '../storage/covers';
import { saveTrack } from '../storage/database';
import { naturalCompare } from './comic/parseComic';
import { AudioError, type AudioErrorCode } from './music/audioTags';
import { readAudio, titleFromFileName, type AudioInfo } from './music/readAudio';
import { deleteQuietly, openReadable, withSource } from './pickedFiles';

// Imports songs. Only each file's tags are read (a few KB, or the cover);
// saving copies the file natively, so a 50 MB FLAC never passes through memory.

/** Room left free on the phone after an import, on top of the songs themselves. */
const SPARE_SPACE = 50 * 1024 * 1024;

export class SongsError extends Error {
  constructor(readonly code: 'noSpace') {
    super(`Songs error: ${code}`);
  }
}

/** One picked song, read but not saved yet. */
export interface PickedSong {
  file: File;
  /** '' when the picker gave no real file name (an Android content link). */
  name: string;
  /** True if `file` belongs to the app (a cache or iOS copy), so it can be moved and must be cleaned up. */
  temporary: boolean;
  size: number;
  info: AudioInfo;
  /** From the tags, or else the file name. */
  title: string;
  trackNumber: number | null;
}

/** Songs picked together, in album order, and the files that turned out not to be songs. */
export interface PickedSongs {
  songs: PickedSong[];
  skipped: { name: string; code: AudioErrorCode }[];
}

/**
 * Reads the tags of each picked file. Files that aren't songs (or are videos)
 * are skipped and listed; if none are songs, the first one's error is thrown.
 * With pickedAreCopies (iOS), the picked files belong to the app.
 */
export async function openSongs(picked: { file: File; name: string }[], pickedAreCopies: boolean): Promise<PickedSongs> {
  const songs: PickedSong[] = [];
  const skipped: PickedSongs['skipped'] = [];
  for (const { file, name } of picked) {
    const opened = await openReadable(file, 'song', name.slice(name.lastIndexOf('.') + 1) || 'audio');
    if (opened.temporary && pickedAreCopies) deleteQuietly(file);
    const temporary = opened.temporary || pickedAreCopies;
    try {
      const info = await withSource(opened.file, readAudio);
      const fromName = titleFromFileName(name);
      songs.push({
        file: opened.file,
        name,
        temporary,
        size: opened.file.size,
        info,
        title: info.title || fromName.title,
        trackNumber: info.trackNumber ?? fromName.trackNumber,
      });
    } catch (error) {
      if (temporary) deleteQuietly(opened.file);
      if (!(error instanceof AudioError)) {
        disposeSongs({ songs, skipped });
        throw error;
      }
      skipped.push({ name, code: error.code });
    }
  }
  if (songs.length === 0) throw new AudioError(skipped[0]?.code ?? 'notAudio');
  songs.sort(albumOrder);
  return { songs, skipped };
}

/** Disc, then track number, then file name; songs without numbers go after those with. */
function albumOrder(a: PickedSong, b: PickedSong): number {
  const byNumber = (x: number | null, y: number | null) => (x ?? Infinity) - (y ?? Infinity) || 0;
  return (
    byNumber(a.info.discNumber, b.info.discNumber) ||
    byNumber(a.trackNumber, b.trackNumber) ||
    naturalCompare(a.name, b.name)
  );
}

/** Deletes the temporary copies made while picking. Call when the picked songs aren't needed any more. */
export function disposeSongs(picked: PickedSongs): void {
  for (const song of picked.songs) if (song.temporary) deleteQuietly(song.file);
}

export interface SongToSave {
  song: PickedSong;
  title: string;
  /** Values for tags by name, e.g. { Artist: 'Mira Holt' }. Empty values are skipped. */
  tagValues: Record<string, string>;
}

/**
 * Adds each song to the shelf as a new item, in order, with its file and
 * track info. A song that fails is removed again and counted, and the rest
 * still import. Calls onProgress(done, total) after each song.
 */
export async function saveImportedSongs(
  db: SQLiteDatabase,
  dispatch: ShelfDispatch,
  shelf: Shelf,
  toSave: SongToSave[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ items: Item[]; failed: number }> {
  const needed = toSave.reduce((sum, s) => sum + (s.song.temporary ? 0 : s.song.size), 0);
  if (Paths.availableDiskSpace < needed + SPARE_SPACE) throw new SongsError('noSpace');

  const items: Item[] = [];
  let failed = 0;
  for (const [index, { song, title, tagValues }] of toSave.entries()) {
    const draft = newItemDraft(shelf, title);
    let coverUri: string | null = null;
    let itemAdded = false;
    try {
      const fileName = songFileName(song.info.extension);
      await storeMediaFile(draft.id, fileName, song.file, song.temporary);
      if (song.info.cover) coverUri = await writeCoverBytes(song.info.cover.bytes, song.info.cover.extension);
      // The track row references the item, so the item is saved first.
      const item: Item = { ...draft, tags: fillTags(draft.tags, tagValues), coverUri };
      itemAdded = true;
      if (!(await dispatch({ type: 'item/add', item }))) throw new Error('Could not save the song');
      const track: Track = {
        itemId: item.id,
        fileName,
        format: song.info.format,
        durationMs: song.info.durationMs,
        trackNumber: song.trackNumber,
        discNumber: song.info.discNumber,
        lyrics: song.info.lyrics,
      };
      await saveTrack(db, track);
      items.push(item);
    } catch (error) {
      console.warn('Could not import song', song.name, error);
      failed++;
      if (itemAdded) void dispatch({ type: 'item/remove', itemId: draft.id });
      deleteBookFiles(draft.id);
      deleteCover(coverUri);
    }
    onProgress?.(index + 1, toSave.length);
  }
  return { items, failed };
}
