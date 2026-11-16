import { darkColors, lightColors } from '../src/theme';
import { applyColorChoice, COLOR_SWATCHES, contrast, mix, NO_COLORS, normalizeHex, textOn } from '../src/models/themeColors';

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

describe('colour helpers', () => {
  it('mixes from one colour to the other', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('matches the WCAG contrast extremes', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('picks white text on dark colours and dark text on light ones', () => {
    expect(textOn('#1B2A6B')).toBe('#FFFFFF');
    expect(textOn('#FFE66D')).toBe('#111111');
  });
});

describe('applyColorChoice', () => {
  const modes = [
    ['light', lightColors, false],
    ['dark', darkColors, true],
  ] as const;
  // Every swatch plus colours that are hard to read on one background or the other.
  const colors = [...COLOR_SWATCHES, '#FFFFFF', '#FFFF00', '#000000', '#0000FF'];

  it.each(modes)('leaves the %s theme alone when nothing is chosen', (_name, base, dark) => {
    const result = applyColorChoice(base, dark, NO_COLORS);
    expect(result.colors).toBe(base);
    expect(result.statusBar).toBe(dark ? 'light' : 'dark');
  });

  it.each(modes)('keeps everything readable in %s mode, whatever the colours', (_name, base, dark) => {
    for (const theme of colors) {
      for (const choice of [
        { theme, button: '', tab: '' },
        { theme: '', button: theme, tab: theme },
        { theme, button: '#FFFF00', tab: '#000000' },
      ]) {
        const c = applyColorChoice(base, dark, choice).colors;
        expect(contrast(c.onHeader, c.header)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.headerTint, c.header)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.text, c.background)).toBeGreaterThanOrEqual(7);
        expect(contrast(c.primary, c.background)).toBeGreaterThanOrEqual(3);
        expect(contrast(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.onTabSelected, c.tabSelected)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('colours the header and tints the screens with the theme colour', () => {
    const { colors, statusBar } = applyColorChoice(lightColors, false, { theme: '#16A34A', button: '', tab: '' });
    expect(colors.header).toBe('#16A34A');
    expect(colors.background).not.toBe(lightColors.background);
    expect(statusBar).toBe(textOn('#16A34A') === '#FFFFFF' ? 'light' : 'dark');
  });

  it('gives buttons and the selected tab the theme colour unless they have their own', () => {
    const matched = applyColorChoice(lightColors, false, { theme: '#16A34A', button: '', tab: '' }).colors;
    expect(matched.primary).toBe('#16A34A');
    const own = applyColorChoice(lightColors, false, { theme: '#16A34A', button: '#DC2626', tab: '#7C3AED' }).colors;
    expect(own.primary).toBe('#DC2626');
    expect(own.tabSelected).toBe('#7C3AED');
    expect(own.header).toBe('#16A34A');
  });

  it('keeps the plain header when only buttons are coloured', () => {
    const c = applyColorChoice(lightColors, false, { theme: '', button: '#DC2626', tab: '' }).colors;
    expect(c.header).toBe(lightColors.header);
    expect(c.background).toBe(lightColors.background);
    expect(c.tabSelected).toBe(lightColors.tabSelected);
    expect(c.primary).toBe('#DC2626');
  });
});
