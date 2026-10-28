import { Directory, File, Paths } from 'expo-file-system';

import { newId } from '../models/ids';
import type { ShelfState } from '../models/types';

// Cover images are copied into the app's own documents folder, because the
// picker's files live in a cache the system may clear. covers.web.ts is used
// on web instead, where there is no file system.

function coversDirectory(): Directory {
  return new Directory(Paths.document, 'covers');
}

function newCoverFile(extension: string): File {
  const directory = coversDirectory();
  directory.create({ idempotent: true, intermediates: true });
  return new File(directory, `${newId()}.${extension}`);
}

/** Copies a picked image into app storage and returns the new, permanent URI. */
export async function saveCover(pickedUri: string): Promise<string> {
  const extension = /\.(\w+)$/.exec(pickedUri.split('?')[0])?.[1] ?? 'jpg';
  const destination = newCoverFile(extension);
  await new File(pickedUri).copy(destination);
  return destination.uri;
}

/** Deletes a cover saved by saveCover. Ignores anything outside the covers folder. */
export function deleteCover(uri: string | null): void {
  if (!uri || !uri.startsWith(coversDirectory().uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    console.warn('Could not delete cover', uri, error);
  }
}

/** Reads a saved cover as "data:image/...;base64,..." for backups. Null if the file is gone. */
export async function readCoverAsDataUri(uri: string): Promise<string | null> {
  try {
    const file = new File(uri);
    if (!file.exists) return null;
    const extension = /\.(\w+)$/.exec(uri)?.[1]?.toLowerCase() ?? 'jpg';
    const mime = extension === 'jpg' ? 'jpeg' : extension;
    return `data:image/${mime};base64,${await file.base64()}`;
  } catch (error) {
    console.warn('Could not read cover', uri, error);
    return null;
  }
}

/** Writes a cover from a backup's data URI into app storage and returns its URI. */
export async function writeCoverFromDataUri(dataUri: string): Promise<string> {
  const match = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUri);
  if (!match) throw new Error('Cover is not a base64 image');
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const file = newCoverFile(extension);
  file.create();
  await file.write(match[2], { encoding: 'base64' });
  return file.uri;
}

/** Saves image bytes (e.g. a cover found inside an EPUB) into app storage and returns its URI. */
export async function writeCoverBytes(bytes: Uint8Array, extension: string): Promise<string> {
  const file = newCoverFile(extension);
  file.create();
  await file.write(bytes);
  return file.uri;
}

/** Deletes cover files no item uses any more (e.g. after restoring a backup). */
export function pruneCovers(state: ShelfState): void {
  const directory = coversDirectory();
  let entries: ReturnType<Directory['list']>;
  try {
    if (!directory.exists) return;
    entries = directory.list();
  } catch (error) {
    // Leftover files only waste space, so never let cleanup fail an import.
    console.warn('Could not list covers for cleanup', error);
    return;
  }
  // Compare by file name: stored URIs and listed URIs may be formatted differently.
  const inUse = new Set(state.items.map((i) => i.coverUri?.split('/').pop()).filter(Boolean));
  for (const entry of entries) {
    if (entry instanceof File && !inUse.has(entry.name)) {
      try {
        entry.delete();
      } catch (error) {
        console.warn('Could not delete unused cover', entry.uri, error);
      }
    }
  }
}
