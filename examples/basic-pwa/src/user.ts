/* eslint-disable @typescript-eslint/no-unused-vars */
import { db } from "./db";

export interface User {
	id: number;
	name: string;
	email: string;
	created_at: number;
}

function isWorker() {
	return typeof window === "undefined" && typeof Worker !== "undefined";
}

const getUsers = $server(async () => {
	return db.query<User, []>("SELECT * FROM users ORDER BY created_at DESC").all();
});

const createUser = $server(async (name: string, email: string) => {
	return db.query<User, [string, string]>("INSERT INTO users (name, email) VALUES (?, ?) RETURNING *").get(name, email)!;
});

const deleteUser = $server(async (id: number) => {
	db.query("DELETE FROM users WHERE id = ?").run(id);
});

// A single shared worker that owns the in-memory users cache.
// All methods share the same thread and the same `users` array.
export const userWorker = $worker(() => {
	const users: User[] = [{ id: 0, name: "Danilo", email: "dan2dev@outlook.com", created_at: 0 }];
	console.log("userWorker initialized", users, isWorker())

	async function load() {
		users.push(...(await getUsers()));
	}

	async function list() {
		return getUsers();
	}

	async function add(name: string, email: string): Promise<User> {
		const user = await createUser(name, email);
		users.push(user);
		return user;
	}

	async function remove(id: number) {
		const index = users.findIndex((u) => u.id === id);
		if (index !== -1) users.splice(index, 1);
		await deleteUser(id);
	}

	function snapshot(): User[] {
		return [...users];
	}

	return { load, list, add, remove, snapshot };
});
