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

const useStyles = makeStyles((c) => ({
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
    color: c.text,
    backgroundColor: c.background,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
}));
