import { useLocales } from 'expo-localization';

import { useSettings } from '@/state/SettingsProvider';

import { languageFromCode, translatorFor, type Language, type Translate } from './index';

/** The language the app is showing: the Language setting, or the phone's language on "System". */
export function useLanguage(): Language {
  const { settings } = useSettings();
  const locales = useLocales();
  return settings.language === 'system' ? languageFromCode(locales[0]?.languageCode) : settings.language;
}

/** Returns t(key, params) for the current language, e.g. t('home.search', { shelf: 'Books' }). */
export function useT(): Translate {
  return translatorFor(useLanguage());
}
