import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { percentLabel } from '@/books/progress';
import { useT } from '@/i18n/useT';
import type { BookSummary } from '@/models/types';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

/** "42%" or "✓ Finished" on a book's cover. Shows nothing for unread books. */
export function ProgressBadge({ book, style }: { book: BookSummary | undefined; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const t = useT();
  if (!book || (!book.finished && book.lastReadAt === null)) return null;
  const label = book.finished ? t('book.finished') : percentLabel(book.percent);
  return (
    <View style={[styles.badge, book.finished && styles.finished, style]} accessibilityLabel={label}>
      <Text style={styles.text}>{book.finished ? `✓ ${label}` : label}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  badge: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: c.primary,
  },
  finished: { backgroundColor: c.textMuted },
  text: { fontSize: fontSize.small - 1, fontWeight: '700', color: c.onPrimary },
}));
