import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View, type ListViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ChapterListSheet } from '@/components/ChapterListSheet';
import { NotFound } from '@/components/NotFound';
import { useT } from '@/i18n/useT';
import type { Chapter } from '@/models/types';
import { useShelfState } from '@/state/ShelfProvider';
import { readChapterText } from '@/storage/bookFiles';
import { loadChapters, loadProgress, saveProgress } from '@/storage/database';
import { fontSize, makeStyles, spacing } from '@/theme';

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
    if (!p) return;
    saveProgress(db, { itemId, chapterId: p.chapterId, paragraph: p.paragraph, updatedAt: Date.now() }).catch(
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
    Promise.all([loadChapters(db, itemId), loadProgress(db, itemId)])
      .then(([loaded, progress]) => {
        if (!current) return;
        const saved = progress ? loaded.findIndex((c) => c.id === progress.chapterId) : -1;
        restoreTo.current = saved >= 0 && progress ? progress.paragraph : 0;
        setIndex(Math.max(saved, 0));
        setChapters(loaded);
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

  if (!item) return <NotFound what="item" />;

  const goTo = (next: number) => {
    if (!chapters || next < 0 || next >= chapters.length) return;
    savePositionNow();
    restoreTo.current = 0;
    setIndex(next);
  };
  const toggleControls = () => setControlsVisible((v) => !v);
  const hasPrevious = index > 0;
  const hasNext = chapters !== null && index < chapters.length - 1;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {chapters === null || (chapter && text.status === 'loading') ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : !chapter ? (
        <View style={styles.center}>
          <Text style={styles.message}>{t('reader.noChapters')}</Text>
          <Button title={t('reader.back')} onPress={() => router.back()} />
        </View>
      ) : (
        <FlatList
          key={chapter.id}
          ref={listRef}
          data={text.status === 'ready' ? text.paragraphs : []}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={[
            styles.page,
            { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
          ]}
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
            <Text style={styles.chapterTitle} onPress={toggleControls}>
              {chapter.title}
            </Text>
          }
          ListEmptyComponent={
            text.status === 'missing' ? <Text style={styles.message}>{t('reader.missingText')}</Text> : undefined
          }
          renderItem={({ item: paragraph }) => (
            <Text style={styles.paragraph} onPress={toggleControls}>
              {paragraph}
            </Text>
          )}
          ListFooterComponent={
            <View style={styles.endOfChapter}>
              {hasNext ? (
                <Button title={t('reader.nextChapter')} variant="primary" onPress={() => goTo(index + 1)} />
              ) : (
                <Text style={styles.message}>{t('reader.endOfBook')}</Text>
              )}
            </View>
          }
        />
      )}

      {controlsVisible && chapters && chapter && (
        <>
          <View style={[styles.bar, styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
            <Button title="←" variant="text" compact accessibilityLabel={t('reader.back')} onPress={() => router.back()} />
            <View style={styles.titles}>
              <Text style={styles.bookTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.barHint} numberOfLines={1}>
                {chapter.title}
              </Text>
            </View>
          </View>
          <View style={[styles.bar, styles.bottomBar, { paddingBottom: insets.bottom + spacing.sm }]}>
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
        <ChapterListSheet
          visible={contentsOpen}
          chapters={chapters}
          currentIndex={index}
          onSelect={(next) => {
            setControlsVisible(false);
            goTo(next);
          }}
          onClose={() => setContentsOpen(false)}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  message: { fontSize: fontSize.body, color: c.textMuted, textAlign: 'center' },
  page: { paddingHorizontal: spacing.xl },
  chapterTitle: { fontSize: fontSize.heading, fontWeight: '700', color: c.text, marginBottom: spacing.xl },
  paragraph: { fontSize: 18, lineHeight: 30, color: c.text, marginBottom: spacing.md },
  endOfChapter: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: c.surface,
    borderColor: c.border,
  },
  topBar: { top: 0, paddingBottom: spacing.sm, borderBottomWidth: 1 },
  bottomBar: { bottom: 0, paddingTop: spacing.sm, borderTopWidth: 1, justifyContent: 'space-between' },
  titles: { flex: 1 },
  bookTitle: { fontSize: fontSize.body, fontWeight: '600', color: c.text },
  barHint: { fontSize: fontSize.small, color: c.textMuted },
}));
