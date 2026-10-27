export type Id = string;

/** A user-defined label on an item, e.g. { name: 'Age Restricted', value: 'Recommended 15+' }. */
export interface Tag {
  id: Id;
  name: string;
  value: string;
}

/** One thing stored on a shelf: a book, movie, video, etc. */
export interface Item {
  id: Id;
  shelfId: Id;
  title: string;
  /** Local file URI of the cover image, or null when there is none. */
  coverUri: string | null;
  /** Tags in display order. */
  tags: Tag[];
  createdAt: number;
  updatedAt: number;
}

/** A top tab such as Books or Movies. */
export interface Shelf {
  id: Id;
  name: string;
  /** Tag names every new item on this shelf starts with (values left empty). */
  defaultTagNames: string[];
}

export interface ShelfState {
  /** Shelves in tab order. */
  shelves: Shelf[];
  items: Item[];
}
