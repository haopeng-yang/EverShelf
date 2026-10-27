import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Cover } from '@/components/Cover';
import { confirm, showMessage } from '@/components/dialogs';
import { NotFound } from '@/components/NotFound';
import { TextField } from '@/components/TextField';
import { newItemDraft } from '@/models/actions';
import { newId } from '@/models/ids';
import { moveInArray } from '@/models/shelfReducer';
import type { Id, Item, Tag } from '@/models/types';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { deleteCover, saveCover } from '@/storage/covers';
import { colors, fontSize, radius, spacing } from '@/theme';

/**
 * Add or edit an item. Open with `id` to edit an existing item, or with
 * `shelfId` to add a new one. Changes stay in a local draft until Save.
 */
export default function EditItemScreen() {
  const { id, shelfId } = useLocalSearchParams<{ id?: string; shelfId?: string }>();
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const original = id ? state.items.find((i) => i.id === id) : undefined;
  const shelf = state.shelves.find((s) => s.id === (original?.shelfId ?? shelfId));
  const [draft, setDraft] = useState<Item | null>(() => {
    if (original) return { ...original, tags: original.tags.map((t) => ({ ...t })) };
    return shelf && !id ? newItemDraft(shelf) : null;
  });
  const [saving, setSaving] = useState(false);

  if (!draft || !shelf) return <NotFound what="item" />;

  const update = (changes: Partial<Item>) => setDraft((d) => d && { ...d, ...changes });
  const updateTag = (tagId: Id, changes: Partial<Tag>) =>
    setDraft((d) => d && { ...d, tags: d.tags.map((t) => (t.id === tagId ? { ...t, ...changes } : t)) });
  const removeTag = (tagId: Id) => setDraft((d) => d && { ...d, tags: d.tags.filter((t) => t.id !== tagId) });
  const moveTag = (index: number, delta: number) =>
    setDraft((d) => d && { ...d, tags: moveInArray(d.tags, index, index + delta) });
  const addTag = () => setDraft((d) => d && { ...d, tags: [...d.tags, { id: newId(), name: '', value: '' }] });

  async function pickCover(source: 'library' | 'camera') {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.8,
    };
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        showMessage('EverShelf needs camera access to take a cover photo.');
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    const uri = result.canceled ? undefined : result.assets?.[0]?.uri;
    if (uri) update({ coverUri: uri });
  }

  async function save() {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) {
      showMessage('Please give this item a title.');
      return;
    }
    setSaving(true);
    try {
      // The picked image is only copied into app storage now, so cancelled edits leave no files behind.
      const coverUri =
        draft.coverUri && draft.coverUri !== original?.coverUri ? await saveCover(draft.coverUri) : draft.coverUri;
      const tags = draft.tags
        .filter((t) => t.name.trim())
        .map((t) => ({ ...t, name: t.name.trim(), value: t.value.trim() }));
      const item: Item = { ...draft, title, coverUri, tags };
      const now = Date.now();

      if (original) {
        dispatch({ type: 'item/save', item, now });
        if (original.coverUri !== coverUri) deleteCover(original.coverUri);
      } else {
        dispatch({ type: 'item/add', item: { ...item, createdAt: now, updatedAt: now } });
      }
      router.back();
    } catch (error) {
      setSaving(false);
      showMessage(`Could not save: ${String(error)}`);
    }
  }

  async function remove() {
    if (!original) return;
    if (!(await confirm(`Delete “${original.title}”?`, 'This cannot be undone.'))) return;
    dispatch({ type: 'item/remove', itemId: original.id });
    deleteCover(original.coverUri);
    router.dismissTo('/');
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Stack.Screen
        options={{
          title: original ? 'Edit item' : `New ${shelf.name} item`,
          headerRight: () => <Button title="Save" variant="text" compact disabled={saving} onPress={save} />,
        }}
      />

      <View style={styles.coverRow}>
        <Cover uri={draft.coverUri} title={draft.title || '?'} style={styles.cover} />
        <View style={styles.coverButtons}>
          <Button title="Choose photo" onPress={() => pickCover('library')} />
          {Platform.OS !== 'web' && <Button title="Take photo" onPress={() => pickCover('camera')} />}
          {draft.coverUri && <Button title="Remove cover" variant="danger" onPress={() => update({ coverUri: null })} />}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Title</Text>
        <TextField
          value={draft.title}
          onChangeText={(title) => update({ title })}
          placeholder="e.g. Dune"
          autoFocus={!original}
          returnKeyType="done"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Tags</Text>
        {draft.tags.length === 0 && <Text style={styles.hint}>No tags yet.</Text>}
        {draft.tags.map((tag, index) => (
          <View key={tag.id} style={styles.tag}>
            <View style={styles.tagHeader}>
              <TextField
                value={tag.name}
                onChangeText={(name) => updateTag(tag.id, { name })}
                placeholder="Tag name, e.g. Age Restricted"
                style={styles.tagName}
              />
              <Button
                title="↑"
                compact
                variant="text"
                accessibilityLabel={`Move ${tag.name || 'tag'} up`}
                disabled={index === 0}
                onPress={() => moveTag(index, -1)}
              />
              <Button
                title="↓"
                compact
                variant="text"
                accessibilityLabel={`Move ${tag.name || 'tag'} down`}
                disabled={index === draft.tags.length - 1}
                onPress={() => moveTag(index, 1)}
              />
              <Button
                title="✕"
                compact
                variant="danger"
                accessibilityLabel={`Remove ${tag.name || 'tag'}`}
                onPress={() => removeTag(tag.id)}
              />
            </View>
            <TextField
              value={tag.value}
              onChangeText={(value) => updateTag(tag.id, { value })}
              placeholder="Value, e.g. Recommended 15+"
              multiline
            />
          </View>
        ))}
        <Button title="+ Add tag" onPress={addTag} />
        <Text style={styles.hint}>Tags without a name are not saved.</Text>
      </View>

      {original && <Button title="Delete item" variant="danger" onPress={remove} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xl * 2 },
  coverRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  cover: { width: 120 },
  coverButtons: { flex: 1, gap: spacing.sm },
  section: { gap: spacing.sm },
  label: { fontSize: fontSize.small, color: colors.textMuted, fontWeight: '600' },
  hint: { fontSize: fontSize.small, color: colors.textMuted },
  tag: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  tagHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tagName: { flex: 1, fontWeight: '600' },
});
