import type { ReactElement } from 'react';
import { FlatList, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BookSummary, Id, Item, Shelf } from '@/models/types';
import { useSettings } from '@/state/SettingsProvider';
import { fontSize, makeStyles, spacing } from '@/theme';

import { ItemCard } from '../ItemCard';
import { ItemRow } from '../ItemRow';

const MIN_CARD_WIDTH = 140;

/** What the shelf screen hands every layout. The layout decides the header and what tapping an item does. */
export interface ShelfLayoutProps {
  shelf: Shelf;
  /** The shelf's items after search and sorting. */
  items: Item[];
  books: ReadonlyMap<Id, BookSummary>;
  /** The search text; '' when not searching. */
  query: string;
  /** Picked items while the shelf is in selection mode, or null. */
  selection: Set<Id> | null;
  misplacedIds: Set<Id>;
  /** Shown above every layout's own header, e.g. the "doesn't fit" banner. Null for none. */
  banner: ReactElement | null;
  onStartSelection: (id: Id) => void;
  onToggleSelected: (id: Id) => void;
  openDetails: (item: Item) => void;
}

interface ItemGridProps extends Omit<ShelfLayoutProps, 'shelf' | 'query' | 'banner' | 'openDetails'> {
  header?: ReactElement;
  emptyText: string;
  /** What a tap does outside selection mode. */
  onOpen: (item: Item) => void;
}

/**
 * A shelf's items as a grid of covers or a list, following the view setting.
 * Long press starts selection mode; while selecting, taps pick and unpick.
 */
export function ItemGrid({
  items,
  books,
  selection,
  misplacedIds,
  header,
  emptyText,
  onOpen,
  onStartSelection,
  onToggleSelected,
}: ItemGridProps) {
  const styles = useStyles();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const listView = settings.viewMode === 'list';
  const columns = listView ? 1 : Math.max(2, Math.floor((width - spacing.lg * 2) / MIN_CARD_WIDTH));
  const cardWidth = (width - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;
  const selecting = selection !== null;

  return (
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
      ListEmptyComponent={<Text style={styles.emptyText}>{emptyText}</Text>}
      ListHeaderComponent={header}
      renderItem={({ item }) => {
        const props = {
          item,
          book: books.get(item.id),
          selected: selection ? selection.has(item.id) : undefined,
          misplaced: misplacedIds.has(item.id),
          onPress: () => (selecting ? onToggleSelected(item.id) : onOpen(item)),
          onLongPress: () => (selecting ? onToggleSelected(item.id) : onStartSelection(item.id)),
        };
        return listView ? <ItemRow {...props} /> : <ItemCard {...props} width={cardWidth} />;
      }}
    />
  );
}

const useStyles = makeStyles((c) => ({
  grid: { padding: spacing.lg, gap: spacing.lg },
  row: { gap: spacing.md },
  emptyText: { fontSize: fontSize.body, color: c.textMuted, textAlign: 'center', marginTop: spacing.xl },
}));
