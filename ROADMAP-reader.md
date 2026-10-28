# Roadmap – Update 2: Novel Reader

EverShelf becomes a shelf **and** a reader. Users import novel files they already have (TXT, EPUB, and later more formats), and EverShelf turns them into books with chapters, a comfortable reader and saved progress.

**Scope and copyright:** EverShelf does not search, scrape or download from any website. It only opens files the user picks on their own device, the same way any e-book reader does. The user is responsible for where their files come from. Say this in the app's About screen and in any store listing.

---

## Phase 0 – Prep (about 1 hour)

1. Finish and merge the `feature/android-build` branch (keyboard fix and EAS profiles), then start a new branch, `feature/reader`.
2. Collect test files: a small English TXT, a large TXT (5–10 MB), a Chinese TXT saved in GBK, and two or three EPUBs from Project Gutenberg or Standard Ebooks (public domain).
3. Decide the first formats: **TXT and EPUB**. PDF is out of scope for now. It needs a different kind of viewer and isn't reflowable text.

## Phase 1 – Data model for books

* A **book** is still an **Item** on a shelf, for example a new "Novels" shelf. Title, Author and Description stay as normal tags, so search, filtering and sorting keep working.
* New table **chapters**: `id`, `itemId`, `position`, `title`, `filePath`, `charCount`.
* New table **reading_progress**: `itemId`, `chapterId`, `offset` (scroll position), `updatedAt`.
* Chapter text is stored as files, `books/<itemId>/<position>.txt`, in the app's document folder. It doesn't go in SQLite, which keeps the database small and fast.
* Deleting an item also deletes its book folder.
* Write a migration for existing users. Their current shelves and items must survive the update.

## Phase 2 – Importing files

1. **Pick a file** with `expo-document-picker` from an "Import book" button on a shelf.
2. **Detect the format** from the extension and the file's first bytes.
3. **TXT import**
   * Detect the text encoding (UTF-8, UTF-16, and GBK/GB18030 for Chinese novels) and convert to UTF-8.
   * Split into chapters with heading patterns such as `Chapter 12`, `CHAPTER XII`, `第十二章` and `第12回`. If no headings are found, split every ~5,000 characters as "Part 1, Part 2…".
   * Clean up: normalise line breaks, trim blank lines, and join lines that were hard-wrapped.
4. **EPUB import**
   * Unzip the file, read `META-INF/container.xml`, then the OPF file (metadata and the spine, which is the reading order), then the table of contents.
   * Fill the Title, Author and Description tags and set the cover image automatically.
   * Convert each XHTML chapter to plain text paragraphs. Keep it simple: no CSS or embedded fonts in the first version.
5. **Import preview screen**: shows the detected title, author, cover and chapter count. The user can fix the title or pick a different chapter-splitting rule before saving.
6. Show a progress indicator for large files and make sure the UI doesn't freeze. Process in chunks.

## Phase 3 – Reader screen

1. A new route, `src/app/read/[itemId].tsx`, which opens at the saved chapter and position.
2. Render the chapter as a list of paragraphs, using `FlatList` so a 50,000-word chapter still scrolls smoothly.
3. Tap the middle of the screen to show or hide the controls: back, chapter title, chapter list, and settings.
4. Previous and next chapter buttons at the end of each chapter, plus a chapter list drawer.
5. Save progress automatically as the user scrolls (throttled) and when they leave the screen.
6. The item detail screen gets a **Read** or **Continue reading** button.

## Phase 4 – Reading comfort

* Font size, line spacing and side margins.
* Reader themes: light, dark (follows the app setting), and sepia.
* Font choice: system serif, system sans, and maybe one bundled reading font.
* Keep the screen awake while reading (`expo-keep-awake`).
* Settings are saved and apply to every book.
* *(Optional)* Page-turn mode (swipe left and right) as an alternative to scrolling.

## Phase 5 – Library features

* A progress badge (for example "42%") on book covers in grid and list view.
* A "Continue reading" row at the top of the Novels shelf.
* Sort by "Last read".
* Bookmarks: long-press a paragraph to bookmark it, and list bookmarks in the chapter drawer.
* Search inside a book.
* Mark as finished. Optionally, auto-set a "Status: Finished" tag.

## Phase 6 – Backup, testing and release

1. **Backup export/import** includes chapters and progress. Add a choice of "with book files" (large) or "shelf data only".
2. **Test**: large TXT, GBK TXT, broken or odd EPUBs, importing the same book twice, deleting books, and a phone with low storage.
3. **Translations**: add the new text to English and Simplified Chinese.
4. **Release**: new libraries with native code mean **one new EAS build**. After that, JS-only fixes can go out with `eas update`.

## Phase 7 (optional) – Later ideas

* More formats: Markdown, HTML, FB2 and DOCX.
* "Open with EverShelf" / Share to EverShelf from the file manager or browser downloads.
* Text-to-speech read-aloud (`expo-speech`).
* Sync reading progress through the cloud (ties in with the original Phase 6, Supabase).

---

### Notes

* Before adding any library (unzip, XML parser, encoding converter), check that it works with Expo SDK 58 and runs in Expo Go, or plan a dev build for it. Prefer small, pure-JavaScript libraries.
* Each phase should end in a working app and a commit, so you can stop after any phase and still have something usable. Phases 1–3 with TXT import alone already make a working reader.
