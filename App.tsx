import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addItem, addTag } from './src/models/actions';
import { selectItemsOnShelf } from './src/models/shelfReducer';
import { ShelfProvider, useShelfDispatch, useShelfState } from './src/state/ShelfProvider';
import { DATABASE_NAME, migrate } from './src/storage/database';

export default function App() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate}>
      <ShelfProvider>
        <ModelPreview />
        <StatusBar style="auto" />
      </ShelfProvider>
    </SQLiteProvider>
  );
}

// Temporary screen to check the Phase 1 data model on a phone.
// Phase 3 replaces this with the real shelf UI.
function ModelPreview() {
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const [selectedId, setSelectedId] = useState(state.shelves[0]?.id);
  const shelf = state.shelves.find((s) => s.id === selectedId);
  const items = shelf ? selectItemsOnShelf(state, shelf.id) : [];

  function addSample() {
    if (!shelf) return;
    const action = addItem(shelf, `Sample ${items.length + 1}`);
    dispatch(action);
    if (action.type === 'item/add') dispatch(addTag(action.item.id, 'Age Restricted', 'Recommended 15+'));
  }

  return (
    <View style={styles.container}>
      <ScrollView horizontal style={styles.tabs} contentContainerStyle={styles.tabsContent}>
        {state.shelves.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setSelectedId(s.id)}
            style={[styles.tab, s.id === selectedId && styles.tabSelected]}>
            <Text>{s.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable onPress={addSample} style={styles.button}>
        <Text>Add sample item to {shelf?.name}</Text>
      </Pressable>

      <ScrollView>
        {items.map((item) => (
          <View key={item.id} style={styles.item}>
            <Text style={styles.title}>Title: {item.title}</Text>
            {item.tags.map((tag) => (
              <Text key={tag.id}>
                {tag.name}: {tag.value || '—'}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 16 },
  tabs: { flexGrow: 0 },
  tabsContent: { gap: 8 },
  tab: { paddingVertical: 10, paddingHorizontal: 18, backgroundColor: '#ddd', borderRadius: 6 },
  tabSelected: { backgroundColor: '#aac8ff' },
  button: { marginVertical: 16, padding: 12, backgroundColor: '#eee', borderRadius: 6, alignItems: 'center' },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 2 },
  title: { fontWeight: '600' },
});
