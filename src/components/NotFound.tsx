import { Stack, router } from 'expo-router';
import { Text, View } from 'react-native';

import { fontSize, makeStyles, spacing } from '@/theme';

import { Button } from './Button';

/** Shown when a screen's item or shelf no longer exists (e.g. it was deleted). */
export function NotFound({ what }: { what: string }) {
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Text style={styles.text}>This {what} no longer exists.</Text>
      <Button title="Back to shelves" onPress={() => router.dismissTo('/')} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  text: { fontSize: fontSize.body, color: c.textMuted },
}));
