# vite-plugin-server-build

A Vite plugin that turns `$server()` and `$ws()` calls written inline in
your frontend source into type-safe server endpoints. In the browser bundle the
calls become `fetch()` or `WebSocket` clients; on the server the original
functions and handlers run inside a generated Bun + Hono application.

```ts
// src/todos.ts
import { db } from "./db";

export const getTodos = server(async () => {
  return db.query("SELECT * FROM todos").all();
});

export const addTodo = server(async (text: string) => {
  return db.query("INSERT INTO todos (text) VALUES (?) RETURNING *").get(text);
});
```

```tsx
// src/App.tsx
import { getTodos, addTodo } from "./todos";

const todos = await getTodos(); // POST /__server-build/todos/get-todos
await addTodo("buy milk");      // POST /__server-build/todos/add-todo
```

No schema, no route file, no separate code generation command. The functions
remain normal TypeScript values with inferred argument and return types on both
sides of the wire, while server-only imports used only inside handlers are
removed from the browser output.

`$ws()` follows the same model for persistent connections:

```ts
// src/chat.ts
type ChatMessage = { text: string };

const history: ChatMessage[] = [];

export const getHistory = server(async () => history);

export const chat = ws({
  onOpen(ws: ServerWs<ChatMessage>) {
    ws.send({ text: "connected" });
  },
  onMessage(ws: ServerWs<ChatMessage>, data: ChatMessage) {
    history.push(data);
    chat.send(data);
  },
});
```

```tsx
const conn = chat.connect();
conn.onMessage((data) => console.log(data.text));
conn.send({ text: "hello" });
```

For the maintainer-level implementation notes, see
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Install

```bash
npm install vite-plugin-server-build hono
# or
bun add vite-plugin-server-build hono
```

Requires Vite `>=6.0.0`. The generated production server runs on Bun, and
projects that use Bun-only APIs in handlers should run Vite under Bun as well
for dev/build parity, for example `bunx --bun vite` and
`bunx --bun vite build`.

`hono` is a **peer dependency**. It must be installed in your project even if you don't provide a custom `serverEntry`, as the generated production server and dev-mode augmentation rely on it.

## Setup

**`vite.config.ts`**

```ts
import { defineConfig } from "vite";
import { serverBuildPlugin } from "vite-plugin-server-build";

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

**`tsconfig.json`**

Register the ambient macro types so TypeScript recognizes `$server()` and
`$ws()` without imports:

```json
{
  "compilerOptions": {
    "types": [
      "vite-plugin-server-build/server",
      "vite-plugin-server-build/ws"
    ]
  }
}
```

**Optional `src/server.ts`**

Use `serverEntry` when you want your own routes or middleware to run alongside
generated endpoints. Export a Hono app as the default export or as a named
`app` export.

```ts
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.use("*", async (_c, next) => {
  await next();
});

export default app;
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `3001` | Dev-server port default and generated production server fallback port. Production can override it with the `PORT` environment variable. |
| `serverEntry` | `string` | none | Project-root-relative path to a module exporting a Hono app as `default` or named `app`. Its routes and middleware are layered with generated server routes. |
| `compile` | `boolean` | `false` | After emitting `dist/server/server.mjs`, also compile standalone Bun executables for every supported Bun target. Requires Bun runtime support or the `bun` CLI on `PATH`. |

## Programming Model

`$server()` and `$ws()` are compile-time macros, not runtime functions.
Their declarations in `server.d.ts` and `ws.d.ts` exist only for type
checking.

During Vite transforms:

- `server(fn)` is replaced in client code with an async function that posts
  JSON to `/__server-build/<endpoint>`.
- `ws(handlers)` is replaced in client code with an object containing
  `connect(...args)`, which opens `ws://` or `wss://` to
  `/__server-build-ws/<endpoint>`.
- The original server function/handler source is recorded in an internal
  registry and later loaded through dev virtual modules or emitted into the
  production server bundle.
- Runtime imports referenced only inside server handlers are preserved for the
  server build and removed from the client build when they are not used
  elsewhere.

Endpoint names are deterministic. The plugin takes the file path relative to
the Vite root, strips a leading `src/`, removes the extension, appends an
inferred handler label, then kebab-cases each segment:

```txt
src/todos.ts + getTodos -> todos/get-todos
src/admin/users.ts + deleteUser -> admin/users/delete-user
```

Labels usually come from the assigned variable or object property name:

```ts
export const getUser = server(async () => {});

export const api = {
  saveUser: server(async () => {}),
};
```

If the plugin cannot infer a natural name, it falls back to a line/column label.
Duplicate endpoint names in the same file get a line/column suffix.

## Request Contract

Generated `$server()` endpoints use this HTTP contract:

- Method: `POST`.
- Path: `/__server-build/<endpoint>`.
- Body: JSON array of function arguments. A non-array JSON value is accepted
  and passed as a single argument.
- Content type: omitted or `application/json`.
- Success: JSON response for returned values.
- `undefined` return: `204 No Content`.
- Invalid endpoint: `404`.
- Wrong method: `405` with `Allow: POST`.
- Unsupported content type: `415`.
- Bad URL encoding or invalid JSON in production/custom-app routing: `400`.
- Handler exception: `500` with `{ "error": "<message>" }`.

The client wrapper reads the response text, throws `Error(message)` for
non-2xx responses, and JSON-parses successful non-empty responses.

Values crossing the wire should be JSON-serializable. There is no runtime
schema validation; TypeScript inference is compile-time only.

## WebSocket Contract

`$ws()` supports `onOpen`, `onMessage`, and `onClose` handlers.

```ts
export const chat = ws<
  { text: string },
  { text: string; from: string },
  [roomId: string]
>({
  onOpen(ws) {
    console.log(ws.args[0]);
  },
  onMessage(ws, data) {
    ws.send({ text: data.text, from: "server" });
  },
});
```

On the client:

- `chat.connect(...args)` serializes the connect args into the ws URL.
- `conn.send(data)` JSON-stringifies outgoing messages.
- `conn.onMessage(cb)` receives JSON-parsed messages, falling back to raw data
  if parsing fails.
- `conn.onClose(cb)`, `conn.close(...)`, and `conn.readyState` mirror the
  underlying browser ws.

On the server:

- `ws.args` contains the args passed to `connect(...args)`.
- `ws.send(data)` JSON-stringifies data before sending it to that client.
- The object returned by `$ws()` also has `send(data)`, which broadcasts
  to all currently open sockets for that endpoint. This is meant to be called
  from sibling `$server()` or `$ws()` handlers in the same file.

## Shared Module State

Top-level declarations used by handlers are captured into a shared per-file
server scope. That means state declared next to handlers is shared across
requests and across sibling `$server()` and `$ws()` handlers from the
same file in both dev and production.

```ts
const countByUser = new Map<string, number>();

export const increment = server(async (userId: string) => {
  countByUser.set(userId, (countByUser.get(userId) ?? 0) + 1);
  return countByUser.get(userId);
});

export const reset = server(async (userId: string) => {
  countByUser.delete(userId);
});
```

Only declarations that the handlers actually reference are emitted into the
server scope. If a handler references a value that is not imported, not locally
bound, not a known runtime global, and not captured from module scope, the
plugin emits a warning during scans/watch updates.

## Development Mode

The plugin uses Vite's standard plugin lifecycle:

- `config` forces the client build output into a `client` directory under the
  configured `dist` root and defaults the dev server port to `port`.
- `buildStart` and `configureServer` scan project `.ts`/`.tsx` files, skipping
  `node_modules`, `.git`, declaration files, and the dist directory.
- `transform` rewrites client-facing source and registers discovered handlers.
- `resolveId` and `load` serve internal virtual modules for client helpers,
  per-file server modules, and per-endpoint server modules.
- File watcher events reprocess changed files and invalidate the relevant Vite
  module graph entries so the next request uses fresh handler code.

Backend HTTP requests in dev are served through the Vite dev server:

- Without `serverEntry`, plugin middleware handles `/__server-build/*`
  directly.
- With `serverEntry`, the configured Hono app is loaded through
  `server.ssrLoadModule()`, augmented once with generated server routes, and
  called via `app.fetch()`. This lets user middleware run for generated
  server routes, matching production behavior. Non-API `404` responses fall
  through to Vite's normal middleware.

WebSocket upgrades in dev hook the Vite HTTP server's `upgrade` event and use
the `ws` package in `noServer` mode. The $ws handler module and upgrade
handler share open-connection state through a fixed `globalThis` key so
`chat.send(...)` broadcasts correctly during dev SSR.

## Production Build

On `vite build`, Vite writes the client build to `dist/client` by default.
Then the plugin's `writeBundle` hook generates and bundles the server:

1. Clean stale top-level entries in the dist root while preserving
   `dist/client` and `dist/server`.
2. Remove the previous `dist/server` directory.
3. Generate one Bun + Hono server source module from all registered handlers
   and the optional `serverEntry`.
4. Bundle that generated source with Rolldown into `dist/server/server.mjs`.
5. If `compile: true`, compile standalone Bun executables for all supported
   targets.

The generated production server:

- Registers `POST /__server-build/*` for generated $server calls.
- Registers `app.all('/__server-build/*')` to reject non-POST API calls.
- Uses the configured Hono app when `serverEntry` is present, otherwise creates
  a bare `new Hono()`.
- Serves static files from `dist/client`.
- Uses long immutable cache headers for files under `/assets/` and
  revalidation headers elsewhere.
- Prevents directory traversal before reading static files.
- Falls back to `index.html` for unmatched GET requests, making SPA routing
  work from the same server process.
- Uses `Bun.serve`. When $ws handlers exist, the same `Bun.serve` call
  also performs ws upgrades and dispatches `open`, `message`, and
  `close` events to the generated handlers.
- Reads `PORT` from `Bun.env.PORT`; invalid or missing values fall back to the
  configured `port`.

## Build Output

Default output:

```txt
dist/
  client/
    index.html
    assets/
  server/
    server.mjs
```

Run the production server:

```bash
bun dist/server/server.mjs
```

With `compile: true`, the plugin also emits one executable per supported Bun
compile target:

```txt
dist/server/server-bun-darwin-x64
dist/server/server-bun-darwin-arm64
dist/server/server-bun-linux-x64
dist/server/server-bun-linux-arm64
dist/server/server-bun-linux-x64-musl
dist/server/server-bun-linux-arm64-musl
dist/server/server-bun-windows-x64.exe
dist/server/server-bun-windows-arm64.exe
```

The compiled binaries still expect the client build directory to exist next to
the generated server output layout. The generated code resolves static asset
paths from `import.meta.url` for normal `server.mjs` execution and from
`process.execPath` inside Bun's compiled executable environment.

## Internal Architecture

The implementation is split into these main pieces:

```txt
src/index.ts
  Vite plugin entry point and lifecycle hooks.

src/core/processor.ts
  TypeScript AST transform. Finds $server()/$ws(), derives endpoints,
  collects imports and shared declarations, rewrites client code, and fills
  the registries.

src/core/registry.ts
  Endpoint registry indexed by endpoint and source file for incremental
  updates.

src/dev-server/virtual-modules.ts
  Generates Vite virtual modules for client helpers and server handlers.

src/dev-server/middleware.ts
  Converts Node requests/responses to Web Request/Response objects and handles
  generated server requests in dev.

src/dev-server/ws-upgrade.ts
  Handles dev ws upgrades with the ws package.

src/dev-server/hmr.ts
  Invalidates Vite module graph entries for changed endpoint modules.

src/build/bundle-generator.ts
  Emits the complete production server source string.

src/build/bundler.ts
  Bundles the generated source with Rolldown and optionally compiles Bun
  executables.
```

The full walkthrough of the processor, virtual module graph, production
bundling pipeline, and validation behavior lives in
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Development

Install dependencies:

```bash
bun install
```

Run tests:

```bash
bun run test
```

Build the plugin package:

```bash
bun run build
```
