import { router } from 'expo-router';
import { useMemo } from 'react';

import { useT } from '@/i18n/useT';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import type { Item } from '@/models/types';
import { useSettings } from '@/state/SettingsProvider';
import { useShelfState } from '@/state/ShelfProvider';

import { ContinueReadingRow } from '../ContinueReadingRow';
import { ItemGrid, type ShelfLayoutProps } from './ItemGrid';

const CONTINUE_READING_MAX = 10;

/**
 * A novel or comic shelf, laid out for reading: "Continue reading" on top, and
 * tapping a book opens it in the reader. Entries without a file, and books
 * from the selection bar's Details button, open their details instead.
 */
export function ReadingShelf({ shelf, query, banner, openDetails, ...grid }: ShelfLayoutProps) {
  const t = useT();
  const state = useShelfState();
  const { settings } = useSettings();
  const { books } = grid;

  const continueReading = useMemo(
    () =>
      selectItemsOnShelf(state, shelf.id)
        .flatMap((item) => {
          const book = books.get(item.id);
          return book && book.lastReadAt !== null && !book.finished ? [{ item, book, at: book.lastReadAt }] : [];
        })
        .sort((a, b) => b.at - a.at)
        .slice(0, CONTINUE_READING_MAX),
    [state, shelf.id, books],
  );

  const read = (item: Item) => router.push({ pathname: '/read/[itemId]', params: { itemId: item.id } });
  const emptyKey = shelf.kind === 'comic' ? 'home.emptyReading.comic' : 'home.emptyReading.novel';

  return (
    <ItemGrid
      {...grid}
      header={
        <>
          {banner}
          {!query && settings.showContinueReading && <ContinueReadingRow books={continueReading} onOpen={read} />}
        </>
      }
      emptyText={query ? t('home.noMatches', { shelf: shelf.name, query }) : t(emptyKey, { shelf: shelf.name })}
      onOpen={(item) => (books.has(item.id) ? read(item) : openDetails(item))}
    />
  );
}
