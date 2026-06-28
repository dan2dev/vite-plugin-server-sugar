# vite-plugin-server-sugar

![Vite compatibility](https://registry.vite.dev/api/badges?package=vite-plugin-server-sugar&tool=vite)
![Rollup compatibility](https://registry.vite.dev/api/badges?package=vite-plugin-server-sugar&tool=rollup)
![Rolldown compatibility](https://registry.vite.dev/api/badges?package=vite-plugin-server-sugar&tool=rolldown)

`vite-plugin-server-sugar` lets you keep small server features next to your
client code in a Vite app.

It recognizes compile-time macros such as `$server()` and `$ws()`, replaces
them with browser-safe clients, and emits a production Bun + Hono server that
runs the original server code.

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
await addTodo("Write docs");
```

There is no route file, schema file, or separate code generation command.
Types are inferred from the function or handler you pass to the macro.

## Features

- Type-safe server functions with `$server()`.
- HTTP method handlers with `$get()`, `$post()`, `$put()`, `$patch()`,
  `$delete()`, and `$head()`.
- Typed WebSockets with `$ws()`.
- Dedicated Web Workers with `$worker()`.
- Optional custom Hono app through `serverEntry`.
- Vite dev-server middleware, WebSocket upgrades, and HMR invalidation.
- Production server generation for Bun.
- Build-only Rollup and Rolldown entrypoints.

## Install

```bash
npm install vite-plugin-server-sugar hono
```

```bash
bun add vite-plugin-server-sugar hono
```

`hono` is a peer dependency. The generated production server uses Bun runtime
APIs, so run it with Bun:

```bash
bun dist/server/server.mjs
```

If your handlers import Bun-only modules such as `bun:sqlite`, run Vite with
Bun too:

```bash
bunx --bun vite
bunx --bun vite build
```

The Vite integration expects Vite `>=6.0.0`. Rollup `>=4.0.0` and Rolldown
`>=1.0.0` are supported for build-only usage through explicit subpaths.

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
      pathnameBase: "/server",
      compile: false,
    }),
  ],
});
```

`pathnameBase` is optional. By default, generated endpoints are mounted at
`/__server-build/<endpoint>`. Setting `pathnameBase: "/server"` mounts
`$server()` and HTTP helper endpoints at `/server/<endpoint>` and `$ws()`
endpoints at `/server-ws/<endpoint>`.

Register the macro types in `tsconfig.json`:

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

The macros are ambient compile-time globals. Do not import `$server`, `$ws`,
`$worker`, or the HTTP method helpers from the package.

## Server Functions

Use `$server()` for typed RPC-style calls. The client receives an async
function. The server runs the original function.

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

```ts
const user = await getUser("u_123");
await renameUser("u_123", "Ada");
```

Values passed between browser and server should be JSON-serializable. The
plugin preserves TypeScript types at compile time, but it does not add runtime
schema validation.

Top-level state referenced by handlers is emitted into a shared per-file server
scope. Sibling handlers in the same file can call each other and share state.

```ts
let requestCount = 0;

export const countRequest = $server(() => {
  requestCount += 1;
  return requestCount;
});

export const getStatus = $server(async () => {
  return {
    requests: countRequest(),
    uptime: process.uptime(),
  };
});
```

## HTTP Handlers

Use HTTP method helpers when you want method-specific endpoints and a
Hono-compatible context object.

```ts
export const listTodos = $get(async (c) => {
  const limit = c.req.query("limit");
  return db.query("SELECT * FROM todos LIMIT ?").all(Number(limit ?? "50"));
});

export const getTodo = $get(
  async (c: ServerContext<never, { id: string }>) => {
    return db.query("SELECT * FROM todos WHERE id = ?").get(c.req.query("id"));
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
objects are optional.

`$post()`, `$put()`, and `$patch()` take:

```ts
body, optionalQuery, optionalFetchOptions
```

`$get()`, `$delete()`, and `$head()` take:

```ts
optionalQuery, optionalFetchOptions
```

Fetch options currently support request headers:

```ts
await createTodo(
  { text: "Document auth headers" },
  undefined,
  { headers: { Authorization: "Bearer token" } },
);
```

Handlers may return JSON-serializable values, `undefined`, or a `Response`.
Returning `undefined` sends `204 No Content`.

## WebSockets

Use `$ws()` for persistent connections.

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

Client connections expose `.send(data)`, `.onMessage(cb)`, `.onClose(cb)`,
`.close()`, and `.readyState`. Server handlers receive `ws.args` from
`connect(...args)`. Calling `chat.send(data)` from a sibling handler broadcasts
to every open connection for that endpoint.

## Web Workers

Use `$worker()` to create a dedicated module worker. The factory runs once
inside the worker, and the returned methods become async client proxies.

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

Same-file `$server()` and `$ws()` siblings referenced by a worker are replaced
with client stubs inside the worker module, so server calls and WebSocket
connections work from the worker thread.

## Custom Hono App

Use `serverEntry` when you want custom routes or middleware alongside the
generated endpoints. Export a Hono app as the default export or as a named
`app` export.

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

In dev and production, generated server endpoints are mounted into the Hono
app. WebSocket upgrades are handled separately because Hono does not process
the raw WebSocket upgrade.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | `3001` | Dev-server port default and production fallback port. Production can override it with `PORT`. |
| `serverEntry` | `string` | none | Project-root-relative path to a module exporting a Hono app as `default` or named `app`. |
| `compile` | `boolean` | `false` | Also compile standalone Bun executables for supported Bun targets after emitting `dist/server/server.mjs`. |

## Build Output

With Vite, the plugin changes the client output directory to `dist/client` and
writes the generated server to `dist/server/server.mjs`.

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

When `compile: true`, standalone Bun executables are also emitted under
`dist/server/`.

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

If the plugin cannot infer a natural label, it falls back to a line/column
label. Duplicate endpoint names in the same file get a line/column suffix.

## Runtime Contracts

`$server()` endpoints:

- Method: `POST`.
- Path: `/{pathnameBase}/<endpoint>`, defaulting to
  `/__server-build/<endpoint>`.
- Body: JSON array of function arguments. A non-array JSON value is passed as
  one argument.
- Success: JSON response, `204` for `undefined`, or the returned `Response`.
- Errors: `404` unknown endpoint, `405` wrong method, `415` unsupported media
  type, `400` invalid JSON or bad URL encoding, `500` handler exception.

HTTP helper endpoints:

- Path: `/{pathnameBase}/<endpoint>`, defaulting to
  `/__server-build/<endpoint>`.
- Method: the matching helper method.
- `$get()`, `$delete()`, and `$head()` receive query parameters.
- `$post()`, `$put()`, and `$patch()` receive a JSON body, optional query
  parameters, and optional headers.

`$ws()` endpoints:

- Path: `/{pathnameBase}-ws/<endpoint>`, defaulting to
  `/__server-build-ws/<endpoint>`.
- `connect(...args)` serializes connection args into the WebSocket URL.
- Messages sent through generated wrappers are JSON-serialized.
- Incoming messages are JSON-parsed when possible and otherwise passed through
  as raw data.

Client wrappers read response text, throw `Error(message)` for non-2xx
responses, and parse successful non-empty responses as JSON.

## Rollup And Rolldown

The default Vite entrypoint is the complete integration. It includes config
handling, dev middleware, WebSocket upgrades, HMR invalidation, worker chunks,
and production server generation.

For build-only Rollup or Rolldown usage, import an explicit subpath:

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
chunks, and production server generation hooks. They do not provide Vite
dev-server middleware or HMR.

## Repository

The publishable package lives in [`packages/vite-plugin`](./packages/vite-plugin).

Useful docs and examples:

- [`packages/vite-plugin/README.md`](./packages/vite-plugin/README.md)
- [`packages/vite-plugin/ARCHITECTURE.md`](./packages/vite-plugin/ARCHITECTURE.md)
- [`examples/basic-pwa`](./examples/basic-pwa)

## Development

Install dependencies:

```bash
bun install
```

Run tests:

```bash
bun run test
```

Run type checks:

```bash
bun run typecheck
```

Build the package:

```bash
bun run build
```
