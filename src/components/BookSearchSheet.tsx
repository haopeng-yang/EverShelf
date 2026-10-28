import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { searchBook, type SearchMatch } from '@/books/searchBook';
import { useT } from '@/i18n/useT';
import type { Chapter, Id } from '@/models/types';
import { fontSize, makeStyles, spacing } from '@/theme';

import { Button } from './Button';
import { TextField } from './TextField';

/** Stop after this many matches; a common word could otherwise match thousands. */
const MAX_RESULTS = 200;
/** Wait for typing to pause before searching. */
const SEARCH_DELAY_MS = 400;

interface BookSearchSheetProps {
  visible: boolean;
  itemId: Id;
  chapters: Chapter[];
  onSelect: (chapterIndex: number, paragraph: number) => void;
  onClose: () => void;
}

type SearchState = { query: string; results: SearchMatch[]; done: boolean; limited: boolean };

/** Full-screen search through every chapter of a book. Tap a result to jump to it. */
export function BookSearchSheet({ visible, itemId, chapters, onSelect, onClose }: BookSearchSheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState | null>(null);
  const searchId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const id = ++searchId.current;
    if (!trimmed) return;
    const timer = setTimeout(() => {
      setSearch({ query: trimmed, results: [], done: false, limited: false });
      searchBook(
        itemId,
        chapters,
        trimmed,
        MAX_RESULTS,
        (found) => setSearch((s) => s && { ...s, results: [...s.results, ...found] }),
        () => id !== searchId.current,
      )
        .then((limited) => {
          if (id === searchId.current) setSearch((s) => s && { ...s, done: true, limited });
        })
        .catch((error: unknown) => console.warn('Search failed', error));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, itemId, chapters]);

  // Results for an older search text are hidden until the new search starts.
  const current = search && search.query === query.trim() ? search : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder={t('search.placeholder')}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            style={styles.input}
            accessibilityLabel={t('search.title')}
          />
          <Button title={t('common.close')} variant="text" compact onPress={onClose} />
        </View>

        {current && (
          <Text style={styles.status}>
            {!current.done
              ? t('search.searching', { count: current.results.length })
              : current.limited
                ? t('search.limited', { count: current.results.length })
                : t('search.results', { count: current.results.length })}
          </Text>
        )}

        <FlatList
          data={current?.results ?? []}
          keyExtractor={(r) => `${r.chapterIndex}-${r.paragraph}`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListFooterComponent={current && !current.done ? <ActivityIndicator style={styles.spinner} /> : undefined}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onSelect(item.chapterIndex, item.paragraph);
                onClose();
              }}
              style={({ pressed }) => [styles.result, pressed && styles.pressed]}>
              <Text style={styles.chapter} numberOfLines={1}>
                {chapters[item.chapterIndex]?.title}
              </Text>
              <Text style={styles.snippet} numberOfLines={3}>
                {item.before}
                <Text style={styles.match}>{item.match}</Text>
                {item.after}
              </Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: spacing.lg, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1 },
  status: { fontSize: fontSize.small, color: c.textMuted },
  spinner: { marginVertical: spacing.lg },
  result: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border, gap: spacing.xs },
  pressed: { opacity: 0.6 },
  chapter: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  snippet: { fontSize: fontSize.body, color: c.text, lineHeight: 22 },
  match: { backgroundColor: c.tabSelected, color: c.text, fontWeight: '700' },
}));
