import { useState, useEffect, useRef } from "react";
import "./App.css";
import {
	getTodos, addTodo, toggleTodo, deleteTodo,
	getRequestCount, getTodoStats,
	listTodos, getTodoById,
	createTodo, createTodoWithTag,
	replaceTodo, patchTodo,
	removeTodo, clearDoneTodos,
	todoExists, healthCheck,
} from "./todos";
import type { Todo } from "./todos";
import { chat, getChatHistory, announce } from "./chat";
import { demoWorker } from "./worker-demo";
import type { WorkerStats } from "./worker-demo";
import { userWorker } from "./user";
import type { User } from "./user";
import {
	getEdgeCaseReport,
	noContentMutation,
	throwingServer,
	groupedServer,
	duplicateLabels,
	responseEndpoint,
	inspectRequest,
	echoBodyWithOptionalQuery,
	textLength,
	alwaysHead,
	edgeSocket,
	broadcastEdgeNotice,
	edgeWorker,
} from "./edge-cases";

// ── $server: CRUD ──

function TodosSection() {
	const [todos, setTodos] = useState<Todo[]>([]);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		getTodos().then(setTodos).finally(() => setLoading(false));
	}, []);

	async function handleAdd(e: React.FormEvent) {
		e.preventDefault();
		const text = input.trim();
		if (!text) return;
		const todo = await addTodo(text);
		setTodos((prev) => [todo, ...prev]);
		setInput("");
	}

	async function handleToggle(id: number) {
		await toggleTodo(id);
		setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: t.done ? 0 : 1 } : t)));
	}

	async function handleDelete(id: number) {
		await deleteTodo(id);
		setTodos((prev) => prev.filter((t) => t.id !== id));
	}

	return (
		<section>
			<h2>$server &mdash; CRUD</h2>
			<p className="description">Basic async RPC with typed arguments: getTodos(), addTodo(text), toggleTodo(id), deleteTodo(id)</p>
			<form onSubmit={handleAdd} className="form-row">
				<input value={input} onChange={(e) => setInput(e.target.value)} placeholder="What needs to be done?" className="input" />
				<button type="submit" className="btn" disabled={!input.trim()}>Add</button>
			</form>
			{loading ? (
				<p className="empty">Loading...</p>
			) : todos.length === 0 ? (
				<p className="empty">No todos yet. Add one above!</p>
			) : (
				<ul className="list">
					{todos.map((todo) => (
						<li key={todo.id} className={`list-item${todo.done ? " done" : ""}`}>
							<button className="check" onClick={() => handleToggle(todo.id)}>{todo.done ? "✓" : ""}</button>
							<span className="item-text">{todo.text}</span>
							<button className="del" onClick={() => handleDelete(todo.id)}>&times;</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

// ── $server: edge cases ──

function ServerEdgeCases() {
	const [count, setCount] = useState<number | null>(null);
	const [stats, setStats] = useState<{ total: number; done: number; pending: number } | null>(null);

	return (
		<section>
			<h2>$server &mdash; Edge Cases</h2>

			<div className="edge-case">
				<h3>Sync return (non-async)</h3>
				<p className="description">getRequestCount() returns a plain number &mdash; the plugin wraps it in a Promise on the client.</p>
				<button className="btn" onClick={async () => setCount(await getRequestCount())}>getRequestCount()</button>
				{count !== null && <pre className="result">{JSON.stringify(count)}</pre>}
			</div>

			<div className="edge-case">
				<h3>Sibling cross-reference</h3>
				<p className="description">getTodoStats() calls getTodos() (another $server) on the server side.</p>
				<button className="btn" onClick={async () => setStats(await getTodoStats())}>getTodoStats()</button>
				{stats && <pre className="result">{JSON.stringify(stats, null, 2)}</pre>}
			</div>
		</section>
	);
}

// ── HTTP method endpoints ──

function HttpMethodsSection() {
	const [results, setResults] = useState<Record<string, unknown>>({});

	function show(key: string, value: unknown) {
		setResults((prev) => ({ ...prev, [key]: value }));
	}

	return (
		<section>
			<h2>HTTP Methods &mdash; $get, $post, $put, $patch, $delete, $head</h2>
			<div className="methods-grid">

				<div className="method-card">
					<code className="tag get">GET</code>
					<h3>listTodos &mdash; untyped query</h3>
					<p className="description">Query params are optional on the client.</p>
					<div className="btn-row">
						<button className="btn" onClick={async () => show("list", await listTodos())}>listTodos()</button>
						<button className="btn" onClick={async () => show("list", await listTodos({ limit: "2" }))}>
							listTodos(&#123; limit: "2" &#125;)
						</button>
						<button className="btn sm" onClick={async () => show("list", await listTodos(undefined, { headers: { "X-Custom": "test" } }))}>
							+ FetchOptions
						</button>
					</div>
					{"list" in results && <pre className="result">{JSON.stringify(results.list, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<code className="tag get">GET</code>
					<h3>getTodoById &mdash; typed query</h3>
					<p className="description">Query param <code>id</code> is required on the client.</p>
					<button className="btn" onClick={async () => show("byId", await getTodoById({ id: "1" }))}>
						getTodoById(&#123; id: "1" &#125;)
					</button>
					{"byId" in results && <pre className="result">{JSON.stringify(results.byId, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<code className="tag post">POST</code>
					<h3>createTodo &mdash; typed body</h3>
					<p className="description">Body is typed as &#123; text: string &#125;.</p>
					<button className="btn" onClick={async () => show("post", await createTodo({ text: "Created via $post" }))}>
						createTodo(&#123; text: "..." &#125;)
					</button>
					{"post" in results && <pre className="result">{JSON.stringify(results.post, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<code className="tag post">POST</code>
					<h3>createTodoWithTag &mdash; body + typed query</h3>
					<p className="description">Both body and query are typed and required.</p>
					<button className="btn" onClick={async () => show("postTag", await createTodoWithTag({ text: "Tagged" }, { tag: "urgent" }))}>
						createTodoWithTag(body, &#123; tag: "urgent" &#125;)
					</button>
					{"postTag" in results && <pre className="result">{JSON.stringify(results.postTag, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<code className="tag put">PUT</code>
					<h3>replaceTodo &mdash; typed body</h3>
					<p className="description">Full replacement with &#123; id, text, done &#125;.</p>
					<button className="btn" onClick={async () => show("put", await replaceTodo({ id: 1, text: "Replaced via $put", done: false }))}>
						replaceTodo(&#123; id: 1, text: "...", done: false &#125;)
					</button>
					{"put" in results && <pre className="result">{JSON.stringify(results.put, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<code className="tag patch">PATCH</code>
					<h3>patchTodo &mdash; body + typed query</h3>
					<p className="description">Partial update: body fields are optional, query <code>id</code> is required.</p>
					<button className="btn" onClick={async () => show("patch", await patchTodo({ done: true }, { id: "1" }))}>
						patchTodo(&#123; done: true &#125;, &#123; id: "1" &#125;)
					</button>
					{"patch" in results && <pre className="result">{JSON.stringify(results.patch, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<code className="tag del">DELETE</code>
					<h3>removeTodo &mdash; typed query</h3>
					<p className="description">Query param <code>id</code> is required.</p>
					<button className="btn" onClick={async () => show("remove", await removeTodo({ id: "1" }))}>
						removeTodo(&#123; id: "1" &#125;)
					</button>
					{"remove" in results && <pre className="result">{JSON.stringify(results.remove, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<code className="tag del">DELETE</code>
					<h3>clearDoneTodos &mdash; untyped query</h3>
					<p className="description">No query params needed.</p>
					<button className="btn" onClick={async () => show("clear", await clearDoneTodos())}>clearDoneTodos()</button>
					{"clear" in results && <pre className="result">{JSON.stringify(results.clear, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<code className="tag head">HEAD</code>
					<h3>todoExists &mdash; typed query</h3>
					<p className="description">Check if a todo exists by id.</p>
					<button className="btn" onClick={async () => show("exists", await todoExists({ id: "1" }))}>
						todoExists(&#123; id: "1" &#125;)
					</button>
					{"exists" in results && <pre className="result">{JSON.stringify(results.exists, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<code className="tag head">HEAD</code>
					<h3>healthCheck &mdash; untyped query</h3>
					<p className="description">No params needed.</p>
					<button className="btn" onClick={async () => show("health", await healthCheck())}>healthCheck()</button>
					{"health" in results && <pre className="result">{JSON.stringify(results.health, null, 2)}</pre>}
				</div>

			</div>
		</section>
	);
}

// ── $ws: WebSocket ──

function ChatSection() {
	const [messages, setMessages] = useState<{ message: string; sender: string }[]>([]);
	const [input, setInput] = useState("");
	const [username, setUsername] = useState("");
	const [connected, setConnected] = useState(false);
	const connRef = useRef<ReturnType<typeof chat.connect> | undefined>(undefined);

	function handleConnect(e: React.FormEvent) {
		e.preventDefault();
		const name = username.trim();
		if (!name) return;
		getChatHistory().then(setMessages);
		const conn = chat.connect(name);
		connRef.current = conn;
		conn.onMessage((data) => {
			setMessages((prev) => [...prev, data]);
		});
		conn.onClose(() => setConnected(false));
		setConnected(true);
	}

	function handleSend(e: React.FormEvent) {
		e.preventDefault();
		const text = input.trim();
		if (!text) return;
		connRef.current?.send({ message: text });
		setInput("");
	}

	function handleDisconnect() {
		connRef.current?.close();
		connRef.current = undefined;
		setConnected(false);
	}

	useEffect(() => {
		return () => connRef.current?.close();
	}, []);

	return (
		<section>
			<h2>$ws &mdash; WebSocket</h2>
			<p className="description">
				Typed messages (ChatMessage &rarr; ChatBroadcast), typed connect args (username), broadcast from sibling $server (announce).
			</p>
			{!connected ? (
				<form onSubmit={handleConnect} className="form-row">
					<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter username to connect..." className="input" />
					<button type="submit" className="btn" disabled={!username.trim()}>Connect</button>
				</form>
			) : (
				<>
					<ul className="list">
						{messages.map((msg, i) => (
							<li key={i} className={`list-item${msg.sender === "system" ? " system" : ""}`}>
								<strong>{msg.sender}:</strong>&nbsp;{msg.message}
							</li>
						))}
					</ul>
					<div className="form-row">
						<form onSubmit={handleSend} className="form-row" style={{ flex: 1 }}>
							<input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message..." className="input" />
							<button type="submit" className="btn">Send</button>
						</form>
						<button type="button" className="btn secondary" onClick={() => announce("System announcement from $server")}>
							Announce
						</button>
						<button type="button" className="btn secondary" onClick={handleDisconnect}>Disconnect</button>
					</div>
				</>
			)}
		</section>
	);
}

// ── $worker ──

function WorkerSection() {
	const [stats, setStats] = useState<WorkerStats | null>(null);
	const [fibInput, setFibInput] = useState("10");
	const [fibResult, setFibResult] = useState<number | null>(null);
	const [callCount, setCallCount] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);

	async function handleStats() {
		setLoading(true);
		try {
			setStats(await demoWorker.computeStats());
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
			setFibResult(await demoWorker.computeFibonacci(n));
			setCallCount(await demoWorker.getCallCount());
		} finally {
			setLoading(false);
		}
	}

	return (
		<section>
			<h2>$worker &mdash; Web Worker</h2>
			<p className="description">
				Shared closure state across methods. computeStats() calls $server from inside the worker.
				{callCount !== null && <strong> Total worker calls: {callCount}</strong>}
			</p>

			<div className="edge-case">
				<button onClick={handleStats} disabled={loading} className="btn">computeStats() &mdash; calls $server from worker</button>
				{stats && <pre className="result">{JSON.stringify(stats, null, 2)}</pre>}
			</div>

			<form onSubmit={handleFib} className="form-row">
				<input type="number" value={fibInput} onChange={(e) => setFibInput(e.target.value)} className="input" style={{ width: 80 }} />
				<button type="submit" disabled={loading} className="btn">computeFibonacci(n)</button>
				{fibResult !== null && <span className="result-inline">= {fibResult}</span>}
			</form>
		</section>
	);
}

// ── $worker + $server ──

function UsersSection() {
	const [users, setUsers] = useState<User[]>([]);
	const [loading, setLoading] = useState(true);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");

	useEffect(() => {
		userWorker.list().then(setUsers).finally(() => setLoading(false));
	}, []);

	async function handleAdd(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim() || !email.trim()) return;
		await userWorker.add(name.trim(), email.trim());
		setUsers(await userWorker.list());
		setName("");
		setEmail("");
	}

	async function handleDelete(id: number) {
		await userWorker.remove(id);
		setUsers((prev) => prev.filter((u) => u.id !== id));
	}

	return (
		<section>
			<h2>$worker + $server &mdash; Combined</h2>
			<p className="description">Worker methods delegate to non-exported $server functions for database access.</p>
			<form onSubmit={handleAdd} className="form-row">
				<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="input" />
				<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="input" />
				<button type="submit" className="btn" disabled={!name.trim() || !email.trim()}>Add</button>
			</form>
			{loading ? (
				<p className="empty">Loading...</p>
			) : users.length === 0 ? (
				<p className="empty">No users.</p>
			) : (
				<ul className="list">
					{users.map((user) => (
						<li key={user.id} className="list-item">
							<span className="item-text"><strong>{user.name}</strong> &mdash; {user.email}</span>
							<button className="del" onClick={() => handleDelete(user.id)}>&times;</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

// ── Additional API edge cases ──

function AdditionalEdgeCasesSection() {
	const [serverResult, setServerResult] = useState<unknown>(null);
	const [httpResult, setHttpResult] = useState<unknown>(null);
	const [wsMessages, setWsMessages] = useState<string[]>([]);
	const [workerResult, setWorkerResult] = useState<unknown>(null);
	const edgeConnRef = useRef<ReturnType<typeof edgeSocket.connect> | undefined>(undefined);

	async function runServerEdges() {
		const report = await getEdgeCaseReport("ui");
		await noContentMutation("mutation returned undefined / 204");
		let thrown = "";
		try {
			await throwingServer("button click");
		} catch (error) {
			thrown = error instanceof Error ? error.message : String(error);
		}
		setServerResult({
			report,
			groupedObjectProperty: await groupedServer.countDone(),
			duplicateLabels: await Promise.all([duplicateLabels[0](), duplicateLabels[1]()] as const),
			noContentResolved: true,
			thrown,
		});
	}

	async function runHttpEdges() {
		setHttpResult({
			responseEndpoint: await responseEndpoint(),
			inspectRequest: await inspectRequest({ label: "typed-query" }, { headers: { "X-Edge-Demo": "header-value" } }),
			echoBodyWithOptionalQuery: await echoBodyWithOptionalQuery(
				{ text: "body + optional query + fetch options" },
				{ dryRun: "true" },
				{ headers: { "X-Edge-Demo": "post-header" } },
			),
			textLength: await textLength("plain text request body"),
			alwaysHead: await alwaysHead(),
		});
	}

	function connectEdgeSocket() {
		edgeConnRef.current?.close();
		const conn = edgeSocket.connect("edge-room", "optional-token");
		edgeConnRef.current = conn;
		setWsMessages([]);
		conn.onMessage((data) => {
			setWsMessages((prev) => [...prev, `${data.kind}: ${data.text}`]);
		});
		conn.onClose((event) => {
			setWsMessages((prev) => [...prev, `closed: ${event.code} ${event.reason}`.trim()]);
		});
	}

	async function runWorkerEdges() {
		setWorkerResult({
			summarize: await edgeWorker.summarize(3),
			calls: await edgeWorker.getCalls(),
			wsStub: await edgeWorker.connectEcho(),
		});
	}

	useEffect(() => {
		return () => edgeConnRef.current?.close();
	}, []);

	return (
		<section>
			<h2>Additional API edge cases</h2>
			<p className="description">
				Covers object-property and duplicate endpoint labels, raw Response returns, request metadata helpers,
				FetchOptions on HTTP wrappers, thrown errors, undefined/204 responses, typed WebSocket args/close, and async workers with same-file server/ws stubs.
			</p>

			<div className="methods-grid">
				<div className="method-card">
					<h3>$server transform edges</h3>
					<button className="btn" onClick={runServerEdges}>Run $server edge cases</button>
					{serverResult !== null && <pre className="result">{JSON.stringify(serverResult, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<h3>HTTP wrapper edges</h3>
					<button className="btn" onClick={runHttpEdges}>Run HTTP edge cases</button>
					{httpResult !== null && <pre className="result">{JSON.stringify(httpResult, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<h3>$ws typed args, broadcast, and close</h3>
					<div className="btn-row">
						<button className="btn" onClick={connectEdgeSocket}>Connect edgeSocket</button>
						<button className="btn secondary" onClick={() => edgeConnRef.current?.send({ kind: "ping", text: "hello" })}>Send ping</button>
						<button className="btn secondary" onClick={() => broadcastEdgeNotice("notice from sibling $server")}>Broadcast notice</button>
						<button className="btn secondary" onClick={() => edgeConnRef.current?.send({ kind: "close", text: "client requested close" })}>Server close</button>
					</div>
					{wsMessages.length > 0 && <pre className="result">{JSON.stringify(wsMessages, null, 2)}</pre>}
				</div>

				<div className="method-card">
					<h3>$worker async factory and same-file stubs</h3>
					<button className="btn" onClick={runWorkerEdges}>Run worker edge cases</button>
					{workerResult !== null && <pre className="result">{JSON.stringify(workerResult, null, 2)}</pre>}
				</div>
			</div>
		</section>
	);
}

// ── App ──

function App() {
	return (
		<div id="center">
			<h1>vite-plugin-server-sugar</h1>
			<p className="subtitle">API examples and edge cases</p>
			<TodosSection />
			<ServerEdgeCases />
			<HttpMethodsSection />
			<ChatSection />
			<WorkerSection />
			<UsersSection />
			<AdditionalEdgeCasesSection />
		</div>
	);
}

export default App;
