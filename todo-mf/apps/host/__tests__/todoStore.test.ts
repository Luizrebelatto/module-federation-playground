import { createTodoStore } from '../store/todoStore';

test('adds simultâneos não se perdem e mantêm a ordem', async () => {
  const store = createTodoStore();
  await Promise.all([store.add('a'), store.add('b'), store.add('c')]);
  expect(store.getSnapshot().map((todo) => todo.title)).toEqual(['a', 'b', 'c']);
});

test('dois toggles seguidos voltam ao estado original', async () => {
  const store = createTodoStore();
  await store.add('a');
  const [{ id }] = store.getSnapshot();
  await Promise.all([store.toggle(id), store.toggle(id)]);
  expect(store.getSnapshot()[0].completed).toBe(false);
});

test('getSnapshot mantém a referência quando nada muda', async () => {
  const store = createTodoStore();
  const before = store.getSnapshot();
  await store.remove('nao-existe');
  expect(store.getSnapshot()).toBe(before);
});
