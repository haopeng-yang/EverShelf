import { ACCENT_SWATCHES, accentPalette, contrast, mix, normalizeHex } from '../src/models/accentColor';

const LIGHT_BG = '#FFFFFF';
const DARK_BG = '#121417';

describe('normalizeHex', () => {
  it('accepts 6-digit hex colours and upper-cases them', () => {
    expect(normalizeHex('#2f6feb')).toBe('#2F6FEB');
    expect(normalizeHex(' #ABCDEF ')).toBe('#ABCDEF');
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'red', '#FFF', '2F6FEB', '#2F6FEBFF', '#GGGGGG']) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });
});

describe('mix', () => {
  it('goes from one colour to the other', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

describe('accentPalette', () => {
  // Every swatch plus colours that are hard to read on one background or the other.
  const accents = [...ACCENT_SWATCHES, '#FFFFFF', '#FFFF00', '#000000', '#0000FF'];

  it.each(accents)('keeps %s readable on light and dark screens', (accent) => {
    for (const [bg, dark] of [
      [LIGHT_BG, false],
      [DARK_BG, true],
    ] as const) {
      const p = accentPalette(accent, bg, dark);
      expect(contrast(p.primary, bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(p.headerTint, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onTabSelected, p.tabSelected)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('leaves a colour that is already readable as it is', () => {
    expect(accentPalette('#2F6FEB', LIGHT_BG, false).primary).toBe('#2F6FEB');
  });

  it('darkens a pale colour on a light screen and lightens a deep one on a dark screen', () => {
    expect(accentPalette('#FFFF00', LIGHT_BG, false).primary).not.toBe('#FFFF00');
    expect(accentPalette('#000080', DARK_BG, true).primary).not.toBe('#000080');
  });
});
