import { Text, View } from 'react-native';

import { useT } from '@/i18n/useT';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

import { ItemGrid, type ShelfLayoutProps } from './ItemGrid';

/**
 * A music shelf. Songs can be imported but not played yet, so for now it says
 * so and tapping a song opens its details; the song list and player replace
 * this in roadmap Phase 5.
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
      emptyText={query ? t('home.noMatches', { shelf: shelf.name, query }) : t('home.emptyMusic', { shelf: shelf.name })}
      onOpen={openDetails}
    />
  );
}

const useStyles = makeStyles((c) => ({
  notice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surface },
  noticeText: { fontSize: fontSize.small, color: c.textMuted },
}));
