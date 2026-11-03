import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { MiniPlayer } from '@/components/music/MiniPlayer';
import { PlayerProvider } from '@/state/PlayerProvider';
import { SettingsProvider } from '@/state/SettingsProvider';
import { ShelfLockProvider } from '@/state/ShelfLockProvider';
import { ShelfProvider } from '@/state/ShelfProvider';
import { DATABASE_NAME, migrate } from '@/storage/database';
import { AppThemeProvider, useTheme } from '@/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate}>
          <SettingsProvider>
            <AppThemeProvider>
              <ShelfProvider>
                <ShelfLockProvider>
                  <PlayerProvider>
                    <ThemedStack />
                  </PlayerProvider>
                </ShelfLockProvider>
              </ShelfProvider>
            </AppThemeProvider>
          </SettingsProvider>
        </SQLiteProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function ThemedStack() {
  const { colors, dark } = useTheme();
  // The mini player sits under the screens rather than over them, so it never hides their buttons.
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text },
          headerShadowVisible: !dark,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      <MiniPlayer />
      <StatusBar style={dark ? 'light' : 'dark'} />
    </View>
  );
}
