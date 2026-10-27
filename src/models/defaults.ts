import type { ShelfState } from './types';

/** What a brand-new install starts with. Ids are fixed so they stay stable. */
export function createDefaultState(): ShelfState {
  return {
    shelves: [
      { id: 'books', name: 'Books', defaultTagNames: ['Author', 'Date', 'Description'] },
      { id: 'movies', name: 'Movies', defaultTagNames: ['Director', 'Date', 'Description'] },
      { id: 'manga', name: 'Manga', defaultTagNames: ['Author', 'Date', 'Description'] },
      { id: 'anime', name: 'Anime', defaultTagNames: ['Studio', 'Date', 'Description'] },
    ],
    items: [],
  };
}
