import { languageFromCode, translate } from '../src/i18n';
import { en, type TranslationKey } from '../src/i18n/en';
import { zh } from '../src/i18n/zh';
import { createDefaultState } from '../src/models/defaults';

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('translations', () => {
  it('has Chinese for every English key (except singular _one forms)', () => {
    const missing = Object.keys(en).filter((key) => !key.endsWith('_one') && !(key in zh));
    expect(missing).toEqual([]);
  });

  it('keeps the same {placeholders} in Chinese as in English', () => {
    const mismatched = (Object.keys(zh) as TranslationKey[]).filter(
      (key) => JSON.stringify(placeholders(zh[key] ?? '')) !== JSON.stringify(placeholders(en[key])),
    );
    expect(mismatched).toEqual([]);
  });

  it('fills in placeholders and picks the singular form for a count of 1', () => {
    expect(translate('en', 'home.search', { shelf: 'Books' })).toBe('Search Books');
    expect(translate('zh', 'home.search', { shelf: '书籍' })).toBe('搜索书籍');
    expect(translate('en', 'home.results', { count: 1 })).toBe('1 result');
    expect(translate('en', 'home.results', { count: 3 })).toBe('3 results');
    expect(translate('zh', 'home.results', { count: 1 })).toBe('1 个结果');
  });

  it('maps phone language codes to app languages', () => {
    expect(languageFromCode('zh')).toBe('zh');
    expect(languageFromCode('zh-Hant')).toBe('zh');
    expect(languageFromCode('en')).toBe('en');
    expect(languageFromCode('ja')).toBe('en');
    expect(languageFromCode(null)).toBe('en');
  });

  it('names first-run shelves in the phone language, keeping the same ids', () => {
    const english = createDefaultState('en');
    const chinese = createDefaultState('zh');
    expect(chinese.shelves.map((s) => s.name)).toEqual(['书籍', '电影', '漫画', '动画']);
    expect(chinese.shelves[0].defaultTagNames).toEqual(['作者', '日期', '简介']);
    expect(chinese.shelves.map((s) => s.id)).toEqual(english.shelves.map((s) => s.id));
  });
});
