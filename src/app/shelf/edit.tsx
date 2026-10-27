import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { confirm, showMessage } from '@/components/dialogs';
import { NotFound } from '@/components/NotFound';
import { TextField } from '@/components/TextField';
import { addShelf } from '@/models/actions';
import { newId } from '@/models/ids';
import { selectItemsOnShelf } from '@/models/shelfReducer';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
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
  const index = id ? state.shelves.findIndex((s) => s.id === id) : -1;
  const shelf = index === -1 ? undefined : state.shelves[index];

  const [name, setName] = useState(shelf?.name ?? '');
  const [tagNames, setTagNames] = useState<TagNameRow[]>(() =>
    (shelf?.defaultTagNames ?? ['Date', 'Description']).map((n) => ({ key: newId(), name: n })),
  );
  const styles = useStyles();

  if (id && !shelf) return <NotFound what="shelf" />;

  const itemCount = shelf ? selectItemsOnShelf(state, shelf.id).length : 0;

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      showMessage('Please give this shelf a name.');
      return;
    }
    const defaults = tagNames.map((t) => t.name.trim()).filter(Boolean);
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
      items.length === 0 ? 'The shelf is empty.' : `This also deletes its ${items.length} item(s). This cannot be undone.`;
    if (!(await confirm(`Delete shelf “${shelf.name}”?`, message))) return;
    dispatch({ type: 'shelf/remove', shelfId: shelf.id });
    items.forEach((item) => deleteCover(item.coverUri));
    router.back();
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Stack.Screen
        options={{
          title: shelf ? 'Edit shelf' : 'New shelf',
          headerRight: () => <Button title="Save" variant="text" compact onPress={save} />,
        }}
      />

      <View style={styles.section}>
        <Text style={styles.label}>Name</Text>
        <TextField value={name} onChangeText={setName} placeholder="e.g. Funny Videos" autoFocus={!shelf} />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Starting tags</Text>
        <Text style={styles.hint}>New items on this shelf start with these tags. Existing items are not changed.</Text>
        {tagNames.map((row) => (
          <View key={row.key} style={styles.tagRow}>
            <TextField
              value={row.name}
              onChangeText={(text) =>
                setTagNames((rows) => rows.map((r) => (r.key === row.key ? { ...r, name: text } : r)))
              }
              placeholder="Tag name"
              style={styles.tagInput}
            />
            <Button
              title="✕"
              compact
              variant="danger"
              accessibilityLabel={`Remove ${row.name || 'tag'}`}
              onPress={() => setTagNames((rows) => rows.filter((r) => r.key !== row.key))}
            />
          </View>
        ))}
        <Button title="+ Add starting tag" onPress={() => setTagNames((rows) => [...rows, { key: newId(), name: '' }])} />
      </View>

      {shelf && (
        <>
          <View style={styles.section}>
            <Text style={styles.label}>Position</Text>
            <View style={styles.moveRow}>
              <Button
                title="← Move left"
                disabled={index === 0}
                style={styles.moveButton}
                onPress={() => dispatch({ type: 'shelf/move', shelfId: shelf.id, toIndex: index - 1 })}
              />
              <Button
                title="Move right →"
                disabled={index === state.shelves.length - 1}
                style={styles.moveButton}
                onPress={() => dispatch({ type: 'shelf/move', shelfId: shelf.id, toIndex: index + 1 })}
              />
            </View>
          </View>

          <View style={styles.dangerZone}>
            <Button title="Delete shelf" variant="danger" onPress={remove} />
            <Text style={styles.hint}>{itemCount} item(s) on this shelf.</Text>
          </View>
        </>
      )}
    </ScrollView>
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
