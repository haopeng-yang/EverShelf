import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n/useT';
import { BACKUP_KINDS, measureBackup, type BackupChoice, type BackupKind, type BackupKindSize } from '@/storage/backupFlow';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

import { Button } from './Button';

interface ExportBackupSheetProps {
  visible: boolean;
  onExport: (choice: BackupChoice) => void;
  onClose: () => void;
}

/** "820 KB", "12.4 MB", "2.3 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Asks which imported files to put in a backup: books, comics, songs and
 * videos, each with how much space it takes. Shelves, items, tags and covers
 * always go in.
 */
export function ExportBackupSheet({ visible, onExport, onClose }: ExportBackupSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Mounted only while open, so sizes are worked out afresh each time. */}
      {visible && <Sheet onExport={onExport} onClose={onClose} />}
    </Modal>
  );
}

function Sheet({ onExport, onClose }: Omit<ExportBackupSheetProps, 'visible'>) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const db = useSQLiteContext();
  const [sizes, setSizes] = useState<Record<BackupKind, BackupKindSize> | null>(null);
  const [choice, setChoice] = useState<BackupChoice>({ books: true, comics: true, songs: true, videos: true });

  useEffect(() => {
    let current = true;
    measureBackup(db)
      .then((measured) => current && setSizes(measured))
      .catch((error: unknown) => {
        console.warn('Could not measure the backup', error);
        if (current) setSizes(Object.fromEntries(BACKUP_KINDS.map((k) => [k, { count: 0, bytes: 0 }])) as typeof sizes);
      });
    return () => {
      current = false;
    };
  }, [db]);

  const included = BACKUP_KINDS.filter((kind) => choice[kind] && (sizes?.[kind].count ?? 0) > 0);
  const totalBytes = included.reduce((sum, kind) => sum + (sizes?.[kind].bytes ?? 0), 0);

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.title}>{t('exportSheet.title')}</Text>
        <Text style={styles.hint}>{t('exportSheet.intro')}</Text>

        {sizes === null ? (
          <View style={styles.measuring}>
            <ActivityIndicator />
            <Text style={styles.hint}>{t('exportSheet.measuring')}</Text>
          </View>
        ) : (
          BACKUP_KINDS.map((kind) => {
            const { count, bytes } = sizes[kind];
            return (
              <View key={kind} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={[styles.label, count === 0 && styles.disabled]}>{t(`exportSheet.${kind}`)}</Text>
                  <Text style={styles.hint}>
                    {count === 0 ? t('exportSheet.noneImported') : t('exportSheet.detail', { count, size: formatBytes(bytes) })}
                  </Text>
                </View>
                <Switch
                  value={count > 0 && choice[kind]}
                  disabled={count === 0}
                  onValueChange={(value) => setChoice((c) => ({ ...c, [kind]: value }))}
                  accessibilityLabel={t(`exportSheet.${kind}`)}
                />
              </View>
            );
          })
        )}

        {sizes !== null && (
          <Text style={styles.hint}>
            {included.length === 0 ? t('exportSheet.onlyShelves') : t('exportSheet.total', { size: formatBytes(totalBytes) })}
          </Text>
        )}
        <View style={styles.buttons}>
          <Button title={t('common.cancel')} variant="text" onPress={onClose} />
          <Button
            title={t('exportSheet.export')}
            variant="primary"
            disabled={sizes === null}
            onPress={() => onExport(choice)}
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
    gap: spacing.sm,
  },
  title: { fontSize: fontSize.body, color: c.text, fontWeight: '700' },
  hint: { fontSize: fontSize.small, color: c.textMuted },
  measuring: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: fontSize.body, color: c.text },
  disabled: { color: c.textMuted },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
}));
