import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ColorPicker, { HueSlider, InputWidget, Panel1, Swatches } from 'reanimated-color-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n/useT';
import { accentPalette, ACCENT_SWATCHES, normalizeHex } from '@/models/accentColor';
import { darkColors, fontSize, lightColors, makeStyles, radius, spacing, useTheme } from '@/theme';

import { Button } from './Button';

/** The app's own blue, shown when no accent colour has been chosen. */
export const DEFAULT_ACCENT = ACCENT_SWATCHES[0];

interface AccentColorSheetProps {
  visible: boolean;
  /** The saved accent, or '' for the default. */
  value: string;
  /** Called with '#RRGGBB', or '' to go back to the default. */
  onSave: (color: string) => void;
  onClose: () => void;
}

/**
 * Lets the user pick any accent colour: ready-made swatches, a
 * saturation/brightness panel with a hue slider, and a hex field. Nothing
 * changes in the app until Save, so dragging stays smooth.
 */
export function AccentColorSheet({ visible, value, onSave, onClose }: AccentColorSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Gestures inside an Android Modal need their own root. Mounted only while open, so it starts from the saved colour. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        {visible && <Sheet value={value} onSave={onSave} onClose={onClose} />}
      </GestureHandlerRootView>
    </Modal>
  );
}

function Sheet({ value, onSave, onClose }: Omit<AccentColorSheetProps, 'visible'>) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { colors, dark } = useTheme();
  const initial = value || DEFAULT_ACCENT;
  const [picked, setPicked] = useState(initial);
  // Show the colour as the app would draw it: after the readability adjustment,
  // or the theme's own colours for the default blue, since Save resets to those.
  const preview = picked === DEFAULT_ACCENT ? (dark ? darkColors : lightColors) : accentPalette(picked, colors.background, dark);

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.title}>{t('accentSheet.title')}</Text>

        <ColorPicker
          value={initial}
          style={styles.picker}
          thumbSize={24}
          sliderThickness={24}
          boundedThumb
          onCompleteJS={(c) => setPicked(normalizeHex(c.hex.slice(0, 7)) ?? picked)}>
          <Swatches colors={ACCENT_SWATCHES} style={styles.swatches} swatchStyle={styles.swatch} />
          <Panel1 style={styles.panel} />
          <HueSlider style={styles.slider} />
          <InputWidget
            formats={['HEX']}
            disableAlphaChannel
            inputStyle={styles.input}
            inputTitleStyle={styles.hint}
            iconColor={colors.textMuted}
          />
        </ColorPicker>

        <View style={styles.previewRow}>
          <View style={[styles.previewButton, { backgroundColor: preview.primary }]}>
            <Text style={[styles.previewButtonText, { color: preview.onPrimary }]}>{t('accentSheet.sampleButton')}</Text>
          </View>
          <View style={[styles.previewTab, { backgroundColor: preview.tabSelected }]}>
            <Text style={[styles.previewTabText, { color: preview.onTabSelected }]}>{t('accentSheet.sampleTab')}</Text>
          </View>
        </View>

        <View style={styles.buttons}>
          <Button title={t('accentSheet.reset')} variant="text" disabled={!value} onPress={() => onSave('')} />
          <View style={styles.spacer} />
          <Button title={t('common.cancel')} variant="text" onPress={onClose} />
          <Button
            title={t('accentSheet.save')}
            variant="primary"
            // Saving the default blue is the same as resetting: keep it following the app's own colours.
            onPress={() => onSave(picked === DEFAULT_ACCENT ? '' : picked)}
          />
        </View>
      </View>
    </>
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
    gap: spacing.md,
  },
  title: { fontSize: fontSize.body, color: c.text, fontWeight: '700' },
  hint: { fontSize: fontSize.small, color: c.textMuted },
  picker: { gap: spacing.md },
  swatches: { justifyContent: 'flex-start', gap: spacing.sm },
  swatch: { width: 32, height: 32, borderRadius: 16, marginHorizontal: 0, marginBottom: 0 },
  panel: { height: 160, borderRadius: radius.md },
  slider: { borderRadius: radius.md },
  input: {
    color: c.text,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    fontSize: fontSize.body,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  previewButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  previewButtonText: { fontSize: fontSize.body, fontWeight: '600' },
  previewTab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.lg },
  previewTabText: { fontSize: fontSize.body, fontWeight: '600' },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  spacer: { flex: 1 },
}));
