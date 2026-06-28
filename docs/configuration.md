# Configuration reference

## Vite entrypoint

Use the default package entrypoint for Vite:

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

The default export is the same plugin function:

```ts
import serverBuildPlugin from "vite-plugin-server-sugar";
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | `3001` | Dev-server port default and production fallback port. Production can override it with `PORT`. |
| `pathnameBase` | `string` | `"/__server-build"` | Base pathname for generated HTTP endpoints. WebSocket endpoints use the same base with `-ws` appended. |
| `serverEntry` | `string` | none | Project-root-relative path to a module exporting a Hono-compatible app as `default` or named `app`. |
| `compile` | `boolean` | `false` | Compile standalone Bun executables for supported targets after writing `dist/server/server.mjs`. |

## `port`

In Vite dev mode, the plugin uses `port` as the default Vite dev server port
when `server.port` is not already configured.

In production, the generated server listens on `process.env.PORT` when it is a
valid integer from `1` to `65535`; otherwise it falls back to `port`.

## `pathnameBase`

`pathnameBase` controls where generated HTTP endpoints are mounted:

```ts
serverBuildPlugin({
  pathnameBase: "/api",
});
```

This produces:

```txt
/api/<endpoint>
/api-ws/<endpoint>
```

The value is normalized:

- A missing leading slash is added, so `"api"` becomes `"/api"`.
- Trailing slashes are removed.
- Empty values, full URLs, query strings, and hash fragments are rejected.

The default keeps the historical endpoint paths:

```txt
/__server-build/<endpoint>
/__server-build-ws/<endpoint>
```

## `serverEntry`

Use `serverEntry` to mount generated endpoints into your own Hono app:

```ts
serverBuildPlugin({
  serverEntry: "src/server.ts",
});
```

```ts
// src/server.ts
import { Hono } from "hono";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
```

The module can export either:

```ts
export default app;
```

or:

```ts
export { app };
```

In dev and production, generated server endpoints are registered on this app so
your Hono middleware can run for generated HTTP endpoints too. WebSocket
upgrades are handled separately because Hono does not process raw upgrade
requests.

## `compile`

Set `compile: true` to compile standalone Bun executables after the generated
server is bundled:

```ts
serverBuildPlugin({
  compile: true,
});
```

The plugin attempts the supported Bun compile targets:

- `bun-darwin-x64`
- `bun-darwin-arm64`
- `bun-linux-x64`
- `bun-linux-arm64`
- `bun-linux-x64-musl`
- `bun-linux-arm64-musl`
- `bun-windows-x64`
- `bun-windows-arm64`

Compilation requires either the Bun runtime API or the `bun` CLI on `PATH`.
Disable `compile` if you only need `dist/server/server.mjs`.

## TypeScript setup

Add only the macro declaration files you use:

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

The declarations provide ambient globals and helper types such as
`ServerContext`, `ServerWs`, and `WsConnection`.

## Rollup and Rolldown

The default Vite entrypoint is the complete integration. It includes config
handling, dev middleware, WebSocket upgrades, HMR invalidation, worker chunks,
and production server generation.

For build-only Rollup usage:

```ts
import serverBuild from "vite-plugin-server-sugar/rollup";

export default {
  input: "src/main.ts",
  output: { dir: "dist/client", format: "esm" },
  plugins: [serverBuild({ port: 3001 })],
};
```

For build-only Rolldown usage:

```ts
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
