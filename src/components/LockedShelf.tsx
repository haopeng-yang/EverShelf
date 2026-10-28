import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { useT } from '@/i18n/useT';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import type { Shelf } from '@/models/types';
import { checkPassword } from '@/security/shelfLock';
import { useShelfLocks } from '@/state/ShelfLockProvider';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { deleteItemFiles } from '@/storage/shelfFiles';
import { fontSize, makeStyles, spacing } from '@/theme';

import { Button } from './Button';
import { confirm } from './dialogs';
import { TextField } from './TextField';

interface LockedShelfProps {
  shelf: Shelf;
  /** Called after "Forgot password?" deletes the shelf, e.g. to leave the screen. */
  onDeleted?: () => void;
}

/**
 * Shown instead of a locked shelf's contents (or any screen inside it) until
 * the right password is entered.
 */
export function LockedShelf({ shelf, onDeleted }: LockedShelfProps) {
  const styles = useStyles();
  const t = useT();
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const { unlock } = useShelfLocks();
  const [password, setPassword] = useState('');
  const [wrong, setWrong] = useState(false);
  const [checking, setChecking] = useState(false);

  async function submit() {
    if (!shelf.lock || !password || checking) return;
    setChecking(true);
    try {
      if (await checkPassword(shelf.lock, password)) {
        unlock(shelf.id);
      } else {
        setWrong(true);
        setPassword('');
      }
    } finally {
      setChecking(false);
    }
  }

  /** There is no way to recover a password, so the only way out is to delete the shelf. */
  async function forgot() {
    const items = selectItemsOnShelf(state, shelf.id);
    const ok = await confirm(
      t('lock.forgotTitle'),
      t('lock.forgotMessage', { name: shelf.name, count: items.length }),
      t('lock.deleteShelf'),
      t('common.cancel'),
    );
    if (!ok) return;
    void dispatch({ type: 'shelf/remove', shelfId: shelf.id });
    deleteItemFiles(items);
    onDeleted?.();
  }

  return (
    <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={spacing.xl}>
      <Text style={styles.icon}>🔒</Text>
      <Text style={styles.title}>{t('lock.title', { name: shelf.name })}</Text>
      <Text style={styles.hint}>{t('lock.enterPassword')}</Text>
      <TextField
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setWrong(false);
        }}
        placeholder={t('lock.password')}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={submit}
        style={styles.input}
        accessibilityLabel={t('lock.password')}
      />
      {wrong && <Text style={styles.error}>{t('lock.wrongPassword')}</Text>}
      <Button title={t('lock.unlock')} variant="primary" disabled={!password || checking} onPress={submit} />
      <Button title={t('lock.forgot')} variant="text" compact onPress={forgot} />
    </KeyboardAwareScrollView>
  );
}

/**
 * A whole screen inside a locked shelf (an item, the reader, import...),
 * shown instead of the screen until the password is entered. If the shelf is
 * deleted with "Forgot password?", it goes back to the shelf list.
 */
export function LockedScreen({ shelf }: { shelf: Shelf }) {
  return (
    <>
      <Stack.Screen options={{ title: shelf.name, headerShown: true }} />
      <LockedShelf shelf={shelf} onDeleted={() => router.dismissTo('/')} />
    </>
  );
}

const useStyles = makeStyles((c) => ({
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  icon: { fontSize: 48 },
  title: { fontSize: fontSize.title, fontWeight: '600', color: c.text, textAlign: 'center' },
  hint: { fontSize: fontSize.body, color: c.textMuted, textAlign: 'center' },
  input: { alignSelf: 'stretch' },
  error: { fontSize: fontSize.small, color: c.danger },
}));
