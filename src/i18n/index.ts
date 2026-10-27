import { en, type TranslationKey } from './en';
import { zh } from './zh';

export type { TranslationKey } from './en';

/** Languages the app is translated into. */
export type Language = 'en' | 'zh';

export type TranslateParams = Record<string, string | number>;
export type Translate = (key: TranslationKey, params?: TranslateParams) => string;

const dictionaries: Record<Language, Partial<Record<TranslationKey, string>>> = { en, zh };

/**
 * Looks up a key in the given language, falling back to English, and fills in
 * {placeholders}. When params.count is 1 and a `<key>_one` form exists, that is used.
 */
export function translate(language: Language, key: TranslationKey, params?: TranslateParams): string {
  const dictionary = dictionaries[language];
  const singular = `${key}_one` as TranslationKey;
  const useSingular = params?.count === 1 && (singular in dictionary || singular in en);
  const chosen = useSingular ? singular : key;
  const text = dictionary[chosen] ?? dictionary[key] ?? en[chosen] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

const translators = new Map<Language, Translate>();

/** A t() function bound to one language. The same function is returned for the same language. */
export function translatorFor(language: Language): Translate {
  let t = translators.get(language);
  if (!t) {
    t = (key, params) => translate(language, key, params);
    translators.set(language, t);
  }
  return t;
}

/** Picks the app language from a phone language code such as "zh" or "en". */
export function languageFromCode(code: string | null | undefined): Language {
  return code?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
