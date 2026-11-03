# Roadmap – Update 4: Shelf Types and Music Player

Two changes that depend on each other:

1. **Shelf types.** Every shelf holds one kind of thing. A novel shelf only accepts novels, a comic shelf only comics, a music shelf only songs. The type also decides **what the shelf looks like when it's opened**: a reading layout for novels and comics, and a song list with a player for music.
2. **Music.** Import songs the user already has (MP3, M4A, FLAC…), and play them with a proper player: queue, seek, background playback and lock-screen controls.

Shelf types come first. Music needs them so it has a place to live, and they're useful on their own.

**Scope and copyright:** the same as the readers. EverShelf only plays files the user picks on their own device. It never searches, streams or downloads from websites.

---

## Background: song formats

| Format | Notes | First version? |
|---|---|---|
| **.mp3** | The most common. Tags are ID3v2 (at the start) or ID3v1 (the last 128 bytes). | ✅ |
| **.m4a / .aac** | Apple's format: AAC audio in an MP4 container. Tags are MP4 "atoms" (`moov/udta/meta/ilst`). | ✅ |
| **.flac** | Lossless. Tags are Vorbis comments, and cover art is a `PICTURE` block. | ✅ |
| **.wav** | Uncompressed and large. Usually has no tags, so the title comes from the file name. | ✅ |
| **.mp4** | Mostly **video**. An audio-only `.mp4` is the same as `.m4a`. | Audio-only `.mp4` ✅, video ❌ (see Phase 9) |
| **.ogg / .opus** | Common on Android, but iOS can't play them. | Later |

**What Expo gives us (SDK 58, `expo-audio`):**

* `expo-audio` is **included in Expo Go**, so you can start building without a dev build.
* `useAudioPlaylist` / `createAudioPlaylist` provide a queue with `next`, `previous`, `skipTo`, `seekTo`, looping (`'none' | 'single' | 'all'`) and gapless playback.
* **Background playback** comes from the `expo-audio` config plugin (`enableBackgroundPlayback`) and `setAudioModeAsync({ shouldPlayInBackground: true })`.
* **Lock-screen controls** come from `player.setActiveForLockScreen(true, metadata)`, and they need `interruptionMode: 'doNotMix'`. Without them, **Android stops background audio after about 3 minutes**.
* Config plugin changes need a **new native build**, so Phases 0–5 can be tested in Expo Go, but Phase 6 needs a dev build.
* `expo-audio` **does not read tags** (title, artist, album, cover). We have to parse them ourselves, as pure functions under `src/books/`, the same way `parseEpub` and `parseComic` work.

---

## Decisions (settled)

1. **Novels and comics are separate types**, `novel` and `comic`. They open different readers and look different on the shelf.
2. **Shelves without files, like Movies and Anime, are the `collection` type**: manual entries only (title, cover, tags), exactly how they work today. It's also where a future video type could grow from (Phase 9).
3. **Novel, comic and music shelves can also hold manual entries** (for example a wishlist book with no file). The type limits which *files* can be imported, not whether you can add a catalogue entry. Opening an entry with no file shows its detail screen, as it does today.
4. **A shelf's type can only be changed while it has no imported files**, or while all its files already match the new type. Otherwise the editor explains why it can't be changed.
5. **Existing shelves that mix novels and comics** get the type with the most items. The items that don't match stay where they are but get a "doesn't belong here" mark, and the shelf shows a banner: *"3 comics are on a novel shelf – Move them"*. Nothing is moved without the user's say-so.
6. **One song = one item.** Artist, album and track number become tags, so search, sorting, tags, selection, Move and Delete all keep working. Grouping by album is a view on top of that (Phase 7), not a different data model.

---

## Phase 0 – Prep (about 1 hour)

1. Merge `feature/comics` into `main`. Start a new branch, `feature/shelf-types`. Music gets its own branch, `feature/music`, from Phase 4.
2. Collect test files:
   * MP3s with ID3v2.3 and ID3v2.4 tags, one with only ID3v1, one with no tags, and one with Chinese tags (often saved as GBK, which `decodeText` already handles).
   * An M4A from iTunes with cover art, a FLAC with a `PICTURE` block, a WAV, an audio-only MP4 and a real video MP4 (it must be rejected with a clear message).
   * A whole album (10–15 tracks, numbered) for the multi-file import, and one long file (1–2 hours, for example an audiobook or DJ mix) to test seeking and saving the position.
   * Public-domain or CC music: the Free Music Archive and Musopen have both.
   * ✅ `node scripts/make-test-songs.mjs` generates most of these in `test-songs/`: a 10-track FLAC album with tones, a song with an `.lrc`, a WAV, silent MP3s with every kind of tag listed above, a huge cover, broken tags and a fake `.mp3`. `--large` adds a 2-hour WAV, and `--many` adds 200 MP3s. The M4A and MP4 files have to be real ones.
3. ✅ Install the player: `npx expo install expo-audio` (and its peer `expo-asset`). The plugin in `app.json` turns off the microphone permissions, since EverShelf never records.
4. Remember the testing notes from the comic work: Expo Go needs `--go`, and the migration step must exist before `SCHEMA_VERSION` goes up (see the version 7 repair).

## Phase 1 – Shelf types: data model ✅

* New type in `src/models/types.ts`: `ShelfKind = 'collection' | 'novel' | 'comic' | 'music'`, and `Shelf.kind`.
* **Migration V9**: `ALTER TABLE shelves ADD COLUMN kind TEXT`, then fill it in:
  * Built-in shelves by id: `books` → `novel`, `manga` → `comic`, `movies` and `anime` → `collection`.
  * Other shelves by content: only text books → `novel`, only comics → `comic`, no imported files → `collection`, both → the type with the most items (decision 5).
  * Write the inference as a **pure function** (`inferShelfKind(builtInId, bookKinds)`) with tests, and test the migration on a database with novels, comics and a mixed shelf.
* `createDefaultState` gives new installs typed shelves. A built-in **Music** shelf waits for Phase 4, so the app never shows a shelf it can't fill yet.
* **Backup**: write `kind` with each shelf. `BACKUP_FORMAT_VERSION` stays 2: older apps ignore the new field, and a bump would make them refuse new backups. Backups without a `kind` (or with an unknown one) run the same inference when restored.
* Add `canHold(shelfKind, fileKind)` in `src/models/`: the one place that says what is allowed where. Every later check goes through it.

## Phase 2 – Shelf types: enforcing them ✅

1. **Shelf editor** (`shelf/edit.tsx`): a type picker when adding a shelf (Collection, Novels, Comics, Music, each with a short line saying what it holds). Changing the type of an existing shelf follows decision 4.
2. **Import** (`import.tsx`, `importBook.ts`):
   * The button says what fits the shelf: "Import book", "Import comic" or "Import songs". A collection shelf has no import button.
   * After a file is picked, `detectFormat` + `canHold` decide. If the file doesn't fit, explain it: *"Dune.epub is a novel, but Manga is a comic shelf. Import it to a novel shelf instead."* The message names the shelves that would fit, or says to add one.
   * A note for later: the system file picker can't reliably filter by extension on Android (content URIs often have no name, see the memory notes), so the check after picking is what really protects the shelf. A MIME filter in the picker is just a convenience.
3. **Move**: the "Move to…" sheet only lists shelves that can hold *every* selected item. If none can, it says so.
4. **Mixed shelves left by the migration**: show the "doesn't belong here" mark and the banner from decision 5, with a one-tap "Move them".
5. **Restoring a backup** that puts a file on the wrong kind of shelf (a hand-edited or very old file): keep the item and show the same mark. Never drop data.
6. Translations (English and Simplified Chinese) for the type names and every new message.

## Phase 3 – Shelf screen per type ✅

Opening a shelf shows a layout that fits its type. `src/app/index.tsx` is already large, so split it first.

1. **Refactor**: move the shared parts (tabs, search, sort, selection mode, Move/Delete bar) into `ShelfScreen`. The type-specific part goes in one component per type under `src/components/shelf/`: `CollectionShelf`, `ReadingShelf`, `MusicShelf`.
2. **Collection**: the current grid/list, unchanged.
3. **Novels and comics, "reading layout"**: a "Continue reading" row at the top, covers with progress badges, and tapping a book **opens the reader directly**. Long-press still selects, and with one book selected the bar has a **Details** button. Entries without a file still open their details. (Comic covers keep the same 2:3 shape: it already fits manga volumes.)
4. **Music**: a placeholder ("Import songs to start"), filled in during Phase 5.
5. The "Continue reading" toggle stays in Settings, since it applies to every novel and comic shelf; its hint now says so.

✅ **Phases 1–3 make a complete, releasable update on their own** (typed shelves for novels and comics) before any music code exists.

## Phase 4 – Music: storage and import ✅

> **As built:** the `tracks` table keeps only what belongs to the file (file name, format, length, track and disc number, plain lyrics). Title, artist and album are the item's title and tags, so there's one place to edit them. Song files live at `books/<itemId>/song.<ext>`, next to book files, so deleting an item and the cleanup after a restore already cover them. They're copied or moved natively rather than streamed through JavaScript. Files in a multi-file pick that aren't songs are skipped and listed rather than failing the whole pick. New installs get a built-in Music shelf; existing users add one with the Music type. Still to do: shrinking very large cover art (needs `expo-image-manipulator`), and a shared placeholder cover for an album without art.

1. **Migration V10**: a `tracks` table with `item_id`, `file_name`, `format`, `duration_ms`, `artist`, `album`, `album_artist`, `track_number`, `disc_number`, `year`, plus `has_lyrics`. Add a `playback_progress` table (`item_id`, `position_ms`, `updated_at`, `play_count`, `last_played_at`), or reuse `reading_progress` the way comics did. A separate table is clearer here, because songs have no chapters.
2. **Storage**: copy each song to `music/<itemId>.<ext>` by **streaming in chunks**, as `importComic` does. Never read the whole file into memory: FLAC albums are often 30–50 MB per track. Deleting the item deletes the file (extend `deleteItemFiles`).
3. **Detect the format** from the first bytes (extend `detectFormat`): `ID3` or an MPEG frame sync for MP3, `fLaC`, `RIFF…WAVE`, and an `ftyp` box for M4A/MP4. **For MP4, check whether there's a video track** (`hdlr` = `vide`). If there is, reject it with *"This is a video. EverShelf can only play the sound of audio files."*
4. **Read tags** with pure functions and Jest tests, reading only the start (and, for ID3v1, the end) of the file:
   * `parseId3` (v2.3, v2.4, and v1 as a fallback, with text encodings including UTF-16 and GBK), `parseMp4Tags`, `parseFlacTags`.
   * Title, artist, album, album artist, track and disc number, year and **cover art**. The cover is saved with the existing `covers.ts`, and when there's no cover, all tracks from one album share one placeholder.
   * Duration: from the tags/headers where they give it, otherwise from the player the first time the song loads, and saved then.
   * No title tag: use the file name, the same as the readers ("03 - Song Name.mp3" → "Song Name", with track 3).
5. **Multi-file import**: pick a whole album at once. The preview lists the tracks (title, artist, duration) in track-number order, and the user can fix the album or artist for all of them together. Show progress ("Copying 4 of 12"), and clean up on failure like the other imports.
6. Artist and album become **tags** on the item (decision 6), so the existing search and sorting find them.

## Phase 5 – Music: shelf and player ✅

> **As built:** `PlayerProvider` (in `_layout.tsx`) owns one `useAudioPlaylist` and a matching queue; shuffle is done in the queue, since the playlist has none, and turning it on or off rearranges the songs around the one playing without stopping it. The mini player sits under the screens rather than over them, so it never covers their buttons, and hides in the readers and the player. The queue is saved in the settings table and comes back paused. Positions are saved every 5 s and on pause; songs of 20 minutes or more resume. Deleting a queued song removes it from the queue. Lengths the file didn't give are saved after the first play. Headphones being unplugged is left to the OS for now and needs checking on a phone.

1. **A player that lives above the screens**: a `PlayerProvider` in `src/state/`, mounted in `_layout.tsx`, owns one `AudioPlaylist`. Music keeps playing when the user goes to another shelf or opens a book.
2. **Music shelf layout** (`MusicShelf`): a song list (cover, title, artist, duration) with "Play all" and "Shuffle". Tapping a song plays it, and the rest of the visible list (after search and sort) becomes the queue.
3. **Mini player**: a bar at the bottom of every screen while something is loaded (cover, title, play/pause, next). Tapping it opens the full player.
4. **Full player screen**, `src/app/play.tsx`: large cover, title and artist, a seek bar with times, previous / play-pause / next, shuffle, repeat (off / all / one), and the queue (reorder and remove).
5. **Resume**: save the position regularly (throttled) and on pause. Reopening the app restores the last queue and song, paused. Long files (over about 20 minutes) resume where they stopped, and normal songs start from the beginning.
6. **Interruptions**: pause for phone calls, other apps and unplugged headphones, using `setAudioModeAsync`.
7. Long-press still selects songs for Move and Delete. Deleting the song that's playing stops it and removes it from the queue.

✅ **After Phase 5 music works in Expo Go** while the app is open.

## Phase 6 – Background playback and lock screen (needs a dev build) — code ✅, phone tests to do

> **As built:** `enableBackgroundPlayback` is set in `app.json` (the plugin's microphone permissions stay off). `expo config --type introspect` shows the iOS `audio` background mode and Android's `mediaPlayback` foreground service. The player sets `shouldPlayInBackground` with `doNotMix`, turns on lock-screen controls with next and previous as soon as a queue is loaded, updates them on every song change (title, artist, album, cover) and clears them when the queue empties. Step 4, testing on real phones, is still to do.

1. Add the `expo-audio` plugin to `app.json` with `enableBackgroundPlayback: true`. On iOS it adds the `audio` background mode, and on Android the media-playback foreground service. **Never edit `ios/` or `android/` by hand.**
2. `setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: 'doNotMix' })`.
3. `setActiveForLockScreen(true, { title, artist, albumTitle, artworkUrl })` on the playlist, with `updateLockScreenMetadata` on every track change and `clearLockScreenControls` when the queue is cleared. This also fixes the Android 3-minute cut-off.
4. Build with `npx eas-cli@latest build --profile development` and test **on real phones** (Android and iOS): screen off for 10+ minutes, the lock-screen buttons, Bluetooth headset buttons, a phone call in the middle, and swiping the app away.
5. Expo Go can't test this phase, so every check from here on is in the dev build.

## Phase 7 – Music library features

* Group the music shelf by **album** or **artist** (a toggle next to grid/list), built from the tags. An album view shows its tracks in disc/track order and "Play album".
* **Lyrics**: import `.lrc` files alongside the songs (matched by file name) or lyrics embedded in tags (ID3 `USLT`). The full player shows them, and with timestamped `.lrc`, highlights and scrolls the current line. Write the LRC parser as a pure function with tests.
* "Recently played" and "Most played", from `playback_progress`, like "Continue reading".
* Sleep timer (15 / 30 / 60 minutes, or the end of the song).
* *(Optional)* Playback speed for long recordings.

## Phase 8 – Backup, testing and release

1. **Backup**: like comics, song files are too big for the in-memory backup. Back up the items, tags, track info and play counts, and say clearly that the audio files aren't included. Shelf types are always backed up (Phase 1).
2. **Test**:
   * Upgrade from a database with novels, comics and a mixed shelf (V9 and V10 in a row).
   * Importing the wrong type on every kind of shelf, moving between shelf types, and changing a shelf's type.
   * A 200-track import, a 2-hour file, odd tags (none, broken, Chinese, huge cover art), a video MP4, and low storage.
   * Background and lock screen on both platforms (Phase 6).
3. **Translations** for everything new, in English and Simplified Chinese.
4. **Release**: the `expo-audio` config plugin is a native change, so it needs **a new EAS build** for both stores. JS-only fixes after that can go out with `eas update`.

## Phase 9 (optional) – Later ideas

* **A video shelf type** for real MP4s (the Movies shelf could become one), with `expo-video`: a different player, but the same shelf-type system.
* **OGG/Opus** on Android only, or converted at import.
* **Playlists**: user-made lists of songs that can span albums. These need a `playlists` table, because a playlist isn't a shelf.
* **Audiobooks**: a type that combines music-style playback with reader-style progress and chapters (M4B files have chapter marks).
* "Open with EverShelf" for audio files from the file manager.
* Import a whole folder (`Directory.pickDirectoryAsync` on Android).

---

### Notes

* As with the earlier roadmaps, each phase should end in a working app and a commit.
* **Phases 1–3 are a release by themselves.** They improve the app for novels and comics before music exists, and they keep the music branch smaller.
* Keep all parsing (format detection, ID3/MP4/FLAC tags, LRC, shelf-type inference) in pure functions with Jest tests and generated sample bytes, no phone needed.
* The main risks are **background playback differences between Android and iOS** (Phase 6, test early on real phones), and **memory** when importing large audio files (stream, as the comic import does).
