# Architecture

This document explains how `vite-plugin-server-build` works internally: the
programming model it exposes, how it transforms source code, what it
generates in dev vs. build mode, and the file-by-file responsibilities of the
plugin. It's aimed at people maintaining or extending the plugin itself.

For install/usage docs, see [README.md](./README.md).

## 1. The programming model

The plugin lets you write server-side functions inline in any `.ts`/`.tsx`
file, alongside client code, using two macros:

```ts
export const getTodos = server(async () => {
  return db.query("SELECT * FROM todos").all();
});

export const chat = ws({
  onOpen(ws) { /* ... */ },
  onMessage(ws, data) { /* ... */ },
  onClose(ws) { /* ... */ },
});
```

`server()` and `ws()` are **not real runtime functions** — there is no
implementation that ships to either side as-is. They are ambient globals
(declared in [`server.d.ts`](./server.d.ts) / [`ws.d.ts`](./ws.d.ts)
purely for TypeScript's benefit) that the plugin recognizes as syntax and
rewrites at compile time:

- **On the client bundle**, the call expression is replaced with a thin
  wrapper: `server(fn)` → an async function that `fetch()`es a generated API
  endpoint; `ws(handlers)` → `{ connect(...args) }` that opens a
  `WebSocket` to a generated endpoint.
- **On the server**, the original function/handlers run as-is (modulo
  TypeScript-to-JS stripping). The server never sees client code or the
  `server`/`ws` call wrapper — it gets its own generated module built
  from the captured AST.

Because the rewrite happens at the AST level and reuses the literal source of
the function, argument types, return types, and (for `ws()`) message
types are inferred end-to-end — there's no schema, codegen step, or RPC
definition file to keep in sync.

Users add the ambient types via `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["vite-plugin-server-build/server", "vite-plugin-server-build/ws"]
  }
}
```

These resolve through the package's `exports` map
(`./server` → `server.d.ts`, `./ws` → `ws.d.ts`) to
types-only entry points; nothing is imported at runtime.

## 2. Source layout

```
src/
  index.ts                   Plugin entry point — wires every hook together
  types.ts                   Shared types (BackendEntry, WebSocketEntry, options)
  constants.ts                Virtual module id prefixes, API path prefixes
  core/
    processor.ts             The AST transform: finds server()/ws() calls,
                              rewrites them, extracts handler source, fills the registries
    registry.ts               Generic endpoint -> entry map, indexed by source file
    transpiler.ts             Thin wrapper around ts.transpileModule
  build/
    bundle-generator.ts       Emits the production server source (single string of JS)
    bundler.ts                Bundles that source with rolldown; optional Bun --compile
  dev-server/
    middleware.ts             Node<->Web Request/Response adapters; server dispatch (no serverEntry case)
    virtual-modules.ts        Per-file/per-endpoint virtual module content for Vite's dev SSR graph
    hmr.ts                    Selective module-graph invalidation on file change
    ws-upgrade.ts              In-process HTTP upgrade handling for ws() in dev (using `ws`)
  utils/
    ast.ts                    TypeScript AST helpers (free-variable analysis, name inference)
    crypto.ts                 Deterministic name generation (kebab-case, hashed const names)
    path.ts                   Path/specifier normalization helpers
```

## 3. The processor: turning source into entries

[`core/processor.ts`](./src/core/processor.ts) is the heart of the plugin. It
runs **both** in `transform()` (per file, on every request/build, via Vite)
and in a manual directory walk (`buildStart`/`configureServer`, used to
pre-populate the registries before any module is requested). It's pure with
respect to its inputs — same `code`/`id`/`options` in, same registry mutation
and returned `{ code, map }` out.

Steps, for a given file:

1. **Fast bail-out**: if the source doesn't contain `server(` or
   `ws(` textually, unregister the file and return `null` (no
   transform). This keeps the plugin cheap for the vast majority of files in
   a project that don't declare server endpoints.
2. **Parse** the file with the TypeScript compiler (`ts.createSourceFile`),
   target `Latest`, in non-strict (`setParentNodes: true`) mode so `.parent`
   pointers are populated for the AST walk.
3. **Walk the AST** looking for `CallExpression`s whose callee identifier is
   exactly `server` or `ws`, with a single function-like (`server`)
   or object-literal (`ws`, containing at least one of
   `onOpen`/`onMessage`/`onClose`) argument. Anything else (wrong arg shape,
   no handlers) is left untouched — this is what makes shadowing safe, e.g. a
   local variable named `server` that isn't a call.
4. **Derive a stable endpoint name** for each call via
   `endpointName(file, label)`:
   - `label` comes from `inferBackendLabel()` (in `utils/ast.ts`), which walks
     up the call's ancestors to build a dotted path from naming context:
     `const x = server(...)` → `x`; `{ foo: server(...) }` → `foo`; nested
     in arrays/conditionals/returns/call-args contributes positional segments
     (`arg0`, `0`, `true`, `return`); falls back to `` `server@line:col` ``
     if no naming context is found at all.
   - The file's path relative to `root` (with a leading `src/` stripped) is
     joined with the label, and every path segment is kebab-cased
     (`toKebabCase` in `utils/crypto.ts`), e.g. `src/todos.ts` + `getTodos` →
     `todos/get-todos`.
   - Collisions are resolved by appending `@line:col` to the label before
     kebab-casing, so two same-named handlers in one file still get distinct
     endpoints.
5. **Transpile the captured handler source** with `transpileTs`
   (`core/transpiler.ts`) — `ts.transpileModule` with `target: ESNext`,
   stripping `"use strict"` and the trailing statement semicolon so the
   result is usable as an inline expression. This is **type erasure only**;
   no bundling, no scope renaming. `server()`'s argument is transpiled as an
   expression; `ws()`'s object-literal argument is wrapped in parens
   first so `ts.transpileModule` doesn't misparse a leading `{` as a block.
6. **Determine runtime imports the handler actually needs**
   (`collectRuntimeImports`): for every import declaration in the file,
   check whether the handler body references each imported local name
   (`collectReferencedNames`, which excludes property-key/member-name
   positions so e.g. `foo.bar` doesn't spuriously pull in an import named
   `bar`). Only referenced bindings are recorded as a `RuntimeImport` on the
   entry — this becomes the import line re-emitted in the generated server
   module.
7. **Detect the original binding name** when the call is the direct
   initializer of a `const x = server(...)`/`const x = ws(...)`
   declaration (`originalNameOf`). This is later used so sibling handlers in
   the same file can call each other by their natural name inside the
   generated module (see §5).
8. **Track free variables** (`allHandlerFreeRefs`): identifiers the handler
   body references that are not the handler's own parameters/locals
   (`collectBoundNames`), not an import, and not a known JS/Bun global
   (`KNOWN_GLOBALS`, a fixed allowlist covering ambient runtime globals like
   `Bun`, `fetch`, `console`, typed-array constructors, etc.). These are
   candidates for module-level state capture (§4).
9. **Replace the call expression in the client-facing output**:
   - `server(fn)` → `` async (...args) => __serverFetch("/__server-build/<endpoint>", JSON.stringify(args)) ``
   - `ws(handlers)` → `` { connect: (...args) => __wsConnect("/__server-build-ws/<endpoint>", args) } ``

   `__serverFetch`/`__wsConnect` are imported from internal virtual
   modules (`virtual:server-build/server-fetch`,
   `virtual:server-build/ws-connect`) inserted right after the file's
   existing import block. Local names are de-duplicated against the file's
   own identifiers (`uniqueLocalName`) so there's never a collision with a
   user-defined `__serverFetch`, etc.
10. **Strip now-dead imports**: after rewriting, any import whose only uses
    were inside a rewritten `server()`/`ws()` call (and nowhere else
    in the file) is removed from the client output — it would otherwise be
    unused/unresolved in the browser bundle (e.g. a server-only DB driver).
    This is computed by walking the file a second time
    (`visitOutside`/`outsideNames`) collecting reference identifiers found
    **outside** the ranges of rewritten calls.
11. **Strip `declare const server: ...;` / `declare function ws(...): ...;`
    shims** if a file declares its own local ambient shim instead of relying
    on the package's ambient `.d.ts` (regex-based, best-effort).
12. **Compute shared module-level declarations** (`collectModuleDeclsJs`, see
    §4) and attach them to every entry from this file.
13. **Emit warnings** (when `emitWarnings` is set — only in the real plugin's
    `buildStart`/`configureServer`/file-watcher paths, not in `transform()`)
    for any handler that references a name that is neither bound, imported,
    a known global, nor module-level-captured — that identifier will be
    `undefined` on the server at runtime, which is almost always a mistake
    (e.g. accidentally referencing a React state variable from inside
    `server()`).
14. **Register** every discovered entry into the `Registry` (keyed by
    endpoint, indexed by file for incremental re-processing), then apply all
    collected text replacements via `rolldown`'s `MagicString` and return the
    rewritten code + sourcemap.

If a file contains zero matching calls (or had some previously but no longer
does), the file is unregistered from both registries and the transform
returns `null` — Vite then treats the file as if this plugin doesn't exist
for it.

## 4. Module-level state sharing (the "IIFE mode")

A file can have ordinary top-level code besides its `server()`/`ws()`
declarations — e.g. a counter, an in-memory `Set` of connections, a parsed
config object. Handlers that close over such state need that state to be
**shared across calls and across sibling handlers**, not re-initialized per
request.

`collectModuleDeclsJs()` (in `processor.ts`) decides, per file, which
top-level statements must be hoisted into a shared scope on the server:

1. Candidate statements are every top-level statement that isn't an
   import/export-declaration/interface/type-alias/`declare`/module
   declaration, and that doesn't itself contain a `server()`/`ws()`
   call.
2. For each candidate, compute the names it **binds** at its top level
   (`statementTopLevelBindings` — e.g. `const x = ...` → `x`; destructuring
   patterns are expanded) and the names it **references** that aren't
   globals/imports/self-bound (`refs`).
3. Starting from `allHandlerFreeRefs` (the free variables every handler in
   the file needs — see step 8 above), transitively expand: include any
   candidate statement that binds a needed name, then add that statement's
   own `refs` to the needed set, repeating until a fixed point.
4. Emit the included statements, in original document order, transpiled via
   `transpileStatements` (like `transpileTs` but preserves statement
   terminators and strips `export`/`export default` modifiers so the result
   is valid inside a block).

Separately, **sibling cross-references** are detected: if handler A's body
references handler B's `originalName` (the `const` binding name B was
declared with), that's also forced into shared-scope mode even if there's no
other shared state — because B's compiled-server identity needs to be a
named local that A's compiled body can call directly.

If a file needs shared state and/or has sibling cross-refs, **every**
handler from that file (both `server()` and `ws()` ones) is wrapped
together in a single IIFE:

```js
const { __server_x_ab12cd34, __ws_chat_5566ee } = (() => {
  // moduleDeclsJs: hoisted shared declarations
  const connections = new Set();
  const history = [];

  // each handler bound to its original name so siblings can call it directly
  const getChatHistory = async () => { chat.send(...); return history; };
  const chat = __wrapWs("chat/chat", { onOpen(ws) {...}, ... });

  return {
    __server_x_ab12cd34: getChatHistory,
    __ws_chat_5566ee: chat,
  };
})();
```

If a file needs **neither** (no free-variable capture, no cross-refs), each
handler is instead emitted as an independent top-level `const`, which is
simpler and lets bundlers/tree-shakers reason about each handler in
isolation.

This logic is duplicated (by design — different output shapes) in two
places that must stay in sync:
- [`dev-server/virtual-modules.ts`](./src/dev-server/virtual-modules.ts)`combinedFileModuleCode()` — per-file dev virtual module.
- [`build/bundle-generator.ts`](./src/build/bundle-generator.ts) — production bundle, grouped per source file inside one generated server module.

Both read the *same* `moduleDeclsJs`/`hasSiblingCrossRefs`/`originalName`
fields computed once by the processor, so dev and prod share semantics.

## 5. Dev mode

### 5.1 Virtual modules

Real handler source never has a file on disk on the server side — it's
synthesized into three families of virtual modules
([`dev-server/virtual-modules.ts`](./src/dev-server/virtual-modules.ts)),
resolved/loaded via the plugin's `resolveId`/`load` hooks:

| Virtual id | Resolves to | Purpose |
|---|---|---|
| `virtual:server-build/server-fetch` | `\0virtual:server-build/server-fetch` | Exports `__serverFetch`, the client `fetch()` wrapper used by rewritten `server()` calls. |
| `virtual:server-build/ws-connect` | `\0virtual:server-build/ws-connect` | Exports `__wsConnect`, the client `WebSocket` wrapper used by rewritten `ws()` calls. |
| `virtual:server-build/server-file/<encoded file path>` | `\0...server-file/<encoded>` | The **combined per-file module**: every `server()`/`ws()` handler from one source file, re-emitted as real JS (IIFE-wrapped or not per §4), each exported under a hashed const name. |
| `virtual:server-build/server/<endpoint>` | `\0...server/<endpoint>` | Re-exports a single server handler's hashed const, as `default`, from its file's combined module. |
| `virtual:server-build/ws/<endpoint>` | `\0...ws/<endpoint>` | Same, for a ws handler. |

The per-endpoint modules exist so the dev middleware and the WS upgrade
handler can `server.ssrLoadModule(VIRTUAL_PREFIX + endpoint)` to get exactly
one handler by name, while the per-file module is what actually defines the
handlers (and is what HMR invalidates when the **file** changes — see §5.3).

### 5.2 Request handling

Two different code paths exist in `configureServer`, depending on whether
`serverEntry` is configured:

- **No `serverEntry`**: the plugin's own middleware
  (`dev-server/middleware.ts` `handleGeneratedBackendRequest`) intercepts any
  request under `/__server-build/*` directly: validates `POST`, looks up the
  endpoint in the registry, parses the JSON body as an args array (or wraps a
  bare object as a 1-element array), `ssrLoadModule`s the per-endpoint
  virtual module, calls the default export, and writes the JSON result (or
  `204` if the handler returned `undefined`).
- **With `serverEntry`**: the user's own Hono app (loaded via
  `server.ssrLoadModule(serverEntryPath)`, expecting a default or named
  `app` export with a Hono-shaped `.fetch`) is loaded and, on first use,
  augmented in place with the same `/__server-build/*` POST route (and an
  `app.all` 405 fallback for other methods) so that **user-defined
  middleware also runs for server requests** — matching what the
  production bundle does (§6). Every request is converted from Node's
  `IncomingMessage` to a Web `Request` (`nodeRequestToWeb`), routed through
  `app.fetch()`, and the Web `Response` is written back
  (`writeWebResponse`). A `404` outside the API prefix falls through to
  `next()` so Vite's own middleware (asset serving, HMR client, etc.) still
  gets a turn; a `404` *inside* the API prefix is treated as authoritative
  (the user's app chose to 404 it).

`ws()` connections are handled entirely separately from the Hono app
(Hono doesn't speak WebSocket upgrades) — see §5.4.

### 5.3 File watching & HMR

`configureServer` registers two `server.watcher` listeners:

- **`change`**: re-run `processFile()` on the changed file. Before
  re-processing, snapshot the file's previous endpoint set (from both
  registries); after, invalidate (in the SSR/mixed module graphs — see
  `dev-server/hmr.ts` `moduleGraphs()`) the union of old and new endpoints'
  virtual modules, plus the per-file combined module. If `processFile`
  throws (e.g. a syntax error mid-edit), the file is unregistered instead so
  stale/broken entries don't linger.
- **`unlink`**: unregister the file from both registries and invalidate
  whatever endpoints it used to expose.

Invalidation is done via Vite's internal `ModuleNode.invalidateModule()` with
`isHmr: true` so a subsequent `ssrLoadModule()` call re-evaluates the module
instead of serving a cached instance — this is what makes edits to a
`server()`/`ws()` body take effect on the very next request/message
without a full server restart.

### 5.4 WebSocket upgrades in dev

[`dev-server/ws-upgrade.ts`](./src/dev-server/ws-upgrade.ts) hooks the Vite
dev server's raw Node `httpServer`'s `'upgrade'` event directly (Vite's own
middleware stack only handles regular HTTP, not the WS handshake) using the
`ws` package in `noServer` mode:

1. Match the upgrade request's path against `WS_API_PREFIX`
   (`/__server-build-ws/`); decode the endpoint name from the rest of the
   path.
2. Reject (`socket.destroy()`) if the endpoint isn't registered.
3. Parse `connect()`-supplied args from the `?args=` query parameter (the
   client wrapper serializes its `connect(...args)` call into this param —
   see §5.5).
4. `wss.handleUpgrade(...)`, then `ssrLoadModule` the per-endpoint ws
   virtual module to get the `{ onOpen, onMessage, onClose }` handlers.
5. Wrap the raw socket: expose `.args` (the parsed connect args), and
   override `.send` to JSON-stringify before sending (mirrors the production
   `Bun.serve` `ws.send` override, so handler code is identical in both
   environments).
6. Track the open socket in a `Map<endpoint, Set<socket>>` so a sibling
   handler's `<name>.send(data)` (the broadcast helper wrapped around the
   raw handlers — `__wrapWs`, defined in the per-file virtual module) can
   reach it.
7. Wire `close` before calling `onOpen()` so a throwing `onOpen` still
   results in proper cleanup; call `onOpen`, then wire `message` →
   `onMessage` (JSON-parsed, falling back to the raw string if parsing
   fails).

A `console.error("[ws-debug] ...")` line currently fires on every upgrade
attempt regardless of whether it matches a ws endpoint — this is
leftover debug instrumentation, not intentional log output.

**Why connection tracking lives on `globalThis`:** in dev mode, the per-file
virtual module (which calls `__wrapWs` and owns the `<name>.send(...)`
closure) and `ws-upgrade.ts` (which performs the actual socket upgrade and
needs to register/unregister sockets) are loaded as **separate module
graph entries** by Vite — they don't share a JS module scope the way they
would after bundling. Both sides therefore store the
`Map<endpoint, Set<socket>>` under a fixed key
(`WS_RUNTIME_GLOBAL_KEY = "__server_build_ws_connections__"`) on
`globalThis`, lazily created by whichever side runs first. In production
there's no such split (everything is one generated file), so the bundle
generator just uses a plain top-level `Map` instead.

### 5.5 Client-side helpers

`__serverFetch(url, jsonBody)` (served by the
`virtual:server-build/server-fetch` virtual module): POSTs the JSON body to
`url`, throws an `Error` with the server's `{ error }` message (or status
text) on a non-OK response, returns the parsed JSON body (or `undefined` for
an empty response, matching the server's `204` for `undefined`-returning
handlers).

`__wsConnect(url, args)` (served by
`virtual:server-build/ws-connect`): builds a `ws(s)://` URL relative
to the current page, encodes `args` into a `?args=` query param as JSON,
opens the socket, and returns `{ send, onMessage, onClose, close, readyState }`
— `send`/incoming messages are JSON-(de)serialized transparently.

## 6. Production build

### 6.1 Triggering

Everything happens in the `writeBundle` hook, i.e. after Vite has finished
writing the **client** build (because the generated server needs to know the
final client output directory to serve static assets from it).

1. `cleanDistRoot()`: removes every entry directly under the configured
   `dist` root *except* the `client`/`server` subdirectories — clears stale
   top-level artifacts from a previous non-this-plugin build layout without
   touching the directories this plugin/Vite just populated.
2. Delete any pre-existing `server` output directory outright (full rebuild,
   no incremental server output).
3. `generateBundleContent()` — see §6.2 — produces the entire server as one
   JS source string, or `null` if there's nothing to generate (no
   `server()`/`ws()` handlers anywhere **and** no `serverEntry`
   configured).
4. `bundleServerSource()` — see §6.3 — bundles that string (plus whatever it
   imports) into `dist/server/server.mjs` using `rolldown`.
5. If `options.compile` is `true`, `compileServer()` additionally produces
   standalone Bun executables for every supported target (§6.4).

### 6.2 Generating the server source (`build/bundle-generator.ts`)

This produces a complete, self-contained Hono + `Bun.serve` application as a
single string of ES module source (not yet bundled — imports are still
import statements pointing at the *original* source files on disk). Broadly
mirrors the dev-mode virtual-module shapes from §3–4, but everything lives in
one module instead of being split into per-file/per-endpoint virtual
modules, since there's no Vite module graph to exploit in production.

Key construction details:

- **Import de-duplication & aliasing**: every distinct `(specifier, default
  | namespace | named-import)` tuple across *all* registered handlers gets
  one unique top-level alias (`__dep_0`, `__dep_1`, ...). This is necessary
  because two different source files can legally use the same local binding
  name for unrelated imports (e.g. both import a default as `db` from
  different modules) — emitting both as literal top-level `import db from
  ...` would collide. Each handler then gets wrapped in a tiny factory IIFE
  that re-binds the aliases back to the handler's own expected local names:
  `((db, query) => (<handler body>))(__dep_0, __dep_1)`.
- **Server entry integration**: if `serverEntry` is configured (and the file
  exists — checked again here, not just at config time, since files can be
  deleted between `configResolved` and `writeBundle`), the user's module is
  imported as `__serverEntry` and `app = __serverEntry.default ?? __serverEntry.app`,
  with a runtime check that `app.fetch` is callable. Otherwise a bare `new Hono()`
  is created.
- **Per-file grouping**: handlers are grouped by source file
  (`entriesByFile`) and emitted using the same "plain consts" vs. "shared
  IIFE" decision as dev mode (§4), reusing the same `moduleDeclsJs` /
  `hasSiblingCrossRefs` / `originalName` fields computed once by the
  processor.
- **Backend dispatch route**: `app.post('/__server-build/*', ...)` — decode
  the endpoint from the URL, look it up in a generated `__serverHandlers`
  endpoint→function map, validate content-type is JSON (or absent), parse
  the body as an args array (default `[]` if empty), call the handler,
  respond `204` for `undefined` or JSON otherwise, `500` with `{ error:
  message }` on a thrown error. A trailing `app.all('/__server-build/*', ...)`
  rejects any non-POST method with `405` + `Allow: POST`.
- **Static asset serving**: registered as `app.use("*", ...)` (GET/HEAD
  only) *after* the server route so it never shadows API requests. Resolves
  the client root relative to the running module's own location — using
  `import.meta.url` when running as a normal ESM file, or `process.execPath`
  when running inside a compiled Bun executable (detected by the URL
  containing `$bunfs`, Bun's embedded virtual filesystem marker for compiled
  binaries) — so the generated server locates its static assets correctly
  whether it's `bun dist/server/server.mjs` or a standalone compiled binary
  sitting next to a `dist/client` directory. Guards against path traversal
  (rejects resolved paths that escape the client root) and serves with
  long-cache headers for anything under `/assets/`, short-cache otherwise.
  Falls through to a SPA fallback (`index.html`) for any other GET that
  didn't match a static file.
- **WebSocket support**: only emitted if there's at least one `ws()`
  handler anywhere. A top-level `__wsConnections` `Map` plus `__wrapWs()`
  (same shape as the dev-mode helper, §4) are emitted, and the final
  `Bun.serve({...})` call's `fetch` checks the URL against
  `WS_API_PREFIX` first — parsing `?args=`, calling `server.upgrade(req,
  { data: { endpoint, args } })` — before falling back to `app.fetch(req)`
  for everything else. The `ws: { open, message, close }` handlers
  dispatch to the right per-endpoint handler object via a generated
  `__wsHandlers` map, tracking/untracking the open connection set and
  JSON (de)serializing messages, mirroring `ws-upgrade.ts`'s dev-mode
  behavior exactly.
- **Port resolution**: reads `Bun.env.PORT`, falls back to the configured
  `port` option (default `3001`) if unset, non-integer, or out of the valid
  TCP port range, with a `console.warn` if an invalid value was supplied.

### 6.3 Bundling (`build/bundler.ts`)

The generated source string is written to a throwaway entry file
(`.server-build-entry.mjs`) inside the server output directory and bundled
with **rolldown** (`platform: 'node'`, single chunk — `codeSplitting:
false`, no sourcemap, no comments) into `server.mjs`:

- `external` marks anything matching `bun:*` or a Node builtin module
  (`node:fs`, `fs`, etc., checked under both prefixed and unprefixed forms)
  as external — left as a runtime `import`, not inlined — since those are
  provided by the Bun runtime itself. Everything else (local relative
  imports, npm dependencies like `hono`) is inlined into the single output
  chunk.
- A custom `onLog` swallows one specific, expected, benign rolldown warning:
  `IMPORT_IS_UNDEFINED` for the `default`/`app` import out of the throwaway
  entry file — this fires because rolldown's static analysis can't always
  prove the entry's own `__serverEntry.default ?? __serverEntry.app`
  fallback pattern resolves, even though it does at runtime.
- Rolldown's own `//#region`/`//#endregion` chunk-boundary comments are
  stripped from the final output (`stripRolldownSectionComments`) purely for
  output readability.
- The throwaway entry file is always removed (`finally`), regardless of
  success/failure.

Output: `dist/server/server.mjs` — a single ESM file with a
`// Auto-generated by vite-plugin-server-build - do not edit` banner, that
can be run directly with `bun dist/server/server.mjs` (or any Node-compatible
runtime, **except** the Bun-specific runtime calls it makes: `Bun.serve`,
`Bun.file`, `Bun.env` — so in practice it requires Bun).

### 6.4 Optional standalone compilation (`compileServer`)

When `options.compile` is `true`, after bundling, `compileServer()` produces
a standalone executable for every entry in `compileTargets`:

```
bun-darwin-x64      bun-darwin-arm64
bun-linux-x64       bun-linux-arm64
bun-linux-x64-musl  bun-linux-arm64-musl
bun-windows-x64     bun-windows-arm64
```

For each target, it either:
- calls `Bun.build({ entrypoints: [server.mjs], compile: { target, outfile }, define: {...} })`
  directly if running **inside** the Bun runtime (`globalThis.Bun` present —
  i.e. the whole Vite build itself was invoked via `bun vite build`), or
- shells out to the `bun build --compile --target=<target> --outfile=<outfile> ...`
  CLI if not (e.g. Vite was invoked under Node) — failing with a clear error
  if `bun` isn't found on `PATH`.

Both paths define `process.env.NODE_ENV` as `"production"` at compile time.
Output files are named `server-<target>` (Bun appends `.exe` for Windows
targets automatically; `emittedOutfile()` accounts for that when reporting
the final path). Bun's compiler can leave stray
`.{hex}-{n}.bun-build` temp artifacts in the **current working directory**
(not the output dir) on some platforms — `compileServer` snapshots which
such files exist before compiling and removes any new ones afterward
(`cleanNewBunCompileArtifacts`), without touching pre-existing files that
might belong to an unrelated concurrent process.

### 6.5 Final on-disk layout

```
dist/
  client/             Normal Vite client build output (HTML, JS, CSS, assets)
  server/
    server.mjs         The bundled production server (Bun + Hono)
    server-bun-darwin-x64       \
    server-bun-darwin-arm64      \  Only when `compile: true` —
    server-bun-linux-x64          >  one standalone executable
    ...                          /   per target in compileTargets
    server-bun-windows-x64.exe  /
```

Run with `bun dist/server/server.mjs` (reads `PORT` from env, defaults to
the configured `port`) or directly execute one of the compiled binaries.
Both serve the client build as static files *and* the server API from the
same process/port.

## 7. The plugin's Vite hooks, end to end

[`src/index.ts`](./src/index.ts) is the composition root — it owns the two
`Registry` instances (one for `server()`, one for `ws()`) and wires
every module above into Vite's plugin lifecycle:

| Hook | What it does |
|---|---|
| `config` | Forces `build.outDir` to end in `/client` (so the server's static-file serving path and the `writeBundle` split between `client`/`server` always line up); in `serve` mode, defaults `server.port` to the plugin's configured `port`. |
| `configResolved` | Captures the resolved `root`/`outDir`, derives `distOutDir` (parent of the client out dir) and `serverOutDir` (`dist/server`), resolves `serverEntryPath` if `serverEntry` is set. |
| `buildStart` | Clears both registries and does a synchronous recursive directory scan (`scanDir`, skipping `node_modules`/`.git`/the dist output dir) calling `processFile` on every `.ts`/`.tsx` file, so the registries are fully populated **before** Vite starts resolving/loading any module — required so `resolveId`/`load` can serve virtual modules from the very first request. |
| `resolveId` | Delegates to `resolveVirtualId` — recognizes the plugin's virtual id namespaces. |
| `load` | Delegates to `loadVirtualModule` — serves the synthesized module content described in §5.1. |
| `configureServer` | Dev-only: re-scans (in case files changed between `buildStart` and server start), sets up the WS upgrade handler (§5.4), installs the server request middleware — either standalone or layered onto a `serverEntry` Hono app (§5.2) — and registers the file watcher listeners (§5.3). |
| `transform` | The main per-file hook in both dev and build: skips `node_modules` and the plugin's own virtual/resolved ids, otherwise calls `processFile` (without `emitWarnings`, since warnings are already emitted once via the `buildStart`/watcher paths) and returns the rewritten client code. |
| `writeBundle` | Build-only: generates and bundles the production server, optionally compiles standalone binaries — see §6. |

## 8. Registries & incremental correctness

[`core/registry.ts`](./src/core/registry.ts) is a small generic
`endpoint -> entry` map that also tracks, per source file, which endpoints
that file currently owns (`entriesByFile`). This indirection exists purely
to make `unregisterFile()` correct and cheap: when a file changes or is
deleted, every endpoint it *previously* contributed needs to be removed
(even if the endpoint name itself doesn't appear in the new version of the
file), without scanning the entire registry. `registerFile()` first clears
any previous association for that file id, then records the new set.

`registry.delete()` inside `unregisterFile()` double-checks `entry.file ===
id` before deleting — guarding against a (largely theoretical, but cheap to
guard) case where two different files raced to register the same endpoint
name and a stale unregister from the loser shouldn't evict the winner's
live entry.

## 9. Safety/validation notes worth knowing as a maintainer

- Backend endpoints only ever accept `POST` with an `application/json` (or
  absent) content-type; every other verb/content-type is rejected before
  the handler runs, in both dev and prod.
- Args are always an array: a bare JSON object posted as the body is
  wrapped as a single-element args array (`[payload]`), matching the client
  wrapper's `JSON.stringify(args)` where `args` is the handler's actual
  argument list.
- Endpoint/static-file path decoding (`decodeURIComponent`) is wrapped in
  `try/catch` everywhere a URL is parsed, returning `400` on a malformed
  percent-encoding rather than throwing past the framework.
- Static file serving validates the resolved path stays within the client
  root (rejecting `..`-escapes and absolute-path overwrites) and rejects
  embedded NUL bytes, before ever touching the filesystem.
- The `emitWarnings` free-variable check is a **best-effort lint**, not a
  type system: it can't see across re-exports, computed member access, or
  values threaded through generics, so absence of a warning is not a
  correctness guarantee — but presence of one reliably means the named
  identifier will be `undefined` server-side.

## 10. Runtime dependency notes

- The generated production server uses Bun-specific runtime APIs:
  `Bun.serve`, `Bun.file`, and `Bun.env`. The output is ESM, but it is meant
  to run with Bun, not plain Node.
- Projects that import Bun-only modules from handlers (for example
  `bun:sqlite`) should run Vite dev/build under Bun too, because dev mode
  executes handlers through Vite's SSR loader in the same runtime as Vite.
- `hono` is a **peer dependency** and must be available in the consuming
  project's `node_modules`. When `serverEntry` is configured, that entry is
  expected to export a Hono-shaped app as `default` or named `app`; when no
  `serverEntry` is configured, the generated server imports `Hono` from the
  project's environment and creates `new Hono()` internally.
- `dev-server/bun-dev-server.ts` is present in the source tree but is not
  currently wired from `src/index.ts`. The active dev path is the Vite
  middleware/SSR/virtual-module path described above.
