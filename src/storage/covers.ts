import { Directory, File, Paths } from 'expo-file-system';

import { newId } from '../models/ids';

// Cover images are copied into the app's own documents folder, because the
// picker's files live in a cache the system may clear. covers.web.ts is used
// on web instead, where there is no file system.

function coversDirectory(): Directory {
  return new Directory(Paths.document, 'covers');
}

/** Copies a picked image into app storage and returns the new, permanent URI. */
export async function saveCover(pickedUri: string): Promise<string> {
  const directory = coversDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const extension = /\.(\w+)$/.exec(pickedUri.split('?')[0])?.[1] ?? 'jpg';
  const destination = new File(directory, `${newId()}.${extension}`);
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
