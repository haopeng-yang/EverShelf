import { Stack, usePathname } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
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
  const { colors, dark, look, statusBar } = useTheme();
  // The shelf screen has no title bar, so its plain background runs up behind
  // the status bar; elsewhere the header's colour does.
  const headerless = usePathname() === '/';
  const behindStatusBar = headerless ? colors.background : colors.header;
  const statusBarStyle = headerless ? (dark ? 'light' : 'dark') : statusBar;
  // Android's own window background shows behind the status bar. Left alone it
  // follows the phone's theme, e.g. a white strip under white icons when Dark
  // was chosen on a light phone.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(behindStatusBar).catch((error: unknown) =>
      console.warn('Could not set the window background', error),
    );
  }, [behindStatusBar]);
  // The mini player sits under the screens rather than over them, so it never hides their buttons.
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: colors.headerTint,
          headerTitleStyle: { color: colors.onHeader, fontWeight: look.raised ? '700' : undefined },
          // A coloured header stands out on its own; a white one needs the line under it.
          headerShadowVisible: !dark && !look.raised,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      <MiniPlayer />
      <StatusBar style={statusBarStyle} />
    </View>
  );
}
