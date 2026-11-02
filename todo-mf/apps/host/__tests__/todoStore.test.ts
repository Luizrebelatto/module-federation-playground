import { createTodoStore } from '../store/todoStore';

test('concurrent adds are not lost and keep their order', async () => {
  const store = createTodoStore();
  await Promise.all([store.add('a'), store.add('b'), store.add('c')]);
  expect(store.getSnapshot().map((todo) => todo.title)).toEqual(['a', 'b', 'c']);
});

test('two consecutive toggles return to the original state', async () => {
  const store = createTodoStore();
  await store.add('a');
  const [{ id }] = store.getSnapshot();
  await Promise.all([store.toggle(id), store.toggle(id)]);
  expect(store.getSnapshot()[0].completed).toBe(false);
});

test('getSnapshot keeps the same reference when nothing changes', async () => {
  const store = createTodoStore();
  const before = store.getSnapshot();
  await store.remove('does-not-exist');
  expect(store.getSnapshot()).toBe(before);
});
