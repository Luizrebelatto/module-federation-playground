import { useTodoStore } from '../store/TodoStoreContext';
import { LocalTodoScreen } from './LocalTodoScreen';

export function LocalTodoRoute() {
  return <LocalTodoScreen store={useTodoStore()} />;
}