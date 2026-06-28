# vite-plugin-server-sugar

![Vite compatibility](https://registry.vite.dev/api/badges?package=vite-plugin-server-sugar&tool=vite)
![Rollup compatibility](https://registry.vite.dev/api/badges?package=vite-plugin-server-sugar&tool=rollup)
![Rolldown compatibility](https://registry.vite.dev/api/badges?package=vite-plugin-server-sugar&tool=rolldown)

Write server functions, HTTP handlers, WebSockets, and Web Workers inline in
your Vite app. `vite-plugin-server-sugar` turns compile-time macros like
`$server()` and `$ws()` into browser-safe clients, then emits a Bun + Hono
server that runs the original server code.

```ts
// src/todos.ts
import { db } from "./db";

export const getTodos = $server(async () => {
  return db.query("SELECT * FROM todos ORDER BY created_at DESC").all();
});

export const addTodo = $server(async (text: string) => {
  return db.query("INSERT INTO todos (text) VALUES (?) RETURNING *").get(text);
});
```

```tsx
// src/App.tsx
import { addTodo, getTodos } from "./todos";

const todos = await getTodos();
await addTodo("Ship the README");
```

There is no route file, schema file, or separate codegen command. The macros
preserve TypeScript argument and return types on the client, while server-only
imports used only inside handlers are removed from the browser bundle.

## Features

- Type-safe inline RPC with `$server()`.
- REST-shaped handlers with `$get()`, `$post()`, `$put()`, `$patch()`,
  `$delete()`, and `$head()`.
- Typed WebSockets with `$ws()`, including server-to-client broadcast from
  sibling handlers.
- Dedicated Web Workers with `$worker()` and typed async method proxies.
- Optional custom Hono app through `serverEntry`.
- Vite dev-server integration, HMR invalidation, and production server
  generation.
- Build-only Rollup and Rolldown entrypoints.

## Install

```bash
npm install vite-plugin-server-sugar hono
```

```bash
bun add vite-plugin-server-sugar hono
```

`hono` is a peer dependency. The generated production server runs on Bun. If
your handlers use Bun-only APIs, run Vite through Bun as well so development
and production have the same runtime behavior:

```bash
bunx --bun vite
bunx --bun vite build
```

The primary integration expects Vite `>=6.0.0`. Build-only Rollup `>=4.0.0`
and Rolldown `>=1.0.0` entrypoints are also available.

## Setup

Add the plugin to `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { serverBuildPlugin } from "vite-plugin-server-sugar";

export default defineConfig({
  plugins: [
    serverBuildPlugin({
      port: 3001,
      serverEntry: "src/server.ts",
      compile: false,
    }),
  ],
});
```

Register the ambient macro types in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": [
      "vite-plugin-server-sugar/server",
      "vite-plugin-server-sugar/ws",
      "vite-plugin-server-sugar/worker"
    ]
  }
}
```

The macros are compile-time markers. Do not import `$server`, `$ws`,
`$worker`, or the HTTP method helpers from the package.

## Server Functions

Use `$server()` for typed RPC-style calls. The client calls a generated
`POST /__server-build/<endpoint>` endpoint; the server runs the original
function.

```ts
// src/user.ts
import { db } from "./db";

export const getUser = $server(async (id: string) => {
  return db.query("SELECT * FROM users WHERE id = ?").get(id);
});

export const renameUser = $server(async (id: string, name: string) => {
  db.query("UPDATE users SET name = ? WHERE id = ?").run(name, id);
});
```

```tsx
const user = await getUser("u_123");
await renameUser("u_123", "Ada");
```

Values that cross the wire should be JSON-serializable. TypeScript inference is
compile-time only; the plugin does not add runtime schema validation.

### Shared State And Sibling Calls

Top-level values referenced by handlers are captured into a shared per-file
server scope. Sibling handlers in the same file can call each other and share
state.

```ts
let requestCount = 0;

export const countRequest = $server(() => {
  requestCount += 1;
  return requestCount;
});

export const getStatus = $server(async () => {
  return {
    requests: await countRequest(),
    uptime: process.uptime(),
  };
});
```

## HTTP Method Helpers

Use the HTTP helpers when you want method-specific handlers with a small
Hono-compatible context object.

```ts
// src/todos.ts
import { db } from "./db";

export const listTodos = $get(async (c) => {
  const limit = c.req.query("limit");
  return db.query("SELECT * FROM todos LIMIT ?").all(Number(limit ?? "50"));
});

export const getTodo = $get(
  async (c: ServerContext<never, { id: string }>) => {
    const id = c.req.query("id");
    return db.query("SELECT * FROM todos WHERE id = ?").get(id);
  },
);

export const createTodo = $post(
  async (c: ServerContext<{ text: string }>) => {
    const body = await c.req.json();
    return db.query("INSERT INTO todos (text) VALUES (?) RETURNING *").get(
      body.text,
    );
  },
);
```

```ts
await listTodos({ limit: "10" });
await getTodo({ id: "42" });
await createTodo({ text: "Write docs" });
```

Typed query objects make the client query argument required. Untyped query
objects are optional. `$post()`, `$put()`, and `$patch()` take the body first,
then an optional query object, then optional fetch headers.

```ts
await createTodo(
  { text: "Document auth headers" },
  undefined,
  { headers: { Authorization: "Bearer token" } },
);
```

Handlers may return plain JSON-serializable values, `undefined`, or a
`Response`. Returning `undefined` sends `204 No Content`.

## WebSockets

Use `$ws()` for persistent connections. Message types are inferred from handler
annotations, or can be supplied explicitly.

```ts
// src/chat.ts
type ClientMessage = { text: string };
type ServerMessage = { text: string; from: string };

const history: ServerMessage[] = [];

export const getHistory = $server(async () => history);

export const chat = $ws<ClientMessage, ServerMessage, [username: string]>({
  onOpen(ws) {
    ws.send({ text: `Joined ${ws.args[0]}`, from: "system" });
  },
  onMessage(ws, data) {
    const message = { text: data.text, from: ws.args[0] };
    history.push(message);
    chat.send(message);
  },
});
```

```ts
const conn = chat.connect("ada");

conn.onMessage((message) => {
  console.log(message.from, message.text);
});

conn.send({ text: "hello" });
```

On the client, `.connect(...args)` opens a `WebSocket`, `.send(data)` sends
JSON, `.onMessage(cb)` receives parsed messages, and `.close()` closes the
socket. On the server, `ws.args` contains the connection arguments and
`chat.send(data)` broadcasts to open sockets for that endpoint.

## Web Workers

Use `$worker()` to create a dedicated module worker with typed async method
proxies. The factory runs once inside the worker, so closure state is shared
across method calls.

```ts
// src/stats-worker.ts
import { getTodos } from "./todos";

export const statsWorker = $worker(() => {
  let calls = 0;

  async function summarize() {
    calls += 1;
    const todos = await getTodos();
    return {
      calls,
      total: todos.length,
      done: todos.filter((todo) => todo.done).length,
    };
  }

  return { summarize };
});
```

```ts
const stats = await statsWorker.summarize();
```

`$server()` and `$ws()` wrappers can be called from inside workers because
`fetch` and `WebSocket` are available in Web Workers.

## Custom Hono App

Use `serverEntry` when you want custom routes or middleware alongside generated
endpoints. Export a Hono app as the default export or as a named `app` export.

```ts
// src/server.ts
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.use("*", async (_c, next) => {
  await next();
});

export default app;
```

In dev mode, generated API routes are mounted into this app through Vite SSR.
In production, the generated Bun server uses the same Hono app before serving
static client assets.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | `3001` | Dev server port default and production fallback port. Production can override it with `PORT`. |
| `serverEntry` | `string` | none | Project-root-relative path to a module exporting a Hono app as `default` or named `app`. |
| `compile` | `boolean` | `false` | Also compile standalone Bun executables for supported Bun targets after emitting `dist/server/server.mjs`. |

## Build Output

`vite build` writes the client build to `dist/client` and emits the generated
server to `dist/server/server.mjs`.

```txt
dist/
  client/
    index.html
    assets/
  server/
    server.mjs
```

Run the generated server with Bun:

```bash
bun dist/server/server.mjs
```

When `compile: true`, the plugin also emits standalone Bun executables for the
supported Bun targets under `dist/server/`.

## Endpoint Names

Endpoint names are deterministic. The plugin takes the source file path
relative to the Vite root, strips a leading `src/`, removes the extension,
appends an inferred handler label, and kebab-cases every segment.

```txt
src/todos.ts + getTodos -> todos/get-todos
src/admin/users.ts + deleteUser -> admin/users/delete-user
```

Labels usually come from the assigned variable or object property name:

```ts
export const getUser = $server(async () => {});

export const api = {
  saveUser: $server(async () => {}),
};
```

If the plugin cannot infer a natural name, it falls back to a line/column
label. Duplicate endpoint names in the same file get a line/column suffix.

## Runtime Contracts

`$server()` endpoints:

- Method: `POST`.
- Path: `/__server-build/<endpoint>`.
- Body: JSON array of function arguments. A non-array JSON value is passed as
  one argument.
- Success: JSON response, `204` for `undefined`, or the returned `Response`.
- Errors: `404` unknown endpoint, `405` wrong method, `415` unsupported content
  type, `400` invalid JSON or bad URL encoding, `500` handler exception.

HTTP helper endpoints:

- Path: `/__server-build/<endpoint>`.
- Method: the matching helper method.
- `$get()`, `$delete()`, and `$head()` receive query parameters.
- `$post()`, `$put()`, and `$patch()` receive a JSON body, optional query
  parameters, and optional headers.

`$ws()` endpoints:

- Path: `/__server-build-ws/<endpoint>`.
- `connect(...args)` serializes connection args into the WebSocket URL.
- Messages sent through the generated wrappers are JSON-serialized.
- Incoming messages are JSON-parsed when possible and fall back to raw data.

Client wrappers read the response text, throw `Error(message)` for non-2xx
responses, and parse successful non-empty responses as JSON.

## Rollup And Rolldown

The default Vite entrypoint is the most complete integration. It includes Vite
config handling, dev-server middleware, WebSocket upgrades, HMR invalidation,
and production server generation.

For build-only Rollup or Rolldown usage, import the explicit subpath:

```ts
// rollup.config.ts
import serverBuild from "vite-plugin-server-sugar/rollup";

export default {
  input: "src/main.ts",
  output: { dir: "dist/client", format: "esm" },
  plugins: [serverBuild({ port: 3001 })],
};
```

```ts
// rolldown.config.ts
import serverBuild from "vite-plugin-server-sugar/rolldown";

export default {
  input: "src/main.ts",
  output: { dir: "dist/client", format: "esm" },
  plugins: [serverBuild({ port: 3001 })],
};
```

Rollup and Rolldown entrypoints share the transform, virtual modules, worker
chunks, and production server generation hooks, but they do not provide Vite
dev-server middleware or HMR.

## Examples

The repository includes a Vite example app at
[`examples/basic-pwa`](../../examples/basic-pwa) covering `$server`, HTTP
method helpers, `$ws`, `$worker`, custom Hono routes, shared state, and edge
cases.

## Development

Install dependencies:

```bash
bun install
```

Run the test suite:

```bash
bun run test
```

Build the package:

```bash
bun run build
```

For maintainer-level implementation notes, see
[`ARCHITECTURE.md`](./ARCHITECTURE.md).
