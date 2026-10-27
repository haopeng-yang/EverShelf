import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { SettingsProvider } from '@/state/SettingsProvider';
import { ShelfProvider } from '@/state/ShelfProvider';
import { DATABASE_NAME, migrate } from '@/storage/database';
import { AppThemeProvider, useTheme } from '@/theme';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate}>
      <SettingsProvider>
        <AppThemeProvider>
          <ShelfProvider>
            <ThemedStack />
          </ShelfProvider>
        </AppThemeProvider>
      </SettingsProvider>
    </SQLiteProvider>
  );
}

function ThemedStack() {
  const { colors, dark } = useTheme();
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text },
          headerShadowVisible: !dark,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      <StatusBar style={dark ? 'light' : 'dark'} />
    </>
  );
}
