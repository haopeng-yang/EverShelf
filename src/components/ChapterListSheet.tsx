import { FlatList, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n/useT';
import type { Chapter } from '@/models/types';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

/** Every row has this height, so the list can open scrolled to the current chapter. */
const ROW_HEIGHT = 48;

interface ChapterListSheetProps {
  visible: boolean;
  chapters: Chapter[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

/** The book's table of contents, sliding up from the bottom of the reader. */
export function ChapterListSheet({ visible, chapters, currentIndex, onSelect, onClose }: ChapterListSheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { maxHeight: height * 0.7, paddingBottom: insets.bottom + spacing.sm }]}>
        <Text style={styles.title}>{t('reader.contents', { count: chapters.length })}</Text>
        <FlatList
          data={chapters}
          keyExtractor={(chapter) => chapter.id}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          initialScrollIndex={Math.max(0, currentIndex - 3)}
          renderItem={({ item, index }) => {
            const isCurrent = index === currentIndex;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isCurrent }}
                onPress={() => {
                  onSelect(index);
                  onClose();
                }}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <Text style={[styles.label, isCurrent && styles.labelCurrent]} numberOfLines={1}>
                  {item.title}
                </Text>
                {isCurrent && <Text style={styles.check}>●</Text>}
              </Pressable>
            );
          }}
        />
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
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pressed: { opacity: 0.6 },
  label: { flex: 1, fontSize: fontSize.body, color: c.text },
  labelCurrent: { color: c.primary, fontWeight: '600' },
  check: { fontSize: fontSize.small, color: c.primary },
}));
