import { router, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n/useT';
import { usePlayer } from '@/state/PlayerProvider';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

import { Cover } from '../Cover';

/**
 * The song that's loaded, with play/pause and next, along the bottom of the
 * app. Tapping it opens the full player. Hidden in the readers and on the
 * player itself, and while the queue is empty.
 */
export function MiniPlayer() {
  const styles = useStyles();
  const t = useT();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { queue, current, status, togglePlay, next } = usePlayer();
  const entry = queue[current];
  if (!entry || pathname === '/play' || pathname.startsWith('/read')) return null;
  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.sm }]}>
      <View style={[styles.progress, { width: `${progress * 100}%` }]} />
      <Pressable
        style={({ pressed }) => [styles.song, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={t('player.open', { title: entry.title })}
        onPress={() => router.push('/play')}>
        <View style={styles.cover}>
          <Cover uri={entry.coverUri} title={entry.title} style={styles.square} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {entry.title}
          </Text>
          {entry.artist !== '' && (
            <Text style={styles.artist} numberOfLines={1}>
              {entry.artist}
            </Text>
          )}
        </View>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? t('player.pause') : t('player.play')}
        onPress={togglePlay}>
        <Text style={styles.controlText}>{status.playing ? '❚❚' : '▶'}</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
        hitSlop={8}
        disabled={current >= queue.length - 1 && status.loop !== 'all'}
        accessibilityRole="button"
        accessibilityLabel={t('player.next')}
        onPress={next}>
        <Text style={styles.controlText}>⏭</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.surface,
  },
  progress: { position: 'absolute', top: -1, left: 0, height: 2, backgroundColor: c.primary },
  song: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pressed: { opacity: 0.6 },
  cover: { width: 40, borderRadius: radius.sm, overflow: 'hidden' },
  square: { aspectRatio: 1 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: fontSize.body, color: c.text, fontWeight: '600' },
  artist: { fontSize: fontSize.small, color: c.textMuted },
  control: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  controlText: { fontSize: fontSize.heading, color: c.text },
}));
