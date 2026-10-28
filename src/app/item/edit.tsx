import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Button } from '@/components/Button';
import { Cover } from '@/components/Cover';
import { confirm, showMessage } from '@/components/dialogs';
import { NotFound } from '@/components/NotFound';
import { TextField } from '@/components/TextField';
import { useT } from '@/i18n/useT';
import { newItemDraft } from '@/models/actions';
import { newId } from '@/models/ids';
import { moveInArray } from '@/models/shelfReducer';
import type { Id, Item, Tag } from '@/models/types';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { deleteCover, saveCover } from '@/storage/covers';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

/**
 * Add or edit an item. Open with `id` to edit an existing item, or with
 * `shelfId` to add a new one. Changes stay in a local draft until Save.
 */
export default function EditItemScreen() {
  const { id, shelfId } = useLocalSearchParams<{ id?: string; shelfId?: string }>();
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const t = useT();
  const original = id ? state.items.find((i) => i.id === id) : undefined;
  const shelf = state.shelves.find((s) => s.id === (original?.shelfId ?? shelfId));
  const [draft, setDraft] = useState<Item | null>(() => {
    if (original) return { ...original, tags: original.tags.map((tag) => ({ ...tag })) };
    return shelf && !id ? newItemDraft(shelf) : null;
  });
  const [saving, setSaving] = useState(false);
  const styles = useStyles();

  if (!draft || !shelf) return <NotFound what="item" />;

  const update = (changes: Partial<Item>) => setDraft((d) => d && { ...d, ...changes });
  const updateTag = (tagId: Id, changes: Partial<Tag>) =>
    setDraft((d) => d && { ...d, tags: d.tags.map((tag) => (tag.id === tagId ? { ...tag, ...changes } : tag)) });
  const removeTag = (tagId: Id) => setDraft((d) => d && { ...d, tags: d.tags.filter((tag) => tag.id !== tagId) });
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
        showMessage(t('itemEdit.cameraPermission'));
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
      showMessage(t('itemEdit.needTitle'));
      return;
    }
    setSaving(true);
    try {
      // The picked image is only copied into app storage now, so cancelled edits leave no files behind.
      const coverUri =
        draft.coverUri && draft.coverUri !== original?.coverUri ? await saveCover(draft.coverUri) : draft.coverUri;
      const tags = draft.tags
        .filter((tag) => tag.name.trim())
        .map((tag) => ({ ...tag, name: tag.name.trim(), value: tag.value.trim() }));
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
      showMessage(t('itemEdit.saveFailed', { error: String(error) }));
    }
  }

  async function remove() {
    if (!original) return;
    const ok = await confirm(
      t('itemEdit.deleteConfirm', { title: original.title }),
      t('common.cannotUndo'),
      t('common.delete'),
      t('common.cancel'),
    );
    if (!ok) return;
    dispatch({ type: 'item/remove', itemId: original.id });
    deleteCover(original.coverUri);
    router.dismissTo('/');
  }

  return (
    <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={spacing.xl}>
      <Stack.Screen
        options={{
          title: original ? t('itemEdit.editTitle') : t('itemEdit.newTitle', { shelf: shelf.name }),
          headerRight: () => (
            <Button title={t('common.save')} variant="text" compact disabled={saving} onPress={save} />
          ),
        }}
      />

      <View style={styles.coverRow}>
        <Cover uri={draft.coverUri} title={draft.title || '?'} style={styles.cover} />
        <View style={styles.coverButtons}>
          <Button title={t('itemEdit.choosePhoto')} onPress={() => pickCover('library')} />
          {Platform.OS !== 'web' && <Button title={t('itemEdit.takePhoto')} onPress={() => pickCover('camera')} />}
          {draft.coverUri && (
            <Button title={t('itemEdit.removeCover')} variant="danger" onPress={() => update({ coverUri: null })} />
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('tag.title')}</Text>
        <TextField
          value={draft.title}
          onChangeText={(title) => update({ title })}
          placeholder={t('itemEdit.titlePlaceholder')}
          autoFocus={!original}
          returnKeyType="done"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('itemEdit.tags')}</Text>
        {draft.tags.length === 0 && <Text style={styles.hint}>{t('itemEdit.noTags')}</Text>}
        {draft.tags.map((tag, index) => {
          const name = tag.name || t('common.tag');
          return (
            <View key={tag.id} style={styles.tag}>
              <View style={styles.tagHeader}>
                <TextField
                  value={tag.name}
                  onChangeText={(text) => updateTag(tag.id, { name: text })}
                  placeholder={t('itemEdit.tagNamePlaceholder')}
                  style={styles.tagName}
                />
                <Button
                  title="↑"
                  compact
                  variant="text"
                  accessibilityLabel={t('itemEdit.moveUp', { name })}
                  disabled={index === 0}
                  onPress={() => moveTag(index, -1)}
                />
                <Button
                  title="↓"
                  compact
                  variant="text"
                  accessibilityLabel={t('itemEdit.moveDown', { name })}
                  disabled={index === draft.tags.length - 1}
                  onPress={() => moveTag(index, 1)}
                />
                <Button
                  title="✕"
                  compact
                  variant="danger"
                  accessibilityLabel={t('itemEdit.remove', { name })}
                  onPress={() => removeTag(tag.id)}
                />
              </View>
              <TextField
                value={tag.value}
                onChangeText={(value) => updateTag(tag.id, { value })}
                placeholder={t('itemEdit.tagValuePlaceholder')}
                multiline
              />
            </View>
          );
        })}
        <Button title={t('itemEdit.addTag')} onPress={addTag} />
        <Text style={styles.hint}>{t('itemEdit.unnamedHint')}</Text>
      </View>

      {original && <Button title={t('itemEdit.deleteItem')} variant="danger" onPress={remove} />}
    </KeyboardAwareScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xl * 2 },
  coverRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  cover: { width: 120 },
  coverButtons: { flex: 1, gap: spacing.sm },
  section: { gap: spacing.sm },
  label: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  hint: { fontSize: fontSize.small, color: c.textMuted },
  tag: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: c.surface,
  },
  tagHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tagName: { flex: 1, fontWeight: '600' },
}));
