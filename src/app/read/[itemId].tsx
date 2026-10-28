import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Text, View, type ListViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bookPercent } from '@/books/progress';
import { BookSearchSheet } from '@/components/BookSearchSheet';
import { Button } from '@/components/Button';
import { ChapterListSheet } from '@/components/ChapterListSheet';
import { NotFound } from '@/components/NotFound';
import { ReaderSettingsSheet } from '@/components/ReaderSettingsSheet';
import { useT } from '@/i18n/useT';
import { readerStyle } from '@/models/readerSettings';
import { newId } from '@/models/ids';
import type { Bookmark, Chapter } from '@/models/types';
import { useSettings } from '@/state/SettingsProvider';
import { useShelfState } from '@/state/ShelfProvider';
import { readChapterText } from '@/storage/bookFiles';
import {
  addBookmark,
  loadBookmarks,
  loadChapters,
  loadProgress,
  removeBookmark,
  saveProgress,
  setBookFinished,
} from '@/storage/database';
import { fontSize, makeStyles, spacing, useTheme } from '@/theme';

const KEEP_AWAKE_TAG = 'reader';
const TOAST_MS = 1500;
/** Characters of a paragraph kept with its bookmark, for the bookmark list. */
const BOOKMARK_EXCERPT = 80;

/** Wait this long after scrolling stops before saving the reading position. */
const SAVE_DELAY_MS = 1000;
const VIEWABILITY = { itemVisiblePercentThreshold: 1 };

type ChapterText = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; paragraphs: string[] };
type LoadedText = { chapterId: string } & ({ status: 'missing' } | { status: 'ready'; paragraphs: string[] });

/**
 * Reads a book one chapter at a time. Tap the text to show or hide the
 * controls. The position is saved as you scroll and restored next time.
 */
export default function ReaderScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const db = useSQLiteContext();
  const state = useShelfState();
  const t = useT();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const item = state.items.find((i) => i.id === itemId);

  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<LoadedText | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [finished, setFinished] = useState(false);
  /** A short message shown over the text, e.g. "Bookmark added". */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { settings } = useSettings();
  const look = readerStyle(settings, useTheme().dark, Platform.OS);
  const chapter = chapters?.[index];
  // Text loaded for an earlier chapter counts as still loading.
  const text: ChapterText = loaded && loaded.chapterId === chapter?.id ? loaded : { status: 'loading' };

  const listRef = useRef<FlatList<string>>(null);
  /** Paragraph to scroll to once the chapter's text has loaded. */
  const restoreTo = useRef(0);
  /** The position to save, and the timer that saves it. */
  const position = useRef<{ chapterId: string; paragraph: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function savePositionNow() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const p = position.current;
    if (!p || !chapters) return;
    const chapterIndex = chapters.findIndex((c) => c.id === p.chapterId);
    const paragraphs = loaded?.chapterId === p.chapterId && loaded.status === 'ready' ? loaded.paragraphs : null;
    const percent = bookPercent(chapters, chapterIndex, paragraphs, p.paragraph);
    saveProgress(db, { itemId, chapterId: p.chapterId, paragraph: p.paragraph, percent, updatedAt: Date.now() }).catch(
      (error: unknown) => console.warn('Could not save reading position', error),
    );
  }
  const savePositionRef = useRef(savePositionNow);
  useEffect(() => {
    savePositionRef.current = savePositionNow;
  });

  // FlatList needs this callback to stay the same for the life of the list.
  const [onViewableItemsChanged] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ListViewToken[] }) => {
        const top = Math.min(...viewableItems.map((v) => v.index ?? Infinity));
        if (!position.current || !Number.isFinite(top)) return;
        position.current = { ...position.current, paragraph: top };
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => savePositionRef.current(), SAVE_DELAY_MS);
      },
  );

  // Load the chapter list and where the reader left off.
  useEffect(() => {
    let current = true;
    Promise.all([loadChapters(db, itemId), loadProgress(db, itemId), loadBookmarks(db, itemId)])
      .then(([loaded, progress, savedBookmarks]) => {
        if (!current) return;
        const saved = progress ? loaded.findIndex((c) => c.id === progress.chapterId) : -1;
        restoreTo.current = saved >= 0 && progress ? progress.paragraph : 0;
        setIndex(Math.max(saved, 0));
        setChapters(loaded);
        setBookmarks(savedBookmarks);
        setFinished(progress?.finishedAt != null);
      })
      .catch((error: unknown) => {
        console.warn('Could not load book', error);
        if (current) setChapters([]);
      });
    return () => {
      current = false;
    };
  }, [db, itemId]);

  // Load the current chapter's text, and remember it as the place to come back to.
  useEffect(() => {
    if (!chapter) return;
    let current = true;
    position.current = { chapterId: chapter.id, paragraph: restoreTo.current };
    savePositionRef.current();
    readChapterText(itemId, chapter.fileName).then((raw) => {
      if (!current) return;
      setLoaded(
        raw === null
          ? { chapterId: chapter.id, status: 'missing' }
          : { chapterId: chapter.id, status: 'ready', paragraphs: raw.split('\n').filter(Boolean) },
      );
    });
    return () => {
      current = false;
    };
  }, [chapter, itemId]);

  // Jump to the saved paragraph once the text is on screen.
  useEffect(() => {
    if (loaded?.status !== 'ready' || restoreTo.current === 0) return;
    const target = Math.min(restoreTo.current, loaded.paragraphs.length - 1);
    restoreTo.current = 0;
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index: target, animated: false }));
  }, [loaded]);

  // Save straight away when leaving the reader.
  useEffect(() => {
    const save = savePositionRef;
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

  // A new text size, spacing, margin or font moves every paragraph; scroll the
  // one being read back to the top of the screen.
  const layoutKey = `${look.fontSize}|${look.lineHeight}|${look.margin}|${look.fontFamily}`;
  const lastLayoutKey = useRef(layoutKey);
  useEffect(() => {
    if (lastLayoutKey.current === layoutKey) return;
    lastLayoutKey.current = layoutKey;
    const paragraph = position.current?.paragraph ?? 0;
    if (paragraph > 0) requestAnimationFrame(() => listRef.current?.scrollToIndex({ index: paragraph, animated: false }));
  }, [layoutKey]);

  if (!item) return <NotFound what="item" />;

  /** Opens a chapter, at its start or at a given paragraph (from a bookmark or search result). */
  const goTo = (next: number, paragraph = 0) => {
    if (!chapters || next < 0 || next >= chapters.length) return;
    if (next === index) {
      if (text.status === 'ready') {
        listRef.current?.scrollToIndex({ index: Math.min(paragraph, text.paragraphs.length - 1), animated: false });
      }
      return;
    }
    savePositionNow();
    restoreTo.current = paragraph;
    setIndex(next);
  };
  const toggleControls = () => setControlsVisible((v) => !v);

  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  /** Long-press a paragraph to bookmark it, or to remove its bookmark. */
  const toggleBookmark = (paragraph: number, paragraphText: string) => {
    if (!chapter) return;
    const existing = bookmarks.find((b) => b.chapterId === chapter.id && b.paragraph === paragraph);
    if (existing) {
      setBookmarks((list) => list.filter((b) => b.id !== existing.id));
      removeBookmark(db, existing.id).catch((error: unknown) => console.warn('Could not remove bookmark', error));
      showToast(t('reader.bookmarkRemoved'));
      return;
    }
    const bookmark = newBookmark(itemId, chapter.id, paragraph, paragraphText);
    setBookmarks((list) => [...list, bookmark]);
    addBookmark(db, bookmark).catch((error: unknown) => console.warn('Could not save bookmark', error));
    showToast(t('reader.bookmarkAdded'));
  };
  const deleteBookmark = (bookmark: Bookmark) => {
    setBookmarks((list) => list.filter((b) => b.id !== bookmark.id));
    removeBookmark(db, bookmark.id).catch((error: unknown) => console.warn('Could not remove bookmark', error));
  };
  const bookmarkedHere = new Set(bookmarks.filter((b) => b.chapterId === chapter?.id).map((b) => b.paragraph));

  const toggleFinished = () => {
    if (!chapters || chapters.length === 0) return;
    const next = !finished;
    setFinished(next);
    setBookFinished(db, itemId, next, chapters[chapters.length - 1].id).catch((error: unknown) =>
      console.warn('Could not mark book finished', error),
    );
  };
  const hasPrevious = index > 0;
  const hasNext = chapters !== null && index < chapters.length - 1;
  const { palette } = look;
  const textStyle = { fontSize: look.fontSize, lineHeight: look.lineHeight, color: palette.text, fontFamily: look.fontFamily };
  const mutedStyle = { color: palette.textMuted };
  const barStyle = { backgroundColor: palette.bar, borderColor: palette.border };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style={palette.dark ? 'light' : 'dark'} />

      {chapters === null || (chapter && text.status === 'loading') ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : !chapter ? (
        <View style={styles.center}>
          <Text style={[styles.message, mutedStyle]}>{t('reader.noChapters')}</Text>
          <Button title={t('reader.back')} onPress={() => router.back()} />
        </View>
      ) : (
        <FlatList
          key={chapter.id}
          ref={listRef}
          data={text.status === 'ready' ? text.paragraphs : []}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{
            paddingHorizontal: look.margin,
            paddingTop: insets.top + spacing.xl,
            paddingBottom: insets.bottom + spacing.xl,
          }}
          initialNumToRender={20}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          onScrollBeginDrag={() => setControlsVisible(false)}
          onScrollToIndexFailed={(info) => {
            // Paragraphs have different heights, so far-away ones aren't measured
            // yet: scroll to an estimate first, then try again.
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: false }), 100);
          }}
          ListHeaderComponent={
            <Text
              style={[styles.chapterTitle, { color: palette.text, fontFamily: look.fontFamily }]}
              onPress={toggleControls}>
              {chapter.title}
            </Text>
          }
          ListEmptyComponent={
            text.status === 'missing' ? (
              <Text style={[styles.message, mutedStyle]}>{t('reader.missingText')}</Text>
            ) : undefined
          }
          renderItem={({ item: paragraph, index: paragraphIndex }) => (
            <Text
              style={[
                styles.paragraph,
                textStyle,
                bookmarkedHere.has(paragraphIndex) && [styles.bookmarked, { borderColor: palette.textMuted }],
              ]}
              onPress={toggleControls}
              onLongPress={() => toggleBookmark(paragraphIndex, paragraph)}>
              {paragraph}
            </Text>
          )}
          ListFooterComponent={
            <View style={styles.endOfChapter}>
              {hasNext ? (
                <Button title={t('reader.nextChapter')} variant="primary" onPress={() => goTo(index + 1)} />
              ) : (
                <>
                  <Text style={[styles.message, mutedStyle]}>
                    {finished ? t('reader.finishedBook') : t('reader.endOfBook')}
                  </Text>
                  <Button
                    title={finished ? t('reader.markUnfinished') : t('reader.markFinished')}
                    variant={finished ? 'secondary' : 'primary'}
                    onPress={toggleFinished}
                  />
                </>
              )}
            </View>
          }
        />
      )}

      {controlsVisible && chapters && chapter && (
        <>
          <View style={[styles.bar, styles.topBar, barStyle, { paddingTop: insets.top + spacing.sm }]}>
            <Button title="←" variant="text" compact accessibilityLabel={t('reader.back')} onPress={() => router.back()} />
            <View style={styles.titles}>
              <Text style={[styles.bookTitle, { color: palette.text }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[styles.barHint, mutedStyle]} numberOfLines={1}>
                {chapter.title}
              </Text>
            </View>
            <Button
              title="🔍"
              variant="text"
              compact
              accessibilityLabel={t('search.title')}
              onPress={() => setSearchOpen(true)}
            />
            <Button
              title="Aa"
              variant="text"
              compact
              accessibilityLabel={t('readerSettings.title')}
              onPress={() => setSettingsOpen(true)}
            />
          </View>
          <View style={[styles.bar, styles.bottomBar, barStyle, { paddingBottom: insets.bottom + spacing.sm }]}>
            <Button
              title={t('reader.previous')}
              variant="text"
              compact
              disabled={!hasPrevious}
              onPress={() => goTo(index - 1)}
            />
            <Button
              title={t('reader.chapterOf', { n: index + 1, total: chapters.length })}
              compact
              accessibilityLabel={t('reader.contents', { count: chapters.length })}
              onPress={() => setContentsOpen(true)}
            />
            <Button title={t('reader.next')} variant="text" compact disabled={!hasNext} onPress={() => goTo(index + 1)} />
          </View>
        </>
      )}

      {chapters && (
        <>
          <ChapterListSheet
            visible={contentsOpen}
            chapters={chapters}
            currentIndex={index}
            bookmarks={bookmarks}
            onSelect={(next, paragraph) => {
              setControlsVisible(false);
              goTo(next, paragraph);
            }}
            onDeleteBookmark={deleteBookmark}
            onClose={() => setContentsOpen(false)}
          />
          <BookSearchSheet
            visible={searchOpen}
            itemId={itemId}
            chapters={chapters}
            onSelect={(next, paragraph) => {
              setControlsVisible(false);
              goTo(next, paragraph);
            }}
            onClose={() => setSearchOpen(false)}
          />
        </>
      )}
      <ReaderSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {toast && (
        <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + spacing.xl * 3 }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

function newBookmark(itemId: string, chapterId: string, paragraph: number, paragraphText: string): Bookmark {
  return {
    id: newId(),
    itemId,
    chapterId,
    paragraph,
    excerpt: paragraphText.slice(0, BOOKMARK_EXCERPT),
    createdAt: Date.now(),
  };
}

// Colours, text size and margins come from the reader settings (see `look`);
// these are only the parts that never change.
const useStyles = makeStyles(() => ({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  message: { fontSize: fontSize.body, textAlign: 'center' },
  chapterTitle: { fontSize: fontSize.heading, fontWeight: '700', marginBottom: spacing.xl },
  paragraph: { marginBottom: spacing.md },
  bookmarked: { borderLeftWidth: 3, paddingLeft: spacing.sm, marginLeft: -spacing.sm - 3 },
  endOfChapter: { alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xl * 2 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  toastText: { color: '#FFFFFF', fontSize: fontSize.small },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  topBar: { top: 0, paddingBottom: spacing.sm, borderBottomWidth: 1 },
  bottomBar: { bottom: 0, paddingTop: spacing.sm, borderTopWidth: 1, justifyContent: 'space-between' },
  titles: { flex: 1 },
  bookTitle: { fontSize: fontSize.body, fontWeight: '600' },
  barHint: { fontSize: fontSize.small },
}));
