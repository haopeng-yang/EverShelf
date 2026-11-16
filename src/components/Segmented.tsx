import { Pressable, Text, View } from 'react-native';

import { fontSize, makeStyles, radius, raisedShadow, spacing } from '@/theme';

/** A row of options where exactly one is selected, like iOS's segmented control. */
export function Segmented<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((option) => {
        const isSelected = selected === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(option.value)}
            style={[styles.segment, isSelected && styles.segmentSelected]}>
            <Text style={[styles.segmentLabel, isSelected && styles.segmentLabelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c, look) => ({
  segmented: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderRadius: look.pills ? radius.pill : radius.md,
    padding: spacing.xs,
    ...raisedShadow(c, look),
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: look.pills ? radius.pill : radius.sm,
  },
  segmentSelected: { backgroundColor: look.raised ? c.tabSelected : c.background },
  segmentLabel: { fontSize: fontSize.body, color: c.textMuted, textAlign: 'center' },
  segmentLabelSelected: { color: look.raised ? c.onTabSelected : c.text, fontWeight: '600' },
}));
