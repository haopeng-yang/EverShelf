import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, makeStyles, radius, spacing } from '@/theme';

interface OptionSheetProps<T extends string> {
  visible: boolean;
  title: string;
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}

/** A list of choices that slides up from the bottom, e.g. for sort order. */
export function OptionSheet<T extends string>({ visible, title, options, selected, onSelect, onClose }: OptionSheetProps<T>) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.title}>{title}</Text>
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              onPress={() => {
                onSelect(option.value);
                onClose();
              }}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              <Text style={[styles.label, isSelected && styles.labelSelected]}>{option.label}</Text>
              {isSelected && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  title: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600', marginBottom: spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  pressed: { opacity: 0.6 },
  label: { flex: 1, fontSize: fontSize.body, color: c.text },
  labelSelected: { color: c.primary, fontWeight: '600' },
  check: { fontSize: fontSize.body, color: c.primary },
}));
