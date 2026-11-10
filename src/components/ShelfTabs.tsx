import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { useT } from '@/i18n/useT';
import type { Id, Shelf } from '@/models/types';
import { fontSize, makeStyles, radius, raisedShadow, spacing } from '@/theme';

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
              {shelf.lock ? `🔒 ${shelf.name}` : shelf.name}
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

const useStyles = makeStyles((c, look) => ({
  // A ScrollView may shrink by default, so a long item list below squeezed this
  // row and clipped the tabs. flexShrink: 0 keeps it at its full height.
  bar: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: look.raised ? 0 : StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  // Room below the tabs for their shadows.
  content: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, paddingBottom: look.raised ? spacing.lg : spacing.md },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: look.pills ? radius.pill : radius.lg,
    backgroundColor: c.surface,
  },
  tabSelected: { backgroundColor: c.tabSelected, ...raisedShadow(c, look) },
  addTab: { backgroundColor: 'transparent', borderWidth: 1, borderColor: look.raised ? c.primary : c.border, borderStyle: 'dashed' },
  pressed: { opacity: 0.6 },
  label: { fontSize: fontSize.body, color: look.raised ? c.textMuted : c.text },
  labelSelected: { color: c.onTabSelected, fontWeight: '600' },
  addLabel: { fontSize: fontSize.body, color: look.raised ? c.primary : c.textMuted },
}));
