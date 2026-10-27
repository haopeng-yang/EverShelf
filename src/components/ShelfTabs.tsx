import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import type { Id, Shelf } from '@/models/types';
import { colors, fontSize, radius, spacing } from '@/theme';

interface ShelfTabsProps {
  shelves: Shelf[];
  selectedId: Id | undefined;
  onSelect: (shelfId: Id) => void;
  /** Long-pressing a tab opens that shelf's settings. */
  onEditShelf: (shelfId: Id) => void;
  onAddShelf: () => void;
}

/** The row of shelf tabs across the top, scrolling sideways when there are many. */
export function ShelfTabs({ shelves, selectedId, onSelect, onEditShelf, onAddShelf }: ShelfTabsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={styles.content}>
      {shelves.map((shelf) => {
        const selected = shelf.id === selectedId;
        return (
          <Pressable
            key={shelf.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityHint="Long press to edit this shelf"
            onPress={() => onSelect(shelf.id)}
            onLongPress={() => onEditShelf(shelf.id)}
            style={({ pressed }) => [styles.tab, selected && styles.tabSelected, pressed && styles.pressed]}>
            <Text style={[styles.label, selected && styles.labelSelected]}>{shelf.name}</Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add shelf"
        onPress={onAddShelf}
        style={({ pressed }) => [styles.tab, styles.addTab, pressed && styles.pressed]}>
        <Text style={styles.addLabel}>+ Add</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  content: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  tabSelected: { backgroundColor: colors.tabSelected },
  addTab: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  pressed: { opacity: 0.6 },
  label: { fontSize: fontSize.body, color: colors.text },
  labelSelected: { color: colors.primary, fontWeight: '600' },
  addLabel: { fontSize: fontSize.body, color: colors.textMuted },
});
