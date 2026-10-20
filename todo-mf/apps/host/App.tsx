import { StatusBar } from 'expo-status-bar';

import { AppNavigation } from './navigation/AppNavigation';
import { createTodoStore } from './store/todoStore';
import { TodoStoreProvider } from './store/TodoStoreContext';

// Criado uma vez, fora do componente: sobrevive a re-renders e é o mesmo para host e remote.
const todoStore = createTodoStore();

export default function App() {
  return (
    <TodoStoreProvider store={todoStore}>
      <AppNavigation />
      <StatusBar style="auto" />
    </TodoStoreProvider>
  );
}
