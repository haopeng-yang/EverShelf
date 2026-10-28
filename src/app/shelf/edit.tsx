import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Button } from '@/components/Button';
import { confirm, showMessage } from '@/components/dialogs';
import { NotFound } from '@/components/NotFound';
import { TextField } from '@/components/TextField';
import { useT } from '@/i18n/useT';
import { addShelf } from '@/models/actions';
import { newId } from '@/models/ids';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { deleteBookFiles } from '@/storage/bookFiles';
import { deleteCover } from '@/storage/covers';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

/** Starting tags are edited as rows with ids so React keeps inputs stable while typing. */
interface TagNameRow {
  key: string;
  name: string;
}

/** Add a shelf (no params) or edit one (`id`): name, starting tags, position, delete. */
export default function EditShelfScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const t = useT();
  const index = id ? state.shelves.findIndex((s) => s.id === id) : -1;
  const shelf = index === -1 ? undefined : state.shelves[index];

  const [name, setName] = useState(shelf?.name ?? '');
  const [tagNames, setTagNames] = useState<TagNameRow[]>(() =>
    (shelf?.defaultTagNames ?? [t('tag.date'), t('tag.description')]).map((n) => ({ key: newId(), name: n })),
  );
  const styles = useStyles();

  if (id && !shelf) return <NotFound what="shelf" />;

  const itemCount = shelf ? selectItemsOnShelf(state, shelf.id).length : 0;

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      showMessage(t('shelfEdit.needName'));
      return;
    }
    const defaults = tagNames.map((row) => row.name.trim()).filter(Boolean);
    if (shelf) {
      dispatch({ type: 'shelf/rename', shelfId: shelf.id, name: trimmed });
      dispatch({ type: 'shelf/setDefaultTags', shelfId: shelf.id, defaultTagNames: defaults });
    } else {
      dispatch(addShelf(trimmed, defaults));
    }
    router.back();
  }

  async function remove() {
    if (!shelf) return;
    const items = selectItemsOnShelf(state, shelf.id);
    const message =
      items.length === 0 ? t('shelfEdit.deleteEmpty') : t('shelfEdit.deleteWithItems', { count: items.length });
    const ok = await confirm(
      t('shelfEdit.deleteConfirm', { name: shelf.name }),
      message,
      t('common.delete'),
      t('common.cancel'),
    );
    if (!ok) return;
    dispatch({ type: 'shelf/remove', shelfId: shelf.id });
    items.forEach((item) => {
      deleteCover(item.coverUri);
      deleteBookFiles(item.id);
    });
    router.back();
  }

  return (
    <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={spacing.xl}>
      <Stack.Screen
        options={{
          title: shelf ? t('shelfEdit.editTitle') : t('shelfEdit.newTitle'),
          headerRight: () => <Button title={t('common.save')} variant="text" compact onPress={save} />,
        }}
      />

      <View style={styles.section}>
        <Text style={styles.label}>{t('shelfEdit.name')}</Text>
        <TextField
          value={name}
          onChangeText={setName}
          placeholder={t('shelfEdit.namePlaceholder')}
          autoFocus={!shelf}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('shelfEdit.startingTags')}</Text>
        <Text style={styles.hint}>{t('shelfEdit.startingTagsHint')}</Text>
        {tagNames.map((row) => (
          <View key={row.key} style={styles.tagRow}>
            <TextField
              value={row.name}
              onChangeText={(text) =>
                setTagNames((rows) => rows.map((r) => (r.key === row.key ? { ...r, name: text } : r)))
              }
              placeholder={t('shelfEdit.tagName')}
              style={styles.tagInput}
            />
            <Button
              title="✕"
              compact
              variant="danger"
              accessibilityLabel={t('itemEdit.remove', { name: row.name || t('common.tag') })}
              onPress={() => setTagNames((rows) => rows.filter((r) => r.key !== row.key))}
            />
          </View>
        ))}
        <Button
          title={t('shelfEdit.addStartingTag')}
          onPress={() => setTagNames((rows) => [...rows, { key: newId(), name: '' }])}
        />
      </View>

      {shelf && (
        <>
          <View style={styles.section}>
            <Text style={styles.label}>{t('shelfEdit.position')}</Text>
            <View style={styles.moveRow}>
              <Button
                title={t('shelfEdit.moveLeft')}
                disabled={index === 0}
                style={styles.moveButton}
                onPress={() => dispatch({ type: 'shelf/move', shelfId: shelf.id, toIndex: index - 1 })}
              />
              <Button
                title={t('shelfEdit.moveRight')}
                disabled={index === state.shelves.length - 1}
                style={styles.moveButton}
                onPress={() => dispatch({ type: 'shelf/move', shelfId: shelf.id, toIndex: index + 1 })}
              />
            </View>
          </View>

          <View style={styles.dangerZone}>
            <Button title={t('shelfEdit.deleteShelf')} variant="danger" onPress={remove} />
            <Text style={styles.hint}>{t('shelfEdit.itemCount', { count: itemCount })}</Text>
          </View>
        </>
      )}
    </KeyboardAwareScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xl * 2 },
  section: { gap: spacing.sm },
  label: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  hint: { fontSize: fontSize.small, color: c.textMuted },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tagInput: { flex: 1 },
  moveRow: { flexDirection: 'row', gap: spacing.sm },
  moveButton: { flex: 1 },
  dangerZone: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
  },
}));
