import { Stack, router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from '@/theme';

import { Button } from './Button';

/** Shown when a screen's item or shelf no longer exists (e.g. it was deleted). */
export function NotFound({ what }: { what: string }) {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Text style={styles.text}>This {what} no longer exists.</Text>
      <Button title="Back to shelves" onPress={() => router.dismissTo('/')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  text: { fontSize: fontSize.body, color: colors.textMuted },
});
