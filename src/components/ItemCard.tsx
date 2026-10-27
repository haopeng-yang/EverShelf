import { Pressable, Text } from 'react-native';

import type { Item } from '@/models/types';
import { fontSize, makeStyles, spacing } from '@/theme';

import { Cover } from './Cover';

interface ItemCardProps {
  item: Item;
  width: number;
  onPress: () => void;
}

/** One item in the shelf grid: cover with the title underneath. */
export function ItemCard({ item, width, onPress }: ItemCardProps) {
  const styles = useStyles();
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

const useStyles = makeStyles((c) => ({
  pressed: { opacity: 0.7 },
  title: { marginTop: spacing.xs, fontSize: fontSize.small, color: c.text, fontWeight: '500' },
}));
