import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { TodoStore } from '@todo-mf/todo-contract';

const TodoStoreContext = createContext<TodoStore | null>(null);

export function TodoStoreProvider({ store, children }: { store: TodoStore; children: ReactNode }) {
  return <TodoStoreContext.Provider value={store}>{children}</TodoStoreContext.Provider>;
}

export function useTodoStore(): TodoStore {
  const store = useContext(TodoStoreContext);
  if (!store) throw new Error('useTodoStore must be used inside <TodoStoreProvider>');
  return store;
}

export function useTodos(store: TodoStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}