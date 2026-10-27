import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { confirm, showMessage } from '@/components/dialogs';
import { BackupError, parseBackup } from '@/models/backup';
import { useSettings, type ThemeMode } from '@/state/SettingsProvider';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { pickBackupFile } from '@/storage/backupFiles';
import { exportBackup, restoreBackupCovers } from '@/storage/backupFlow';
import { pruneCovers } from '@/storage/covers';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const { settings, setSetting } = useSettings();
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const styles = useStyles();
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  async function handleExport() {
    setBusy('export');
    try {
      await exportBackup(state);
    } catch (error) {
      console.error('Export failed', error);
      showMessage(errorText(error), 'Could not export');
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
        'Replace your shelf with this backup?',
        `The backup has ${backup.state.shelves.length} shelves and ${backup.state.items.length} items. ` +
          `Your current ${state.shelves.length} shelves and ${state.items.length} items will be replaced. ` +
          'Export a backup first if you want to keep them.',
        'Replace',
      );
      if (!ok) return;
      const restored = await restoreBackupCovers(backup);
      dispatch({ type: 'state/replace', state: restored });
      pruneCovers(restored);
      showMessage(`Restored ${restored.shelves.length} shelves and ${restored.items.length} items.`, 'Backup restored');
    } catch (error) {
      if (!(error instanceof BackupError)) console.error('Import failed', error);
      showMessage(errorText(error), 'Could not import');
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <View style={styles.section}>
        <Text style={styles.label}>Appearance</Text>
        <View style={styles.segmented} accessibilityRole="radiogroup">
          {THEME_OPTIONS.map((option) => {
            const selected = settings.themeMode === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setSetting('themeMode', option.value)}
                style={[styles.segment, selected && styles.segmentSelected]}>
                <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>“System” follows your phone’s light or dark mode.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Backup</Text>
        <Button
          title={busy === 'export' ? 'Exporting…' : 'Export backup'}
          disabled={busy !== null}
          onPress={handleExport}
        />
        <Button
          title={busy === 'import' ? 'Importing…' : 'Import backup'}
          disabled={busy !== null}
          onPress={handleImport}
        />
        <Text style={styles.hint}>
          Export saves all shelves, items, tags and covers into one file you can keep in Files, Drive or email.
          Import replaces everything with a backup file.
        </Text>
      </View>

      <Text style={styles.footer}>
        EverShelf {Constants.expoConfig?.version ?? ''} · {state.shelves.length} shelves · {state.items.length} items
      </Text>
    </ScrollView>
  );
}

function errorText(error: unknown): string {
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
