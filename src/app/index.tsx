import { Stack, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ItemCard } from '@/components/ItemCard';
import { ShelfTabs } from '@/components/ShelfTabs';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import type { Id } from '@/models/types';
import { useShelfState } from '@/state/ShelfProvider';
import { colors, fontSize, spacing } from '@/theme';

const MIN_CARD_WIDTH = 140;

export default function ShelvesScreen() {
  const state = useShelfState();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<Id | undefined>(state.shelves[0]?.id);

  // When a shelf is added (always at the end), switch to it.
  const shelfCount = useRef(state.shelves.length);
  useEffect(() => {
    if (state.shelves.length > shelfCount.current) setSelectedId(state.shelves.at(-1)?.id);
    shelfCount.current = state.shelves.length;
  }, [state.shelves]);

  // Falls back to the first shelf if the selected one was deleted.
  const shelf = state.shelves.find((s) => s.id === selectedId) ?? state.shelves[0];
  const items = shelf ? selectItemsOnShelf(state, shelf.id).reverse() : [];

  const columns = Math.max(2, Math.floor((width - spacing.lg * 2) / MIN_CARD_WIDTH));
  const cardWidth = (width - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;

  const editShelf = (shelfId: Id) => router.push({ pathname: '/shelf/edit', params: { id: shelfId } });

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'EverShelf',
          headerRight: shelf
            ? () => <Button title="Edit shelf" variant="text" compact onPress={() => editShelf(shelf.id)} />
            : undefined,
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
          <FlatList
            key={columns}
            data={items}
            numColumns={columns}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 96 }]}
            columnWrapperStyle={columns > 1 ? styles.row : undefined}
            ListEmptyComponent={
              <Text style={styles.emptyText}>Nothing on {shelf.name} yet. Tap “Add item” to start.</Text>
            }
            renderItem={({ item }) => (
              <ItemCard
                item={item}
                width={cardWidth}
                onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
              />
            )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  grid: { padding: spacing.lg, gap: spacing.lg },
  row: { gap: spacing.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  emptyText: { fontSize: fontSize.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
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
});
