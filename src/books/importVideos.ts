import { Paths, type File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { fillTags, newItemDraft } from '../models/actions';
import type { Item, Shelf, Video } from '../models/types';
import type { ShelfDispatch } from '../state/ShelfProvider';
import { deleteBookFiles, mediaUri, storeMediaFile, videoFileName } from '../storage/bookFiles';
import { deleteCover, writeCoverBytes } from '../storage/covers';
import { saveVideo } from '../storage/database';
import { naturalCompare } from './comic/parseComic';
import { deleteQuietly, openReadable, withSource } from './pickedFiles';
import { ANDROID_ONLY_FORMATS, readVideo, VideoError, videoTitleFromFileName, type VideoInfo } from './video/readVideo';
import { videoCoverAndLength } from './video/thumbnail';

// Imports videos, the same way importSongs imports songs: only each file's
// header is read, and saving copies the file natively, so a 4 GB film never
// passes through memory.

/** Room left free on the phone after an import, on top of the videos themselves. */
const SPARE_SPACE = 200 * 1024 * 1024;

/** Why a picked file was skipped or refused. */
export type VideoSkipCode = 'notVideo' | 'notOnThisPhone';

export class VideosError extends Error {
  constructor(readonly code: 'noSpace' | VideoSkipCode) {
    super(`Videos error: ${code}`);
  }
}

/** One picked video, read but not saved yet. */
export interface PickedVideo {
  file: File;
  /** '' when the picker gave no real file name (an Android content link). */
  name: string;
  /** True if `file` belongs to the app (a cache or iOS copy), so it can be moved and must be cleaned up. */
  temporary: boolean;
  size: number;
  info: VideoInfo;
  /** From the tags, or else the file name. '' if neither has one. */
  title: string;
}

/** Videos picked together, in file-name order (so episodes line up), and the files that were skipped. */
export interface PickedVideos {
  videos: PickedVideo[];
  skipped: { name: string; code: VideoSkipCode }[];
}

/**
 * Reads the header of each picked file. Files that aren't videos, or that
 * this phone can't play (.mkv and .webm on iOS), are skipped and listed; if
 * none are left, the first one's reason is thrown as a VideosError.
 * With pickedAreCopies (iOS), the picked files belong to the app.
 */
export async function openVideos(picked: { file: File; name: string }[], pickedAreCopies: boolean): Promise<PickedVideos> {
  const videos: PickedVideo[] = [];
  const skipped: PickedVideos['skipped'] = [];
  for (const { file, name } of picked) {
    const opened = await openReadable(file, 'video', name.slice(name.lastIndexOf('.') + 1) || 'mp4');
    if (opened.temporary && pickedAreCopies) deleteQuietly(file);
    const temporary = opened.temporary || pickedAreCopies;
    try {
      const info = await withSource(opened.file, readVideo);
      if (Platform.OS === 'ios' && ANDROID_ONLY_FORMATS.includes(info.format)) {
        if (temporary) deleteQuietly(opened.file);
        skipped.push({ name, code: 'notOnThisPhone' });
        continue;
      }
      videos.push({
        file: opened.file,
        name,
        temporary,
        size: opened.file.size,
        info,
        title: info.title || videoTitleFromFileName(name),
      });
    } catch (error) {
      if (temporary) deleteQuietly(opened.file);
      if (!(error instanceof VideoError)) {
        disposeVideos({ videos, skipped });
        throw error;
      }
      skipped.push({ name, code: 'notVideo' });
    }
  }
  if (videos.length === 0) throw new VideosError(skipped[0]?.code ?? 'notVideo');
  videos.sort((a, b) => naturalCompare(a.name, b.name));
  return { videos, skipped };
}

/** Deletes the temporary copies made while picking. Call when the picked videos aren't needed any more. */
export function disposeVideos(picked: PickedVideos): void {
  for (const video of picked.videos) if (video.temporary) deleteQuietly(video.file);
}

export interface VideoToSave {
  video: PickedVideo;
  title: string;
  /** Values for tags by name, e.g. { Description: '…' }. Empty values are skipped. */
  tagValues: Record<string, string>;
}

/**
 * Adds each video to the shelf as a new item, in order, with its file, info
 * and a cover (its own artwork, or a frame from it). A video that fails is
 * removed again and counted, and the rest still import. Calls
 * onProgress(done, total) after each video.
 */
export async function saveImportedVideos(
  db: SQLiteDatabase,
  dispatch: ShelfDispatch,
  shelf: Shelf,
  toSave: VideoToSave[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ items: Item[]; failed: number }> {
  const needed = toSave.reduce((sum, v) => sum + (v.video.temporary ? 0 : v.video.size), 0);
  if (Paths.availableDiskSpace < needed + SPARE_SPACE) throw new VideosError('noSpace');

  const items: Item[] = [];
  let failed = 0;
  for (const [index, { video, title, tagValues }] of toSave.entries()) {
    const draft = newItemDraft(shelf, title);
    let coverUri: string | null = null;
    let itemAdded = false;
    try {
      const fileName = videoFileName(video.info.extension);
      await storeMediaFile(draft.id, fileName, video.file, video.temporary);
      let durationMs = video.info.durationMs;
      if (video.info.cover) {
        coverUri = await writeCoverBytes(video.info.cover.bytes, video.info.cover.extension);
      } else {
        const found = await videoCoverAndLength(mediaUri(draft.id, fileName), durationMs);
        coverUri = found.coverUri;
        durationMs ??= found.durationMs;
      }
      // The video row references the item, so the item is saved first.
      const item: Item = { ...draft, tags: fillTags(draft.tags, tagValues), coverUri };
      itemAdded = true;
      if (!(await dispatch({ type: 'item/add', item }))) throw new Error('Could not save the video');
      const row: Video = {
        itemId: item.id,
        fileName,
        format: video.info.format,
        durationMs,
        width: video.info.width,
        height: video.info.height,
        subtitleChoice: null,
        audioChoice: null,
      };
      await saveVideo(db, row);
      items.push(item);
    } catch (error) {
      console.warn('Could not import video', video.name, error);
      failed++;
      if (itemAdded) void dispatch({ type: 'item/remove', itemId: draft.id });
      deleteBookFiles(draft.id);
      deleteCover(coverUri);
    }
    onProgress?.(index + 1, toSave.length);
  }
  return { items, failed };
}
