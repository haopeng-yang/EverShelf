import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { confirm, showMessage } from '@/components/dialogs';
import { ExportBackupSheet, formatBytes } from '@/components/ExportBackupSheet';
import type { Translate } from '@/i18n';
import { useT } from '@/i18n/useT';
import { BackupError, parseBackup } from '@/models/backup';
import { useSettings, type LanguageSetting, type ThemeMode } from '@/state/SettingsProvider';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { openBackupFile } from '@/storage/backupFiles';
import {
  BACKUP_KINDS,
  exportBackup,
  NotEnoughSpaceError,
  restorableCounts,
  restoreBackupCovers,
  restoreBackupFiles,
  type BackupChoice,
  type BackupKind,
} from '@/storage/backupFlow';
import { pruneBooks } from '@/storage/bookFiles';
import { pruneCovers } from '@/storage/covers';
import { fontSize, makeStyles, radius, raisedShadow, spacing } from '@/theme';

export default function SettingsScreen() {
  const { settings, setSetting } = useSettings();
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const styles = useStyles();
  const t = useT();
  const [busy, setBusy] = useState<'export' | 'import' | 'clear' | null>(null);
  const [exportSheetOpen, setExportSheetOpen] = useState(false);
  /** Whole percent done while exporting or restoring files, or null before any are copied. */
  const [percent, setPercent] = useState<number | null>(null);
  const db = useSQLiteContext();
  // Files are copied a megabyte at a time; only re-render when the shown percent changes.
  const lastPercent = useRef<number | null>(null);
  const showProgress = (done: number, total: number) => {
    const next = total > 0 ? Math.floor((done / total) * 100) : 0;
    if (next === lastPercent.current) return;
    lastPercent.current = next;
    setPercent(next);
  };
  const stopProgress = () => {
    lastPercent.current = null;
    setPercent(null);
  };

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: t('settings.system') },
    { value: 'light', label: t('settings.light') },
    { value: 'dark', label: t('settings.dark') },
    { value: 'purple', label: t('settings.purple') },
  ];
  // Language names are always written in their own language, so they can be found either way.
  const languageOptions: { value: LanguageSetting; label: string }[] = [
    { value: 'system', label: t('settings.system') },
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
  ];

  async function handleExport(choice: BackupChoice) {
    setExportSheetOpen(false);
    setBusy('export');
    try {
      await exportBackup(db, state, choice, showProgress);
    } catch (error) {
      if (!(error instanceof NotEnoughSpaceError)) console.error('Export failed', error);
      showMessage(errorText(error, t), t('settings.exportFailed'));
    } finally {
      setBusy(null);
      stopProgress();
    }
  }

  async function handleImport() {
    setBusy('import');
    let opened: Awaited<ReturnType<typeof openBackupFile>> = null;
    try {
      opened = await openBackupFile();
      if (opened === null) return;
      const backup = parseBackup(opened.json);
      const message = t('settings.replaceMessage', {
        backupShelves: backup.state.shelves.length,
        backupItems: backup.state.items.length,
        shelves: state.shelves.length,
        items: state.items.length,
      });
      const files = kindList(restorableCounts(backup, opened), t);
      const filesNote = files ? t('settings.replaceFiles', { list: files }) : t('settings.replaceNoFiles');
      const ok = await confirm(
        t('settings.replaceTitle'),
        `${message}\n\n${filesNote}`,
        t('settings.replace'),
        t('common.cancel'),
      );
      if (!ok) return;
      const restored = await restoreBackupCovers(backup);
      // Books, comics, songs and videos belong to items, so the items must be saved before they go in.
      if (!(await dispatch({ type: 'state/replace', state: restored }))) throw new Error('Could not save the backup');
      pruneCovers(restored);
      const restoredFiles = kindList(await restoreBackupFiles(db, backup, opened, showProgress), t);
      showMessage(
        t('settings.restored', { shelves: restored.shelves.length, items: restored.items.length }) +
          (restoredFiles ? `\n${t('settings.restoredFiles', { list: restoredFiles })}` : ''),
        t('settings.restoredTitle'),
      );
    } catch (error) {
      if (!(error instanceof BackupError)) console.error('Import failed', error);
      showMessage(errorText(error, t), t('settings.importFailed'));
    } finally {
      opened?.close();
      setBusy(null);
      stopProgress();
    }
  }

  /** Removes every shelf and item, with their files, after asking three times. App settings stay. */
  async function handleClearAll() {
    const counts = { shelves: state.shelves.length, items: state.items.length };
    for (const step of [1, 2, 3] as const) {
      const ok = await confirm(
        t(`settings.clearTitle${step}`),
        t(`settings.clearMessage${step}`, counts),
        step === 3 ? t('settings.clearConfirm') : t('settings.clearContinue'),
        t('common.cancel'),
      );
      if (!ok) return;
    }
    setBusy('clear');
    try {
      if (!(await dispatch({ type: 'state/replace', state: { shelves: [], items: [] } }))) {
        throw new Error('Could not remove everything');
      }
      // Rows went with their items; now the covers and imported files they used.
      pruneCovers({ shelves: [], items: [] });
      pruneBooks(new Set());
      showMessage(t('settings.cleared'), t('settings.clearedTitle'));
    } catch (error) {
      console.error('Clear all failed', error);
      showMessage(errorText(error, t), t('settings.clearFailed'));
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
        <Text style={styles.label}>{t('settings.shelves')}</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>{t('settings.showContinueReading')}</Text>
            <Text style={styles.hint}>{t('settings.showContinueReadingHint')}</Text>
          </View>
          <Switch
            value={settings.showContinueReading}
            onValueChange={(value) => setSetting('showContinueReading', value)}
          />
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>{t('settings.autoplayNextVideo')}</Text>
            <Text style={styles.hint}>{t('settings.autoplayNextVideoHint')}</Text>
          </View>
          <Switch
            value={settings.autoplayNextVideo}
            onValueChange={(value) => setSetting('autoplayNextVideo', value)}
          />
        </View>
        {Platform.OS !== 'web' && (
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchLabel}>{t('settings.videoBackgroundSound')}</Text>
              <Text style={styles.hint}>{t('settings.videoBackgroundSoundHint')}</Text>
            </View>
            <Switch
              value={settings.videoBackgroundSound}
              onValueChange={(value) => setSetting('videoBackgroundSound', value)}
            />
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('settings.backup')}</Text>
        <Button
          title={
            busy !== 'export'
              ? t('settings.export')
              : percent === null
                ? t('settings.exporting')
                : t('settings.exportingPercent', { percent })
          }
          disabled={busy !== null}
          onPress={() => setExportSheetOpen(true)}
        />
        <Button
          title={
            busy !== 'import'
              ? t('settings.import')
              : percent === null
                ? t('settings.importing')
                : t('settings.importingPercent', { percent })
          }
          disabled={busy !== null}
          onPress={handleImport}
        />
        <Text style={styles.hint}>{t('settings.backupHint')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('settings.clearSection')}</Text>
        <Button
          title={busy === 'clear' ? t('settings.clearing') : t('settings.clearAll')}
          variant="danger"
          disabled={busy !== null || (state.shelves.length === 0 && state.items.length === 0)}
          onPress={handleClearAll}
        />
        <Text style={styles.hint}>{t('settings.clearHint')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('settings.about')}</Text>
        <Text style={styles.hint}>{t('settings.aboutFiles')}</Text>
      </View>

      <ExportBackupSheet visible={exportSheetOpen} onExport={handleExport} onClose={() => setExportSheetOpen(false)} />

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

/** "3 books, 2 comics, 1 video": the kinds with any, or '' if none. */
function kindList(counts: Record<BackupKind, number>, t: Translate): string {
  return BACKUP_KINDS.filter((kind) => counts[kind] > 0)
    .map((kind) => t(`backupCount.${kind}`, { count: counts[kind] }))
    .join(t('common.listSeparator'));
}

function errorText(error: unknown, t: Translate): string {
  if (error instanceof BackupError) return t(`backupError.${error.code}`, error.params);
  if (error instanceof NotEnoughSpaceError) {
    return t('exportSheet.noSpace', { needed: formatBytes(error.needed), free: formatBytes(error.free) });
  }
  return error instanceof Error ? error.message : String(error);
}

const useStyles = makeStyles((c, look) => ({
  content: { padding: spacing.lg, gap: spacing.xl },
  section: { gap: spacing.sm },
  label: { fontSize: fontSize.small, color: look.raised ? c.primary : c.textMuted, fontWeight: '600' },
  hint: { fontSize: fontSize.small, color: c.textMuted },
  segmented: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderRadius: look.pills ? radius.pill : radius.md,
    padding: spacing.xs,
    ...raisedShadow(c, look),
  },
  segment: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: look.pills ? radius.pill : radius.sm },
  segmentSelected: { backgroundColor: look.raised ? c.tabSelected : c.background },
  segmentLabel: { fontSize: fontSize.body, color: c.textMuted },
  segmentLabelSelected: { color: look.raised ? c.onTabSelected : c.text, fontWeight: '600' },
  footer: { fontSize: fontSize.small, color: c.textMuted, textAlign: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchText: { flex: 1, gap: 2 },
  switchLabel: { fontSize: fontSize.body, color: c.text },
}));
