# Runtime and deployment

## Build output

With the Vite entrypoint, the plugin changes the client output directory to
`dist/client` and writes the generated server to `dist/server/server.mjs`:

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

If `compile: true` is enabled, standalone executable artifacts are also written
under `dist/server/`.

## Production server behavior

The generated Bun server:

- Registers generated `$server()` and HTTP helper endpoints.
- Handles `$ws()` upgrades when WebSocket macros are present.
- Mounts a custom Hono app when `serverEntry` is configured.
- Serves static client files from `dist/client`.
- Serves immutable cache headers for files under `/assets/`.
- Falls back to `index.html` for unmatched `GET` and `HEAD` requests.

## HTTP endpoint paths

By default, `$server()` and HTTP helper endpoints use:

```txt
/__server-build/<endpoint>
```

With a custom `pathnameBase`:

```ts
serverBuildPlugin({
  pathnameBase: "/api",
});
```

the endpoints use:

```txt
/api/<endpoint>
```

Endpoint path segments are URL-encoded by generated client wrappers.

## `$server()` contract

Generated `$server()` endpoints use:

- Method: `POST`.
- Body: JSON array of function arguments.
- Body fallback: a non-array JSON value is passed as one argument.
- Success: JSON response, `204 No Content` for `undefined`, or the returned
  `Response`.
- Errors: JSON error responses for unknown endpoints, wrong methods,
  unsupported media type, invalid JSON, bad URL encoding, and handler
  exceptions.

Client wrappers read response text, throw `Error(message)` for non-2xx
responses, and parse successful non-empty responses as JSON.

## HTTP helper contract

HTTP helper endpoints use the method implied by the macro:

| Macro | Method | Client arguments |
| --- | --- | --- |
| `$get()` | `GET` | `query?, options?` |
| `$post()` | `POST` | `body, query?, options?` |
| `$put()` | `PUT` | `body, query?, options?` |
| `$patch()` | `PATCH` | `body, query?, options?` |
| `$delete()` | `DELETE` | `query?, options?` |
| `$head()` | `HEAD` | `query?, options?` |

For typed queries, the query argument is required:

```ts
export const getTodo = $get(
  async (c: ServerContext<never, { id: string }>) => {
    return c.req.query("id");
  },
);
```

HTTP helper handlers receive a Hono-compatible context. With `serverEntry`,
this is the real Hono context. Without `serverEntry` in dev, the plugin uses a
lightweight compatible wrapper.

## WebSocket paths and contract

By default, `$ws()` endpoints use:

```txt
/__server-build-ws/<endpoint>
```

With `pathnameBase: "/api"`, WebSocket endpoints use:

```txt
/api-ws/<endpoint>
```

`connect(...args)` serializes connection arguments into the WebSocket URL.
Those values are available as `ws.args` in `onOpen`, `onMessage`, and
`onClose`.

Messages sent through generated wrappers are JSON-serialized. Incoming messages
are JSON-parsed when possible and otherwise passed through as raw data.

## Deployment checklist

1. Build with Bun when server code imports Bun-only APIs:

   ```bash
   bunx --bun vite build
   ```

2. Deploy both `dist/client` and `dist/server`.

3. Start the generated server with Bun:

   ```bash
   PORT=8080 bun dist/server/server.mjs
   ```

4. Route HTTP traffic and WebSocket upgrade traffic to the same Bun process.

5. Keep dependencies such as `hono` installed for dev and build. The generated
   `server.mjs` bundles local source and npm dependencies for deployment.

## Runtime requirements

- Vite integration: Vite `>=6.0.0`.
- Build-only Rollup integration: Rollup `>=4.0.0`.
- Build-only Rolldown integration: Rolldown `>=1.0.0`.
- Generated production server: Bun.
- `hono` peer dependency: `>=4.0.0`.
