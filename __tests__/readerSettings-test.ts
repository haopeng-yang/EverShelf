import {
  DEFAULT_READER_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  READER_PALETTES,
  clampFontSize,
  parseReaderSettings,
  readerStyle,
} from '../src/models/readerSettings';

describe('parseReaderSettings', () => {
  it('uses the defaults when nothing is stored', () => {
    expect(parseReaderSettings({})).toEqual(DEFAULT_READER_SETTINGS);
  });

  it('reads stored values back from text', () => {
    expect(
      parseReaderSettings({
        readerFontSize: '24',
        readerLineSpacing: 'relaxed',
        readerMargins: 'wide',
        readerTheme: 'sepia',
        readerFont: 'serif',
        readerKeepAwake: 'false',
      }),
    ).toEqual({
      readerFontSize: 24,
      readerLineSpacing: 'relaxed',
      readerMargins: 'wide',
      readerTheme: 'sepia',
      readerFont: 'serif',
      readerKeepAwake: false,
    });
  });

  it('ignores unknown or out-of-range values', () => {
    const parsed = parseReaderSettings({
      readerFontSize: 'huge',
      readerLineSpacing: 'double',
      readerTheme: 'neon',
      readerKeepAwake: 'maybe',
    });
    expect(parsed).toEqual(DEFAULT_READER_SETTINGS);
    expect(parseReaderSettings({ readerFontSize: '999' }).readerFontSize).toBe(FONT_SIZE_MAX);
    expect(parseReaderSettings({ readerFontSize: '' }).readerFontSize).toBe(DEFAULT_READER_SETTINGS.readerFontSize);
  });
});

describe('clampFontSize', () => {
  it('keeps sizes on the step and within range', () => {
    expect(clampFontSize(19)).toBe(20);
    expect(clampFontSize(2)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(100)).toBe(FONT_SIZE_MAX);
  });
});

describe('readerStyle', () => {
  it('follows the app appearance on the "app" theme', () => {
    expect(readerStyle(DEFAULT_READER_SETTINGS, true, 'android').palette).toBe(READER_PALETTES.dark);
    expect(readerStyle(DEFAULT_READER_SETTINGS, false, 'android').palette).toBe(READER_PALETTES.light);
  });

  it('uses a fixed palette otherwise, and works out sizes and fonts', () => {
    const style = readerStyle(
      { ...DEFAULT_READER_SETTINGS, readerTheme: 'sepia', readerFontSize: 20, readerLineSpacing: 'relaxed', readerFont: 'serif' },
      true,
      'android',
    );
    expect(style.palette).toBe(READER_PALETTES.sepia);
    expect(style.lineHeight).toBe(38);
    expect(style.fontFamily).toBe('serif');
    expect(readerStyle({ ...DEFAULT_READER_SETTINGS, readerFont: 'serif' }, false, 'ios').fontFamily).toBe('Georgia');
    expect(readerStyle(DEFAULT_READER_SETTINGS, false, 'ios').fontFamily).toBeUndefined();
  });
});
