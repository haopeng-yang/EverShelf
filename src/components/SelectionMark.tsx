import { Text, View } from 'react-native';

import { makeStyles, radius, spacing } from '@/theme';

/**
 * Laid over a cover while the shelf is in selection mode: a tinted frame and
 * a filled check when picked, an empty circle when not.
 */
export function SelectionMark({ selected }: { selected: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.frame, selected && styles.frameSelected]} pointerEvents="none">
      <View style={[styles.circle, selected && styles.circleSelected]}>
        {selected && <Text style={styles.check}>✓</Text>}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  frame: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.sm,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  frameSelected: { borderColor: c.primary },
  circle: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: c.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleSelected: { backgroundColor: c.primary, borderColor: c.primary },
  check: { color: c.onPrimary, fontSize: 14, fontWeight: '700' },
}));
