import { useState, useSyncExternalStore } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TodoRemoteProps } from '@todo-mf/todo-contract';

export default function TodoScreen({ store, releaseId }: TodoRemoteProps) {
  const todos = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [title, setTitle] = useState('');

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle('');
    void store.add(trimmed);
  };

  const pending = todos.filter((todo) => !todo.completed).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Remote · {releaseId}</Text>
        <Text style={styles.headerText}>{pending} pendente(s)</Text>
      </View>
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Nova tarefa (remote)"
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
                {item.completed ? '✓' : '○'} {item.title}
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
  container: { flex: 1, backgroundColor: '#f6f8fa' },
  header: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#8250df', padding: 12 },
  headerText: { color: '#fff', fontWeight: '600' },
  form: { flexDirection: 'row', gap: 8, padding: 16 },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addButton: { backgroundColor: '#8250df', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
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
