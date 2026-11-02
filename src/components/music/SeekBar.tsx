import { useState } from 'react';
import { Text, View, type GestureResponderEvent } from 'react-native';

import { useT } from '@/i18n/useT';
import { durationLabel } from '@/models/queue';
import { fontSize, makeStyles, spacing } from '@/theme';

const THUMB = 18;
/** How far one accessibility swipe moves, in seconds. */
const STEP = 10;

interface SeekBarProps {
  /** Seconds played. */
  value: number;
  /** Length in seconds; 0 while unknown. */
  duration: number;
  /** Called when the finger lifts, with the second to go to. */
  onSeek: (seconds: number) => void;
}

/**
 * Drag or tap along the track to move in the song, with the time played and
 * the length underneath. Like the comic page slider, the jump happens on
 * release; while dragging, the time follows the finger.
 */
export function SeekBar({ value, duration, onSeek }: SeekBarProps) {
  const styles = useStyles();
  const t = useT();
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);

  const secondsAt = (event: GestureResponderEvent) =>
    width === 0 ? 0 : Math.min(1, Math.max(0, event.nativeEvent.locationX / width)) * duration;
  const shown = dragging ?? value;
  const fraction = duration > 0 ? Math.min(1, shown / duration) : 0;

  return (
    <View style={styles.container}>
      <View
        style={styles.track}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => duration > 0}
        onMoveShouldSetResponder={() => duration > 0}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => setDragging(secondsAt(e))}
        onResponderMove={(e) => setDragging(secondsAt(e))}
        onResponderRelease={(e) => {
          setDragging(null);
          onSeek(secondsAt(e));
        }}
        onResponderTerminate={() => setDragging(null)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('player.seek')}
        accessibilityValue={{ text: t('player.time', { at: durationLabel(shown * 1000), total: durationLabel(duration * 1000) }) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === 'increment' ? STEP : -STEP;
          onSeek(Math.min(duration, Math.max(0, value + step)));
        }}>
        {/* The children ignore touches, so locationX is always measured along the track. */}
        <View pointerEvents="none" style={styles.rail} />
        <View pointerEvents="none" style={[styles.fill, { width: `${fraction * 100}%` }]} />
        <View pointerEvents="none" style={[styles.thumb, { left: fraction * width - THUMB / 2 }]} />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{durationLabel(shown * 1000)}</Text>
        <Text style={styles.time}>{duration > 0 ? durationLabel(duration * 1000) : '–:––'}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { gap: spacing.xs },
  // Tall enough to be easy to grab; the visible rail is thin and centred.
  track: { height: 36, justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: c.border },
  fill: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: c.primary },
  thumb: { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: c.primary },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: fontSize.small, color: c.textMuted, fontVariant: ['tabular-nums'] },
}));
