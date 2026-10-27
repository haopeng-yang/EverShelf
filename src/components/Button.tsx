import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';

import { fontSize, makeStyles, radius, spacing } from '@/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'text';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Smaller padding, for buttons inside rows. */
  compact?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'secondary',
  disabled,
  compact,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      hitSlop={compact ? 6 : 0}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        styles[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}>
      <Text style={[styles.label, styles[`${variant}Label`]]}>{title}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  base: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  label: { fontSize: fontSize.body, fontWeight: '600' },
  primary: { backgroundColor: c.primary },
  secondary: { backgroundColor: c.surface },
  danger: { backgroundColor: c.surface },
  text: { backgroundColor: 'transparent' },
  primaryLabel: { color: c.onPrimary },
  secondaryLabel: { color: c.text },
  dangerLabel: { color: c.danger },
  textLabel: { color: c.primary },
}));
