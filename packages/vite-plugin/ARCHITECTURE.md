# Architecture

This document explains how `vite-plugin-server-sugar` is put together. It is
for maintainers and contributors. For user-facing setup and examples, see
[README.md](./README.md).

## Programming Model

The plugin treats these globals as compile-time macros:

- `$server(fn)`
- `$get(fn)`, `$post(fn)`, `$put(fn)`, `$patch(fn)`, `$delete(fn)`, `$head(fn)`
- `$ws(handlers)`
- `$worker(factory)`

They are not imported and they do not exist at runtime as normal functions.
The `.d.ts` files provide TypeScript types, and the plugin rewrites matching
calls during bundling.

Client output:

- `$server()` becomes an async function that posts to
  `/{pathnameBase}/<endpoint>`, defaulting to `/__server-build/<endpoint>`.
- HTTP method helpers become async functions that call the same endpoint path
  with the matching HTTP method.
- `$ws()` becomes an object with `connect(...args)`.
- `$worker()` becomes a proxy to a generated module worker.

Server and worker output:

- Server and HTTP handlers are emitted into the generated Bun + Hono server.
- WebSocket handlers are emitted into the generated server and wired to Bun
  WebSocket upgrades in production.
- Worker factories are emitted as worker chunks and run once per worker thread.

## Source Map

```txt
src/
  index.ts                     public Vite entrypoint
  rollup.ts                    build-only Rollup entrypoint
  rolldown.ts                  build-only Rolldown entrypoint
  plugin.ts                    lifecycle wiring and shared plugin host
  types.ts                     shared entry types and options
  constants.ts                 API paths and virtual module IDs
  core/
    processor.ts               AST transform and registry population
    registry.ts                endpoint registry indexed by file
    transpiler.ts              TypeScript-to-JavaScript stripping
  dev-server/
    middleware.ts              generated HTTP request handling in dev
    virtual-modules.ts         client helpers and generated dev modules
    hmr.ts                     virtual module invalidation
    ws-upgrade.ts              dev WebSocket upgrade handling
  build/
    bundle-generator.ts        generated production server source
    bundler.ts                 rolldown bundling and Bun compilation
  utils/
    ast.ts                     AST reference and label helpers
    crypto.ts                  stable endpoint and const-name helpers
    path.ts                    path normalization helpers
```

## Processor

[`core/processor.ts`](./src/core/processor.ts) is the central transform.

For each `.ts`, `.tsx`, `.js`, or `.jsx` file it:

1. Quickly skips files that do not contain one of the macro names.
2. Parses the file with the TypeScript compiler API.
3. Finds valid macro call expressions.
4. Infers a stable endpoint name from the source path and local naming
   context.
5. Transpiles the captured function, handler object, or worker factory to
   JavaScript.
6. Records only the runtime imports used by that captured code.
7. Tracks top-level declarations needed by handlers so shared state works.
8. Replaces the macro call in client code with a generated helper call.
9. Removes imports that are now only used by server-only code.
10. Registers the discovered entries by source file.

The processor owns the important correctness rule: server code can close over
top-level state from the same file, but it cannot close over component-local
browser state. Warnings for uncaptured references are best-effort linting.

## Endpoint Names

Endpoint names are deterministic:

```txt
relative file path without leading src/
+ inferred handler label
+ kebab-case per path segment
```

Examples:

```txt
src/todos.ts + getTodos -> todos/get-todos
src/admin/users.ts + deleteUser -> admin/users/delete-user
```

The label usually comes from a variable name, export name, or object property.
If no natural label exists, the processor falls back to a line and column
label. Duplicate labels in one file get a line and column suffix.

## Registries

[`core/registry.ts`](./src/core/registry.ts) stores `endpoint -> entry` and
also tracks which endpoints came from each source file.

That second index is what makes edits and deletes safe:

- On file change, old endpoints from that file are removed before new ones are
  registered.
- On file delete, all endpoints from that file are removed.
- HMR invalidates both old and new virtual modules so the next request loads
  fresh code.

There are separate registries for server/HTTP handlers, WebSocket handlers,
and workers.

## Dev Mode

The Vite entrypoint wires these hooks:

- `config`: moves client output under `dist/client` and sets the dev server
  port default.
- `configResolved`: stores root and output paths.
- `buildStart`: scans source files to populate registries before modules load.
- `resolveId` and `load`: serve virtual modules.
- `configureServer`: installs dev HTTP middleware, WebSocket upgrades, file
  watchers, and HMR invalidation.
- `transform`: rewrites source files for the browser.
- `writeBundle`: emits the production server during builds.

Dev HTTP handling has two modes:

- Without `serverEntry`, the plugin handles `/{pathnameBase}/*` directly in
  Vite middleware.
- With `serverEntry`, the configured Hono app is loaded through Vite SSR and
  generated routes are mounted into it. This lets user middleware run for
  generated API requests too.

WebSocket upgrades are handled outside Hono by
[`dev-server/ws-upgrade.ts`](./src/dev-server/ws-upgrade.ts), because HTTP
middleware does not receive raw upgrade handling.

## Virtual Modules

[`dev-server/virtual-modules.ts`](./src/dev-server/virtual-modules.ts)
generates the modules used by rewritten client code and dev SSR.

Important virtual modules:

| ID | Purpose |
| --- | --- |
| `virtual:server-build/server-fetch` | Client `$server()` fetch helper. |
| `virtual:server-build/http-fetch` | Client HTTP method helper. |
| `virtual:server-build/ws-connect` | Client WebSocket connector. |
| `virtual:server-build/worker-invoke` | Client worker proxy helper. |
| `virtual:server-build/server-file/<file>` | Combined per-file server and WebSocket module. |
| `virtual:server-build/server/<endpoint>` | Per-endpoint server re-export. |
| `virtual:server-build/ws/<endpoint>` | Per-endpoint WebSocket re-export. |
| `virtual:server-build/worker/<endpoint>` | Generated worker module. |

Server and WebSocket handlers from the same source file share a combined
virtual module so top-level state is not duplicated between handler kinds.

## Shared State

Handlers often need shared module-level state:

```ts
const history: Message[] = [];

export const getHistory = $server(() => history);
export const chat = $ws({
  onMessage(_ws, message) {
    history.push(message);
  },
});
```

The processor finds top-level declarations referenced by handlers and emits
them into a per-file IIFE. All handlers from that file close over the same
state. The same IIFE mode is also used when sibling handlers call each other by
their original names.

If no shared state or sibling references are needed, handlers are emitted as
plain top-level constants.

## Workers

`$worker()` is client-side worker generation, not a server endpoint.

The processor registers a worker entry and replaces the macro call with a
proxy. In dev, the worker URL points at a virtual module. In build, the plugin
emits a worker chunk and the client uses Rollup/Rolldown file URL handling.

The generated worker module:

- imports runtime dependencies used by the factory,
- inlines needed same-file module declarations,
- creates client stubs for same-file `$server()` and `$ws()` siblings used by
  the worker,
- runs the factory once,
- dispatches proxy method calls over `postMessage`.

## Production Build

Production generation happens in `writeBundle`, after the client build is
written.

Steps:

1. Clean stale top-level files in `dist`, keeping `dist/client` and
   `dist/server`.
2. Remove the previous server output directory.
3. Generate one Bun + Hono server source string.
4. Bundle that source with rolldown into `dist/server/server.mjs`.
5. If `compile: true`, compile standalone Bun executables for supported
   targets.

The generated server:

- imports or creates a Hono app,
- registers generated API handlers under `/{pathnameBase}/*`,
- handles WebSocket upgrades under `/{pathnameBase}-ws/*` when needed,
- serves static files from `dist/client`,
- falls back to `index.html` for SPA routes,
- reads `PORT` from the environment and falls back to the configured `port`.

## Runtime Contracts

Server and HTTP endpoints:

- Generated API path: `/{pathnameBase}/<endpoint>`, defaulting to
  `/__server-build/<endpoint>`.
- `$server()` uses `POST` with a JSON array of function arguments.
- HTTP helpers use their matching method and receive a Hono-compatible
  context.
- Returned `Response` objects are passed through.
- Returning `undefined` sends `204 No Content`.
- Other values are serialized as JSON.

WebSocket endpoints:

- Generated path: `/{pathnameBase}-ws/<endpoint>`, defaulting to
  `/__server-build-ws/<endpoint>`.
- `connect(...args)` stores args in the WebSocket URL.
- Server handlers read those args from `ws.args`.
- Wrapper sends are JSON-serialized.
- Incoming messages are JSON-parsed when possible.

Production runtime:

- The generated server uses `Bun.serve`, `Bun.file`, and `Bun.env`.
- The output is ESM but is intended to run with Bun, not plain Node.
- Projects using Bun-only handler imports should run Vite dev/build through
  Bun too.

## Build-Only Hosts

The Vite entrypoint is the primary integration.

The Rollup and Rolldown entrypoints call the same shared plugin host with a
different mode. They provide transform, virtual modules, worker chunks, and
production server generation. They do not provide Vite dev middleware, HMR, or
dev WebSocket upgrades.
