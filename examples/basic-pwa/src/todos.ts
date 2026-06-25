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

export const getTodos = $server(async () => {
	console.log("getTodos ------------------");
	return db.query<Todo, []>("SELECT * FROM todos ORDER BY created_at DESC").all();
});

export const getSomeData = $server(async () => {
	state.count1 += 1;
	const todos = await getTodos();
	return {
		count: state.count1,
		name: state.name,
		todos: todos,
	};
});
type PostSomeDataPayload = {
	name: string;
};

export const postSomeData = $post(async (c: ServerContext<PostSomeDataPayload>) => {
	const body = await c.req.json();
	return body;
});

export const getSomeData2 = $get(async (c: ServerContext<never, { id: string }>) => {
	const userId = c.req.query("id");
	console.log(userId);
	const contentType = c.req.header("Content-Type");
	return { userId, contentType };
});

export const addTodo = $server(async (text: string, someOtherValue: string) => {
	console.log("some other value", someOtherValue);
	return db.query<Todo, [string]>("INSERT INTO todos (text) VALUES (?) RETURNING *").get(text)!;
});

export const toggleTodo = $server(async (id: number) => {
	console.log("toggleTodo", id);
	db.query("UPDATE todos SET done = 1 - done WHERE id = ?").run(id);
});

export const deleteTodo = $server(async (id: number) => {
	db.query("DELETE FROM todos WHERE id = ?").run(id);
});
