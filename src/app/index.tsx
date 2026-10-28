import { Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ContinueReadingRow } from '@/components/ContinueReadingRow';
import { ItemCard } from '@/components/ItemCard';
import { ItemRow } from '@/components/ItemRow';
import { OptionSheet } from '@/components/OptionSheet';
import { ShelfTabs } from '@/components/ShelfTabs';
import { TextField } from '@/components/TextField';
import { useT } from '@/i18n/useT';
import { SORT_ORDERS, filterItems, sortItems } from '@/models/query';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import type { BookSummary, Id } from '@/models/types';
import { useSettings } from '@/state/SettingsProvider';
import { useShelfState } from '@/state/ShelfProvider';
import { loadBookSummaries } from '@/storage/database';
import { fontSize, makeStyles, spacing } from '@/theme';

const MIN_CARD_WIDTH = 140;
const CONTINUE_READING_MAX = 10;

export default function ShelvesScreen() {
  const state = useShelfState();
  const { settings, setSetting } = useSettings();
  const styles = useStyles();
  const t = useT();
  const sortOptions = SORT_ORDERS.map((value) => ({ value, label: t(`sort.${value}`) }));
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<Id | undefined>(state.shelves[0]?.id);
  const [query, setQuery] = useState('');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);

  // When a shelf is added (always at the end), switch to it.
  const shelfCount = useRef(state.shelves.length);
  useEffect(() => {
    if (state.shelves.length > shelfCount.current) setSelectedId(state.shelves.at(-1)?.id);
    shelfCount.current = state.shelves.length;
  }, [state.shelves]);

  // Falls back to the first shelf if the selected one was deleted.
  const shelf = state.shelves.find((s) => s.id === selectedId) ?? state.shelves[0];
  // Reading progress of imported books, reloaded whenever the shelf comes back into view.
  const db = useSQLiteContext();
  const [books, setBooks] = useState<Map<Id, BookSummary>>(new Map());
  useFocusEffect(
    useCallback(() => {
      let current = true;
      loadBookSummaries(db)
        .then((loaded) => current && setBooks(loaded))
        .catch((error: unknown) => console.warn('Could not load reading progress', error));
      return () => {
        current = false;
      };
    }, [db]),
  );

  const items = useMemo(() => {
    if (!shelf) return [];
    const lastRead = new Map([...books].map(([id, book]) => [id, book.lastReadAt]));
    return sortItems(filterItems(selectItemsOnShelf(state, shelf.id), query), settings.sortOrder, lastRead);
  }, [state, shelf, query, settings.sortOrder, books]);
  const searching = query.trim() !== '';

  const continueReading = useMemo(() => {
    if (!shelf) return [];
    return selectItemsOnShelf(state, shelf.id)
      .flatMap((item) => {
        const book = books.get(item.id);
        return book && book.lastReadAt !== null && !book.finished ? [{ item, book, at: book.lastReadAt }] : [];
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, CONTINUE_READING_MAX);
  }, [state, shelf, books]);

  const listView = settings.viewMode === 'list';
  const columns = listView ? 1 : Math.max(2, Math.floor((width - spacing.lg * 2) / MIN_CARD_WIDTH));
  const cardWidth = (width - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;

  const openItem = (id: Id) => router.push({ pathname: '/item/[id]', params: { id } });
  const editShelf = (shelfId: Id) => router.push({ pathname: '/shelf/edit', params: { id: shelfId } });

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'EverShelf',
          headerRight: () => (
            <View style={styles.headerButtons}>
              {shelf && (
                <Button title={t('home.editShelf')} variant="text" compact onPress={() => editShelf(shelf.id)} />
              )}
              <Button title={t('home.settings')} variant="text" compact onPress={() => router.push('/settings')} />
            </View>
          ),
        }}
      />

      <ShelfTabs
        shelves={state.shelves}
        selectedId={shelf?.id}
        onSelect={setSelectedId}
        onEditShelf={editShelf}
        onAddShelf={() => router.push('/shelf/edit')}
      />

      {!shelf ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t('home.noShelves')}</Text>
          <Button title={t('home.addShelf')} variant="primary" onPress={() => router.push('/shelf/edit')} />
        </View>
      ) : (
        <>
          <View style={styles.toolbar}>
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder={t('home.search', { shelf: shelf.name })}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              style={styles.search}
              accessibilityLabel={t('home.searchLabel')}
            />
            <Button
              title={`↕ ${t(`sortShort.${settings.sortOrder}`)}`}
              compact
              accessibilityLabel={t('home.sortLabel', { sort: t(`sort.${settings.sortOrder}`) })}
              onPress={() => setSortSheetOpen(true)}
              style={styles.toolbarButton}
            />
            <Button
              title={listView ? '▦' : '☰'}
              compact
              accessibilityLabel={listView ? t('home.showGrid') : t('home.showList')}
              onPress={() => setSetting('viewMode', listView ? 'grid' : 'list')}
              style={styles.toolbarButton}
            />
          </View>
          {searching && (
            <View style={styles.resultsRow}>
              <Text style={styles.resultsText}>{t('home.results', { count: items.length })}</Text>
              <Button title={t('common.clear')} variant="text" compact onPress={() => setQuery('')} />
            </View>
          )}

          <FlatList
            key={listView ? 'list' : columns}
            data={items}
            numColumns={columns}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 96 }]}
            columnWrapperStyle={columns > 1 ? styles.row : undefined}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {searching
                  ? t('home.noMatches', { shelf: shelf.name, query: query.trim() })
                  : t('home.empty', { shelf: shelf.name })}
              </Text>
            }
            ListHeaderComponent={
              searching ? undefined : (
                <ContinueReadingRow
                  books={continueReading}
                  onOpen={(item) => router.push({ pathname: '/read/[itemId]', params: { itemId: item.id } })}
                />
              )
            }
            renderItem={({ item }) =>
              listView ? (
                <ItemRow item={item} book={books.get(item.id)} onPress={() => openItem(item.id)} />
              ) : (
                <ItemCard item={item} width={cardWidth} book={books.get(item.id)} onPress={() => openItem(item.id)} />
              )
            }
          />
          <View style={[styles.fabRow, { bottom: insets.bottom + spacing.lg }]}>
            {/* Book files are stored on the device, which the web version can't do. */}
            {Platform.OS !== 'web' && (
              <Button
                title={t('home.importBook')}
                accessibilityLabel={t('home.importBookTo', { shelf: shelf.name })}
                style={styles.fab}
                onPress={() => router.push({ pathname: '/import', params: { shelfId: shelf.id } })}
              />
            )}
            <Button
              title={t('home.addItem')}
              variant="primary"
              accessibilityLabel={t('home.addItemTo', { shelf: shelf.name })}
              style={styles.fab}
              onPress={() => router.push({ pathname: '/item/edit', params: { shelfId: shelf.id } })}
            />
          </View>
        </>
      )}

      <OptionSheet
        visible={sortSheetOpen}
        title={t('home.sortTitle')}
        options={sortOptions}
        selected={settings.sortOrder}
        onSelect={(order) => setSetting('sortOrder', order)}
        onClose={() => setSortSheetOpen(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.background },
  headerButtons: { flexDirection: 'row', gap: spacing.xs },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  search: { flex: 1, minWidth: 0 },
  toolbarButton: { paddingVertical: spacing.sm },
  resultsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  resultsText: { fontSize: fontSize.small, color: c.textMuted },
  grid: { padding: spacing.lg, gap: spacing.lg },
  row: { gap: spacing.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  emptyText: { fontSize: fontSize.body, color: c.textMuted, textAlign: 'center', marginTop: spacing.xl },
  fabRow: { position: 'absolute', right: spacing.lg, flexDirection: 'row', gap: spacing.sm },
  fab: {
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
}));
