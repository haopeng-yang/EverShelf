import { Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { BackHandler, Platform, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { LockedShelf } from '@/components/LockedShelf';
import { OptionSheet } from '@/components/OptionSheet';
import { ShelfTabs } from '@/components/ShelfTabs';
import { CollectionShelf } from '@/components/shelf/CollectionShelf';
import type { ShelfLayoutProps } from '@/components/shelf/ItemGrid';
import { MusicShelf } from '@/components/shelf/MusicShelf';
import { ReadingShelf } from '@/components/shelf/ReadingShelf';
import { VideoShelf } from '@/components/shelf/VideoShelf';
import { TextField } from '@/components/TextField';
import { confirm, showMessage } from '@/components/dialogs';
import { useT } from '@/i18n/useT';
import { SORT_ORDERS, filterItems, sortItems } from '@/models/query';
import { misplacedItems, moveTargets } from '@/models/shelfKinds';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import type { BookSummary, FileKind, Id, Item, ShelfKind } from '@/models/types';
import { useSettings } from '@/state/SettingsProvider';
import { useShelfLocks } from '@/state/ShelfLockProvider';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { loadBookSummaries, loadFileKinds } from '@/storage/database';
import { deleteItemFiles } from '@/storage/shelfFiles';
import { fontSize, makeStyles, radius, raisedShadow, spacing } from '@/theme';

/** How each kind of shelf looks when it's opened. */
const LAYOUTS: Record<ShelfKind, (props: ShelfLayoutProps) => ReactElement> = {
  collection: CollectionShelf,
  novel: ReadingShelf,
  comic: ReadingShelf,
  music: MusicShelf,
  video: VideoShelf,
};

export default function ShelvesScreen() {
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const { settings, setSetting } = useSettings();
  const styles = useStyles();
  const t = useT();
  const sortOptions = SORT_ORDERS.map((value) => ({ value, label: t(`sort.${value}`) }));
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<Id | undefined>(state.shelves[0]?.id);
  const [query, setQuery] = useState('');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [moveSheetOpen, setMoveSheetOpen] = useState(false);
  // Ids picked by long pressing, and the shelf they were picked on. Null when not selecting.
  const [picked, setPicked] = useState<{ shelfId: Id; ids: Set<Id> } | null>(null);

  // When a shelf is added (always at the end), switch to it.
  const shelfCount = useRef(state.shelves.length);
  useEffect(() => {
    if (state.shelves.length > shelfCount.current) setSelectedId(state.shelves.at(-1)?.id);
    shelfCount.current = state.shelves.length;
  }, [state.shelves]);

  // Falls back to the first shelf if the selected one was deleted.
  const shelf = state.shelves.find((s) => s.id === selectedId) ?? state.shelves[0];
  const { isLocked, lock } = useShelfLocks();
  // Reading progress of imported books, reloaded whenever the shelf comes back into view.
  const db = useSQLiteContext();
  const [books, setBooks] = useState<Map<Id, BookSummary>>(new Map());
  // What kind of file each item is, for the shelf-kind checks.
  const [fileKinds, setFileKinds] = useState<Map<Id, FileKind>>(new Map());
  useFocusEffect(
    useCallback(() => {
      let current = true;
      Promise.all([loadBookSummaries(db), loadFileKinds(db)])
        .then(([loadedBooks, loadedKinds]) => {
          if (!current) return;
          setBooks(loadedBooks);
          setFileKinds(loadedKinds);
        })
        .catch((error: unknown) => console.warn('Could not load reading progress', error));
      return () => {
        current = false;
      };
    }, [db]),
  );

  const items = useMemo(() => {
    if (!shelf) return [];
    const lastRead = new Map([...books].map(([id, book]) => [id, book.lastReadAt]));
    return sortItems(filterItems(selectItemsOnShelf(state, shelf.id), query), settings.sortOrder, lastRead);
  }, [state, shelf, query, settings.sortOrder, books]);
  const searching = query.trim() !== '';

  // Files that don't fit this shelf's kind, left here by an upgrade or a restore.
  const misplaced = useMemo(
    () => (shelf ? misplacedItems(shelf, selectItemsOnShelf(state, shelf.id), fileKinds) : []),
    [state, shelf, fileKinds],
  );
  const misplacedIds = useMemo(() => new Set(misplaced.map((i) => i.id)), [misplaced]);

  const listView = settings.viewMode === 'list';

  const openDetails = (item: Item) => router.push({ pathname: '/item/[id]', params: { id: item.id } });
  const editShelf = (shelfId: Id) => router.push({ pathname: '/shelf/edit', params: { id: shelfId } });

  // Switching to another shelf or locking this one ends selection mode.
  const shelfId = shelf?.id;
  const selection = shelf && picked?.shelfId === shelf.id && !isLocked(shelf) ? picked.ids : null;
  const selecting = selection !== null;
  const clearSelection = () => setPicked(null);
  // Only items still on this shelf, so a deleted or moved item never lingers in the selection.
  const selectedItems = useMemo(
    () => (shelfId && selection ? selectItemsOnShelf(state, shelfId).filter((i) => selection.has(i.id)) : []),
    [state, shelfId, selection],
  );

  // Android's back button leaves selection mode instead of the screen.
  useEffect(() => {
    if (!selecting) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setPicked(null);
      return true;
    });
    return () => subscription.remove();
  }, [selecting]);

  const startSelection = (id: Id) => {
    if (shelfId) setPicked({ shelfId, ids: new Set([id]) });
  };
  const toggleSelected = (id: Id) =>
    setPicked((current) => {
      if (!current) return current;
      const ids = new Set(current.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      // Unpicking the last item leaves selection mode.
      return ids.size === 0 ? null : { ...current, ids };
    });

  // On a reading, music or video shelf, tapping a book opens the reader and a song or video plays, so their details are reached from here.
  const detailsItem =
    shelf && shelf.kind !== 'collection' && selectedItems.length === 1 && fileKinds.has(selectedItems[0].id)
      ? selectedItems[0]
      : null;
  // The selection bar splits its width evenly between its buttons, whatever their labels. (flex: 1
  // let long labels push the others aside on Android, squeezing "Details" and "Cancel" to one letter a line.)
  const barButtons = detailsItem ? 4 : 3;
  const selectionButtonStyle = [
    styles.selectionButton,
    { width: (width - spacing.lg * 2 - spacing.sm * (barButtons - 1)) / barButtons },
  ];
  // The bottom bar's three buttons share its width the same way.
  const bottomButtonStyle = [styles.selectionButton, { width: (width - spacing.lg * 2 - spacing.sm * 2) / 3 }];

  async function deleteSelected() {
    const picked = selectedItems;
    if (picked.length === 0) return;
    const ok = await confirm(
      t('select.deleteConfirm', { count: picked.length, title: picked[0].title }),
      t('common.cannotUndo'),
      t('common.delete'),
      t('common.cancel'),
    );
    if (!ok) return;
    for (const item of picked) void dispatch({ type: 'item/remove', itemId: item.id });
    deleteItemFiles(picked);
    clearSelection();
  }

  /** Opens the Move sheet for `items`, or explains why no shelf can take them all. */
  function openMoveSheet(items: Item[]) {
    if (!shelfId) return;
    if (moveTargets(state.shelves, shelfId, items, fileKinds).length === 0) showMessage(t('select.moveNowhere'));
    else setMoveSheetOpen(true);
  }

  /** "Move them" on the banner: select every misplaced item and offer where to move them. */
  function moveMisplaced() {
    if (!shelfId || misplaced.length === 0) return;
    setPicked({ shelfId, ids: new Set(misplaced.map((i) => i.id)) });
    openMoveSheet(misplaced);
  }

  function moveSelected(toShelfId: Id) {
    if (toShelfId === shelfId) return;
    for (const item of selectedItems) void dispatch({ type: 'item/move', itemId: item.id, shelfId: toShelfId });
    clearSelection();
  }

  const Layout = shelf ? LAYOUTS[shelf.kind] : CollectionShelf;

  return (
    <View style={styles.container}>
      {/* No title bar: the shelf tabs sit at the top, and long pressing one edits that shelf. */}
      <Stack.Screen options={{ headerShown: false, title: 'EverShelf' }} />

      <View style={{ paddingTop: insets.top }}>
        <ShelfTabs
          shelves={state.shelves}
          selectedId={shelf?.id}
          onSelect={setSelectedId}
          onEditShelf={editShelf}
          onAddShelf={() => router.push('/shelf/edit')}
        />
      </View>

      {!shelf ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t('home.noShelves')}</Text>
          <Button title={t('home.addShelf')} variant="primary" onPress={() => router.push('/shelf/edit')} />
        </View>
      ) : isLocked(shelf) ? (
        <LockedShelf shelf={shelf} />
      ) : (
        <>
          <View style={styles.toolbar}>
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder={t('home.search', { shelf: shelf.name })}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              style={styles.search}
              accessibilityLabel={t('home.searchLabel')}
            />
            <Button
              title={`↕ ${t(`sortShort.${settings.sortOrder}`)}`}
              compact
              accessibilityLabel={t('home.sortLabel', { sort: t(`sort.${settings.sortOrder}`) })}
              onPress={() => setSortSheetOpen(true)}
              style={styles.toolbarButton}
            />
            <Button
              title={listView ? '▦' : '☰'}
              compact
              accessibilityLabel={listView ? t('home.showGrid') : t('home.showList')}
              onPress={() => setSetting('viewMode', listView ? 'grid' : 'list')}
              style={styles.toolbarButton}
            />
            {shelf.lock && (
              <Button
                title="🔒"
                compact
                accessibilityLabel={t('home.lockNow', { shelf: shelf.name })}
                onPress={() => {
                  setQuery('');
                  lock(shelf.id);
                }}
                style={styles.toolbarButton}
              />
            )}
          </View>
          {searching && (
            <View style={styles.resultsRow}>
              <Text style={styles.resultsText}>{t('home.results', { count: items.length })}</Text>
              <Button title={t('common.clear')} variant="text" compact onPress={() => setQuery('')} />
            </View>
          )}

          <Layout
            shelf={shelf}
            items={items}
            books={books}
            query={query.trim()}
            selection={selection}
            misplacedIds={misplacedIds}
            banner={
              misplaced.length > 0 && !searching && !selecting ? (
                <View style={styles.banner}>
                  <Text style={styles.bannerText}>
                    {t('home.misplaced', { count: misplaced.length, kind: t(`shelfKind.${shelf.kind}`) })}
                  </Text>
                  <Button
                    title={t('home.misplacedMove', { count: misplaced.length })}
                    variant="primary"
                    compact
                    onPress={moveMisplaced}
                  />
                </View>
              ) : null
            }
            onStartSelection={startSelection}
            onToggleSelected={toggleSelected}
            openDetails={openDetails}
          />
          {selecting && (
            <View style={[styles.selectionBar, { paddingBottom: insets.bottom + spacing.md }]}>
              <Text style={styles.selectionCount}>{t('select.count', { count: selectedItems.length })}</Text>
              <View style={styles.selectionButtons}>
              <Button
                title={t('common.delete')}
                variant="danger"
                style={selectionButtonStyle}
                onPress={() => void deleteSelected()}
              />
              <Button
                title={t('select.move')}
                variant="primary"
                disabled={state.shelves.length < 2}
                style={selectionButtonStyle}
                onPress={() => openMoveSheet(selectedItems)}
              />
              {detailsItem && (
                <Button title={t('select.details')} style={selectionButtonStyle} onPress={() => openDetails(detailsItem)} />
              )}
              <Button title={t('common.cancel')} style={selectionButtonStyle} onPress={clearSelection} />
              </View>
            </View>
          )}
        </>
      )}

      {/* Always there, even with no shelves or a locked one, so Settings can be reached. Selection mode has its own bar. */}
      {!selecting && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          {/* Book files are stored on the device, which the web version can't do. Collections have nothing to import. */}
          {shelf && Platform.OS !== 'web' && shelf.kind !== 'collection' ? (
            <Button
              title={t(`home.import.${shelf.kind}`)}
              icon="download"
              accessibilityLabel={t(`home.importTo.${shelf.kind}`, { shelf: shelf.name })}
              disabled={isLocked(shelf)}
              style={bottomButtonStyle}
              onPress={() => router.push({ pathname: '/import', params: { shelfId: shelf.id } })}
            />
          ) : (
            <Button title={t('home.import')} icon="download" disabled style={bottomButtonStyle} onPress={() => {}} />
          )}
          <Button
            title={t('home.addItem')}
            variant="primary"
            accessibilityLabel={shelf ? t('home.addItemTo', { shelf: shelf.name }) : undefined}
            disabled={!shelf || isLocked(shelf)}
            style={bottomButtonStyle}
            onPress={() => shelf && router.push({ pathname: '/item/edit', params: { shelfId: shelf.id } })}
          />
          <Button title={t('home.settings')} icon="settings" style={bottomButtonStyle} onPress={() => router.push('/settings')} />
        </View>
      )}

      {shelf && (
        <OptionSheet
          visible={moveSheetOpen}
          title={t('select.moveTitle', { count: selectedItems.length })}
          options={moveTargets(state.shelves, shelf.id, selectedItems, fileKinds).map((s) => ({
            value: s.id,
            label: s.lock ? `🔒 ${s.name}` : s.name,
          }))}
          selected={shelf.id}
          onSelect={moveSelected}
          onClose={() => setMoveSheetOpen(false)}
        />
      )}

      <OptionSheet
        visible={sortSheetOpen}
        title={t('home.sortTitle')}
        options={sortOptions}
        selected={settings.sortOrder}
        onSelect={(order) => setSetting('sortOrder', order)}
        onClose={() => setSortSheetOpen(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((c, look) => ({
  container: { flex: 1, backgroundColor: c.background },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  search: { flex: 1, minWidth: 0 },
  toolbarButton: { paddingVertical: spacing.sm },
  resultsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  resultsText: { fontSize: fontSize.small, color: c.textMuted },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  emptyText: { fontSize: fontSize.body, color: c.textMuted, textAlign: 'center', marginTop: spacing.xl },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: c.surface,
  },
  bannerText: { flex: 1, fontSize: fontSize.small, color: c.text },
  selectionBar: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.background,
  },
  selectionCount: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600', textAlign: 'center' },
  selectionButtons: { flexDirection: 'row', gap: spacing.sm },
  selectionButton: { paddingHorizontal: spacing.xs },
  // The raised look floats the bar on a white card with rounded top corners.
  bottomBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: look.raised ? c.card : c.background,
    ...(look.raised
      ? { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, ...raisedShadow(c, look) }
      : { borderTopWidth: 1, borderTopColor: c.border }),
  },
}));
