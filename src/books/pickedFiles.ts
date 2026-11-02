import { File, Paths } from 'expo-file-system';

import { newId } from '../models/ids';
import type { ByteSource } from './comic/zip';

// Reading picked files in parts, for imports that never load a whole file
// (comics and songs can be hundreds of MB).

/**
 * Makes sure the file can be opened for reading at any offset. Some Android
 * providers refuse that for content links; those are copied to the cache
 * first, as `<prefix>-<id>.<extension>`, and `temporary` says to delete it.
 */
export async function openReadable(file: File, prefix: string, extension: string): Promise<{ file: File; temporary: boolean }> {
  try {
    file.open().close();
    return { file, temporary: false };
  } catch (error) {
    console.warn('Could not open the file directly, copying it first', file.uri, error);
    const copy = new File(Paths.cache, `${prefix}-${newId()}.${extension}`);
    await file.copy(copy);
    return { file: copy, temporary: true };
  }
}

/** Opens the file, runs `work` with a ByteSource over it, and closes it again. */
export async function withSource<T>(file: File, work: (source: ByteSource) => Promise<T>): Promise<T> {
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

/** Deletes a temporary copy, logging rather than failing if it can't. */
export function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch (error) {
    console.warn('Could not delete a temporary copy', file.uri, error);
  }
}
