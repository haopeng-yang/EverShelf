import { Stack, router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ItemCard } from '@/components/ItemCard';
import { ItemRow } from '@/components/ItemRow';
import { OptionSheet } from '@/components/OptionSheet';
import { ShelfTabs } from '@/components/ShelfTabs';
import { TextField } from '@/components/TextField';
import { SORT_LABELS, SORT_ORDERS, SORT_SHORT_LABELS, filterItems, sortItems } from '@/models/query';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import type { Id } from '@/models/types';
import { useSettings } from '@/state/SettingsProvider';
import { useShelfState } from '@/state/ShelfProvider';
import { fontSize, makeStyles, spacing } from '@/theme';

const MIN_CARD_WIDTH = 140;
const SORT_OPTIONS = SORT_ORDERS.map((value) => ({ value, label: SORT_LABELS[value] }));

export default function ShelvesScreen() {
  const state = useShelfState();
  const { settings, setSetting } = useSettings();
  const styles = useStyles();
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
  const items = useMemo(
    () => (shelf ? sortItems(filterItems(selectItemsOnShelf(state, shelf.id), query), settings.sortOrder) : []),
    [state, shelf, query, settings.sortOrder],
  );
  const searching = query.trim() !== '';

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
              {shelf && <Button title="Edit shelf" variant="text" compact onPress={() => editShelf(shelf.id)} />}
              <Button title="Settings" variant="text" compact onPress={() => router.push('/settings')} />
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
          <Text style={styles.emptyText}>You have no shelves yet.</Text>
          <Button title="Add a shelf" variant="primary" onPress={() => router.push('/shelf/edit')} />
        </View>
      ) : (
        <>
          <View style={styles.toolbar}>
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder={`Search ${shelf.name}`}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              style={styles.search}
              accessibilityLabel="Search"
            />
            <Button
              title={`↕ ${SORT_SHORT_LABELS[settings.sortOrder]}`}
              compact
              accessibilityLabel={`Sort: ${SORT_LABELS[settings.sortOrder]}`}
              onPress={() => setSortSheetOpen(true)}
              style={styles.toolbarButton}
            />
            <Button
              title={listView ? '▦' : '☰'}
              compact
              accessibilityLabel={listView ? 'Show as grid' : 'Show as list'}
              onPress={() => setSetting('viewMode', listView ? 'grid' : 'list')}
              style={styles.toolbarButton}
            />
          </View>
          {searching && (
            <View style={styles.resultsRow}>
              <Text style={styles.resultsText}>
                {items.length} {items.length === 1 ? 'result' : 'results'}
              </Text>
              <Button title="Clear" variant="text" compact onPress={() => setQuery('')} />
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
                  ? `Nothing on ${shelf.name} matches “${query.trim()}”.`
                  : `Nothing on ${shelf.name} yet. Tap “Add item” to start.`}
              </Text>
            }
            renderItem={({ item }) =>
              listView ? (
                <ItemRow item={item} onPress={() => openItem(item.id)} />
              ) : (
                <ItemCard item={item} width={cardWidth} onPress={() => openItem(item.id)} />
              )
            }
          />
          <Button
            title="+ Add item"
            variant="primary"
            accessibilityLabel={`Add item to ${shelf.name}`}
            style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
            onPress={() => router.push({ pathname: '/item/edit', params: { shelfId: shelf.id } })}
          />
        </>
      )}

      <OptionSheet
        visible={sortSheetOpen}
        title="Sort items by"
        options={SORT_OPTIONS}
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
  fab: {
    position: 'absolute',
    right: spacing.lg,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
}));
