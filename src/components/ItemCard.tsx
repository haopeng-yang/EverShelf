import { Pressable, StyleSheet, Text } from 'react-native';

import type { Item } from '@/models/types';
import { colors, fontSize, spacing } from '@/theme';

import { Cover } from './Cover';

interface ItemCardProps {
  item: Item;
  width: number;
  onPress: () => void;
}

/** One item in the shelf grid: cover with the title underneath. */
export function ItemCard({ item, width, onPress }: ItemCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      onPress={onPress}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}>
      <Cover uri={item.coverUri} title={item.title} />
      <Text style={styles.title} numberOfLines={2}>
        {item.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  title: { marginTop: spacing.xs, fontSize: fontSize.small, color: colors.text, fontWeight: '500' },
});
