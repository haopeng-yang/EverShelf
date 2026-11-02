import { useT } from '@/i18n/useT';

import { ItemGrid, type ShelfLayoutProps } from './ItemGrid';

/** A shelf of manual entries (Movies, Anime…): tapping an item opens its details. */
export function CollectionShelf({ shelf, query, banner, openDetails, ...grid }: ShelfLayoutProps) {
  const t = useT();
  return (
    <ItemGrid
      {...grid}
      header={banner ?? undefined}
      emptyText={query ? t('home.noMatches', { shelf: shelf.name, query }) : t('home.empty', { shelf: shelf.name })}
      onOpen={openDetails}
    />
  );
}
