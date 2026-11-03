import { strFromU8 } from 'fflate';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { isZip, readZipEntries, readZipEntry, type ByteSource, type ZipEntry } from '../books/comic/zip';
import { deleteQuietly, openReadable } from '../books/pickedFiles';
import type { ByteSink } from '../books/zipWriter';
import { BACKUP_JSON_NAME, BackupError } from '../models/backup';

// Getting a backup file out of and into the app on phones: export writes the
// ZIP to the cache, a chunk at a time, and opens the share sheet (save to
// Files, Drive...); import opens the file picker and reads the ZIP's files
// from their offsets, so a backup of several GB is never loaded whole.
// backupFiles.web.ts does the same in a browser.

/** A backup being written. Share it once it's complete, or discard it if something went wrong. */
export interface BackupZip {
  sink: ByteSink;
  share(): Promise<void>;
  discard(): void;
}

/** A picked backup: its JSON, and for a ZIP, a way to read the files stored beside it. */
export interface OpenedBackup {
  json: string;
  /** Null for a plain JSON backup (from before backups were ZIPs). */
  source: ByteSource | null;
  /** Files in the ZIP by name; empty for a plain JSON backup. */
  entries: Map<string, ZipEntry>;
  close(): void;
}

/** Free space on the phone in bytes, or null where it can't be known. */
export function freeSpace(): number | null {
  return Paths.availableDiskSpace;
}

export async function createBackupZip(fileName: string): Promise<BackupZip> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  removeOldBackups();
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  const handle = file.open();
  return {
    sink: {
      write: (bytes) => handle.writeBytes(bytes),
      patch: async (offset, bytes) => {
        const end = handle.offset ?? 0;
        handle.offset = offset;
        await handle.writeBytes(bytes);
        handle.offset = end;
      },
    },
    share: async () => {
      handle.close();
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/zip',
        UTI: 'public.zip-archive',
        dialogTitle: 'Save EverShelf backup',
      });
    },
    discard: () => {
      try {
        handle.close();
      } catch {
        // Already closed.
      }
      deleteQuietly(file);
    },
  };
}

/**
 * Backups stay in the cache after sharing, since the app they were shared to
 * may still be reading them. With videos they can be GB, so the old ones go
 * when a new one is made.
 */
function removeOldBackups(): void {
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && /^evershelf-backup-.*\.(zip|json)$/.test(entry.name)) deleteQuietly(entry);
    }
  } catch (error) {
    console.warn('Could not clear old backups', error);
  }
}

/** Lets the user pick a backup (a ZIP, or an older JSON file). Null if they cancel. */
export async function openBackupFile(): Promise<OpenedBackup | null> {
  // Some Android file managers don't label .zip or .json files, so allow any file and check the contents.
  const picked = await File.pickFileAsync({ mimeTypes: '*/*' });
  if (picked.canceled || !picked.result) return null;
  const pickedAreCopies = Platform.OS === 'ios';
  const opened = await openReadable(picked.result, 'backup', 'zip');
  const cleanUp = () => {
    if (opened.temporary || pickedAreCopies) deleteQuietly(opened.file);
  };
  const handle = opened.file.open();
  const close = () => {
    handle.close();
    cleanUp();
  };
  try {
    const source: ByteSource = {
      size: handle.size ?? opened.file.size,
      read: async (offset, length) => {
        handle.offset = offset;
        return handle.readBytes(length);
      },
    };
    if (!isZip(await source.read(0, 4))) {
      const json = await textOf(opened.file);
      close();
      return { json, source: null, entries: new Map(), close: () => {} };
    }
    const entries = new Map((await readZipEntries(source)).map((entry) => [entry.name, entry]));
    const jsonEntry = entries.get(BACKUP_JSON_NAME);
    if (!jsonEntry) throw new BackupError('noBackupInZip');
    return { json: strFromU8(await readZipEntry(source, jsonEntry)), source, entries, close };
  } catch (error) {
    close();
    throw error;
  }
}

async function textOf(file: File): Promise<string> {
  try {
    return await file.text();
  } catch (fileError) {
    // Some pickers return URIs (e.g. names with spaces or brackets) the File API won't open; fetch can.
    console.warn('File API could not read the backup, trying fetch', file.uri, fileError);
    const response = await fetch(file.uri);
    return await response.text();
  }
}
