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

- Server and HTTP handlers are emitted into the generated production server:
  a Bun + Hono server by default (`platform: "hono"`), or one or more
  Cloudflare Worker modules (`platform: "cloudflare-worker"`) — see
  [Production Build](#production-build).
- WebSocket handlers are emitted into the generated server and wired to Bun
  WebSocket upgrades in production. Not supported on `platform:
  "cloudflare-worker"`.
- Worker factories (`$worker()`, unrelated to the `platform` option above)
  are emitted as worker chunks and run once per browser worker thread.

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
    platform.ts                 `platform` option validation
    handler-emitter.ts          shared codegen: imports, handler decls, Hono RPC dispatch
    bundle-generator.ts         generated Bun + Hono production server source
    cloudflare-bundle-generator.ts  generated Cloudflare Worker module(s)
    cloudflare-dispatch.ts      Hono-free RPC dispatch for Cloudflare Workers
    wrangler-config.ts          generated `wrangler.toml` content
    bundler.ts                  rolldown bundling and Bun compilation
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
written. `options.platform` (validated up front by
[`build/platform.ts`](./src/build/platform.ts)) selects one of two,
mutually exclusive code paths.

### `platform: "hono"` (default)

1. Clean stale top-level files in `dist`, keeping `dist/client` and
   `dist/server`.
2. Remove the previous server output directory.
3. Generate one Bun + Hono server source string
   ([`build/bundle-generator.ts`](./src/build/bundle-generator.ts)).
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

### `platform: "cloudflare-worker"`

Handled by `writeCloudflareOutput` in `plugin.ts`, using
[`build/cloudflare-bundle-generator.ts`](./src/build/cloudflare-bundle-generator.ts)
and [`build/wrangler-config.ts`](./src/build/wrangler-config.ts):

1. **Without `serverEntry`**: generate the independent Workers first — one
   per endpoint, or per group of same-file endpoints that share
   module-level state or reference each other by name, since that state
   cannot span separate Worker deployments — under
   `dist/server/functions/<slug>/index.mjs`, each with its own
   `wrangler.toml`. Their names are computed here
   (`workerName(projectName, slug)`) because the next step needs them.
2. Generate `dist/server/worker.mjs` + `dist/server/wrangler.toml`. **With
   `serverEntry`**, this mounts every endpoint onto the user's app (see
   below). **Without it**, this is a thin gateway that forwards each
   endpoint to the independent Worker that implements it — it does not run
   handler code and is not built from the registry's handler bodies at all,
   just the endpoint → Worker-name mapping from step 1. The generated
   `wrangler.toml` gets a `[[services]]` Service Binding per independent
   Worker (`serviceBindingName(slug)` → its deployed name) so the forward
   is a same-server call, with no manual Cloudflare Route or custom domain
   needed to reach independent Workers from one origin.

`generateCloudflareFunctionBundles` (step 1) and the `serverEntry` branch of
`generateCloudflareWorkerBundle` (step 2) share the platform-agnostic parts
of codegen — import aliasing and per-file handler declarations — via
[`build/handler-emitter.ts`](./src/build/handler-emitter.ts), which also
provides the `__serverHandlers` lookup table and the Hono-flavored RPC
dispatch route (`emitApiDispatchRoute`) used by `platform: "hono"` and by
`platform: "cloudflare-worker"` when `serverEntry` is configured — mounting
onto a user-supplied app inherently means routing through *their* Hono app.

Independent Workers don't use Hono at all:
[`build/cloudflare-dispatch.ts`](./src/build/cloudflare-dispatch.ts)'s
`emitCloudflareDispatch` is an equivalent dispatch route (same
request/response contract: methods, status codes, JSON body handling)
written directly against `Request`/`Response`, paired with a
`__serverContext` helper mirroring
[`dev-server/middleware.ts`](./src/dev-server/middleware.ts)'s
`createServerContext` (extended with `env`/`executionCtx` so handlers can
read Cloudflare bindings and secrets via `c.env`). The gateway (without
`serverEntry`) uses a third, even thinner route from the same file —
`emitCloudflareGatewayDispatch` — which has no handler-related codegen to
share at all: just a generated `endpoint → binding` table and a
`service.fetch(request)` forward, wrapped in a `try`/`catch` that turns an
undeployed or unreachable target Worker into a `502` instead of an
unhandled error. This is why splitting into independent per-function
Workers is cheap and the gateway shrinks as a result: see
[Cloudflare Workers output](../../docs/runtime-and-deployment.md#cloudflare-workers-output)
for measured sizes. The Cloudflare output never emits static-file-serving
code or a `serve()` call either way: static assets are served by
Cloudflare's own asset system, configured in the generated `wrangler.toml`.

`$ws()` is rejected for this platform (with a descriptive build error): the
existing broadcast implementation relies on an in-memory `Map`, which is not
safe across Cloudflare's stateless, recyclable isolates without Durable
Objects. `compile` is rejected too, since it only makes sense for the Bun
output.

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

Production runtime (`platform: "hono"`):

- The generated server uses `Bun.serve`, `Bun.file`, and `Bun.env`.
- The output is ESM but is intended to run with Bun, not plain Node.
- Projects using Bun-only handler imports should run Vite dev/build through
  Bun too.

Production runtime (`platform: "cloudflare-worker"`): no Bun/Node-specific
APIs are used by the generated code itself; handler bodies that reference
Bun/Node APIs are the deploying project's responsibility, same as they are
for `serverEntry` today. See [Production Build](#production-build) above.

## Build-Only Hosts

The Vite entrypoint is the primary integration.

The Rollup and Rolldown entrypoints call the same shared plugin host with a
different mode. They provide transform, virtual modules, worker chunks, and
production server generation. They do not provide Vite dev middleware, HMR, or
dev WebSocket upgrades.
