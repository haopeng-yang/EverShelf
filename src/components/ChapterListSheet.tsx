import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n/useT';
import type { Bookmark, Chapter } from '@/models/types';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

import { Button } from './Button';

/** Every chapter row has this height, so the list can open scrolled to the current chapter. */
const ROW_HEIGHT = 48;

interface ChapterListSheetProps {
  visible: boolean;
  chapters: Chapter[];
  currentIndex: number;
  bookmarks: Bookmark[];
  /** Go to a chapter, at its start or at a bookmarked paragraph. */
  onSelect: (chapterIndex: number, paragraph?: number) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  onClose: () => void;
}

/** The book's table of contents and bookmarks, sliding up from the bottom of the reader. */
export function ChapterListSheet({
  visible,
  chapters,
  currentIndex,
  bookmarks,
  onSelect,
  onDeleteBookmark,
  onClose,
}: ChapterListSheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const t = useT();
  const [tab, setTab] = useState<'contents' | 'bookmarks'>('contents');
  const chapterIndex = new Map(chapters.map((c, i) => [c.id, i]));
  // In reading order, so they match the book.
  const sortedBookmarks = bookmarks
    .filter((b) => chapterIndex.has(b.chapterId))
    .sort((a, b) => chapterIndex.get(a.chapterId)! - chapterIndex.get(b.chapterId)! || a.paragraph - b.paragraph);

  const select = (index: number, paragraph?: number) => {
    onSelect(index, paragraph);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { height: height * 0.7, paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.tabs}>
          <Button
            title={t('reader.contents', { count: chapters.length })}
            compact
            variant={tab === 'contents' ? 'primary' : 'secondary'}
            onPress={() => setTab('contents')}
            style={styles.tab}
          />
          <Button
            title={t('reader.bookmarks', { count: bookmarks.length })}
            compact
            variant={tab === 'bookmarks' ? 'primary' : 'secondary'}
            onPress={() => setTab('bookmarks')}
            style={styles.tab}
          />
        </View>

        {tab === 'contents' ? (
          <FlatList
            data={chapters}
            keyExtractor={(chapter) => chapter.id}
            getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
            initialScrollIndex={Math.max(0, currentIndex - 3)}
            renderItem={({ item, index }) => {
              const isCurrent = index === currentIndex;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isCurrent }}
                  onPress={() => select(index)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <Text style={[styles.label, isCurrent && styles.labelCurrent]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {isCurrent && <Text style={styles.check}>●</Text>}
                </Pressable>
              );
            }}
          />
        ) : (
          <FlatList
            data={sortedBookmarks}
            keyExtractor={(bookmark) => bookmark.id}
            ListEmptyComponent={<Text style={styles.empty}>{t('reader.noBookmarks')}</Text>}
            renderItem={({ item }) => {
              const index = chapterIndex.get(item.chapterId)!;
              return (
                <View style={styles.bookmarkRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => select(index, item.paragraph)}
                    style={({ pressed }) => [styles.bookmarkText, pressed && styles.pressed]}>
                    <Text style={styles.bookmarkChapter} numberOfLines={1}>
                      {chapters[index].title}
                    </Text>
                    <Text style={styles.label} numberOfLines={2}>
                      {item.excerpt}
                    </Text>
                  </Pressable>
                  <Button
                    title="✕"
                    variant="text"
                    compact
                    accessibilityLabel={t('reader.deleteBookmark')}
                    onPress={() => onDeleteBookmark(item)}
                  />
                </View>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: { flex: 1 },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pressed: { opacity: 0.6 },
  label: { flex: 1, fontSize: fontSize.body, color: c.text },
  labelCurrent: { color: c.primary, fontWeight: '600' },
  check: { fontSize: fontSize.small, color: c.primary },
  empty: { fontSize: fontSize.body, color: c.textMuted, textAlign: 'center', marginTop: spacing.xl },
  bookmarkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  bookmarkText: { flex: 1, gap: 2 },
  bookmarkChapter: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
}));
