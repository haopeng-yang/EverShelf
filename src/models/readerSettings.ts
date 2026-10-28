// How the reader looks: text size, spacing, margins, colours and font. These
// apply to every book and are saved with the other settings. Pure, so it can
// be tested without a phone.

export type LineSpacing = 'compact' | 'normal' | 'relaxed';
export type Margins = 'narrow' | 'normal' | 'wide';
/** 'app' follows the app's light/dark appearance. */
export type ReaderTheme = 'app' | 'light' | 'sepia' | 'dark';
export type ReaderFont = 'sans' | 'serif';

export interface ReaderSettings {
  readerFontSize: number;
  readerLineSpacing: LineSpacing;
  readerMargins: Margins;
  readerTheme: ReaderTheme;
  readerFont: ReaderFont;
  readerKeepAwake: boolean;
}

export const LINE_SPACINGS: LineSpacing[] = ['compact', 'normal', 'relaxed'];
export const MARGINS: Margins[] = ['narrow', 'normal', 'wide'];
export const READER_THEMES: ReaderTheme[] = ['app', 'light', 'sepia', 'dark'];
export const READER_FONTS: ReaderFont[] = ['sans', 'serif'];

export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 30;
export const FONT_SIZE_STEP = 2;

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  readerFontSize: 18,
  readerLineSpacing: 'normal',
  readerMargins: 'normal',
  readerTheme: 'app',
  readerFont: 'sans',
  readerKeepAwake: true,
};

const LINE_HEIGHT: Record<LineSpacing, number> = { compact: 1.4, normal: 1.65, relaxed: 1.9 };
const MARGIN: Record<Margins, number> = { narrow: 12, normal: 24, wide: 40 };

export interface ReaderPalette {
  background: string;
  text: string;
  textMuted: string;
  /** Background of the reader's top and bottom bars. */
  bar: string;
  border: string;
  /** Whether the status bar needs light text. */
  dark: boolean;
}

export const READER_PALETTES: Record<Exclude<ReaderTheme, 'app'>, ReaderPalette> = {
  light: { background: '#FFFFFF', text: '#1B1F24', textMuted: '#6B7280', bar: '#F2F3F5', border: '#D9DCE1', dark: false },
  sepia: { background: '#F4ECD8', text: '#4A3B2C', textMuted: '#87735C', bar: '#EADFC6', border: '#D8C9A8', dark: false },
  dark: { background: '#121417', text: '#D7DADF', textMuted: '#9AA0A6', bar: '#1E2227', border: '#343A42', dark: true },
};

export interface ReaderStyle {
  palette: ReaderPalette;
  fontSize: number;
  lineHeight: number;
  /** Space on the left and right of the text. */
  margin: number;
  /** Platform font family, or undefined for the system default. */
  fontFamily: string | undefined;
}

/** Everything the reader needs to draw text, from the settings. */
export function readerStyle(settings: ReaderSettings, appDark: boolean, platform: string): ReaderStyle {
  const theme = settings.readerTheme === 'app' ? (appDark ? 'dark' : 'light') : settings.readerTheme;
  return {
    palette: READER_PALETTES[theme],
    fontSize: settings.readerFontSize,
    lineHeight: Math.round(settings.readerFontSize * LINE_HEIGHT[settings.readerLineSpacing]),
    margin: MARGIN[settings.readerMargins],
    // Android's "serif" also covers Chinese; iOS falls back to its own CJK font.
    fontFamily: settings.readerFont === 'serif' ? (platform === 'ios' ? 'Georgia' : 'serif') : undefined,
  };
}

export function clampFontSize(size: number): number {
  const stepped = Math.round(size / FONT_SIZE_STEP) * FONT_SIZE_STEP;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, stepped));
}

/** Reads stored setting strings, ignoring anything unknown or out of range. */
export function parseReaderSettings(stored: Record<string, string>): ReaderSettings {
  const d = DEFAULT_READER_SETTINGS;
  const size = Number(stored.readerFontSize);
  return {
    readerFontSize: Number.isFinite(size) && stored.readerFontSize !== '' ? clampFontSize(size) : d.readerFontSize,
    readerLineSpacing: LINE_SPACINGS.find((v) => v === stored.readerLineSpacing) ?? d.readerLineSpacing,
    readerMargins: MARGINS.find((v) => v === stored.readerMargins) ?? d.readerMargins,
    readerTheme: READER_THEMES.find((v) => v === stored.readerTheme) ?? d.readerTheme,
    readerFont: READER_FONTS.find((v) => v === stored.readerFont) ?? d.readerFont,
    readerKeepAwake:
      stored.readerKeepAwake === 'true' ? true : stored.readerKeepAwake === 'false' ? false : d.readerKeepAwake,
  };
}
