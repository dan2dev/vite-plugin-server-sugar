// ── HTTP endpoints backed by Cloudflare D1 ──
//
// Plain $server() handlers only receive their declared arguments. HTTP method
// handlers receive a ServerContext as well, whose Cloudflare implementation
// exposes bindings on `c.env`. The post-build script adds the DB binding to
// this generated Worker's wrangler.toml.

export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

interface TodoRow {
  id: number;
  text: string;
  done: number;
}

interface WorkerBindings {
  DB: D1Database;
}

function database<
  TBody,
  TQuery extends Record<string, string>,
>(c: ServerContext<TBody, TQuery>): D1Database {
  return (c as ServerContext<TBody, TQuery> & { env: WorkerBindings }).env.DB;
}

function toTodo(row: TodoRow): Todo {
  return { ...row, done: row.done === 1 };
}

export const listTodos = $get(async (c) => {
  const { results } = await database(c)
    .prepare("SELECT id, text, done FROM todos ORDER BY id")
    .all<TodoRow>();
  return results.map(toTodo);
});

export const addTodo = $post(async (c: ServerContext<{ text: string }>) => {
  const { text } = await c.req.json();
  const row = await database(c)
    .prepare("INSERT INTO todos (text) VALUES (?) RETURNING id, text, done")
    .bind(text)
    .first<TodoRow>();

  if (!row) throw new Error("D1 did not return the new todo");
  return toTodo(row);
});

export const toggleTodo = $patch(async (c: ServerContext<{ id: number }>) => {
  const { id } = await c.req.json();
  const row = await database(c)
    .prepare(
      "UPDATE todos SET done = CASE done WHEN 0 THEN 1 ELSE 0 END WHERE id = ? RETURNING id, text, done",
    )
    .bind(id)
    .first<TodoRow>();
  return row ? toTodo(row) : null;
});

export const deleteTodo = $delete(
  async (c: ServerContext<never, { id: string }>) => {
    const id = Number(c.req.query("id"));
    const result = await database(c)
      .prepare("DELETE FROM todos WHERE id = ?")
      .bind(id)
      .run();
    return { deleted: result.meta.changes > 0, id };
  },
);

export const todoCount = $get(async (c: ServerContext<never, { done?: string }>) => {
  const done = c.req.query("done");
  const statement = done === undefined
    ? database(c).prepare("SELECT COUNT(*) AS count FROM todos")
    : database(c)
      .prepare("SELECT COUNT(*) AS count FROM todos WHERE done = ?")
      .bind(done === "true" ? 1 : 0);
  const row = await statement.first<{ count: number }>();
  return { count: row?.count ?? 0 };
});
