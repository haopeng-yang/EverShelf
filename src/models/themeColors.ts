// Turns the user's chosen colours into theme colours: a theme colour that
// tints the header and backgrounds, and button and selected-tab colours that
// follow it unless the user picked their own. Everything is adjusted so text
// and icons stay readable in light and dark mode.
// Pure functions, no React Native, so they can be unit tested.

/** A theme's colours, by name, as in theme.tsx. */
export type ColorSet = Record<string, string>;

/** The user's colour choices, each '#RRGGBB' or '' (theme: no tint; button and tab: match the theme). */
export interface ColorChoice {
  theme: string;
  button: string;
  tab: string;
}

export const NO_COLORS: ColorChoice = { theme: '', button: '', tab: '' };

/** Ready-made choices shown above the colour panel. The first is the app's own blue. */
export const COLOR_SWATCHES = [
  '#2F6FEB',
  '#4F46E5',
  '#7C3AED',
  '#DB2777',
  '#DC2626',
  '#EA580C',
  '#D97706',
  '#16A34A',
  '#0D9488',
  '#0891B2',
  '#475569',
  '#8B5E3C',
];

const HEX = /^#[0-9a-f]{6}$/i;

/** '#2f6feb' → '#2F6FEB'; anything that isn't a 6-digit hex colour → null. */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  return HEX.test(trimmed) ? trimmed.toUpperCase() : null;
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** `amount` of `b` mixed into `a`: 0 is all `a`, 1 is all `b`. */
export function mix(a: string, b: string, amount: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as Rgb);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#FFFFFF';
const INK = '#111111';

/** White or near-black, whichever reads better on `background`. */
export function textOn(background: string): string {
  return contrast(WHITE, background) >= contrast(INK, background) ? WHITE : INK;
}

/**
 * Darkens (on a light background) or lightens (on a dark one) `color` just
 * enough to reach `ratio` against `background`, keeping its hue.
 */
function readableOn(color: string, background: string, ratio: number): string {
  const towards = luminance(background) > 0.5 ? '#000000' : WHITE;
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, towards, step / 20);
    if (contrast(candidate, background) >= ratio) return candidate;
  }
  return towards;
}

/**
 * The theme's colours with the user's choices applied. With nothing chosen it
 * returns `base` itself. `statusBar` is the icon colour over the header.
 */
export function applyColorChoice<C extends ColorSet>(
  base: C,
  dark: boolean,
  choice: ColorChoice,
): { colors: C; statusBar: 'light' | 'dark' } {
  const defaultStatusBar = dark ? 'light' : 'dark';
  if (!choice.theme && !choice.button && !choice.tab) return { colors: base, statusBar: defaultStatusBar };
  const c: ColorSet = { ...base };

  if (choice.theme) {
    const t = choice.theme;
    // Light: the header in the colour itself, on screens with a faint wash of it.
    // Dark: a deep shade of it in the header, the same faint wash below.
    c.header = dark ? mix(base.background, t, 0.55) : t;
    c.onHeader = textOn(c.header);
    c.headerTint = c.onHeader;
    c.background = mix(base.background, t, dark ? 0.08 : 0.05);
    c.surface = mix(base.surface, t, dark ? 0.14 : 0.1);
    c.card = dark ? c.background : mix(base.card, t, 0.03);
    c.border = mix(base.border, t, 0.25);
    c.coverPlaceholder = mix(base.coverPlaceholder, t, 0.35);
    c.tabSelected = mix(c.background, t, dark ? 0.3 : 0.15);
    c.onTabSelected = readableOn(t, c.tabSelected, 4.5);
  }

  const button = choice.button || choice.theme;
  if (button) {
    // Buttons, switches and icons need 3:1 against the screen.
    c.primary = readableOn(button, c.background, 3);
    c.onPrimary = textOn(c.primary);
    // With a plain header, its buttons take the button colour, as text needs 4.5:1.
    if (!choice.theme) c.headerTint = readableOn(button, c.header, 4.5);
  }

  if (choice.tab) {
    // A colour picked for the selected tab fills it.
    c.tabSelected = choice.tab;
    c.onTabSelected = textOn(choice.tab);
  }

  return { colors: c as C, statusBar: textOn(c.header) === WHITE ? 'light' : 'dark' };
}
