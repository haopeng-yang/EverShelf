# Roadmap – Update 3: Comic Reader (manga, comics, manhua, manhwa)

EverShelf already reads novels. This update lets it read **image-based books** too: Japanese manga, Western comics, Chinese manhua and Korean manhwa/webtoons. The user imports comic files they already have, and EverShelf turns them into items with chapters, a page reader and saved progress.

**Scope and copyright:** the same as the novel reader. EverShelf only opens files the user picks on their own device. It never searches, scrapes or downloads from websites.

---

## Background: what the files look like

All four kinds are just **pictures in order**. Comic file formats are mostly ordinary archives full of JPG/PNG/WebP images, with a different extension.

| Kind | Where it's from | Usual files | How it's read |
|---|---|---|---|
| **Manga** | Japan | CBZ, ZIP of images; CBR; official digital volumes as EPUB | Pages, **right to left** |
| **Comics** | US/Europe | CBR and CBZ (CBR is very common for older releases); PDF | Pages, left to right |
| **Manhwa / webtoon** | Korea | CBZ/ZIP or loose images, often very tall strips; WebP/AVIF common | **Vertical scroll**, one long strip |
| **Manhua** | China | CBZ/ZIP or loose images; many newer ones are vertical strips like webtoons | Vertical scroll, or pages left to right |

The formats:

* **CBZ** = a ZIP file of images (`.cbz` is a renamed `.zip`). It's easy to support: EverShelf already unzips EPUBs with `fflate`.
* **CBR** = a RAR file of images. There is no reliable pure-JavaScript RAR reader that runs on Hermes (the existing ones use WebAssembly, which Hermes doesn't run). It needs a native module and a dev build, so it's **left for later**. Users can convert CBR to CBZ with free tools in the meantime.
* **CB7** (7-Zip) and **CBT** (tar) are rare. Left for later.
* **PDF** needs a native PDF renderer. Left for later, the same decision as in the novel roadmap.
* **ComicInfo.xml** is an optional metadata file inside many CBZs (the "ComicRack" standard). It has `Title`, `Series`, `Number`, `Writer`, `Summary`, and `Manga` (`YesAndRightToLeft` means it reads right to left). If it's there, use it.

**First version: CBZ and ZIP**, with JPG, PNG, WebP, GIF and AVIF pages, in three reading modes: **right to left**, **left to right** and **vertical scroll**.

---

## Phase 0 – Prep (about 1 hour)

1. Commit the current `feature/reader` work (long-press selection, the "Continue reading" toggle) and merge it. Start a new branch, `feature/comics`.
2. Collect test files:
   * Public-domain comics from the Digital Comic Museum (Golden Age, CBZ and CBR).
   * A CC-licensed webcomic such as *Pepper&Carrot*: download its pages and zip them yourself into a CBZ.
   * A "webtoon-style" CBZ made by joining images into tall strips (for example 800 × 12,000 px).
   * A CBZ with a `ComicInfo.xml` that says `<Manga>YesAndRightToLeft</Manga>`.
   * Odd ones: a ZIP with subfolders (one folder per chapter), a ZIP with `__MACOSX/` junk, pages named `1.jpg … 10.jpg`, which must sort 1, 2 … 10 and not 1, 10, 2.
   * A large CBZ, around 300 MB, for the memory test.
3. Add `expo-image` with `npx expo install expo-image`. It's included in Expo Go and handles WebP/AVIF, large images and downscaling much better than React Native's `Image`.

## Phase 1 – Data model for comics

* A comic is still an **Item** with **chapters**, like a novel. Search, tags, sorting, selection, Move and Delete keep working unchanged.
* **Migration V8**:
  * New table **book_info**: `item_id`, `kind` (`'text'` or `'comic'`), `reading_mode` (`'rtl'`, `'ltr'` or `'vertical'`). Existing books get `kind = 'text'`.
  * New table **pages**: `chapter_id`, `position`, `file_name`, `width`, `height`. Sizes are stored so the vertical reader can lay out pages before their images load, without the list jumping.
* Page images are stored as files at `books/<itemId>/<chapterPosition>/<page>.<ext>`. `deleteBookFiles` already removes the whole `books/<itemId>/` folder, so deleting a comic needs no new code.
* Progress reuses **reading_progress**: `chapter_id`, the **page index** stored in `paragraph`, and `percent` counted in pages instead of characters. Badges, "Continue reading" and "Recently read" then work for comics without changes.
* Add a `kind` to `BookSummary` so screens know which reader to open.
* Test the migration on a database that already has novels and progress.

## Phase 2 – Importing CBZ/ZIP

1. **Detect the format**: `.cbz` or `.zip`, or a ZIP with no extension whose files are mostly images, is a comic. A ZIP with `META-INF/container.xml` is still an EPUB.
2. **Never load the whole file into memory.** CBZs are often 100–500 MB. Read the file in chunks with `File.open()` → `FileHandle.readBytes()`, feed them to `fflate`'s streaming `Unzip`, and write each image straight to its page file as soon as it's unpacked. This is the biggest difference from the EPUB import, which reads the whole file at once.
3. **Find the pages**:
   * Keep only image files. Skip `__MACOSX/`, `.DS_Store`, `Thumbs.db` and hidden files.
   * Sort with a **natural sort**, so `page2` comes before `page10`.
   * If the images are in subfolders, each folder becomes a chapter, named after the folder. Otherwise the whole file is one chapter.
4. **Read each page's size** from the first bytes of the image file (JPEG, PNG, WebP, GIF and AVIF headers), without decoding the picture. Write it as a small pure function with tests.
5. **Metadata**: if there's a `ComicInfo.xml`, fill the Title, Author (Writer) and Description (Summary) tags, and set right-to-left reading if `Manga` is `YesAndRightToLeft`. Otherwise, use the file name as the title. The cover is the first page.
6. **Guess the reading mode**: right to left if ComicInfo says so or the shelf is the built-in Manga shelf; **vertical** if most pages are very tall (height more than about 2.5 × width); otherwise left to right. The user can change it in the preview.
7. **Several files at once**: a series usually comes as one CBZ per chapter or volume. Let the user pick multiple files (`File.pickFileAsync({ multipleFiles: true })`) and import them as **one item, one chapter per file**, naturally sorted by file name.
8. **"Add chapters" to an existing comic**, from its detail screen, for when a new chapter comes out.
9. **Import preview screen** (extend `import.tsx`): title, cover, number of chapters and pages, and the reading mode picker. Show progress while unpacking ("Page 120 of 480"). If anything fails, clean up the files the import already wrote, as `saveImportedBook` already does.

## Phase 3 – Comic reader screen

1. `read/[itemId].tsx` opens `ComicReader` for comics and the existing text reader for novels. Keep them as separate components.
2. Show pages with `expo-image`. Preload the next two or three pages so turning pages is instant.
3. **Paged modes (left to right, right to left)**: a horizontal paging `FlatList`, one page per screen, with the page fit to the screen. In right-to-left mode, the order and the swipe direction are reversed.
4. **Vertical mode**: a vertical `FlatList`, with pages at full width and no gaps between them. The heights come from the stored sizes. Chapters follow one another seamlessly.
5. **Tap zones**: tap the left or right third to turn the page (flipped in right-to-left mode), and tap the middle to show the controls.
6. **Controls**: back, chapter title, "Page 12 / 180", a page slider, the chapter list, and reading mode.
7. At the end of a chapter, go straight into the next one (vertical mode) or show a short "Next: Chapter 5" page (paged modes).
8. Save progress as pages change (throttled) and when leaving, the same as the novel reader.
9. **Check very tall images on a real Android phone.** Android can't draw a single image taller than a certain size, and it may show up blank or blurry. If that happens, cut tall pages into slices of about 3,000 px when importing (with `expo-image-manipulator`, which is in Expo Go) and store them as consecutive pages.

## Phase 4 – Zoom and reading comfort

* Pinch to zoom, and double-tap to zoom in and out, with `react-native-gesture-handler` and `react-native-reanimated` (both are in Expo Go). While zoomed in, dragging pans the page instead of turning it.
* Fit options for paged modes: fit screen, fit width, and fit height.
* Reader background: black, white, or follow the theme. Many people prefer black for comics.
* Keep the screen awake (reuse the existing setting).
* The reading mode is saved per comic, and new imports default to the guess from Phase 2.
* *(Optional)* Two pages side by side in landscape on tablets, in the right order for right-to-left reading.

## Phase 5 – Library features

* Progress badges, "Continue reading" and "Recently read" should already work through Phase 1. Check them.
* The detail screen shows "Chapter 3 · Page 12" instead of a percentage.
* Bookmarks: long-press a page to bookmark it. The list shows a small thumbnail of the page.
* Mark as finished, the same as novels.
* *(Optional)* The chapter list shows which chapters have been read.

## Phase 6 – Backup, testing and release

1. **Backup**: comic pages are far too big to put in the current backup file, which is built in memory. By default, back up comics as items, tags, chapter lists and progress only, and say clearly that the page images aren't included. Restoring keeps the progress, and the user imports the files again. A full backup with images, streamed to disk, can come later.
2. **Test**: a 300 MB CBZ (memory and time), a webtoon with tall strips, right-to-left page turning and tap zones, importing the same file twice, deleting comics (the files must be gone), moving comics between shelves, a phone with low storage, and the upgrade migration from a database that already has novels.
3. **Translations**: English and Simplified Chinese for every new string, including the format names and reading modes.
4. **Release**: `expo-image` is a new native library, so it needs **one new EAS build**. JS-only fixes after that can go out with `eas update`.

## Phase 7 (optional) – Later ideas

* **CBR/RAR** and **CB7**, through a native unarchiver module (needs a dev build).
* **PDF comics**, through a native PDF renderer.
* **Image-only EPUBs** (official digital manga): detect EPUBs whose pages are just one `<img>` each, and import them as comics.
* **Import a folder of images** (`Directory.pickDirectoryAsync` on Android).
* "Open with EverShelf" for `.cbz` files from the file manager.
* Auto-crop the white margins on scanned pages.

---

### Notes

* Phases 1–3 with CBZ alone already make a working comic reader. As with the novel roadmap, each phase should end in a working app and a commit.
* Keep parsing (finding and sorting pages, image sizes, ComicInfo, guessing the reading mode) in pure functions under `src/books/`, so they can be tested in Jest with generated ZIPs and no phone, like `parseEpub`.
* Memory is the main risk. The novel importer reads whole files, but the comic importer must stream, and the reader must only keep a few pages decoded at a time.
