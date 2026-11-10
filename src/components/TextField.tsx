import { TextInput, type TextInputProps } from 'react-native';

import { fontSize, makeStyles, radius, spacing, useTheme } from '@/theme';

/** A TextInput with the app's look. Accepts all TextInput props. */
export function TextField({ style, multiline, ...props }: TextInputProps) {
  const styles = useStyles();
  const { colors, dark } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      keyboardAppearance={dark ? 'dark' : 'light'}
      multiline={multiline}
      style={[styles.input, multiline && styles.multiline, style]}
      {...props}
    />
  );
}

const useStyles = makeStyles((c, look) => ({
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: look.pills ? radius.pill : radius.sm,
    paddingHorizontal: look.pills ? spacing.lg : spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
    color: c.text,
    backgroundColor: c.card,
  },
  // A pill shape doesn't suit a box of several lines.
  multiline: { minHeight: 64, textAlignVertical: 'top', borderRadius: look.pills ? radius.md : radius.sm },
}));
