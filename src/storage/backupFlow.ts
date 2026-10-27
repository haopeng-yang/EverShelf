import { backupFileName, createBackup, type ParsedBackup } from '../models/backup';
import type { Id, Item, ShelfState } from '../models/types';
import { shareBackupFile } from './backupFiles';
import { readCoverAsDataUri, writeCoverFromDataUri } from './covers';

/** Builds a backup of everything, covers included, and hands it to the share sheet / download. */
export async function exportBackup(state: ShelfState): Promise<void> {
  const covers = new Map<Id, string>();
  for (const item of state.items) {
    if (!item.coverUri) continue;
    const dataUri = await readCoverAsDataUri(item.coverUri);
    if (dataUri) covers.set(item.id, dataUri);
  }
  const now = new Date();
  await shareBackupFile(backupFileName(now), JSON.stringify(createBackup(state, covers, now)));
}

/** Saves a parsed backup's covers into app storage and returns the state to load. */
export async function restoreBackupCovers(backup: ParsedBackup): Promise<ShelfState> {
  const items: Item[] = [];
  for (const item of backup.state.items) {
    const dataUri = backup.covers.get(item.id);
    let coverUri: string | null = null;
    if (dataUri) {
      try {
        coverUri = await writeCoverFromDataUri(dataUri);
      } catch (error) {
        console.warn('Skipping unreadable cover for', item.title, error);
      }
    }
    items.push({ ...item, coverUri });
  }
  return { ...backup.state, items };
}
