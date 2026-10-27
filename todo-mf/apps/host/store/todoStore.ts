import { createStore } from 'zustand/vanilla';
import type { Todo, TodoStore } from '@todo-mf/todo-contract';

let nextId = 0;
const createId = () => `${Date.now().toString(36)}-${(nextId++).toString(36)}`;

type TodoState = {
  todos: readonly Todo[];
  add: (title: string) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const createTodoState = (initial: readonly Todo[]) =>
  createStore<TodoState>()((set) => {
    let queue: Promise<void> = Promise.resolve();

    const mutate = (update: (current: readonly Todo[]) => readonly Todo[]) => {
      const run = queue.then(() => {
        set((state) => {
          const next = update(state.todos);
          return next === state.todos ? state : { todos: next };
        });
      });
      queue = run.catch(() => undefined);
      return run;
    };

    return {
      todos: initial,
      add: (title) =>
        mutate((current) => [...current, { id: createId(), title, completed: false }]),
      // Id inexistente devolve `current`: o `mutate` vê que nada mudou e não notifica ninguém.
      toggle: (id) =>
        mutate((current) =>
          current.some((todo) => todo.id === id)
            ? current.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo))
            : current,
        ),
      remove: (id) =>
        mutate((current) =>
          current.some((todo) => todo.id === id) ? current.filter((todo) => todo.id !== id) : current,
        ),
    };
  });

export function createTodoStore(initial: readonly Todo[] = []): TodoStore {
  const state = createTodoState(initial);
  const { add, toggle, remove } = state.getState();

  return {
    getSnapshot: () => state.getState().todos,
    subscribe: (listener) => state.subscribe(() => listener()),
    add,
    toggle,
    remove,
  };
}