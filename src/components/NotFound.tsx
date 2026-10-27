import { Stack, router } from 'expo-router';
import { Text, View } from 'react-native';

import { useT } from '@/i18n/useT';
import { fontSize, makeStyles, spacing } from '@/theme';

import { Button } from './Button';

/** Shown when a screen's item or shelf no longer exists (e.g. it was deleted). */
export function NotFound({ what }: { what: 'item' | 'shelf' }) {
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: t('notFound.title') }} />
      <Text style={styles.text}>{t(what === 'item' ? 'notFound.item' : 'notFound.shelf')}</Text>
      <Button title={t('notFound.back')} onPress={() => router.dismissTo('/')} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  text: { fontSize: fontSize.body, color: c.textMuted },
}));
