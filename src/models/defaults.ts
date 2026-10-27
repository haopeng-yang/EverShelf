import { translatorFor, type Language } from '../i18n';
import type { ShelfState } from './types';

/**
 * What a brand-new install starts with, named in the given language.
 * Ids are fixed so they stay stable whatever the language.
 */
export function createDefaultState(language: Language = 'en'): ShelfState {
  const t = translatorFor(language);
  const date = t('tag.date');
  const description = t('tag.description');
  return {
    shelves: [
      { id: 'books', name: t('defaults.books'), defaultTagNames: [t('tag.author'), date, description] },
      { id: 'movies', name: t('defaults.movies'), defaultTagNames: [t('tag.director'), date, description] },
      { id: 'manga', name: t('defaults.manga'), defaultTagNames: [t('tag.author'), date, description] },
      { id: 'anime', name: t('defaults.anime'), defaultTagNames: [t('tag.studio'), date, description] },
    ],
    items: [],
  };
}
