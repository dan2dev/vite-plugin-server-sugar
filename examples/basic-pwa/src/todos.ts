import { db } from "./db";

export interface Todo {
	id: number;
	text: string;
	done: number;
	created_at: number;
}

// ── $server: async RPC with arguments ──

export const getTodos = $server(async () => {
	return db.query<Todo, []>("SELECT * FROM todos ORDER BY created_at DESC").all();
});

export const addTodo = $server(async (text: string) => {
	return db.query<Todo, [string]>("INSERT INTO todos (text) VALUES (?) RETURNING *").get(text)!;
});

export const toggleTodo = $server(async (id: number) => {
	db.query("UPDATE todos SET done = 1 - done WHERE id = ?").run(id);
});

export const deleteTodo = $server(async (id: number) => {
	db.query("DELETE FROM todos WHERE id = ?").run(id);
});

// ── $server: sync return (non-async) ──

let requestCount = 0;

export const getRequestCount = $server(() => {
	return ++requestCount;
});

// ── $server: sibling cross-reference (calls another $server) ──

export const getTodoStats = $server(async () => {
	const todos = await getTodos();
	const done = todos.filter((t) => t.done).length;
	return { total: todos.length, done, pending: todos.length - done };
});

// ── $get: untyped query (all query params optional on client) ──

export const listTodos = $get(async (c) => {
	const limit = c.req.query("limit");
	const offset = c.req.query("offset");
	if (limit) {
		return db
			.query<Todo, [number, number]>("SELECT * FROM todos ORDER BY created_at DESC LIMIT ? OFFSET ?")
			.all(Number(limit), Number(offset ?? "0"));
	}
	return db.query<Todo, []>("SELECT * FROM todos ORDER BY created_at DESC").all();
});

// ── $get: typed query (query param required on client) ──

export const getTodoById = $get(async (c: ServerContext<never, { id: string }>) => {
	const id = c.req.query("id");
	return db.query<Todo, [number]>("SELECT * FROM todos WHERE id = ?").get(Number(id)) ?? null;
});

// ── $post: typed body ──

export const createTodo = $post(async (c: ServerContext<{ text: string }>) => {
	const { text } = await c.req.json();
	return db.query<Todo, [string]>("INSERT INTO todos (text) VALUES (?) RETURNING *").get(text)!;
});

// ── $post: typed body + typed query ──

export const createTodoWithTag = $post(async (c: ServerContext<{ text: string }, { tag: string }>) => {
	const { text } = await c.req.json();
	const tag = c.req.query("tag");
	const todo = db.query<Todo, [string]>("INSERT INTO todos (text) VALUES (?) RETURNING *").get(`[${tag}] ${text}`)!;
	return { ...todo, tag };
});

// ── $put: typed body (full replacement) ──

export const replaceTodo = $put(async (c: ServerContext<{ id: number; text: string; done: boolean }>) => {
	const { id, text, done } = await c.req.json();
	db.query("UPDATE todos SET text = ?, done = ? WHERE id = ?").run(text, done ? 1 : 0, id);
	return db.query<Todo, [number]>("SELECT * FROM todos WHERE id = ?").get(id)!;
});

// ── $patch: typed body + typed query ──

export const patchTodo = $patch(async (c: ServerContext<{ text?: string; done?: boolean }, { id: string }>) => {
	const id = Number(c.req.query("id"));
	const updates = await c.req.json();
	if (updates.text !== undefined) {
		db.query("UPDATE todos SET text = ? WHERE id = ?").run(updates.text, id);
	}
	if (updates.done !== undefined) {
		db.query("UPDATE todos SET done = ? WHERE id = ?").run(updates.done ? 1 : 0, id);
	}
	return db.query<Todo, [number]>("SELECT * FROM todos WHERE id = ?").get(id)!;
});

// ── $delete: typed query ──

export const removeTodo = $delete(async (c: ServerContext<never, { id: string }>) => {
	const id = Number(c.req.query("id"));
	db.query("DELETE FROM todos WHERE id = ?").run(id);
	return { deleted: true, id };
});

// ── $delete: untyped query ──

export const clearDoneTodos = $delete(async () => {
	const cleared = db.query<{ id: number }, []>("DELETE FROM todos WHERE done = 1 RETURNING id").all();
	return { cleared: cleared.length };
});

// ── $head: typed query ──

export const todoExists = $head(async (c: ServerContext<never, { id: string }>) => {
	const id = Number(c.req.query("id"));
	const todo = db.query<{ id: number }, [number]>("SELECT id FROM todos WHERE id = ?").get(id);
	return { exists: !!todo };
});

// ── $head: untyped query ──

export const healthCheck = $head(async () => {
	return { status: "ok", timestamp: Date.now() };
});
