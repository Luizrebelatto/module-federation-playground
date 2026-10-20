import { useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TodoStore } from '@todo-mf/packages';

import { useTodos } from '../store/TodoStoreContext';

type Props = {
  store: TodoStore;
  banner?: ReactNode;
};

export function LocalTodoScreen({ store, banner }: Props) {
  const todos = useTodos(store);
  const [title, setTitle] = useState('');

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle('');
    void store.add(trimmed);
  };

  return (
    <View style={styles.container}>
      {banner}
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Nova tarefa"
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={submit}
          returnKeyType="done"
        />
        <Pressable style={styles.addButton} onPress={submit} accessibilityRole="button">
          <Text style={styles.addButtonText}>Adicionar</Text>
        </Pressable>
      </View>
      <FlatList
        data={todos}
        keyExtractor={(todo) => todo.id}
        ListEmptyComponent={<Text style={styles.empty}>Nenhuma tarefa ainda.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              style={styles.rowTitle}
              onPress={() => void store.toggle(item.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.completed }}
            >
              <Text style={[styles.title, item.completed && styles.completed]}>
                {item.completed ? '☑' : '☐'} {item.title}
              </Text>
            </Pressable>
            <Pressable onPress={() => void store.remove(item.id)} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.remove}>Remover</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  form: { flexDirection: 'row', gap: 8, padding: 16 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  addButton: { backgroundColor: '#1f6feb', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  addButtonText: { color: '#fff', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#888', marginTop: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  rowTitle: { flex: 1 },
  title: { fontSize: 16 },
  completed: { textDecorationLine: 'line-through', color: '#888' },
  remove: { color: '#d1242f' },
});