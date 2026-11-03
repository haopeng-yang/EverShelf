import * as DocumentPicker from 'expo-document-picker';
import { strFromU8 } from 'fflate';

import { isZip, memorySource, readZipEntries, readZipEntry } from '../books/comic/zip';
import { BACKUP_JSON_NAME, BackupError } from '../models/backup';
import type { BackupZip, OpenedBackup } from './backupFiles';

// Web version of backupFiles.ts: export builds the ZIP in memory and downloads
// it, import uses the browser's file picker. The web version has no imported
// files, so its backups are small.

export function freeSpace(): number | null {
  return null;
}

export async function createBackupZip(fileName: string): Promise<BackupZip> {
  let bytes = new Uint8Array(1024 * 1024);
  let length = 0;
  const reserve = (end: number) => {
    if (end <= bytes.length) return;
    const bigger = new Uint8Array(Math.max(end, bytes.length * 2));
    bigger.set(bytes.subarray(0, length));
    bytes = bigger;
  };
  return {
    sink: {
      write: async (chunk) => {
        reserve(length + chunk.length);
        bytes.set(chunk, length);
        length += chunk.length;
      },
      patch: async (offset, chunk) => {
        bytes.set(chunk, offset);
      },
    },
    share: async () => {
      const url = URL.createObjectURL(new Blob([bytes.slice(0, length)], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    discard: () => {},
  };
}

export async function openBackupFile(): Promise<OpenedBackup | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/json'] });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isZip(bytes)) return { json: strFromU8(bytes), source: null, entries: new Map(), close: () => {} };
  const source = memorySource(bytes);
  const entries = new Map((await readZipEntries(source)).map((entry) => [entry.name, entry]));
  const jsonEntry = entries.get(BACKUP_JSON_NAME);
  if (!jsonEntry) throw new BackupError('noBackupInZip');
  return { json: strFromU8(await readZipEntry(source, jsonEntry)), source, entries, close: () => {} };
}
