import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { useT } from '@/i18n/useT';
import { artistOf, durationLabel } from '@/models/queue';
import type { Id, Item, Track } from '@/models/types';
import { queueEntries, usePlayer } from '@/state/PlayerProvider';
import { loadTracks } from '@/storage/database';
import { fontSize, makeStyles, radius, raisedShadow, spacing } from '@/theme';

import { Button } from '../Button';
import { Cover } from '../Cover';
import { MisplacedMark } from '../MisplacedMark';
import { SelectionMark } from '../SelectionMark';
import type { ShelfLayoutProps } from './ItemGrid';

/**
 * A music shelf: a list of songs with Play all and Shuffle. Tapping a song
 * plays it, with the rest of the list (as searched and sorted) after it.
 * Entries without a song file open their details instead.
 */
export function MusicShelf({
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
  const db = useSQLiteContext();
  const player = usePlayer();
  const playingId = player.queue[player.current]?.itemId;

  // Reloaded when the shelf comes back into view, e.g. after an import.
  const [tracks, setTracks] = useState<Map<Id, Track>>(new Map());
  useFocusEffect(
    useCallback(() => {
      let current = true;
      loadTracks(db)
        .then((loaded) => current && setTracks(loaded))
        .catch((error: unknown) => console.warn('Could not load songs', error));
      return () => {
        current = false;
      };
    }, [db]),
  );

  const songs = useMemo(() => queueEntries(items, tracks), [items, tracks]);
  const selecting = selection !== null;

  const play = (item: Item) => {
    const start = songs.findIndex((s) => s.itemId === item.id);
    if (start === -1) openDetails(item);
    else player.playQueue(songs, start);
  };

  return (
    <FlatList
      data={items}
      extraData={[selection, playingId, tracks]}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={[styles.list, { paddingBottom: spacing.xl }]}
      ListHeaderComponent={
        <>
          {banner}
          {songs.length > 0 && !selecting && (
            <View style={styles.playRow}>
              <Button
                title={`▶ ${t('player.playAll')}`}
                variant="primary"
                style={styles.playButton}
                onPress={() => player.playQueue(songs, 0, { shuffle: false })}
              />
              <Button
                title={`🔀 ${t('player.shuffle')}`}
                style={styles.playButton}
                onPress={() => player.playQueue(songs, Math.floor(Math.random() * songs.length), { shuffle: true })}
              />
            </View>
          )}
        </>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>
          {query ? t('home.noMatches', { shelf: shelf.name, query }) : t('home.emptyMusic', { shelf: shelf.name })}
        </Text>
      }
      renderItem={({ item }) => {
        const track = tracks.get(item.id);
        const selected = selection ? selection.has(item.id) : undefined;
        const artist = artistOf(item);
        const playing = item.id === playingId;
        return (
          <Pressable
            accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
            accessibilityState={selected === undefined ? { selected: playing } : { checked: selected }}
            accessibilityLabel={artist ? `${item.title}, ${artist}` : item.title}
            onPress={() => (selecting ? onToggleSelected(item.id) : play(item))}
            onLongPress={() => (selecting ? onToggleSelected(item.id) : onStartSelection(item.id))}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.cover}>
              <Cover uri={item.coverUri} title={item.title} style={styles.square} />
              {misplacedIds.has(item.id) && <MisplacedMark />}
              {selected !== undefined && <SelectionMark selected={selected} />}
            </View>
            <View style={styles.text}>
              <Text style={[styles.title, playing && styles.playing]} numberOfLines={1}>
                {playing ? `♪ ${item.title}` : item.title}
              </Text>
              {artist !== '' && (
                <Text style={styles.meta} numberOfLines={1}>
                  {artist}
                </Text>
              )}
            </View>
            {track?.durationMs != null && <Text style={styles.meta}>{durationLabel(track.durationMs)}</Text>}
          </Pressable>
        );
      }}
    />
  );
}

const useStyles = makeStyles((c, look) => ({
  list: { padding: spacing.lg, gap: look.raised ? spacing.md : spacing.sm },
  playRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  playButton: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    ...(look.raised && { padding: spacing.sm, paddingRight: spacing.md, borderRadius: radius.lg, backgroundColor: c.card, ...raisedShadow(c, look) }),
  },
  pressed: { opacity: 0.7 },
  cover: { width: 52, borderRadius: radius.sm },
  square: { aspectRatio: 1 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: fontSize.body, color: c.text, fontWeight: '500' },
  playing: { color: c.primary, fontWeight: '700' },
  meta: { fontSize: fontSize.small, color: c.textMuted, fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: fontSize.body, color: c.textMuted, textAlign: 'center', marginTop: spacing.xl },
}));
