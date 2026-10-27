import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { ShelfProvider } from '@/state/ShelfProvider';
import { DATABASE_NAME, migrate } from '@/storage/database';
import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate}>
      <ShelfProvider>
        <Stack
          screenOptions={{
            headerTintColor: colors.primary,
            headerTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.background },
          }}
        />
        <StatusBar style="dark" />
      </ShelfProvider>
    </SQLiteProvider>
  );
}
