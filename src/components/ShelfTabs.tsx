import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { useT } from '@/i18n/useT';
import type { Id, Shelf } from '@/models/types';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

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
  const styles = useStyles();
  const t = useT();
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
            accessibilityHint={t('tabs.longPressHint')}
            onPress={() => onSelect(shelf.id)}
            onLongPress={() => onEditShelf(shelf.id)}
            style={({ pressed }) => [styles.tab, selected && styles.tabSelected, pressed && styles.pressed]}>
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {shelf.name}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tabs.addShelf')}
        onPress={onAddShelf}
        style={({ pressed }) => [styles.tab, styles.addTab, pressed && styles.pressed]}>
        <Text style={styles.addLabel}>{t('tabs.add')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  // A ScrollView may shrink by default, so a long item list below squeezed this
  // row and clipped the tabs. flexShrink: 0 keeps it at its full height.
  bar: { flexGrow: 0, flexShrink: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  content: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: c.surface,
  },
  tabSelected: { backgroundColor: c.tabSelected },
  addTab: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.border, borderStyle: 'dashed' },
  pressed: { opacity: 0.6 },
  label: { fontSize: fontSize.body, color: c.text },
  labelSelected: { color: c.primary, fontWeight: '600' },
  addLabel: { fontSize: fontSize.body, color: c.textMuted },
}));
