import { Pressable, Text, View } from 'react-native';

import { useT } from '@/i18n/useT';
import type { BookSummary, Item } from '@/models/types';
import { fontSize, makeStyles, spacing } from '@/theme';

import { Cover } from './Cover';
import { ProgressBadge } from './ProgressBadge';
import { SelectionMark } from './SelectionMark';

/** How many filled-in tags to show under the title. */
const SUMMARY_TAGS = 2;

interface ItemRowProps {
  item: Item;
  /** Reading progress, if the item is an imported book. */
  book?: BookSummary;
  /** Set while the shelf is in selection mode: whether this item is picked. */
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

/** One item in list view: small cover on the left, title and the first few filled-in tags on the right. */
export function ItemRow({ item, book, selected, onPress, onLongPress }: ItemRowProps) {
  const styles = useStyles();
  const t = useT();
  const summary = item.tags.filter((tag) => tag.value.trim()).slice(0, SUMMARY_TAGS);
  return (
    <Pressable
      accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      accessibilityLabel={item.title}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.cover}>
        <Cover uri={item.coverUri} title={item.title} />
        <ProgressBadge book={book} />
        {selected !== undefined && <SelectionMark selected={selected} />}
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        {summary.length === 0 ? (
          <Text style={styles.detail}>{t('row.noDetails')}</Text>
        ) : (
          summary.map((tag) => (
            <Text key={tag.id} style={styles.detail} numberOfLines={1}>
              {tag.name}: {tag.value}
            </Text>
          ))
        )}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  pressed: { opacity: 0.7 },
  cover: { width: 64 },
  text: { flex: 1, gap: spacing.xs },
  title: { fontSize: fontSize.body + 1, color: c.text, fontWeight: '600' },
  detail: { fontSize: fontSize.small + 1, color: c.textMuted },
}));
