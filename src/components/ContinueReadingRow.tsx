import { Pressable, ScrollView, Text, View } from 'react-native';

import { useT } from '@/i18n/useT';
import type { BookSummary, Item } from '@/models/types';
import { fontSize, makeStyles, spacing } from '@/theme';

import { Cover } from './Cover';
import { ProgressBadge } from './ProgressBadge';

const CARD_WIDTH = 96;

interface ContinueReadingRowProps {
  books: { item: Item; book: BookSummary }[];
  onOpen: (item: Item) => void;
}

/** Books started but not finished, most recently read first; tapping one opens the reader. */
export function ContinueReadingRow({ books, onOpen }: ContinueReadingRowProps) {
  const styles = useStyles();
  const t = useT();
  if (books.length === 0) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t('home.continueReading')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {books.map(({ item, book }) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={t('home.continueBook', { title: item.title })}
            onPress={() => onOpen(item)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
            <View>
              <Cover uri={item.coverUri} title={item.title} />
              <ProgressBadge book={book} />
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { gap: spacing.sm },
  heading: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  row: { gap: spacing.md },
  card: { width: CARD_WIDTH },
  pressed: { opacity: 0.7 },
  title: { marginTop: spacing.xs, fontSize: fontSize.small, color: c.text },
}));
