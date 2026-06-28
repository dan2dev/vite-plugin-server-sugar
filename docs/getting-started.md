# Getting started

This guide assumes an existing Vite app and Bun available for running server
code. The plugin works with Vite in dev/build mode and emits a production
Bun + Hono server.

## Install

Install the plugin and its Hono peer dependency:

```bash
npm install vite-plugin-server-sugar hono
```

```bash
bun add vite-plugin-server-sugar hono
```

If your server handlers import Bun-only modules such as `bun:sqlite`, run Vite
through Bun so those imports are available during dev SSR and production builds:

```bash
bunx --bun vite
bunx --bun vite build
```

## Configure Vite

Add `serverBuildPlugin()` to `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { serverBuildPlugin } from "vite-plugin-server-sugar";

export default defineConfig({
  plugins: [
    serverBuildPlugin({
      port: 3001,
      pathnameBase: "/server",
    }),
  ],
});
```

`pathnameBase` is optional. If it is omitted, generated HTTP endpoints are
mounted at `/__server-build/<endpoint>` and WebSocket endpoints are mounted at
`/__server-build-ws/<endpoint>`.

## Add macro types

The macros are ambient compile-time globals. Add the declaration subpaths to
`tsconfig.json`:

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

Do not import `$server`, `$get`, `$ws`, `$worker`, or the other macros from the
package. The plugin finds and rewrites those calls during transform.

## Write a server function

Create a module that exports a `$server()` function:

```ts
// src/todos.ts
type Todo = {
  id: string;
  text: string;
  done: boolean;
};

const todos: Todo[] = [];

export const listTodos = $server(async () => todos);

export const addTodo = $server(async (text: string) => {
  const todo = { id: crypto.randomUUID(), text, done: false };
  todos.push(todo);
  return todo;
});
```

Use it from client code like a normal async function:

```tsx
// src/App.tsx
import { addTodo, listTodos } from "./todos";

const todos = await listTodos();
const next = await addTodo("Write docs");
```

The client bundle receives a typed `fetch` wrapper. The generated Bun server
runs the original function.

## Run in dev

Start Vite:

```bash
npm run dev
```

Or with Bun:

```bash
bunx --bun vite
```

The plugin installs Vite middleware for generated HTTP endpoints and hooks the
dev server's HTTP upgrade event for `$ws()` endpoints.

## Build and run production

Build the app:

```bash
bunx --bun vite build
```

With the Vite entrypoint, the plugin writes the client build to `dist/client`
and the generated server to `dist/server/server.mjs`:

```txt
dist/
  client/
    index.html
    assets/
  server/
    server.mjs
```

Run the production server with Bun:

```bash
bun dist/server/server.mjs
```

The production server serves generated API routes, WebSocket upgrades when
present, static files from the client build, and an SPA fallback to
`index.html`.

## Add a custom Hono app

Use `serverEntry` when you want custom routes or middleware alongside generated
endpoints:

```ts
// vite.config.ts
serverBuildPlugin({
  serverEntry: "src/server.ts",
});
```

```ts
// src/server.ts
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

export default app;
```

The entry module must export a Hono-compatible app as the default export or as a
named `app` export.
