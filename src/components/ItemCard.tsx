import { Pressable, Text, View } from 'react-native';

import type { BookSummary, Item } from '@/models/types';
import { fontSize, makeStyles, spacing } from '@/theme';

import { Cover } from './Cover';
import { ProgressBadge } from './ProgressBadge';
import { SelectionMark } from './SelectionMark';

interface ItemCardProps {
  item: Item;
  width: number;
  /** Reading progress, if the item is an imported book. */
  book?: BookSummary;
  /** Set while the shelf is in selection mode: whether this item is picked. */
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

/** One item in the shelf grid: cover with the title underneath. */
export function ItemCard({ item, width, book, selected, onPress, onLongPress }: ItemCardProps) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      accessibilityLabel={item.title}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}>
      <View>
        <Cover uri={item.coverUri} title={item.title} />
        <ProgressBadge book={book} />
        {selected !== undefined && <SelectionMark selected={selected} />}
      </View>
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
