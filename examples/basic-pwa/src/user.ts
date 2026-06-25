// ── $worker + $server: worker methods delegate to non-exported $server functions ──

import { db } from "./db";

export interface User {
	id: number;
	name: string;
	email: string;
	created_at: number;
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

export const userWorker = $worker(() => {
	async function list() {
		return getUsers();
	}

	async function add(name: string, email: string): Promise<User> {
		return createUser(name, email);
	}

	async function remove(id: number) {
		await deleteUser(id);
	}

	return { list, add, remove };
});
