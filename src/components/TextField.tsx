import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/theme';

/** A TextInput with the app's look. Accepts all TextInput props. */
export function TextField({ style, multiline, ...props }: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      multiline={multiline}
      style={[styles.input, multiline && styles.multiline, style]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
    color: colors.text,
    backgroundColor: colors.background,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
});
