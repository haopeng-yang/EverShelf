import { useState } from 'react';
import { Text, View, type GestureResponderEvent } from 'react-native';

import { useT } from '@/i18n/useT';
import { fontSize, makeStyles, spacing } from '@/theme';

const THUMB = 20;

interface PageSliderProps {
  /** 0-based page shown now. */
  value: number;
  count: number;
  /** Runs right to left, for manga: the first page is on the right. */
  reversed: boolean;
  /** Called when the finger lifts, with the 0-based page to go to. */
  onSeek: (page: number) => void;
}

/**
 * Drag or tap along the track to jump to a page. While dragging, the label
 * shows the page under the finger; the jump happens on release, so a long
 * drag doesn't load every page on the way.
 */
export function PageSlider({ value, count, reversed, onSeek }: PageSliderProps) {
  const styles = useStyles();
  const t = useT();
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);

  const pageAt = (event: GestureResponderEvent) => {
    if (width === 0 || count <= 1) return 0;
    const fraction = Math.min(1, Math.max(0, event.nativeEvent.locationX / width));
    return Math.round((reversed ? 1 - fraction : fraction) * (count - 1));
  };
  const shown = dragging ?? value;
  const fraction = count > 1 ? shown / (count - 1) : 1;
  const thumbAt = (reversed ? 1 - fraction : fraction) * width;
  const label = t('comicReader.page', { n: shown + 1, total: count });

  return (
    <View style={styles.row}>
      <View
        style={styles.track}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => setDragging(pageAt(e))}
        onResponderMove={(e) => setDragging(pageAt(e))}
        onResponderRelease={(e) => {
          setDragging(null);
          onSeek(pageAt(e));
        }}
        onResponderTerminate={() => setDragging(null)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('comicReader.slider')}
        accessibilityValue={{ min: 1, max: count, now: shown + 1, text: label }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const next = value + (e.nativeEvent.actionName === 'increment' ? 1 : -1);
          if (next >= 0 && next < count) onSeek(next);
        }}>
        {/* The children ignore touches, so locationX is always measured along the track. */}
        <View pointerEvents="none" style={styles.rail} />
        <View
          pointerEvents="none"
          style={[styles.fill, reversed ? { right: 0 } : { left: 0 }, { width: `${fraction * 100}%` }]}
        />
        <View pointerEvents="none" style={[styles.thumb, { left: thumbAt - THUMB / 2 }]} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // Tall enough to be easy to grab; the visible rail is thin and centred.
  track: { flex: 1, height: 36, justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  fill: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: c.primary },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: c.primary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  label: { minWidth: 72, textAlign: 'right', fontSize: fontSize.small, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
}));
