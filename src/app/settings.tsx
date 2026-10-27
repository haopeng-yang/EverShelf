import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { confirm, showMessage } from '@/components/dialogs';
import type { Translate } from '@/i18n';
import { useT } from '@/i18n/useT';
import { BackupError, parseBackup } from '@/models/backup';
import { useSettings, type LanguageSetting, type ThemeMode } from '@/state/SettingsProvider';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { pickBackupFile } from '@/storage/backupFiles';
import { exportBackup, restoreBackupCovers } from '@/storage/backupFlow';
import { pruneCovers } from '@/storage/covers';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

export default function SettingsScreen() {
  const { settings, setSetting } = useSettings();
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const styles = useStyles();
  const t = useT();
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: t('settings.system') },
    { value: 'light', label: t('settings.light') },
    { value: 'dark', label: t('settings.dark') },
  ];
  // Language names are always written in their own language, so they can be found either way.
  const languageOptions: { value: LanguageSetting; label: string }[] = [
    { value: 'system', label: t('settings.system') },
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
  ];

  async function handleExport() {
    setBusy('export');
    try {
      await exportBackup(state);
    } catch (error) {
      console.error('Export failed', error);
      showMessage(errorText(error, t), t('settings.exportFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    setBusy('import');
    try {
      const text = await pickBackupFile();
      if (text === null) return;
      const backup = parseBackup(text);
      const ok = await confirm(
        t('settings.replaceTitle'),
        t('settings.replaceMessage', {
          backupShelves: backup.state.shelves.length,
          backupItems: backup.state.items.length,
          shelves: state.shelves.length,
          items: state.items.length,
        }),
        t('settings.replace'),
        t('common.cancel'),
      );
      if (!ok) return;
      const restored = await restoreBackupCovers(backup);
      dispatch({ type: 'state/replace', state: restored });
      pruneCovers(restored);
      showMessage(
        t('settings.restored', { shelves: restored.shelves.length, items: restored.items.length }),
        t('settings.restoredTitle'),
      );
    } catch (error) {
      if (!(error instanceof BackupError)) console.error('Import failed', error);
      showMessage(errorText(error, t), t('settings.importFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('settings.title') }} />

      <View style={styles.section}>
        <Text style={styles.label}>{t('settings.appearance')}</Text>
        <Segmented options={themeOptions} selected={settings.themeMode} onSelect={(v) => setSetting('themeMode', v)} />
        <Text style={styles.hint}>{t('settings.appearanceHint')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('settings.language')}</Text>
        <Segmented options={languageOptions} selected={settings.language} onSelect={(v) => setSetting('language', v)} />
        <Text style={styles.hint}>{t('settings.languageHint')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('settings.backup')}</Text>
        <Button
          title={busy === 'export' ? t('settings.exporting') : t('settings.export')}
          disabled={busy !== null}
          onPress={handleExport}
        />
        <Button
          title={busy === 'import' ? t('settings.importing') : t('settings.import')}
          disabled={busy !== null}
          onPress={handleImport}
        />
        <Text style={styles.hint}>{t('settings.backupHint')}</Text>
      </View>

      <Text style={styles.footer}>
        EverShelf {Constants.expoConfig?.version ?? ''} ·{' '}
        {t('settings.summary', { shelves: state.shelves.length, items: state.items.length })}
      </Text>
    </ScrollView>
  );
}

/** A row of options where exactly one is selected, like iOS's segmented control. */
function Segmented<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((option) => {
        const isSelected = selected === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(option.value)}
            style={[styles.segment, isSelected && styles.segmentSelected]}>
            <Text style={[styles.segmentLabel, isSelected && styles.segmentLabelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function errorText(error: unknown, t: Translate): string {
  if (error instanceof BackupError) return t(`backupError.${error.code}`, error.params);
  return error instanceof Error ? error.message : String(error);
}

const useStyles = makeStyles((c) => ({
  content: { padding: spacing.lg, gap: spacing.xl },
  section: { gap: spacing.sm },
  label: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  hint: { fontSize: fontSize.small, color: c.textMuted },
  segmented: { flexDirection: 'row', backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.xs },
  segment: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  segmentSelected: { backgroundColor: c.background },
  segmentLabel: { fontSize: fontSize.body, color: c.textMuted },
  segmentLabelSelected: { color: c.text, fontWeight: '600' },
  footer: { fontSize: fontSize.small, color: c.textMuted, textAlign: 'center' },
}));
