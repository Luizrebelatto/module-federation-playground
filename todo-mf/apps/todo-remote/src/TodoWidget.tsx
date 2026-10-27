import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TodoRemoteProps } from '@todo-mf/todo-contract';

export default function TodoWidget({ store, releaseId }: TodoRemoteProps) {
  const todos = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const pending = todos.filter((todo) => !todo.completed).length;

  return (
    <View style={styles.badge}>
      <Text style={styles.count}>{pending} tarefa(s) pendente(s)</Text>
      <Text style={styles.release}>Remote · {releaseId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: '#8250df', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  count: { color: '#fff', fontSize: 16, fontWeight: '600' },
  release: { color: '#e9ddff', fontSize: 12, marginTop: 2 },
});
