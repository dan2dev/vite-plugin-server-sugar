import { db } from "./db";

export interface Todo {
  id: number;
  text: string;
  done: number;
  created_at: number;
}

const state = {
  count1: 0,
  get name() {
    console.log("state getName server", this.count1);
    return "danilo1";
  },
};
// console.log(state.name);

export const getTodos = $action(async () => {
  console.log("getTodos ------------------");
  return db
    .query<Todo, []>("SELECT * FROM todos ORDER BY created_at DESC")
    .all();
});

export const getSomeData = $action(async () => {
  state.count1 += 1;
  const todos = await getTodos();
  return {
    count: state.count1,
    name: state.name,
    todos: todos,
  };
});

export const addTodo = $action(async (text: string, someOtherValue: string) => {
  console.log("some other value", someOtherValue);
  return db
    .query<Todo, [string]>("INSERT INTO todos (text) VALUES (?) RETURNING *")
    .get(text)!;
});

export const toggleTodo = $action(async (id: number) => {
  console.log("toggleTodo", id);
  db.query("UPDATE todos SET done = 1 - done WHERE id = ?").run(id);
});

export const deleteTodo = $action(async (id: number) => {
  db.query("DELETE FROM todos WHERE id = ?").run(id);
});
