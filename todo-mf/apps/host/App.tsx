import { StatusBar } from 'expo-status-bar';

import { AppNavigation } from './navigation/AppNavigation';
import { createTodoStore } from './store/todoStore';
import { TodoStoreProvider } from './store/TodoStoreContext';

const todoStore = createTodoStore();

export default function App() {
  return (
    <TodoStoreProvider store={todoStore}>
      <AppNavigation />
      <StatusBar style="auto" />
    </TodoStoreProvider>
  );
}
