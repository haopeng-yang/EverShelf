import type { Item } from '../models/types';
import { deleteBookFiles } from './bookFiles';
import { deleteCover } from './covers';

/** Deletes the files of items being removed with their shelf: covers and book chapters. */
export function deleteItemFiles(items: Item[]): void {
  for (const item of items) {
    deleteCover(item.coverUri);
    deleteBookFiles(item.id);
  }
}
