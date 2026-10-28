import { Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, FlatList, Platform, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ContinueReadingRow } from '@/components/ContinueReadingRow';
import { ItemCard } from '@/components/ItemCard';
import { ItemRow } from '@/components/ItemRow';
import { LockedShelf } from '@/components/LockedShelf';
import { OptionSheet } from '@/components/OptionSheet';
import { ShelfTabs } from '@/components/ShelfTabs';
import { TextField } from '@/components/TextField';
import { confirm } from '@/components/dialogs';
import { useT } from '@/i18n/useT';
import { SORT_ORDERS, filterItems, sortItems } from '@/models/query';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import type { BookSummary, Id } from '@/models/types';
import { useSettings } from '@/state/SettingsProvider';
import { useShelfLocks } from '@/state/ShelfLockProvider';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { loadBookSummaries } from '@/storage/database';
import { deleteItemFiles } from '@/storage/shelfFiles';
import { fontSize, makeStyles, spacing } from '@/theme';

const MIN_CARD_WIDTH = 140;
const CONTINUE_READING_MAX = 10;

export default function ShelvesScreen() {
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const { settings, setSetting } = useSettings();
  const styles = useStyles();
  const t = useT();
  const sortOptions = SORT_ORDERS.map((value) => ({ value, label: t(`sort.${value}`) }));
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<Id | undefined>(state.shelves[0]?.id);
  const [query, setQuery] = useState('');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [moveSheetOpen, setMoveSheetOpen] = useState(false);
  // Ids picked by long pressing, and the shelf they were picked on. Null when not selecting.
  const [picked, setPicked] = useState<{ shelfId: Id; ids: Set<Id> } | null>(null);

  // When a shelf is added (always at the end), switch to it.
  const shelfCount = useRef(state.shelves.length);
  useEffect(() => {
    if (state.shelves.length > shelfCount.current) setSelectedId(state.shelves.at(-1)?.id);
    shelfCount.current = state.shelves.length;
  }, [state.shelves]);

  // Falls back to the first shelf if the selected one was deleted.
  const shelf = state.shelves.find((s) => s.id === selectedId) ?? state.shelves[0];
  const { isLocked, lock } = useShelfLocks();
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
  // The selection bar splits the width evenly between its three buttons, whatever their labels.
  const selectionButtonStyle = [styles.selectionButton, { width: (width - spacing.lg * 2 - spacing.sm * 2) / 3 }];

  const openItem = (id: Id) => router.push({ pathname: '/item/[id]', params: { id } });
  const editShelf = (shelfId: Id) => router.push({ pathname: '/shelf/edit', params: { id: shelfId } });

  // Switching to another shelf or locking this one ends selection mode.
  const shelfId = shelf?.id;
  const selection = shelf && picked?.shelfId === shelf.id && !isLocked(shelf) ? picked.ids : null;
  const selecting = selection !== null;
  const clearSelection = () => setPicked(null);
  // Only items still on this shelf, so a deleted or moved item never lingers in the selection.
  const selectedItems = useMemo(
    () => (shelfId && selection ? selectItemsOnShelf(state, shelfId).filter((i) => selection.has(i.id)) : []),
    [state, shelfId, selection],
  );

  // Android's back button leaves selection mode instead of the screen.
  useEffect(() => {
    if (!selecting) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setPicked(null);
      return true;
    });
    return () => subscription.remove();
  }, [selecting]);

  const startSelection = (id: Id) => {
    if (shelfId) setPicked({ shelfId, ids: new Set([id]) });
  };
  const toggleSelected = (id: Id) =>
    setPicked((current) => {
      if (!current) return current;
      const ids = new Set(current.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      // Unpicking the last item leaves selection mode.
      return ids.size === 0 ? null : { ...current, ids };
    });

  const pressItem = (id: Id) => (selecting ? toggleSelected(id) : openItem(id));

  async function deleteSelected() {
    const picked = selectedItems;
    if (picked.length === 0) return;
    const ok = await confirm(
      t('select.deleteConfirm', { count: picked.length, title: picked[0].title }),
      t('common.cannotUndo'),
      t('common.delete'),
      t('common.cancel'),
    );
    if (!ok) return;
    for (const item of picked) void dispatch({ type: 'item/remove', itemId: item.id });
    deleteItemFiles(picked);
    clearSelection();
  }

  function moveSelected(toShelfId: Id) {
    if (toShelfId === shelfId) return;
    for (const item of selectedItems) void dispatch({ type: 'item/move', itemId: item.id, shelfId: toShelfId });
    clearSelection();
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: selecting ? t('select.count', { count: selectedItems.length }) : 'EverShelf',
          headerRight: () =>
            selecting ? null : (
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
      ) : isLocked(shelf) ? (
        <LockedShelf shelf={shelf} />
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
            {shelf.lock && (
              <Button
                title="🔒"
                compact
                accessibilityLabel={t('home.lockNow', { shelf: shelf.name })}
                onPress={() => {
                  setQuery('');
                  lock(shelf.id);
                }}
                style={styles.toolbarButton}
              />
            )}
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
            extraData={selection}
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
              searching || !settings.showContinueReading ? undefined : (
                <ContinueReadingRow
                  books={continueReading}
                  onOpen={(item) => router.push({ pathname: '/read/[itemId]', params: { itemId: item.id } })}
                />
              )
            }
            renderItem={({ item }) => {
              const props = {
                item,
                book: books.get(item.id),
                selected: selection ? selection.has(item.id) : undefined,
                onPress: () => pressItem(item.id),
                onLongPress: () => (selecting ? toggleSelected(item.id) : startSelection(item.id)),
              };
              return listView ? <ItemRow {...props} /> : <ItemCard {...props} width={cardWidth} />;
            }}
          />
          {selecting ? (
            <View style={[styles.selectionBar, { paddingBottom: insets.bottom + spacing.md }]}>
              <Button
                title={t('common.delete')}
                variant="danger"
                style={selectionButtonStyle}
                onPress={() => void deleteSelected()}
              />
              <Button
                title={t('select.move')}
                variant="primary"
                disabled={state.shelves.length < 2}
                style={selectionButtonStyle}
                onPress={() => setMoveSheetOpen(true)}
              />
              <Button title={t('common.cancel')} style={selectionButtonStyle} onPress={clearSelection} />
            </View>
          ) : (
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
          )}
        </>
      )}

      {shelf && (
        <OptionSheet
          visible={moveSheetOpen}
          title={t('select.moveTitle', { count: selectedItems.length })}
          options={state.shelves.map((s) => ({ value: s.id, label: s.lock ? `🔒 ${s.name}` : s.name }))}
          selected={shelf.id}
          onSelect={moveSelected}
          onClose={() => setMoveSheetOpen(false)}
        />
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
  selectionBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.background,
  },
  selectionButton: { paddingHorizontal: spacing.xs },
  fab: {
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
}));
