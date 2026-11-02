import { Text, View } from 'react-native';

import { useT } from '@/i18n/useT';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

import { ItemGrid, type ShelfLayoutProps } from './ItemGrid';

/**
 * A music shelf. Songs can't be imported yet (roadmap Phase 4), so for now it
 * says so and works like a collection; the song list and player replace this
 * in Phase 5.
 */
export function MusicShelf({ shelf, query, banner, openDetails, ...grid }: ShelfLayoutProps) {
  const t = useT();
  const styles = useStyles();
  return (
    <ItemGrid
      {...grid}
      header={
        <>
          {banner}
          {!query && (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{t('home.musicSoon')}</Text>
            </View>
          )}
        </>
      }
      emptyText={query ? t('home.noMatches', { shelf: shelf.name, query }) : t('home.empty', { shelf: shelf.name })}
      onOpen={openDetails}
    />
  );
}

const useStyles = makeStyles((c) => ({
  notice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surface },
  noticeText: { fontSize: fontSize.small, color: c.textMuted },
}));
