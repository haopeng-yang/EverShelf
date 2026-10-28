import { Modal, Pressable, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  LINE_SPACINGS,
  MARGINS,
  READER_FONTS,
  READER_PALETTES,
  READER_THEMES,
  clampFontSize,
  type ReaderTheme,
} from '@/models/readerSettings';
import { useSettings } from '@/state/SettingsProvider';
import { fontSize, makeStyles, radius, spacing, useTheme } from '@/theme';

interface ReaderSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Text size, spacing, margins, colours and font for the reader. Changes apply
 * straight away; the backdrop is clear so the text behind shows the result.
 */
export function ReaderSettingsSheet({ visible, onClose }: ReaderSettingsSheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { colors } = useTheme();
  const { settings, setSetting } = useSettings();
  const size = settings.readerFontSize;
  const setSize = (next: number) => setSetting('readerFontSize', clampFontSize(next));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Row label={t('readerSettings.fontSize')}>
          <View style={styles.stepper}>
            <Button
              title="A−"
              compact
              disabled={size <= FONT_SIZE_MIN}
              accessibilityLabel={t('readerSettings.smaller')}
              onPress={() => setSize(size - FONT_SIZE_STEP)}
            />
            <Text style={styles.sizeValue}>{size}</Text>
            <Button
              title="A+"
              compact
              disabled={size >= FONT_SIZE_MAX}
              accessibilityLabel={t('readerSettings.larger')}
              onPress={() => setSize(size + FONT_SIZE_STEP)}
            />
          </View>
        </Row>

        <Row label={t('readerSettings.lineSpacing')}>
          <Segmented
            options={LINE_SPACINGS}
            selected={settings.readerLineSpacing}
            label={(v) => t(`readerSettings.spacing.${v}` as TranslationKey)}
            onSelect={(v) => setSetting('readerLineSpacing', v)}
          />
        </Row>

        <Row label={t('readerSettings.margins')}>
          <Segmented
            options={MARGINS}
            selected={settings.readerMargins}
            label={(v) => t(`readerSettings.margins.${v}` as TranslationKey)}
            onSelect={(v) => setSetting('readerMargins', v)}
          />
        </Row>

        <Row label={t('readerSettings.font')}>
          <Segmented
            options={READER_FONTS}
            selected={settings.readerFont}
            label={(v) => t(`readerSettings.font.${v}` as TranslationKey)}
            onSelect={(v) => setSetting('readerFont', v)}
          />
        </Row>

        <Row label={t('readerSettings.theme')}>
          <View style={styles.swatches}>
            {READER_THEMES.map((theme) => (
              <ThemeSwatch
                key={theme}
                theme={theme}
                selected={settings.readerTheme === theme}
                appBackground={colors.background}
                appText={colors.text}
                label={t(`readerSettings.theme.${theme}` as TranslationKey)}
                onPress={() => setSetting('readerTheme', theme)}
              />
            ))}
          </View>
        </Row>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('readerSettings.keepAwake')}</Text>
          <Switch value={settings.readerKeepAwake} onValueChange={(v) => setSetting('readerKeepAwake', v)} />
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Segmented<T extends string>({
  options,
  selected,
  label,
  onSelect,
}: {
  options: T[];
  selected: T;
  label: (value: T) => string;
  onSelect: (value: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Button
          key={option}
          title={label(option)}
          compact
          variant={option === selected ? 'primary' : 'secondary'}
          onPress={() => onSelect(option)}
          style={styles.segment}
        />
      ))}
    </View>
  );
}

function ThemeSwatch({
  theme,
  selected,
  appBackground,
  appText,
  label,
  onPress,
}: {
  theme: ReaderTheme;
  selected: boolean;
  appBackground: string;
  appText: string;
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const palette = theme === 'app' ? { background: appBackground, text: appText } : READER_PALETTES[theme];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.swatch, { backgroundColor: palette.background }, selected && styles.swatchSelected]}>
      <Text style={[styles.swatchText, { color: palette.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: c.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: c.border,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 12,
  },
  row: { gap: spacing.sm },
  label: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  sizeValue: { fontSize: fontSize.body, color: c.text, minWidth: 28, textAlign: 'center' },
  segmented: { flexDirection: 'row', gap: spacing.sm },
  segment: { flex: 1 },
  swatches: { flexDirection: 'row', gap: spacing.sm },
  swatch: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  swatchSelected: { borderWidth: 2, borderColor: c.primary },
  swatchText: { fontSize: fontSize.small, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: fontSize.body, color: c.text },
}));
