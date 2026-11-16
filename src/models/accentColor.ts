// Turns the user's favourite colour into the theme's accent colours, adjusted
// so text and icons drawn in it stay readable on light and dark backgrounds.
// Pure functions, no React Native, so they can be unit tested.

/** The colours an accent touches. Every other theme colour stays as it is. */
export interface AccentPalette {
  primary: string;
  onPrimary: string;
  tabSelected: string;
  onTabSelected: string;
  headerTint: string;
}

/** Ready-made choices shown above the colour panel. The first is the app's own blue. */
export const ACCENT_SWATCHES = [
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

/**
 * Darkens (on a light background) or lightens (on a dark one) `color` just
 * enough to reach `ratio` against `background`, keeping its hue.
 */
function readableOn(color: string, background: string, ratio: number): string {
  const towards = luminance(background) > 0.5 ? '#000000' : '#FFFFFF';
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, towards, step / 20);
    if (contrast(candidate, background) >= ratio) return candidate;
  }
  return towards;
}

/** Accent colours for `accent` on a theme whose screens use `background`. */
export function accentPalette(accent: string, background: string, dark: boolean): AccentPalette {
  // Buttons, switches and icons need 3:1 against the screen; text in the accent needs 4.5:1.
  const primary = readableOn(accent, background, 3);
  const onPrimary = contrast('#FFFFFF', primary) >= contrast('#111111', primary) ? '#FFFFFF' : '#111111';
  // A soft wash of the colour behind the selected shelf tab or option.
  const tabSelected = mix(background, accent, dark ? 0.3 : 0.15);
  return {
    primary,
    onPrimary,
    tabSelected,
    onTabSelected: readableOn(accent, tabSelected, 4.5),
    headerTint: readableOn(accent, background, 4.5),
  };
}
