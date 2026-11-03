import { translatorFor, type Language, type Translate } from '../i18n';
import type { ShelfKind, ShelfState } from './types';

/** The tags a new shelf of this kind starts its items with. */
export function defaultTagNamesFor(kind: ShelfKind, t: Translate): string[] {
  if (kind === 'novel') return [t('tag.author'), t('tag.description')];
  return [t('tag.date'), t('tag.description')];
}

/** The example shown in an empty tag value, matched to the tag's name. */
export function tagValuePlaceholder(tagName: string, t: Translate): string {
  const name = tagName.trim().toLowerCase();
  if (name === t('tag.author').toLowerCase()) return t('itemEdit.authorPlaceholder');
  if (name === t('tag.description').toLowerCase()) return t('itemEdit.descriptionPlaceholder');
  return t('itemEdit.tagValuePlaceholder');
}

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
      { id: 'books', name: t('defaults.books'), kind: 'novel', defaultTagNames: [t('tag.author'), date, description] },
      { id: 'movies', name: t('defaults.movies'), kind: 'collection', defaultTagNames: [t('tag.director'), date, description] },
      { id: 'manga', name: t('defaults.manga'), kind: 'comic', defaultTagNames: [t('tag.author'), date, description] },
      { id: 'anime', name: t('defaults.anime'), kind: 'collection', defaultTagNames: [t('tag.studio'), date, description] },
      { id: 'music', name: t('defaults.music'), kind: 'music', defaultTagNames: [t('tag.artist'), t('tag.album'), date] },
      { id: 'videos', name: t('defaults.videos'), kind: 'video', defaultTagNames: [date, description] },
    ],
    items: [],
  };
}
