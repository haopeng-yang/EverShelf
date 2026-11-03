import { Stack, router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Cover } from '@/components/Cover';
import { SeekBar } from '@/components/music/SeekBar';
import { useT } from '@/i18n/useT';
import { REPEAT_MODES, durationLabel } from '@/models/queue';
import { usePlayer } from '@/state/PlayerProvider';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

/** The full player: cover, seek bar, controls, then the queue. */
export default function PlayerScreen() {
  const styles = useStyles();
  const t = useT();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { queue, current, status, shuffle, repeat } = player;
  const entry = queue[current];

  if (!entry) {
    return (
      <View style={styles.empty}>
        <Stack.Screen options={{ title: t('player.title') }} />
        <Text style={styles.emptyText}>{t('player.nothing')}</Text>
        <Button title={t('common.close')} onPress={() => router.back()} />
      </View>
    );
  }

  const nextRepeat = REPEAT_MODES[(REPEAT_MODES.indexOf(repeat) + 1) % REPEAT_MODES.length];

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
      <Stack.Screen options={{ title: t('player.title') }} />
      <View style={styles.cover}>
        <Cover uri={entry.coverUri} title={entry.title} style={styles.square} />
      </View>
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={2}>
          {entry.title}
        </Text>
        {entry.artist !== '' && <Text style={styles.artist}>{entry.artist}</Text>}
      </View>

      <SeekBar
        value={status.currentTime}
        duration={status.duration > 0 ? status.duration : (entry.durationMs ?? 0) / 1000}
        onSeek={player.seekTo}
      />

      <View style={styles.controls}>
        <Control
          label={shuffle ? t('player.shuffleOn') : t('player.shuffleOff')}
          symbol="🔀"
          active={shuffle}
          onPress={() => player.setShuffle(!shuffle)}
        />
        <Control label={t('player.previous')} symbol="⏮" onPress={player.previous} />
        <Control
          label={status.playing ? t('player.pause') : t('player.play')}
          symbol={status.playing ? '❚❚' : '▶'}
          big
          onPress={player.togglePlay}
        />
        <Control label={t('player.next')} symbol="⏭" onPress={player.next} />
        <Control
          label={t(`player.repeat.${repeat}`)}
          symbol={repeat === 'one' ? '🔂' : '🔁'}
          active={repeat !== 'off'}
          onPress={() => player.setRepeat(nextRepeat)}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('player.queue', { count: queue.length })}</Text>
        <View style={styles.queue}>
          {queue.map((song, index) => {
            const playing = index === current;
            return (
              <View key={`${song.itemId}-${index}`} style={styles.queueRow}>
                <Pressable
                  style={({ pressed }) => [styles.queueSong, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={t('player.playThis', { title: song.title })}
                  accessibilityState={{ selected: playing }}
                  onPress={() => player.skipTo(index)}>
                  <Text style={[styles.queueTitle, playing && styles.playing]} numberOfLines={1}>
                    {playing ? `♪ ${song.title}` : song.title}
                  </Text>
                  <Text style={styles.queueMeta} numberOfLines={1}>
                    {[song.artist, song.durationMs !== null ? durationLabel(song.durationMs) : ''].filter(Boolean).join(' · ')}
                  </Text>
                </Pressable>
                {!playing && (
                  <>
                    <SmallButton label={t('player.moveUp', { title: song.title })} symbol="↑" disabled={index === 0} onPress={() => player.move(index, index - 1)} />
                    <SmallButton
                      label={t('player.moveDown', { title: song.title })}
                      symbol="↓"
                      disabled={index === queue.length - 1}
                      onPress={() => player.move(index, index + 1)}
                    />
                    <SmallButton label={t('player.remove', { title: song.title })} symbol="✕" onPress={() => player.removeAt(index)} />
                  </>
                )}
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

function Control(props: { label: string; symbol: string; onPress: () => void; active?: boolean; big?: boolean; disabled?: boolean }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled, selected: props.active }}
      disabled={props.disabled}
      hitSlop={6}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.control,
        props.big && styles.controlBig,
        props.active && styles.controlActive,
        pressed && styles.pressed,
        props.disabled && styles.disabled,
      ]}>
      <Text style={[styles.controlText, props.big && styles.controlTextBig]}>{props.symbol}</Text>
    </Pressable>
  );
}

function SmallButton(props: { label: string; symbol: string; onPress: () => void; disabled?: boolean }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      hitSlop={4}
      onPress={props.onPress}
      style={({ pressed }) => [styles.small, pressed && styles.pressed, props.disabled && styles.disabled]}>
      <Text style={styles.smallText}>{props.symbol}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  content: { padding: spacing.lg, gap: spacing.lg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, backgroundColor: c.background },
  emptyText: { fontSize: fontSize.body, color: c.textMuted },
  cover: { width: '70%', maxWidth: 320, alignSelf: 'center', borderRadius: radius.md, overflow: 'hidden' },
  square: { aspectRatio: 1 },
  titles: { alignItems: 'center', gap: spacing.xs },
  title: { fontSize: fontSize.heading, color: c.text, fontWeight: '700', textAlign: 'center' },
  artist: { fontSize: fontSize.body, color: c.textMuted, textAlign: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  control: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  controlBig: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.primary },
  controlActive: { backgroundColor: c.surface },
  controlText: { fontSize: fontSize.heading, color: c.text },
  controlTextBig: { color: c.onPrimary },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.3 },
  section: { gap: spacing.sm },
  label: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  queue: { borderRadius: radius.md, backgroundColor: c.surface, paddingVertical: spacing.xs },
  queueRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.xs },
  queueSong: { flex: 1, minWidth: 0, paddingVertical: spacing.sm },
  queueTitle: { fontSize: fontSize.body, color: c.text },
  playing: { color: c.primary, fontWeight: '700' },
  queueMeta: { fontSize: fontSize.small, color: c.textMuted },
  small: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: fontSize.body, color: c.textMuted },
}));
