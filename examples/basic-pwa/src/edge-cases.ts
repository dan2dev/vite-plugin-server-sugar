import { db } from "./db";
import type { Todo } from "./todos";

const SERVER_ONLY_PREFIX = "edge";
const EDGE_MULTIPLIER = 2;
const EDGE_OFFSET = EDGE_MULTIPLIER + 1;

function decorate(label: string) {
	return `${SERVER_ONLY_PREFIX}:${label}:${EDGE_OFFSET}`;
}

export interface EdgeCaseReport {
	moduleState: number;
	decorated: string;
	todoCount: number;
	calledSibling: string;
}

let moduleState = 0;

// $server edge: module-level state + transitive declarations + sibling call.
export const getEdgeCaseReport = $server(async (label: string = "default"): Promise<EdgeCaseReport> => {
	moduleState += 1;
	const todoCount = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM todos").get()?.count ?? 0;
	return {
		moduleState,
		decorated: decorate(label),
		todoCount,
		calledSibling: await siblingServerMessage("from-report"),
	};
});

// $server edge: sibling cross-reference target and string return.
export const siblingServerMessage = $server((source: string) => {
	return decorate(source);
});

// $server edge: undefined return becomes HTTP 204 but the typed client resolves to undefined.
export const noContentMutation = $server(async (text: string) => {
	db.query("INSERT INTO todos (text, done) VALUES (?, 1)").run(`[no-content] ${text}`);
});

// $server edge: thrown errors become rejected client promises with the server message.
export const throwingServer = $server(async (message: string) => {
	throw new Error(`Expected demo error: ${message}`);
});

// $server edge: object-property label inference.
export const groupedServer = {
	countDone: $server(async () => {
		return db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM todos WHERE done = 1").get()?.count ?? 0;
	}),
};

// Duplicate natural labels are disambiguated internally by source position.
export const duplicateLabels = [
	$server(async () => "duplicate-label:first"),
	$server(async () => "duplicate-label:second"),
] as const;

// HTTP edge: return a raw Response instead of JSON.
export const responseEndpoint = $get(async () => {
	return new Response("raw response body", {
		status: 202,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
});

// HTTP edge: inspect raw request metadata and query/header helpers.
export const inspectRequest = $get(async (c: ServerContext<never, { label: string }>) => {
	return {
		method: c.req.method,
		urlHasLabel: c.req.url.includes("label="),
		label: c.req.query("label"),
		header: c.req.header("x-edge-demo") ?? null,
		allHeadersIncludesDemo: "x-edge-demo" in c.req.header(),
	};
});

// HTTP edge: optional untyped query + FetchOptions on a body method.
export const echoBodyWithOptionalQuery = $post(async (c: ServerContext<{ text: string }>) => {
	const body = await c.req.json();
	return {
		body,
		dryRun: c.req.query("dryRun") ?? "false",
		header: c.req.header("x-edge-demo") ?? null,
	};
});

// HTTP edge: text body access from a typed JSON body endpoint.
export const textLength = $post(async (c: ServerContext<string>) => {
	const text = await c.req.text();
	return { length: text.length, text };
});

// HTTP edge: HEAD result is useful for status, but the browser fetch body is empty.
export const alwaysHead = $head(async () => {
	return { ok: true };
});

interface EdgeMessage {
	kind: "ping" | "close";
	text: string;
}

interface EdgeBroadcast {
	kind: "welcome" | "echo" | "notice" | "closed";
	text: string;
}

type EdgeSocket = ServerWs<EdgeBroadcast, [room: string, token?: string]>;

const edgeConnections = new Set<EdgeSocket>();

export const edgeSocket = $ws<EdgeMessage, EdgeBroadcast, [room: string, token?: string]>({
	onOpen(ws) {
		edgeConnections.add(ws);
		const [room, token] = ws.args;
		ws.send({ kind: "welcome", text: `room=${room}; token=${token ?? "none"}` });
	},
	onMessage(ws, data) {
		if (data.kind === "close") {
			ws.close(4000, data.text);
			return;
		}
		ws.send({ kind: "echo", text: `${ws.args[0]}:${data.text}` });
	},
	onClose(ws) {
		edgeConnections.delete(ws);
	},
});

// $ws edge: broadcast from sibling $server.
export const broadcastEdgeNotice = $server(async (text: string) => {
	edgeSocket.send({ kind: "notice", text });
	return { sent: edgeConnections.size };
});

const workerSeed = 7;
function doubleInModule(n: number) {
	return n * 2;
}

const sameFileWorkerTodoCount = $server(async () => {
	return db.query<Todo, []>("SELECT * FROM todos").all().length;
});

const sameFileWorkerSocket = $ws<{ text: string }, { text: string }>({
	onMessage(ws, data) {
		ws.send({ text: data.text.toUpperCase() });
	},
});

// $worker edge: async factory, module declaration capture, same-file $server/$ws stubs.
export const edgeWorker = $worker(async () => {
	let calls = workerSeed;

	async function summarize(multiplier: number) {
		calls += 1;
		const todoCount = await sameFileWorkerTodoCount();
		return {
			calls,
			todoCount,
			computed: doubleInModule(todoCount + multiplier),
		};
	}

	function getCalls() {
		return calls;
	}

	function connectEcho() {
		const conn = sameFileWorkerSocket.connect();
		conn.close();
		return "opened-and-closed";
	}

	return { summarize, getCalls, connectEcho };
});
