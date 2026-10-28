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
  /** Set when the shelf needs a password to open. Missing for unlocked shelves. */
  lock?: ShelfLock;
}

/**
 * A shelf's password, stored only as a salted hash so the password itself is
 * never saved. This hides a shelf from other people using the phone; it does
 * not encrypt the shelf's data.
 */
export interface ShelfLock {
  /** Random salt, as hex. */
  salt: string;
  /** SHA-256 of salt + password, as hex. */
  hash: string;
}

/**
 * One chapter of an imported book. The text itself lives in a file
 * (books/<itemId>/<fileName>); only this summary is kept in SQLite.
 * A comic chapter's fileName is the folder holding its pages.
 */
export interface Chapter {
  id: Id;
  itemId: Id;
  /** 0-based reading order. */
  position: number;
  title: string;
  fileName: string;
  /** How long the chapter is: characters for a novel, pages for a comic. Progress is weighted by it. */
  charCount: number;
}

/** A novel (text chapters) or a comic (image pages). */
export type BookKind = 'text' | 'comic';

/** How a comic is read: pages left to right, right to left (manga), or one vertical strip (webtoon). */
export type ReadingMode = 'ltr' | 'rtl' | 'vertical';

export const DEFAULT_READING_MODE: ReadingMode = 'ltr';

/** What kind of book an item is. Books imported before comics existed have none stored and are 'text'. */
export interface BookInfo {
  itemId: Id;
  kind: BookKind;
  /** Only used for comics. */
  readingMode: ReadingMode;
}

/** One image of a comic chapter, stored at books/<itemId>/<fileName>. */
export interface Page {
  chapterId: Id;
  /** 0-based order within the chapter. */
  position: number;
  fileName: string;
  /** Size in pixels, so pages can be laid out before their images load. */
  width: number;
  height: number;
}

/** Where the user stopped reading a book. */
export interface ReadingProgress {
  itemId: Id;
  chapterId: Id;
  /**
   * 0-based index of the paragraph at the top of the screen. Stored instead of
   * a pixel offset so it stays right when the font size changes.
   */
  paragraph: number;
  /** How far through the whole book, 0–1, by characters (pages for a comic, stored in `paragraph`). */
  percent: number;
  updatedAt: number;
  /** When the book was marked finished, or null. Saving a new position leaves it alone. */
  finishedAt: number | null;
}

/** A saved place in a book, chosen by long-pressing a paragraph. */
export interface Bookmark {
  id: Id;
  itemId: Id;
  chapterId: Id;
  paragraph: number;
  /** The start of the paragraph, shown in the bookmark list. */
  excerpt: string;
  createdAt: number;
}

/** What the shelf needs to know about a book: size and reading progress. */
export interface BookSummary {
  itemId: Id;
  kind: BookKind;
  chapterCount: number;
  /** 0–1; 0 if the book has never been opened. */
  percent: number;
  /** When it was last read, or null if never opened. */
  lastReadAt: number | null;
  finished: boolean;
}

export interface ShelfState {
  /** Shelves in tab order. */
  shelves: Shelf[];
  items: Item[];
}
