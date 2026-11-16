import { useState } from 'react';
import { Modal, Pressable, Switch, Text, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ColorPicker, { HueSlider, InputWidget, Panel1, Swatches } from 'reanimated-color-picker';

import { useT } from '@/i18n/useT';
import { applyColorChoice, COLOR_SWATCHES, NO_COLORS, normalizeHex, type ColorChoice } from '@/models/themeColors';
import { darkColors, fontSize, lightColors, makeStyles, radius, spacing, useTheme } from '@/theme';

import { Button } from './Button';
import { Segmented } from './Segmented';

/** The app's own blue: where the picker starts when nothing has been chosen. */
const DEFAULT_COLOR = COLOR_SWATCHES[0];

type Target = keyof ColorChoice;

interface ThemeColorSheetProps {
  visible: boolean;
  /** The saved choice. */
  value: ColorChoice;
  onSave: (choice: ColorChoice) => void;
  onClose: () => void;
}

/**
 * Lets the user colour the theme (header and backgrounds), the buttons and
 * the selected tab. Buttons and the tab match the theme colour unless given
 * their own. Nothing changes in the app until Save, so dragging stays smooth.
 */
export function ThemeColorSheet({ visible, value, onSave, onClose }: ThemeColorSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Gestures inside an Android Modal need their own root. Mounted only while open, so it starts from the saved colours. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        {visible && <Sheet value={value} onSave={onSave} onClose={onClose} />}
      </GestureHandlerRootView>
    </Modal>
  );
}

function Sheet({ value, onSave, onClose }: Omit<ThemeColorSheetProps, 'visible'>) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { dark, colors } = useTheme();
  const [target, setTarget] = useState<Target>('theme');
  // The colour last picked for each part, kept while its switch is off so turning it back on restores it.
  const [picked, setPicked] = useState<ColorChoice>({
    theme: value.theme || DEFAULT_COLOR,
    button: value.button || value.theme || DEFAULT_COLOR,
    tab: value.tab || value.theme || DEFAULT_COLOR,
  });
  const [themeOn, setThemeOn] = useState(value.theme !== '');
  const [matches, setMatches] = useState({ button: value.button === '', tab: value.tab === '' });

  const choice: ColorChoice = {
    theme: themeOn ? picked.theme : '',
    button: matches.button ? '' : picked.button,
    tab: matches.tab ? '' : picked.tab,
  };
  const preview = applyColorChoice(dark ? darkColors : lightColors, dark, choice).colors;

  // The picker is live for the theme while it's on, and for buttons or the tab while they have their own colour.
  const live = target === 'theme' ? themeOn : !matches[target];
  // Otherwise it shows the colour that part is getting from the theme.
  const shown = live ? picked[target] : target !== 'theme' && themeOn ? picked.theme : DEFAULT_COLOR;

  const targets: { value: Target; label: string }[] = [
    { value: 'theme', label: t('colorSheet.theme') },
    { value: 'button', label: t('colorSheet.buttons') },
    { value: 'tab', label: t('colorSheet.tab') },
  ];
  const isDefault = !value.theme && !value.button && !value.tab;

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{t('colorSheet.title')}</Text>

          <View style={[styles.preview, { backgroundColor: preview.background, borderColor: preview.border }]}>
            <View style={[styles.previewHeader, { backgroundColor: preview.header }]}>
              <Text style={[styles.previewTitle, { color: preview.onHeader }]}>EverShelf</Text>
              <Text style={[styles.previewHeaderButton, { color: preview.headerTint }]}>{t('colorSheet.sampleSave')}</Text>
            </View>
            <View style={styles.previewBody}>
              <View style={styles.previewTabs}>
                <View style={[styles.previewTab, { backgroundColor: preview.tabSelected }]}>
                  <Text style={[styles.previewTabText, { color: preview.onTabSelected, fontWeight: '600' }]}>
                    {t('colorSheet.sampleTab')}
                  </Text>
                </View>
                <View style={[styles.previewTab, { backgroundColor: preview.surface }]}>
                  <Text style={[styles.previewTabText, { color: preview.text }]}>{t('colorSheet.sampleOtherTab')}</Text>
                </View>
              </View>
              <View style={[styles.previewButton, { backgroundColor: preview.primary }]}>
                <Text style={[styles.previewButtonText, { color: preview.onPrimary }]}>{t('colorSheet.sampleButton')}</Text>
              </View>
            </View>
          </View>

          <Segmented options={targets} selected={target} onSelect={setTarget} />

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.label}>
                {target === 'theme' ? t('colorSheet.useThemeColor') : t('colorSheet.matchTheme')}
              </Text>
              <Text style={styles.hint}>
                {target === 'theme'
                  ? t('colorSheet.useThemeColorHint')
                  : themeOn
                    ? t('colorSheet.matchThemeHint')
                    : t('colorSheet.matchDefaultHint')}
              </Text>
            </View>
            <Switch
              value={target === 'theme' ? themeOn : matches[target]}
              onValueChange={(on) => (target === 'theme' ? setThemeOn(on) : setMatches((m) => ({ ...m, [target]: on })))}
            />
          </View>

          {/* Dimmed and untouchable while this part takes its colour from elsewhere. */}
          <View pointerEvents={live ? 'auto' : 'none'} style={!live && styles.inactive}>
            <ColorPicker
              value={shown}
              style={styles.picker}
              thumbSize={24}
              sliderThickness={24}
              boundedThumb
              onCompleteJS={(c) => {
                const hex = normalizeHex(c.hex.slice(0, 7));
                if (hex && live) setPicked((p) => ({ ...p, [target]: hex }));
              }}>
              <Swatches colors={COLOR_SWATCHES} style={styles.swatches} swatchStyle={styles.swatch} />
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
          </View>
        </ScrollView>

        <View style={styles.buttons}>
          <Button title={t('colorSheet.reset')} variant="text" disabled={isDefault} onPress={() => onSave(NO_COLORS)} />
          <View style={styles.spacer} />
          <Button title={t('common.cancel')} variant="text" onPress={onClose} />
          <Button title={t('colorSheet.save')} variant="primary" onPress={() => onSave(choice)} />
        </View>
      </View>
    </>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    maxHeight: '90%',
    backgroundColor: c.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  content: { gap: spacing.md },
  title: { fontSize: fontSize.body, color: c.text, fontWeight: '700' },
  label: { fontSize: fontSize.body, color: c.text },
  hint: { fontSize: fontSize.small, color: c.textMuted },
  preview: { borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  previewTitle: { fontSize: fontSize.body, fontWeight: '700' },
  previewHeaderButton: { fontSize: fontSize.body, fontWeight: '600' },
  previewBody: { padding: spacing.md, gap: spacing.md },
  previewTabs: { flexDirection: 'row', gap: spacing.sm },
  previewTab: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.lg },
  previewTabText: { fontSize: fontSize.small },
  previewButton: { alignSelf: 'flex-start', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  previewButtonText: { fontSize: fontSize.body, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchText: { flex: 1, gap: 2 },
  inactive: { opacity: 0.35 },
  picker: { gap: spacing.md },
  swatches: { justifyContent: 'flex-start', gap: spacing.sm },
  swatch: { width: 32, height: 32, borderRadius: 16, marginHorizontal: 0, marginBottom: 0 },
  panel: { height: 150, borderRadius: radius.md },
  slider: { borderRadius: radius.md },
  input: {
    color: c.text,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    fontSize: fontSize.body,
  },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  spacer: { flex: 1 },
}));
