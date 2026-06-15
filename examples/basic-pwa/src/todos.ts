import { db } from "./db";

export interface Todo {
	id: number;
	text: string;
	done: number;
	created_at: number;
}

const state = {
	count1: 0,
	name: "danilo1",
};

export const getSomeData = backend(async () => {
	state.count1 += 1;
	return {
		count: state.count1,
		name: state.name,
	};
});

export const getTodos = backend(async () => {
	return db.query<Todo, []>("SELECT * FROM todos ORDER BY created_at DESC").all();
});

export const addTodo = backend(async (text: string) => {
	return db.query<Todo, [string]>("INSERT INTO todos (text) VALUES (?) RETURNING *").get(text)!;
});

export const toggleTodo = backend(async (id: number) => {
	db.query("UPDATE todos SET done = 1 - done WHERE id = ?").run(id);
});

export const deleteTodo = backend(async (id: number) => {
	db.query("DELETE FROM todos WHERE id = ?").run(id);
});
