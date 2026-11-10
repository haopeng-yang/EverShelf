import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { guessReadingMode } from '@/books/comic/parseComic';
import { ZipError } from '@/books/comic/zip';
import {
  MixedFilesError,
  pickBookFile,
  saveImportedBook,
  UnsupportedFileError,
  WrongShelfError,
  type PickedBookFile,
} from '@/books/importBook';
import { ComicError, disposeComic, saveImportedComic } from '@/books/importComic';
import { disposeSongs, saveImportedSongs, SongsError, type PickedSongs } from '@/books/importSongs';
import { disposeVideos, saveImportedVideos, VideosError, type PickedVideos } from '@/books/importVideos';
import { resolutionLabel } from '@/books/video/readVideo';
import { AudioError } from '@/books/music/audioTags';
import { EpubError } from '@/books/parseEpub';
import { CHAPTER_LENGTH, parseTxt, type ParsedChapter, type SplitRule } from '@/books/parseTxt';
import { Button } from '@/components/Button';
import { showMessage } from '@/components/dialogs';
import { LockedScreen } from '@/components/LockedShelf';
import { NotFound } from '@/components/NotFound';
import { TextField } from '@/components/TextField';
import type { Translate } from '@/i18n';
import { useT } from '@/i18n/useT';
import { durationLabel } from '@/models/queue';
import type { ReadingMode, Shelf } from '@/models/types';
import { useShelfLocks } from '@/state/ShelfLockProvider';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

/** How many chapter titles the preview lists before "and N more". */
const PREVIEW_CHAPTERS = 30;

const READING_MODES: ReadingMode[] = ['ltr', 'rtl', 'vertical'];

/**
 * Import a .txt or .epub book, one or more comic files, songs or videos onto
 * a shelf: pick the file(s), check the chapters or tracks, fix the title or
 * author (a comic's reading direction, an album's artist, each video's
 * title), then save new items.
 */
export default function ImportScreen() {
  const { shelfId } = useLocalSearchParams<{ shelfId: string }>();
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const db = useSQLiteContext();
  const t = useT();
  const styles = useStyles();
  const shelf = state.shelves.find((s) => s.id === shelfId);
  const { isLocked } = useShelfLocks();

  const [file, setFile] = useState<PickedBookFile | null>(null);
  const [picking, setPicking] = useState(false);
  const [rule, setRule] = useState<SplitRule>('headings');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [readingMode, setReadingMode] = useState<ReadingMode>('ltr');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // For songs: artist and album for every song, or null to keep each song's own.
  const [songArtist, setSongArtist] = useState<string | null>(null);
  const [songAlbum, setSongAlbum] = useState<string | null>(null);
  // For videos: each one's title, in the order picked.
  const [videoTitles, setVideoTitles] = useState<string[]>([]);

  // Comics may have copied a file to the cache while picking; drop it when it's replaced or the screen closes.
  useEffect(() => {
    if (file?.kind === 'comic') return () => disposeComic(file.comic);
    if (file?.kind === 'songs') return () => disposeSongs(file.songs);
    if (file?.kind === 'videos') return () => disposeVideos(file.videos);
  }, [file]);

  // TXT files are split here, so changing the rule re-splits; EPUBs come with their chapters.
  const txt = useMemo(() => (file?.kind === 'txt' ? parseTxt(file.text, file.name, rule) : null), [file, rule]);
  const chapters = useMemo(() => {
    const raw = file?.kind === 'epub' ? file.book.chapters : (txt?.chapters ?? []);
    return withTitles(raw, t);
  }, [file, txt, t]);
  // What the chapter list shows: a title and a size, for books and comics alike.
  const chapterRows = useMemo(
    () =>
      file?.kind === 'comic'
        ? file.comic.chapters.map((c, index) => ({
            title: c.title || t('import.chapterN', { n: index + 1 }),
            size: t('import.pages', { count: c.pages.length }),
          }))
        : chapters.map((c) => ({ title: c.title, size: t('import.chars', { count: c.text.length }) })),
    [file, chapters, t],
  );

  async function choose() {
    if (!shelf) return;
    setPicking(true);
    try {
      const picked = await pickBookFile(shelf.kind);
      if (!picked) return;
      setFile(picked);
      setRule('headings');
      setSongArtist(null);
      setSongAlbum(null);
      if (picked.kind === 'songs') return;
      if (picked.kind === 'videos') {
        setVideoTitles(picked.videos.videos.map((v) => v.title));
        return;
      }
      if (picked.kind === 'comic') {
        const { comic } = picked;
        setTitle(comic.title);
        setAuthor(comic.author);
        setReadingMode(guessReadingMode({ rightToLeft: comic.rightToLeft, shelfId: shelfId ?? '', sizes: comic.sampleSizes }));
        return;
      }
      const meta = picked.kind === 'epub' ? picked.book : parseTxt(picked.text, picked.name, 'headings');
      setTitle(meta.title || picked.name.replace(/\.\w+$/, ''));
      setAuthor(meta.author);
    } catch (error) {
      showMessage(error instanceof WrongShelfError ? wrongShelfText(error, shelf, state.shelves, t) : errorText(error, t));
    } finally {
      setPicking(false);
    }
  }

  // Open the picker straight away; there is nothing to show until a file is chosen.
  const openedOnce = useRef(false);
  const openPickerOnce = useEffectEvent(() => {
    if (openedOnce.current) return;
    openedOnce.current = true;
    void choose();
  });
  useEffect(() => openPickerOnce(), []);

  if (!shelf) return <NotFound what="shelf" />;
  if (isLocked(shelf)) return <LockedScreen shelf={shelf} />;
  const saving = progress !== null;

  async function save() {
    if (!shelf || !file || saving) return;
    if (file.kind === 'songs') {
      await saveSongs(file.songs);
      return;
    }
    if (file.kind === 'videos') {
      await saveVideos(file.videos);
      return;
    }
    if (!title.trim()) {
      showMessage(t('itemEdit.needTitle'));
      return;
    }
    if (chapterRows.length === 0) {
      showMessage(t('import.empty'));
      return;
    }
    if (file.kind === 'comic') {
      setProgress({ done: 0, total: file.comic.pageCount });
      try {
        const item = await saveImportedComic(
          db,
          dispatch,
          {
            shelf,
            title: title.trim(),
            tagValues: { [t('tag.author')]: author, [t('tag.description')]: file.comic.description },
            comic: file.comic,
            readingMode,
            chapterTitles: chapterRows.map((row) => row.title),
          },
          (done, total) => setProgress({ done, total }),
        );
        router.replace({ pathname: '/item/[id]', params: { id: item.id } });
      } catch (error) {
        setProgress(null);
        showMessage(error instanceof ComicError ? errorText(error, t) : t('import.saveFailed', { error: String(error) }));
      }
      return;
    }
    setProgress({ done: 0, total: chapters.length });
    try {
      const epub = file.kind === 'epub' ? file.book : null;
      const item = await saveImportedBook(
        db,
        dispatch,
        {
          shelf,
          title: title.trim(),
          tagValues: { [t('tag.author')]: author, [t('tag.description')]: epub?.description ?? '' },
          cover: epub?.cover ?? null,
          chapters,
        },
        (done, total) => setProgress({ done, total }),
      );
      router.replace({ pathname: '/item/[id]', params: { id: item.id } });
    } catch (error) {
      setProgress(null);
      showMessage(t('import.saveFailed', { error: String(error) }));
    }
  }

  async function saveSongs(picked: PickedSongs) {
    if (!shelf) return;
    setProgress({ done: 0, total: picked.songs.length });
    try {
      const { items, failed } = await saveImportedSongs(
        db,
        dispatch,
        shelf,
        picked.songs.map((song) => ({
          song,
          // No title tag and no file name (an Android content link): the user can rename it later.
          title: song.title || t('import.untitledSong'),
          tagValues: {
            [t('tag.artist')]: songArtist ?? song.info.artist,
            [t('tag.album')]: songAlbum ?? song.info.album,
            [t('tag.date')]: song.info.year,
          },
        })),
        (done, total) => setProgress({ done, total }),
      );
      if (failed > 0) showMessage(t('import.songsFailed', { count: failed }));
      if (items.length === 1) router.replace({ pathname: '/item/[id]', params: { id: items[0].id } });
      else router.back();
    } catch (error) {
      setProgress(null);
      showMessage(error instanceof SongsError ? t('import.songsNoSpace') : t('import.saveFailed', { error: String(error) }));
    }
  }

  async function saveVideos(picked: PickedVideos) {
    if (!shelf) return;
    setProgress({ done: 0, total: picked.videos.length });
    try {
      const { items, failed } = await saveImportedVideos(
        db,
        dispatch,
        shelf,
        picked.videos.map((video, index) => ({
          video,
          title: videoTitles[index]?.trim() || video.title || t('import.untitledVideo'),
          tagValues: { [t('tag.date')]: video.info.year, [t('tag.description')]: video.info.description },
        })),
        (done, total) => setProgress({ done, total }),
      );
      if (failed > 0) showMessage(t('import.videosFailed', { count: failed }));
      if (items.length === 1) router.replace({ pathname: '/item/[id]', params: { id: items[0].id } });
      else router.back();
    } catch (error) {
      setProgress(null);
      showMessage(error instanceof VideosError ? errorText(error, t) : t('import.saveFailed', { error: String(error) }));
    }
  }

  const savingKey =
    file?.kind === 'comic'
      ? 'import.savingPages'
      : file?.kind === 'songs'
        ? 'import.savingSongs'
        : file?.kind === 'videos'
          ? 'import.savingVideos'
          : 'import.saving';
  const introKind = shelf.kind === 'comic' || shelf.kind === 'music' || shelf.kind === 'video' ? shelf.kind : 'novel';

  return (
    <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={spacing.xl}>
      <Stack.Screen
        options={{
          title: t('import.title', { shelf: shelf.name }),
          headerRight: () => (
            <Button title={t('common.save')} variant="header" compact disabled={!file || saving} onPress={save} />
          ),
        }}
      />

      {saving ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.hint}>{t(savingKey, { done: progress.done, total: progress.total })}</Text>
        </View>
      ) : !file ? (
        <View style={styles.center}>
          {picking ? <ActivityIndicator /> : <Text style={styles.hint}>{t(`import.intro.${introKind}`)}</Text>}
          <Button title={t('import.chooseFile')} variant="primary" disabled={picking} onPress={choose} />
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.label}>{t('import.file')}</Text>
            <Text style={styles.value}>{file.name || t('import.noFileName')}</Text>
            {file.kind === 'txt' && (
              <Text style={styles.hint}>{t('import.encoding', { encoding: file.encoding.toUpperCase() })}</Text>
            )}
            {file.kind === 'epub' && file.book.cover && <Text style={styles.hint}>{t('import.hasCover')}</Text>}
            {file.kind === 'comic' && (
              <Text style={styles.hint}>
                {[
                  file.comic.files.length > 1 ? t('import.files', { count: file.comic.files.length }) : '',
                  t('import.pages', { count: file.comic.pageCount }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            )}
            {file.kind === 'songs' && <Text style={styles.hint}>{t('import.songs', { count: file.songs.songs.length })}</Text>}
            {file.kind === 'videos' && <Text style={styles.hint}>{t('import.videos', { count: file.videos.videos.length })}</Text>}
            <Button title={t('import.chooseOther')} compact onPress={choose} style={styles.alignStart} />
          </View>

          {file.kind === 'songs' ? (
            <SongsPreview
              picked={file.songs}
              artist={songArtist}
              album={songAlbum}
              onChangeArtist={setSongArtist}
              onChangeAlbum={setSongAlbum}
            />
          ) : file.kind === 'videos' ? (
            <VideosPreview
              picked={file.videos}
              titles={videoTitles}
              onChangeTitle={(index, title) =>
                setVideoTitles((titles) => titles.map((old, i) => (i === index ? title : old)))
              }
            />
          ) : (
            <>
              <View style={styles.section}>
                <Text style={styles.label}>{t('tag.title')}</Text>
                <TextField value={title} onChangeText={setTitle} placeholder={t('itemEdit.titlePlaceholder')} />
              </View>
              <View style={styles.section}>
                <Text style={styles.label}>{t('tag.author')}</Text>
                <TextField value={author} onChangeText={setAuthor} />
              </View>
            </>
          )}

          {txt && (
            <View style={styles.section}>
              <Text style={styles.label}>{t('import.splitBy')}</Text>
              <View style={styles.ruleRow}>
                <Button
                  title={t('import.byHeadings', { count: txt.headingCount })}
                  variant={txt.rule === 'headings' ? 'primary' : 'secondary'}
                  compact
                  disabled={txt.headingCount < 2}
                  onPress={() => setRule('headings')}
                  style={styles.ruleButton}
                />
                <Button
                  title={t('import.byLength', { length: CHAPTER_LENGTH.toLocaleString() })}
                  variant={txt.rule === 'length' ? 'primary' : 'secondary'}
                  compact
                  onPress={() => setRule('length')}
                  style={styles.ruleButton}
                />
              </View>
              {txt.headingCount < 2 && <Text style={styles.hint}>{t('import.noHeadings')}</Text>}
            </View>
          )}

          {file.kind === 'comic' && (
            <View style={styles.section}>
              <Text style={styles.label}>{t('import.readingMode')}</Text>
              {READING_MODES.map((mode) => (
                <Button
                  key={mode}
                  title={`${t(`readingMode.${mode}`)} · ${t(`readingMode.${mode}Hint`)}`}
                  variant={readingMode === mode ? 'primary' : 'secondary'}
                  compact
                  onPress={() => setReadingMode(mode)}
                />
              ))}
              <Text style={styles.hint}>{t('import.readingModeHint')}</Text>
            </View>
          )}

          {file.kind !== 'songs' && file.kind !== 'videos' && (
          <View style={styles.section}>
            <Text style={styles.label}>{t('import.chapters', { count: chapterRows.length })}</Text>
            <View style={styles.chapterList}>
              {chapterRows.slice(0, PREVIEW_CHAPTERS).map((chapter, index) => (
                <View key={index} style={styles.chapterRow}>
                  <Text style={styles.chapterTitle} numberOfLines={1}>
                    {chapter.title}
                  </Text>
                  <Text style={styles.hint}>{chapter.size}</Text>
                </View>
              ))}
              {chapterRows.length > PREVIEW_CHAPTERS && (
                <Text style={styles.hint}>{t('import.more', { count: chapterRows.length - PREVIEW_CHAPTERS })}</Text>
              )}
            </View>
          </View>
          )}
        </>
      )}
    </KeyboardAwareScrollView>
  );
}

/** The value every song shares, or '' if they differ. */
function shared(values: string[]): string {
  return values.every((v) => v === values[0]) ? (values[0] ?? '') : '';
}

interface SongsPreviewProps {
  picked: PickedSongs;
  /** Null keeps each song's own value. */
  artist: string | null;
  album: string | null;
  onChangeArtist: (value: string) => void;
  onChangeAlbum: (value: string) => void;
}

/** Artist and album for all the songs at once, then the track list in album order. */
function SongsPreview({ picked, artist, album, onChangeArtist, onChangeAlbum }: SongsPreviewProps) {
  const t = useT();
  const styles = useStyles();
  const { songs, skipped } = picked;
  const several = songs.length > 1;
  const artists = songs.map((s) => s.info.artist);
  const albums = songs.map((s) => s.info.album);
  const mixedHint = (values: string[]) =>
    several && shared(values) === '' && values.some(Boolean) ? t('import.songsMixed') : '';

  return (
    <>
      <View style={styles.section}>
        <Text style={styles.label}>{t('tag.artist')}</Text>
        <TextField value={artist ?? shared(artists)} onChangeText={onChangeArtist} placeholder={mixedHint(artists)} />
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>{t('tag.album')}</Text>
        <TextField value={album ?? shared(albums)} onChangeText={onChangeAlbum} placeholder={mixedHint(albums)} />
        {several && <Text style={styles.hint}>{t('import.songsSharedHint')}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('import.songs', { count: songs.length })}</Text>
        <View style={styles.chapterList}>
          {songs.slice(0, PREVIEW_CHAPTERS).map((song, index) => (
            <View key={index} style={styles.chapterRow}>
              <Text style={styles.trackNumber}>{song.trackNumber ?? '–'}</Text>
              <View style={styles.songText}>
                <Text style={styles.chapterTitle} numberOfLines={1}>
                  {song.title || t('import.untitledSong')}
                </Text>
                {(artist ?? song.info.artist) !== '' && (
                  <Text style={styles.songArtist} numberOfLines={1}>
                    {artist ?? song.info.artist}
                  </Text>
                )}
              </View>
              {song.info.durationMs !== null && <Text style={styles.hint}>{durationLabel(song.info.durationMs)}</Text>}
            </View>
          ))}
          {songs.length > PREVIEW_CHAPTERS && (
            <Text style={styles.hint}>{t('import.more', { count: songs.length - PREVIEW_CHAPTERS })}</Text>
          )}
        </View>
        {skipped.length > 0 && (
          <Text style={styles.hint}>
            {t('import.songsSkipped', {
              files: skipped
                .map((s) => `${s.name || t('import.noFileName')} (${t(s.code === 'video' ? 'import.reasonVideo' : 'import.reasonNotSong')})`)
                .join(', '),
            })}
          </Text>
        )}
      </View>
    </>
  );
}

interface VideosPreviewProps {
  picked: PickedVideos;
  titles: string[];
  onChangeTitle: (index: number, title: string) => void;
}

/** Each video's title, ready to fix, with its length and size; then the files that were skipped. */
function VideosPreview({ picked, titles, onChangeTitle }: VideosPreviewProps) {
  const t = useT();
  const styles = useStyles();
  const { videos, skipped } = picked;

  return (
    <View style={styles.section}>
      <Text style={styles.label}>{videos.length > 1 ? t('import.videoTitles') : t('tag.title')}</Text>
      {videos.slice(0, PREVIEW_CHAPTERS).map((video, index) => {
        const details = [
          video.info.durationMs !== null ? durationLabel(video.info.durationMs) : '',
          resolutionLabel(video.info.width, video.info.height),
          video.info.format.toUpperCase(),
        ].filter(Boolean);
        return (
          <View key={index} style={styles.videoRow}>
            <TextField
              value={titles[index] ?? ''}
              onChangeText={(text) => onChangeTitle(index, text)}
              placeholder={t('import.untitledVideo')}
              accessibilityLabel={t('import.videoTitleLabel', { n: index + 1 })}
            />
            <Text style={styles.videoDetails} numberOfLines={1}>
              {[video.name, ...details].filter(Boolean).join(' · ')}
            </Text>
          </View>
        );
      })}
      {videos.length > PREVIEW_CHAPTERS && (
        <Text style={styles.hint}>{t('import.videosMore', { count: videos.length - PREVIEW_CHAPTERS })}</Text>
      )}
      {skipped.length > 0 && (
        <Text style={styles.hint}>
          {t('import.songsSkipped', {
            files: skipped
              .map((s) => `${s.name || t('import.noFileName')} (${t(s.code === 'notOnThisPhone' ? 'import.reasonNotOnThisPhone' : 'import.reasonNotVideo')})`)
              .join(', '),
          })}
        </Text>
      )}
    </View>
  );
}

/** Gives untitled chapters a name: the text before the first heading, or numbered parts. */
function withTitles(chapters: ParsedChapter[], t: Translate): ParsedChapter[] {
  return chapters.map((chapter, index) => {
    if (chapter.title) return chapter;
    const isOpening = index === 0 && chapters.length > 1 && chapters[1].title !== '';
    return { ...chapter, title: isOpening ? t('import.opening') : t('import.part', { n: index + 1 }) };
  });
}

/** "Dune.epub is a novel, but Manga is a Comics shelf. Import it into “Books” instead." */
function wrongShelfText(error: WrongShelfError, shelf: Shelf, shelves: Shelf[], t: Translate): string {
  const params = { shelf: shelf.name, kind: t(`shelfKind.${shelf.kind}`), file: t(`fileKind.${error.fileKind}`) };
  const problem =
    error.fileCount > 1
      ? t('import.wrongShelfFiles', {
          ...params,
          files: t(error.fileKind === 'music' ? 'fileKinds.music' : error.fileKind === 'video' ? 'fileKinds.video' : 'fileKinds.comic'),
        })
      : error.fileName
        ? t('import.wrongShelf', { ...params, name: error.fileName })
        : t('import.wrongShelfUnnamed', params);
  const fitting = shelves.filter((s) => s.id !== shelf.id && s.kind === error.fileKind);
  const fix =
    fitting.length > 0
      ? t('import.wrongShelfTry', { shelves: fitting.map((s) => `“${s.name}”`).join(', ') })
      : t('import.wrongShelfNone', { kind: t(`shelfKind.${error.fileKind}`) });
  return `${problem} ${fix}`;
}

function errorText(error: unknown, t: Translate): string {
  if (error instanceof UnsupportedFileError) {
    return error.message ? t('import.unsupported', { name: error.message }) : t('import.unsupportedUnnamed');
  }
  if (error instanceof MixedFilesError) return t('import.mixedFiles');
  if (error instanceof AudioError) return t(error.code === 'video' ? 'import.isVideo' : 'import.notSong');
  if (error instanceof VideosError) {
    if (error.code === 'noSpace') return t('import.videosNoSpace');
    return t(error.code === 'notOnThisPhone' ? 'import.videoNotOnThisPhone' : 'import.notVideo');
  }
  if (error instanceof ComicError) return t(error.code === 'noSpace' ? 'import.comicNoSpace' : 'import.comicNoPages');
  if (error instanceof ZipError) {
    if (error.code === 'tooLarge') return t('import.comicTooLarge');
    if (error.code === 'encrypted') return t('import.comicEncrypted');
    if (error.code === 'unsupported') return t('import.comicUnsupported');
    return t('import.comicDamaged');
  }
  if (error instanceof EpubError) {
    if (error.code === 'drm') return t('import.epubDrm');
    if (error.code === 'noText') return t('import.epubNoText');
    return t('import.epubInvalid');
  }
  return t('import.readFailed', { error: String(error) });
}

const useStyles = makeStyles((c) => ({
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xl * 2 },
  center: { alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xl * 2 },
  section: { gap: spacing.sm },
  label: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  value: { fontSize: fontSize.body, color: c.text },
  hint: { fontSize: fontSize.small, color: c.textMuted, textAlign: 'center' },
  alignStart: { alignSelf: 'flex-start' },
  ruleRow: { flexDirection: 'row', gap: spacing.sm },
  ruleButton: { flex: 1 },
  chapterList: { borderRadius: radius.md, backgroundColor: c.surface, padding: spacing.md, gap: spacing.sm },
  chapterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chapterTitle: { flex: 1, fontSize: fontSize.body, color: c.text },
  trackNumber: { minWidth: 24, fontSize: fontSize.small, color: c.textMuted, textAlign: 'right' },
  songText: { flex: 1, minWidth: 0 },
  songArtist: { fontSize: fontSize.small, color: c.textMuted },
  videoRow: { gap: spacing.xs },
  videoDetails: { fontSize: fontSize.small, color: c.textMuted },
}));
