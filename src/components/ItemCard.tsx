import { Pressable, Text, View } from 'react-native';

import type { BookSummary, Item } from '@/models/types';
import { fontSize, makeStyles, radius, raisedShadow, spacing } from '@/theme';

import { Cover } from './Cover';
import { MisplacedMark } from './MisplacedMark';
import { ProgressBadge } from './ProgressBadge';
import { SelectionMark } from './SelectionMark';

interface ItemCardProps {
  item: Item;
  width: number;
  /** Reading progress, if the item is an imported book. */
  book?: BookSummary;
  /** Set while the shelf is in selection mode: whether this item is picked. */
  selected?: boolean;
  /** True if the item doesn't fit on its shelf's kind. */
  misplaced?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

/** One item in the shelf grid: cover with the title underneath. */
export function ItemCard({ item, width, book, selected, misplaced, onPress, onLongPress }: ItemCardProps) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      accessibilityLabel={item.title}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}>
      <View>
        <Cover uri={item.coverUri} title={item.title} />
        <ProgressBadge book={book} />
        {misplaced && <MisplacedMark />}
        {selected !== undefined && <SelectionMark selected={selected} />}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {item.title}
      </Text>
    </Pressable>
  );
}

// The raised look puts the cover and title on a white card; `width` still covers the whole card.
const useStyles = makeStyles((c, look) => ({
  card: look.raised ? { padding: spacing.xs, borderRadius: radius.md, backgroundColor: c.card, ...raisedShadow(c, look) } : {},
  pressed: { opacity: 0.7 },
  title: {
    marginTop: spacing.xs,
    marginHorizontal: look.raised ? spacing.xs : 0,
    marginBottom: look.raised ? spacing.xs : 0,
    fontSize: fontSize.small,
    color: c.text,
    fontWeight: look.raised ? '600' : '500',
  },
}));
