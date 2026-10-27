import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/Button';
import { Cover } from '@/components/Cover';
import { NotFound } from '@/components/NotFound';
import { useShelfState } from '@/state/ShelfProvider';
import { colors, fontSize, spacing } from '@/theme';

/** Wider than this, the cover sits beside the details (as in the sketch); narrower, above them. */
const SIDE_BY_SIDE_MIN_WIDTH = 600;

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useShelfState();
  const { width } = useWindowDimensions();
  const item = state.items.find((i) => i.id === id);
  if (!item) return <NotFound what="item" />;

  const shelf = state.shelves.find((s) => s.id === item.shelfId);
  const sideBySide = width >= SIDE_BY_SIDE_MIN_WIDTH;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: shelf?.name ?? 'Item' }} />

      <View style={sideBySide ? styles.row : styles.column}>
        <Cover
          uri={item.coverUri}
          title={item.title}
          style={sideBySide ? styles.coverSide : [styles.coverTop, { width: Math.min(width * 0.6, 260) }]}
        />
        <View style={[styles.fields, sideBySide && styles.fieldsSide]}>
          <Field name="Title" value={item.title} />
          {item.tags.map((tag) => (
            <Field key={tag.id} name={tag.name} value={tag.value} />
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <Button
          title="Edit"
          variant="primary"
          onPress={() => router.push({ pathname: '/item/edit', params: { id: item.id } })}
        />
      </View>
    </ScrollView>
  );
}

function Field({ name, value }: { name: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldName}>{name}:</Text>
      <Text style={[styles.fieldValue, !value && styles.fieldEmpty]} selectable>
        {value || '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.xl },
  row: { flexDirection: 'row', gap: spacing.xl, alignItems: 'flex-start' },
  column: { gap: spacing.xl },
  coverSide: { width: 200 },
  coverTop: { alignSelf: 'center' },
  fields: { gap: spacing.lg },
  fieldsSide: { flex: 1 },
  field: { gap: spacing.xs },
  fieldName: { fontSize: fontSize.small, color: colors.textMuted, fontWeight: '600' },
  fieldValue: { fontSize: fontSize.body, color: colors.text, lineHeight: 22 },
  fieldEmpty: { color: colors.textMuted },
  footer: { alignItems: 'flex-end' },
});
