import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n/useT';
import { fontSize, makeStyles, spacing } from '@/theme';

import { Button } from './Button';
import { TextField } from './TextField';

interface TextEditSheetProps {
  /** What is being edited, e.g. "Edit paragraph". */
  title: string;
  /** Text to start from. The sheet is only shown while this is set. */
  initial: string | null;
  hint?: string;
  /** A single line (a chapter title) rather than a paragraph. */
  singleLine?: boolean;
  onSave: (text: string) => void;
  onClose: () => void;
}

/** Full-screen editor for fixing a piece of a book's text. */
export function TextEditSheet({ title, initial, hint, singleLine, onSave, onClose }: TextEditSheetProps) {
  return (
    <Modal visible={initial !== null} animationType="slide" onRequestClose={onClose}>
      {/* Keyed by the starting text, so each opening starts fresh. */}
      {initial !== null && (
        <Editor key={initial} title={title} initial={initial} hint={hint} singleLine={singleLine} onSave={onSave} onClose={onClose} />
      )}
    </Modal>
  );
}

function Editor({ title, initial, hint, singleLine, onSave, onClose }: TextEditSheetProps & { initial: string }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [text, setText] = useState(initial);
  const unchanged = text === initial || (singleLine && !text.trim());

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.container, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }]}>
      <View style={styles.header}>
        <Button title={t('common.cancel')} variant="text" compact onPress={onClose} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Button title={t('common.save')} variant="primary" compact disabled={unchanged} onPress={() => onSave(text)} />
      </View>
      {hint && <Text style={styles.hint}>{hint}</Text>}
      <TextField
        value={text}
        onChangeText={setText}
        multiline={!singleLine}
        autoFocus
        accessibilityLabel={title}
        style={!singleLine && styles.input}
      />
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: spacing.lg, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.body, fontWeight: '600', color: c.text, textAlign: 'center' },
  hint: { fontSize: fontSize.small, color: c.textMuted },
  input: { flex: 1, lineHeight: 24 },
}));
