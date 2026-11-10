import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Appearance, StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

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
  /** Label of the selected shelf tab or option. */
  onTabSelected: '#2F6FEB',
  overlay: 'rgba(0, 0, 0, 0.4)',
  /** The bar at the top of each screen, and the strip behind the status bar. */
  header: '#FFFFFF',
  /** Screen titles in the header. */
  onHeader: '#1B1F24',
  /** Back arrow and buttons in the header. */
  headerTint: '#2F6FEB',
  /** Items, fields and other raised boxes. */
  card: '#FFFFFF',
  shadow: '#000000',
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
  onTabSelected: '#7EA6F8',
  overlay: 'rgba(0, 0, 0, 0.6)',
  header: '#121417',
  onHeader: '#E8EAED',
  headerTint: '#7EA6F8',
  card: '#121417',
  shadow: '#000000',
};

/** A light theme with a purple header and accents, on a soft lavender background. */
export const purpleColors: Colors = {
  background: '#F3F1FB',
  surface: '#FFFFFF',
  border: '#E3DDF7',
  text: '#1E1A3C',
  textMuted: '#8C87A6',
  primary: '#6C3FE6',
  onPrimary: '#FFFFFF',
  danger: '#E5484D',
  coverPlaceholder: '#D6CCF8',
  coverLetter: '#FFFFFF',
  tabSelected: '#6C3FE6',
  onTabSelected: '#FFFFFF',
  overlay: 'rgba(36, 20, 92, 0.45)',
  header: '#6C3FE6',
  onHeader: '#FFFFFF',
  headerTint: '#FFFFFF',
  card: '#FFFFFF',
  shadow: '#5B3FD9',
};

/** How a theme shapes things, beyond its colours. */
export interface Look {
  /** Items, tags and buttons sit on white cards with a soft coloured shadow. */
  raised: boolean;
  /** Buttons, tabs and search fields are fully rounded pills. */
  pills: boolean;
}

const flatLook: Look = { raised: false, pills: false };
const raisedLook: Look = { raised: true, pills: true };

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
  /** Rounds any button or field into a pill. */
  pill: 999,
};

export const fontSize = {
  small: 13,
  body: 16,
  title: 20,
  heading: 24,
};

/** Width / height of a cover image (2:3, like a book or poster). */
export const coverAspectRatio = 2 / 3;

/** The soft shadow under raised boxes; nothing for a flat look. */
export function raisedShadow(c: Colors, look: Look): ViewStyle {
  if (!look.raised) return {};
  return {
    shadowColor: c.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  };
}

interface Theme {
  /** Dark backgrounds, light text. Purple counts as light. */
  dark: boolean;
  colors: Colors;
  look: Look;
  /** Status bar icons: 'light' over a dark or coloured header. */
  statusBar: 'light' | 'dark';
}

const lightTheme: Theme = { dark: false, colors: lightColors, look: flatLook, statusBar: 'dark' };
const darkTheme: Theme = { dark: true, colors: darkColors, look: flatLook, statusBar: 'light' };
const purpleTheme: Theme = { dark: false, colors: purpleColors, look: raisedLook, statusBar: 'light' };

const ThemeContext = createContext<Theme>(lightTheme);

/** Picks the theme from the Appearance setting (or the phone's light or dark mode on "System"). */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const systemScheme = useColorScheme();
  const mode = settings.themeMode;
  const theme =
    mode === 'purple' ? purpleTheme : mode === 'dark' || (mode === 'system' && systemScheme === 'dark') ? darkTheme : lightTheme;
  // Tell the native side too, so Android's own parts (dialogs, the keyboard)
  // match. The strip behind the status bar is set per screen, in _layout.tsx.
  useEffect(() => {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode === 'dark' ? 'dark' : 'light');
  }, [mode]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

// Same shape StyleSheet.create accepts; typed this way so style values like 'row' keep their literal types.
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Creates a hook that returns styles built from the current theme, e.g.
 *   const useStyles = makeStyles((c, look) => ({ box: { backgroundColor: c.surface } }));
 *   const styles = useStyles();
 * Styles are built once per theme and reused.
 */
export function makeStyles<T extends NamedStyles<T> | NamedStyles<any>>(
  factory: (colors: Colors, look: Look) => T & NamedStyles<any>,
): () => T {
  const cache = new Map<Theme, T>();
  return function useStyles() {
    const theme = useTheme();
    let styles = cache.get(theme);
    if (!styles) {
      styles = StyleSheet.create(factory(theme.colors, theme.look));
      cache.set(theme, styles);
    }
    return styles;
  };
}
