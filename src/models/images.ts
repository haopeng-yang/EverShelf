import type { Item } from './types';

/** Every image a tag on the item holds, in tag order. */
export function tagImageUris(item: Item): string[] {
  return item.tags.flatMap((tag) => tag.images ?? []);
}

/** Every stored image the item uses: its cover and its tags' images. */
export function itemImageUris(item: Item): string[] {
  return [...(item.coverUri ? [item.coverUri] : []), ...tagImageUris(item)];
}
