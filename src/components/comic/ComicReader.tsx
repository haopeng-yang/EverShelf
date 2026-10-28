import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Image } from 'expo-image';
import { Stack, router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, type ListViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bookPages, chapterStarts, comicPercent, startPage, stripOffsets, type BookPage } from '@/books/comic/comicProgress';
import { Button } from '@/components/Button';
import { ChapterListSheet } from '@/components/ChapterListSheet';
import { LockedScreen } from '@/components/LockedShelf';
import { NotFound } from '@/components/NotFound';
import { OptionSheet } from '@/components/OptionSheet';
import { useT } from '@/i18n/useT';
import type { Chapter, ReadingMode } from '@/models/types';
import { useSettings } from '@/state/SettingsProvider';
import { useShelfLocks } from '@/state/ShelfLockProvider';
import { useShelfState } from '@/state/ShelfProvider';
import { pageUri } from '@/storage/bookFiles';
import {
  loadBookInfo,
  loadChapters,
  loadPages,
  loadProgress,
  saveProgress,
  setBookFinished,
  setReadingMode,
} from '@/storage/database';
import { fontSize, makeStyles, spacing } from '@/theme';

import { PageSlider } from './PageSlider';

const KEEP_AWAKE_TAG = 'comic-reader';
/** Wait this long after the page stops changing before saving the position. */
const SAVE_DELAY_MS = 1000;
const VIEWABILITY = { itemVisiblePercentThreshold: 1 };
const READING_MODES: ReadingMode[] = ['ltr', 'rtl', 'vertical'];

interface LoadedComic {
  chapters: Chapter[];
  pages: BookPage[];
  mode: ReadingMode;
  finished: boolean;
}

/**
 * Reads a comic page by page (left to right, or right to left for manga) or
 * as one long vertical strip (webtoons). In page modes, tap the left or right
 * third of the screen to turn the page, or swipe; tap the middle for the
 * controls. The page is saved as you read and restored next time.
 */
export function ComicReader({ itemId }: { itemId: string }) {
  const db = useSQLiteContext();
  const state = useShelfState();
  const t = useT();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { isLocked } = useShelfLocks();
  const item = state.items.find((i) => i.id === itemId);

  const [comic, setComic] = useState<LoadedComic | null>(null);
  const [failed, setFailed] = useState(false);
  /** 0-based page in the whole book. */
  const [current, setCurrent] = useState(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const listRef = useRef<FlatList<BookPage>>(null);

  // Load the chapters, pages, reading mode and where the reader left off.
  useEffect(() => {
    let active = true;
    Promise.all([loadChapters(db, itemId), loadPages(db, itemId), loadProgress(db, itemId), loadBookInfo(db, itemId)])
      .then(([chapters, pages, progress, info]) => {
        if (!active) return;
        const all = bookPages(chapters, pages);
        setCurrent(startPage(all, progress));
        setComic({ chapters, pages: all, mode: info.readingMode, finished: progress?.finishedAt != null });
      })
      .catch((error: unknown) => {
        console.warn('Could not load comic', error);
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [db, itemId]);

  // Save the page a moment after it stops changing, and straight away when leaving.
  const saveNow = useRef(() => {});
  useEffect(() => {
    saveNow.current = () => {
      const page = comic?.pages[current];
      if (!comic || !page) return;
      saveProgress(db, {
        itemId,
        chapterId: page.chapterId,
        paragraph: page.position,
        percent: comicPercent(current, comic.pages.length),
        updatedAt: Date.now(),
      }).catch((error: unknown) => console.warn('Could not save reading position', error));
    };
    if (!comic) return;
    const timer = setTimeout(() => saveNow.current(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [comic, current, db, itemId]);
  useEffect(() => {
    const save = saveNow;
    return () => save.current();
  }, []);

  // Stop the screen from turning off while reading, if that setting is on.
  useEffect(() => {
    if (!settings.readerKeepAwake) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch((error: unknown) => console.warn('Keep awake failed', error));
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [settings.readerKeepAwake]);

  // In vertical mode, the page at the top of the screen is the current one.
  // FlatList needs this callback to stay the same for the life of the list.
  const [onViewableItemsChanged] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ListViewToken[] }) => {
        const top = Math.min(...viewableItems.map((v) => (v.item as BookPage).index));
        if (Number.isFinite(top)) setCurrent(top);
      },
  );

  const offsets = useMemo(
    () => (comic && size ? stripOffsets(comic.pages, size.width) : []),
    [comic, size],
  );
  const starts = useMemo(() => (comic ? chapterStarts(comic.chapters.length, comic.pages) : []), [comic]);
  // Page modes show the pages left to right; right-to-left books reversed, so the first page is on the right.
  const slots = useMemo(() => (comic?.mode === 'rtl' ? [...comic.pages].reverse() : (comic?.pages ?? [])), [comic]);

  if (!item) return <NotFound what="item" />;
  const itemShelf = state.shelves.find((s) => s.id === item.shelfId);
  if (itemShelf && isLocked(itemShelf)) return <LockedScreen shelf={itemShelf} />;

  const total = comic?.pages.length ?? 0;
  const mode = comic?.mode ?? 'ltr';
  const paged = mode !== 'vertical';
  const rtl = mode === 'rtl';
  const toSlot = (index: number) => (rtl ? total - 1 - index : index);
  const page = comic?.pages[current];
  const chapterIndex = page?.chapterIndex ?? 0;
  const chapter = comic?.chapters[chapterIndex];

  /** Jumps to a page of the book. */
  const goTo = (index: number, animated = false) => {
    if (index < 0 || index >= total) return;
    setCurrent(index);
    listRef.current?.scrollToIndex({ index: paged ? toSlot(index) : index, animated });
  };
  const goToChapter = (index: number) => {
    const start = starts[index];
    if (start !== undefined && start >= 0) goTo(start);
  };
  const previousChapter = starts.slice(0, chapterIndex).findLastIndex((s) => s >= 0);
  const nextChapter = starts.findIndex((s, i) => i > chapterIndex && s >= 0);

  /** Tap the outer thirds to turn the page (mirrored for right to left); the middle shows the controls. */
  const tapPage = (x: number) => {
    if (!size) return;
    const third = size.width / 3;
    if (x > third && x < third * 2) {
      setControlsVisible((v) => !v);
      return;
    }
    setControlsVisible(false);
    const forward = x >= third * 2 !== rtl;
    goTo(current + (forward ? 1 : -1), true);
  };

  const changeMode = (next: ReadingMode) => {
    if (!comic || next === comic.mode) return;
    setComic({ ...comic, mode: next });
    setReadingMode(db, itemId, next).catch((error: unknown) => console.warn('Could not save reading mode', error));
  };

  const toggleFinished = () => {
    if (!comic || comic.chapters.length === 0) return;
    const next = !comic.finished;
    setComic({ ...comic, finished: next });
    setBookFinished(db, itemId, next, comic.chapters[comic.chapters.length - 1].id).catch((error: unknown) =>
      console.warn('Could not mark comic finished', error),
    );
  };

  const renderPage = (bookPage: BookPage, width: number, height: number, onPress: (x: number) => void) => (
    <Pressable style={{ width, height }} onPress={(e) => onPress(e.nativeEvent.locationX)}>
      <Image
        source={{ uri: pageUri(itemId, bookPage.fileName) ?? undefined }}
        style={styles.fill}
        contentFit="contain"
        // Pages are local files already: don't copy them into a disk cache too.
        cachePolicy="memory"
        recyclingKey={bookPage.fileName}
        transition={null}
        accessibilityLabel={t('comicReader.pageLabel', { n: bookPage.index + 1, total })}
      />
    </Pressable>
  );

  return (
    <View style={styles.container} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" hidden={!controlsVisible} />

      {failed || (comic && total === 0) ? (
        <View style={styles.center}>
          <Text style={styles.message}>{t('reader.noChapters')}</Text>
          <Button title={t('reader.back')} onPress={() => router.back()} />
        </View>
      ) : !comic || !size ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : paged ? (
        <FlatList
          // A new list when the direction changes, so it opens at the right end.
          key={`${mode}-${size.width}`}
          ref={listRef}
          data={slots}
          extraData={current}
          keyExtractor={(p) => p.fileName}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: size.width, offset: size.width * index, index })}
          initialScrollIndex={toSlot(current)}
          initialNumToRender={1}
          // Two pages on each side stay loaded, so turning a page is instant.
          windowSize={5}
          maxToRenderPerBatch={2}
          onScrollBeginDrag={() => setControlsVisible(false)}
          onMomentumScrollEnd={(e) => {
            const slot = Math.round(e.nativeEvent.contentOffset.x / size.width);
            setCurrent(rtl ? total - 1 - slot : slot);
          }}
          renderItem={({ item: p }) => renderPage(p, size.width, size.height, tapPage)}
        />
      ) : (
        <FlatList
          key={`vertical-${size.width}`}
          ref={listRef}
          data={comic.pages}
          keyExtractor={(p) => p.fileName}
          getItemLayout={(_, index) => ({ length: offsets[index + 1] - offsets[index], offset: offsets[index], index })}
          initialScrollIndex={current}
          initialNumToRender={2}
          windowSize={7}
          onScrollBeginDrag={() => setControlsVisible(false)}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          renderItem={({ item: p, index }) =>
            renderPage(p, size.width, offsets[index + 1] - offsets[index], () => setControlsVisible((v) => !v))
          }
        />
      )}

      {controlsVisible && comic && chapter && page && (
        <>
          <View style={[styles.bar, styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
            <Button title="←" variant="text" compact accessibilityLabel={t('reader.back')} onPress={() => router.back()} />
            <View style={styles.titles}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.hint} numberOfLines={1}>
                {chapter.title}
              </Text>
            </View>
            <Button
              title={t(`readingMode.${mode}`)}
              variant="text"
              compact
              accessibilityLabel={t('import.readingMode')}
              onPress={() => setModeSheetOpen(true)}
            />
          </View>

          <View style={[styles.bar, styles.bottomBar, { paddingBottom: insets.bottom + spacing.sm }]}>
            <PageSlider
              value={page.position}
              count={chapter.charCount}
              reversed={rtl}
              onSeek={(position) => goTo(starts[chapterIndex] + position)}
            />
            {current === total - 1 && (
              <Button
                title={comic.finished ? t('reader.markUnfinished') : t('reader.markFinished')}
                variant={comic.finished ? 'secondary' : 'primary'}
                compact
                onPress={toggleFinished}
              />
            )}
            <View style={styles.chapterRow}>
              <Button
                title={t('reader.previous')}
                variant="text"
                compact
                disabled={previousChapter === -1}
                onPress={() => goToChapter(previousChapter)}
              />
              <Button
                title={t('reader.chapterOf', { n: chapterIndex + 1, total: comic.chapters.length })}
                compact
                accessibilityLabel={t('reader.contents', { count: comic.chapters.length })}
                onPress={() => setContentsOpen(true)}
              />
              <Button
                title={t('reader.next')}
                variant="text"
                compact
                disabled={nextChapter === -1}
                onPress={() => goToChapter(nextChapter)}
              />
            </View>
          </View>
        </>
      )}

      {comic && (
        <>
          <ChapterListSheet
            visible={contentsOpen}
            chapters={comic.chapters}
            currentIndex={chapterIndex}
            bookmarks={[]}
            onSelect={(next) => {
              setControlsVisible(false);
              goToChapter(next);
            }}
            onDeleteBookmark={() => {}}
            onClose={() => setContentsOpen(false)}
          />
          <OptionSheet
            visible={modeSheetOpen}
            title={t('import.readingMode')}
            options={READING_MODES.map((value) => ({
              value,
              label: `${t(`readingMode.${value}`)} · ${t(`readingMode.${value}Hint`)}`,
            }))}
            selected={mode}
            onSelect={changeMode}
            onClose={() => setModeSheetOpen(false)}
          />
        </>
      )}
    </View>
  );
}

// Comics are read on black, whatever the app theme, so the bars are dark too.
const useStyles = makeStyles(() => ({
  container: { flex: 1, backgroundColor: '#000000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  message: { fontSize: fontSize.body, color: '#CCCCCC', textAlign: 'center' },
  fill: { width: '100%', height: '100%' },
  bar: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(20, 20, 20, 0.92)', paddingHorizontal: spacing.md },
  topBar: { top: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.sm },
  bottomBar: { bottom: 0, gap: spacing.sm, paddingTop: spacing.sm },
  titles: { flex: 1 },
  title: { fontSize: fontSize.body, fontWeight: '600', color: '#FFFFFF' },
  hint: { fontSize: fontSize.small, color: '#BBBBBB' },
  chapterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
}));
