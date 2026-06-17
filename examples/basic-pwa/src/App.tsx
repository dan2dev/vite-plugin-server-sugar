import { useState, useEffect, useRef } from "react";
import "./App.css";
import { getTodos, addTodo, toggleTodo, deleteTodo, getSomeData } from "./todos";
import type { Todo } from "./todos";
import { chat, getChatHistory } from "./chat";
import { demoWorker } from "./worker-demo";
import type { WorkerStats } from "./worker-demo";
import { userWorker } from "./user";
import type { User } from "./user";

const globalState = {
	count1: 0,
	get name() {
		console.log("globalState getName", this.count1);
		return "danilo2";
	},
};

const getSomeData2 = $server(async () => {
	globalState.count1 += 1;
	return {
		count: globalState.count1,
		name: globalState.name,
	};
});

function Chat() {
	const [messages, setMessages] = useState<string[]>([]);
	const [input, setInput] = useState("");
	const connRef = useRef<ReturnType<typeof chat.connect> | undefined>(undefined);

	useEffect(() => {
		getChatHistory().then(setMessages);
		const conn = chat.connect();
		connRef.current = conn;
		conn.onMessage(({ message }) => {
			setMessages((prev) => [...prev, message]);
		});
		return () => conn.close();
	}, []);

	function handleSend(e: React.FormEvent) {
		e.preventDefault();
		const text = input.trim();
		if (!text) return;
		connRef.current?.send({ message: text, name: "server" });
		setInput("");
	}

	return (
		<section id="chat">
			<h2>Chat</h2>
			<ul className="todo-list">
				{messages.map((message, i) => (
					<li key={i} className="todo-item">
						{message}
					</li>
				))}
			</ul>
			<form onSubmit={handleSend} className="todo-form">
				<input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Say something..." className="todo-input" />
				<button type="submit" className="todo-add">
					Send
				</button>
			</form>
		</section>
	);
}

function WorkerDemo() {
	const [stats, setStats] = useState<WorkerStats | null>(null);
	const [fibInput, setFibInput] = useState("10");
	const [fibResult, setFibResult] = useState<number | null>(null);
	const [callCount, setCallCount] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);

	async function handleComputeStats() {
		setLoading(true);
		try {
			const result = await demoWorker.computeStats();
			setStats(result);
			setCallCount(await demoWorker.getCallCount());
		} finally {
			setLoading(false);
		}
	}

	async function handleFib(e: React.FormEvent) {
		e.preventDefault();
		const n = parseInt(fibInput, 10);
		if (isNaN(n)) return;
		setLoading(true);
		try {
			const result = await demoWorker.computeFibonacci(n);
			setFibResult(result);
			setCallCount(await demoWorker.getCallCount());
		} finally {
			setLoading(false);
		}
	}

	return (
		<section id="worker-demo">
			<h2>$worker Demo</h2>
			<p style={{ fontSize: "0.85rem", color: "#888" }}>
				All methods share one worker thread and one closure state.
				{callCount !== null && <strong> Worker call count: {callCount}</strong>}
			</p>

			<div style={{ marginBottom: "1rem" }}>
				<button onClick={handleComputeStats} disabled={loading} className="todo-add">
					Compute Stats (calls $server from worker)
				</button>
				{stats && (
					<ul className="todo-list" style={{ marginTop: "0.5rem" }}>
						<li className="todo-item">Total todos: {stats.totalTodos}</li>
						<li className="todo-item">Done: {stats.doneTodos}</li>
						<li className="todo-item">Pending: {stats.pendingTodos}</li>
						<li className="todo-item">Chat messages: {stats.chatMessages}</li>
						<li className="todo-item">Processed at: {new Date(stats.processedAt).toLocaleTimeString()}</li>
					</ul>
				)}
			</div>

			<form onSubmit={handleFib} className="todo-form">
				<input
					type="number"
					value={fibInput}
					onChange={(e) => setFibInput(e.target.value)}
					placeholder="N"
					className="todo-input"
					style={{ width: "80px" }}
				/>
				<button type="submit" disabled={loading} className="todo-add">
					Fibonacci(N)
				</button>
				{fibResult !== null && <span style={{ marginLeft: "0.75rem" }}>= {fibResult}</span>}
			</form>
		</section>
	);
}

function UserList() {
	const [users, setUsers] = useState<User[]>([]);
	const [loading, setLoading] = useState(true);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [adding, setAdding] = useState(false);

	async function loadUsers() {
		setLoading(true);
		const result = await userWorker.list();
		setUsers(result);
		setLoading(false);
	}

	useEffect(() => {
		userWorker.load();
	}, []);

	async function handleAdd(e: React.FormEvent) {
		e.preventDefault();
		const trimmedName = name.trim();
		const trimmedEmail = email.trim();
		if (!trimmedName || !trimmedEmail) return;
		setAdding(true);
		await userWorker.add(trimmedName, trimmedEmail);
		const users = await userWorker.list();
		setUsers(users);
		setName("");
		setEmail("");
		setAdding(false);
	}

	async function handleDelete(id: number) {
		await userWorker.remove(id);
		setUsers((prev) => prev.filter((u) => u.id !== id));
	}

	return (
		<section id="users">
			<h2>Users</h2>
			<p style={{ fontSize: "0.85rem", color: "#888" }}>Fetched via $worker() → $server() (off the main thread).</p>

			<form onSubmit={handleAdd} className="todo-form">
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Name"
					className="todo-input"
					disabled={adding}
				/>
				<input
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="Email"
					className="todo-input"
					disabled={adding}
				/>
				<button type="submit" className="todo-add" disabled={adding || !name.trim() || !email.trim()}>
					Add
				</button>
			</form>

			{loading ? (
				<p className="todo-empty">Loading users...</p>
			) : users.length === 0 ? (
				<p className="todo-empty">No users found.</p>
			) : (
				<ul className="todo-list">
					{users.map((user) => (
						<li key={user.id} className="todo-item">
							<span className="todo-text">
								<strong>{user.name}</strong> — {user.email}
							</span>
							<button className="todo-delete" onClick={() => handleDelete(user.id)} aria-label="Delete user">
								×
							</button>
						</li>
					))}
				</ul>
			)}

			<button onClick={loadUsers} className="todo-add" style={{ marginTop: "0.5rem" }}>
				Refresh
			</button>
		</section>
	);
}

function App() {
	const [todos, setTodos] = useState<Todo[]>([]);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(true);
	const [adding, setAdding] = useState(false);
	const [state, setState] = useState<{ count: number; name: string }>({
		count: 0,
		// name: '',
		name: globalState.name,
	});

	useEffect(() => {
		Promise.all([getTodos().then(setTodos), getSomeData().then(setState), getSomeData2().then(setState)]).finally(() => {
			setLoading(false);
		});
	}, []);

	async function handleAdd(e: React.FormEvent) {
		e.preventDefault();
		const text = input.trim();
		if (!text) return;
		setAdding(true);
		const todo = await addTodo(text, Date.now().toString());
		setTodos((prev) => [todo, ...prev]);
		setInput("");
		setAdding(false);
	}

	async function handleToggle(id: number) {
		const result = await toggleTodo(id).catch((e) => {
			return e;
		});
		console.log(result);
		setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: t.done ? 0 : 1 } : t)));
	}

	async function handleDelete(id: number) {
		await deleteTodo(id);
		setTodos((prev) => prev.filter((t) => t.id !== id));
	}

	return (
		<section id="center">
			<h1>Todos</h1>

			<form onSubmit={handleAdd} className="todo-form">
				<h2>
					{state.count} - {state.name}
				</h2>
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder="What needs to be done?"
					className="todo-input"
					disabled={adding}
				/>
				<button type="submit" className="todo-add" disabled={adding || !input.trim()}>
					Add
				</button>
			</form>

			{loading ? (
				<p className="todo-empty">Loading...</p>
			) : todos.length === 0 ? (
				<p className="todo-empty">No todos yet. Add one above!</p>
			) : (
				<ul className="todo-list">
					{todos.map((todo) => (
						<li key={todo.id} className={`todo-item${todo.done ? " done" : ""}`}>
							<button
								className="todo-check"
								onClick={() => handleToggle(todo.id)}
								aria-label={todo.done ? "Mark undone" : "Mark done"}
							>
								{todo.done ? "✓" : ""}
							</button>
							<span className="todo-text">{todo.text}</span>
							<button className="todo-delete" onClick={() => handleDelete(todo.id)} aria-label="Delete todo">
								×
							</button>
						</li>
					))}
				</ul>
			)}

			<Chat />
			<UserList />
			<WorkerDemo />
		</section>
	);
}

export default App;
