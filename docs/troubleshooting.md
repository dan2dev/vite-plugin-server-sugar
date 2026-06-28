# Troubleshooting

## TypeScript cannot find `$server`, `$ws`, or `$worker`

Add the macro declaration subpaths to `tsconfig.json`:

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

The macros are compile-time globals. Do not import them from
`vite-plugin-server-sugar`.

## Bun-only imports fail in dev

If a handler imports modules such as `bun:sqlite`, run Vite through Bun:

```bash
bunx --bun vite
```

Use the same pattern for production builds:

```bash
bunx --bun vite build
```

## The generated server does not start

Run the server with Bun, not Node:

```bash
bun dist/server/server.mjs
```

The generated server uses Bun runtime APIs such as `Bun.serve` and `Bun.file`.

## `serverEntry` cannot be loaded

Check that the configured file exists relative to the Vite project root:

```ts
serverBuildPlugin({
  serverEntry: "src/server.ts",
});
```

The module must export a Hono-compatible app as the default export or as a named
`app` export:

```ts
export default app;
// or
export { app };
```

## Custom middleware does not affect WebSocket upgrades

Generated WebSocket endpoints are handled through the server upgrade path, not
through Hono request middleware. Put WebSocket authentication data in
`connect(...args)` or headers handled by your deployment layer.

## A client call returns `404`

Confirm that:

- The source file containing the macro is inside the project root.
- The macro call is in a `.ts`, `.tsx`, `.js`, or `.jsx` file.
- The endpoint path uses the configured `pathnameBase`.
- The handler name did not change, since endpoint names include the inferred
  handler label.

Endpoint examples:

```txt
src/todos.ts + getTodos -> todos/get-todos
src/admin/users.ts + deleteUser -> admin/users/delete-user
```

## A client call returns `405`

`$server()` endpoints always use `POST`. HTTP helper endpoints require their
matching method:

```txt
$get() -> GET
$post() -> POST
$put() -> PUT
$patch() -> PATCH
$delete() -> DELETE
$head() -> HEAD
```

## A client call returns `415`

`$server()` calls expect JSON request bodies. Generated client wrappers set the
right content type. This usually happens when calling the generated endpoint
manually with a different `Content-Type`.

## Return values lose class instances or special types

Generated client wrappers use JSON for ordinary return values. Return
JSON-serializable data, or return a `Response` when you need full control of the
payload and headers.

## `compile: true` fails

Compilation requires Bun's build API or the `bun` CLI on `PATH`. Disable
`compile` if you only need the generated module:

```ts
serverBuildPlugin({
  compile: false,
});
```

The normal server output is still available at:

```txt
dist/server/server.mjs
```
