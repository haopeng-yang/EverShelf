import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { useSettings } from '@/state/SettingsProvider';

// All colours, sizes and spacing in one place. Restyling the app later should
// mostly mean editing this file.

export const lightColors = {
  background: '#FFFFFF',
  surface: '#F2F3F5',
  border: '#D9DCE1',
  text: '#1B1F24',
  textMuted: '#6B7280',
  primary: '#2F6FEB',
  onPrimary: '#FFFFFF',
  danger: '#D93025',
  coverPlaceholder: '#C9CCD1',
  coverLetter: '#FFFFFF',
  tabSelected: '#DCE7FD',
  overlay: 'rgba(0, 0, 0, 0.4)',
};

export type Colors = typeof lightColors;

export const darkColors: Colors = {
  background: '#121417',
  surface: '#1E2227',
  border: '#343A42',
  text: '#E8EAED',
  textMuted: '#9AA0A6',
  primary: '#7EA6F8',
  onPrimary: '#0B1A33',
  danger: '#F28B82',
  coverPlaceholder: '#3A3F46',
  coverLetter: '#C9CCD1',
  tabSelected: '#25365A',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
};

export const fontSize = {
  small: 13,
  body: 16,
  title: 20,
  heading: 24,
};

/** Width / height of a cover image (2:3, like a book or poster). */
export const coverAspectRatio = 2 / 3;

interface Theme {
  dark: boolean;
  colors: Colors;
}

const ThemeContext = createContext<Theme>({ dark: false, colors: lightColors });

/** Picks light or dark colours from the Appearance setting (or the phone's setting on "System"). */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const systemScheme = useColorScheme();
  const dark = settings.themeMode === 'system' ? systemScheme === 'dark' : settings.themeMode === 'dark';
  return (
    <ThemeContext.Provider value={dark ? darkTheme : lightTheme}>{children}</ThemeContext.Provider>
  );
}

const lightTheme: Theme = { dark: false, colors: lightColors };
const darkTheme: Theme = { dark: true, colors: darkColors };

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

// Same shape StyleSheet.create accepts; typed this way so style values like 'row' keep their literal types.
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Creates a hook that returns styles built from the current colours, e.g.
 *   const useStyles = makeStyles((c) => ({ box: { backgroundColor: c.surface } }));
 *   const styles = useStyles();
 * Styles are built once per palette and reused.
 */
export function makeStyles<T extends NamedStyles<T> | NamedStyles<any>>(
  factory: (colors: Colors) => T & NamedStyles<any>,
): () => T {
  const cache = new Map<Colors, T>();
  return function useStyles() {
    const { colors } = useTheme();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors));
      cache.set(colors, styles);
    }
    return styles;
  };
}
