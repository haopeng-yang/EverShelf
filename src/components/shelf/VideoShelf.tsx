import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n/useT';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import type { Id, Item, VideoSummary } from '@/models/types';
import { continueWatching } from '@/models/videos';
import { useSettings } from '@/state/SettingsProvider';
import { useShelfState } from '@/state/ShelfProvider';
import { loadVideoSummaries } from '@/storage/database';
import { fontSize, makeStyles, spacing } from '@/theme';

import { VideoCard, VideoThumb } from '../video/VideoCard';
import type { ShelfLayoutProps } from './ItemGrid';

const MIN_CARD_WIDTH = 220;
const CONTINUE_WATCHING_MAX = 10;
const CONTINUE_CARD_WIDTH = 200;

/**
 * A video shelf: wide frames with each video's length and progress, and
 * "Continue watching" on top. Tapping a video plays it; entries without a
 * file open their details instead.
 */
export function VideoShelf({
  shelf,
  items,
  query,
  selection,
  misplacedIds,
  banner,
  onStartSelection,
  onToggleSelected,
  openDetails,
}: ShelfLayoutProps) {
  const t = useT();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { settings } = useSettings();
  const state = useShelfState();
  const db = useSQLiteContext();

  // Reloaded when the shelf comes back into view, e.g. after watching or importing.
  const [videos, setVideos] = useState<Map<Id, VideoSummary>>(new Map());
  useFocusEffect(
    useCallback(() => {
      let current = true;
      loadVideoSummaries(db)
        .then((loaded) => current && setVideos(loaded))
        .catch((error: unknown) => console.warn('Could not load videos', error));
      return () => {
        current = false;
      };
    }, [db]),
  );

  const resume = useMemo(
    () => continueWatching(selectItemsOnShelf(state, shelf.id), videos, CONTINUE_WATCHING_MAX),
    [state, shelf.id, videos],
  );

  const listView = settings.viewMode === 'list';
  const columns = listView ? 1 : Math.max(1, Math.floor((width - spacing.lg * 2) / MIN_CARD_WIDTH));
  const cardWidth = (width - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;
  const selecting = selection !== null;

  const watch = (item: Item) => router.push({ pathname: '/item/[id]', params: { id: item.id } });
  const open = (item: Item) => (videos.has(item.id) ? watch(item) : openDetails(item));

  return (
    <FlatList
      key={listView ? 'list' : columns}
      data={items}
      extraData={[selection, videos]}
      numColumns={columns}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 96 }]}
      columnWrapperStyle={columns > 1 ? styles.row : undefined}
      ListHeaderComponent={
        <>
          {banner}
          {!query && !selecting && settings.showContinueReading && resume.length > 0 && (
            <View style={styles.continue}>
              <Text style={styles.heading}>{t('home.continueWatching')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.continueRow}>
                {resume.map(({ item, video }) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.continueVideo', { title: item.title })}
                    onPress={() => watch(item)}
                    style={({ pressed }) => [styles.continueCard, pressed && styles.pressed]}>
                    <VideoThumb item={item} video={video} />
                    <Text style={styles.continueTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>
          {query ? t('home.noMatches', { shelf: shelf.name, query }) : t('home.emptyVideo', { shelf: shelf.name })}
        </Text>
      }
      renderItem={({ item }) => (
        <VideoCard
          item={item}
          video={videos.get(item.id)}
          width={cardWidth}
          row={listView}
          selected={selection ? selection.has(item.id) : undefined}
          misplaced={misplacedIds.has(item.id)}
          onPress={() => (selecting ? onToggleSelected(item.id) : open(item))}
          onLongPress={() => (selecting ? onToggleSelected(item.id) : onStartSelection(item.id))}
        />
      )}
    />
  );
}

const useStyles = makeStyles((c) => ({
  grid: { padding: spacing.lg, gap: spacing.lg },
  row: { gap: spacing.md },
  continue: { gap: spacing.sm },
  heading: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  continueRow: { gap: spacing.md },
  continueCard: { width: CONTINUE_CARD_WIDTH },
  continueTitle: { marginTop: spacing.xs, fontSize: fontSize.small, color: c.text },
  pressed: { opacity: 0.7 },
  emptyText: { fontSize: fontSize.body, color: c.textMuted, textAlign: 'center', marginTop: spacing.xl },
}));
