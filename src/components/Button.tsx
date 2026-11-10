import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontSize, makeStyles, radius, raisedShadow, spacing } from '@/theme';

/** A Feather icon's name, e.g. 'download' or 'settings'. All are listed at https://feathericons.com */
export type IconName = ComponentProps<typeof Feather>['name'];

/** 'header' is a text button for the bar at the top of a screen, coloured to show on it. */
type Variant = 'primary' | 'secondary' | 'danger' | 'text' | 'header';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Smaller padding, for buttons inside rows. */
  compact?: boolean;
  accessibilityLabel?: string;
  /** An icon shown before the label, in the label's colour. */
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'secondary',
  disabled,
  compact,
  accessibilityLabel,
  icon,
  style,
}: ButtonProps) {
  const styles = useStyles();
  const variantLabel = styles[`${variant}Label`];
  const labelStyle = [styles.label, variantLabel];
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
      {icon ? (
        <View style={styles.withIcon}>
          <Feather name={icon} size={20} color={variantLabel.color} />
          {/* flexShrink lets a long label wrap beside the icon instead of pushing out of the button. */}
          <Text style={[labelStyle, styles.shrink]}>{title}</Text>
        </View>
      ) : (
        <Text style={labelStyle}>{title}</Text>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((c, look) => ({
  base: {
    paddingVertical: spacing.md,
    paddingHorizontal: look.pills ? spacing.xl : spacing.lg,
    borderRadius: look.pills ? radius.pill : radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { paddingVertical: spacing.xs, paddingHorizontal: look.pills ? spacing.md : spacing.sm },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  label: { fontSize: fontSize.body, fontWeight: '600' },
  withIcon: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shrink: { flexShrink: 1 },
  primary: { backgroundColor: c.primary, ...raisedShadow(c, look) },
  secondary: { backgroundColor: c.surface, ...raisedShadow(c, look) },
  danger: { backgroundColor: c.surface, ...raisedShadow(c, look) },
  text: { backgroundColor: 'transparent' },
  header: { backgroundColor: 'transparent' },
  primaryLabel: { color: c.onPrimary },
  secondaryLabel: { color: c.text },
  dangerLabel: { color: c.danger },
  textLabel: { color: c.primary },
  headerLabel: { color: c.headerTint },
}));
