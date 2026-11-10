import { itemImageUris } from '../models/images';
import type { Item } from '../models/types';
import { deleteBookFiles } from './bookFiles';
import { deleteCover } from './covers';

/** Deletes the files of items being removed with their shelf: covers, tag images and book chapters. */
export function deleteItemFiles(items: Item[]): void {
  for (const item of items) {
    for (const uri of itemImageUris(item)) deleteCover(uri);
    deleteBookFiles(item.id);
  }
}
