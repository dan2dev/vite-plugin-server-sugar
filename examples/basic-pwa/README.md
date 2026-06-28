# vite-plugin-server-sugar example

This is a Vite + React app that exercises the plugin surface area:

- `$server()` CRUD calls
- `$get()`, `$post()`, `$put()`, `$patch()`, `$delete()`, and `$head()`
- `$ws()` chat and broadcast
- `$worker()` method proxies
- a custom Hono `serverEntry`
- shared state and edge cases

## Run

Install dependencies:

```bash
bun install
```

Start the dev server:

```bash
bunx --bun vite
```

The plugin config uses port `3001`.

## Build

```bash
bunx --bun vite build
```

The client build is written to `dist/client`. The generated Bun server is
written to `dist/server/server.mjs`.

Run the production server:

```bash
bun dist/server/server.mjs
```

This example sets `compile: true`, so the build also attempts to emit
standalone Bun executables under `dist/server/`.

## Files

- [`src/todos.ts`](./src/todos.ts): `$server()` and HTTP method handlers.
- [`src/chat.ts`](./src/chat.ts): `$ws()` chat and server-side broadcast.
- [`src/worker-demo.ts`](./src/worker-demo.ts): `$worker()` basics.
- [`src/user.ts`](./src/user.ts): worker calls into server functions.
- [`src/edge-cases.ts`](./src/edge-cases.ts): return shapes and transform edge
  cases.
- [`src/server.ts`](./src/server.ts): custom Hono app passed as `serverEntry`.
- [`vite.config.ts`](./vite.config.ts): plugin setup.
