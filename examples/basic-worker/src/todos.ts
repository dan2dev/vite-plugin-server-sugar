// ── $server() endpoints that share in-memory state ──
//
// `listTodos`, `addTodo`, `toggleTodo`, and `deleteTodo` all close over the
// same `todos` array. Because that module-level state can't be split across
// separate Worker deployments, the plugin groups every handler in this file
// into ONE independent Cloudflare Worker
// (dist/server/functions/todos-*/index.mjs) instead of one per endpoint.
//
// State lives in the Worker's memory, so it resets whenever Cloudflare
// recycles the isolate — the same caveat as an in-memory array on any
// serverless platform. Swap it for D1, KV, or another storage binding for
// anything that needs to persist.

export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

let todos: Todo[] = [];
let nextId = 1;

export const listTodos = $server(async () => todos);

export const addTodo = $server(async (text: string) => {
  const todo: Todo = { id: nextId++, text, done: false };
  todos.push(todo);
  return todo;
});

export const toggleTodo = $server(async (id: number) => {
  todos = todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo));
  return todos.find((todo) => todo.id === id) ?? null;
});

export const deleteTodo = $server(async (id: number) => {
  todos = todos.filter((todo) => todo.id !== id);
  return { deleted: true, id };
});

// ── $get(): HTTP method helpers work the same as platform: "hono" ──

export const todoCount = $get(async (c: ServerContext<never, { done?: string }>) => {
  const done = c.req.query("done");
  if (done === undefined) return { count: todos.length };
  const want = done === "true";
  return { count: todos.filter((todo) => todo.done === want).length };
});
