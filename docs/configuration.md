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
      platform: "hono",
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
| `port` | `number` | `3001` | Dev-server port default and production fallback port. Production can override it with `PORT`. Not used by `platform: "cloudflare-worker"`. |
| `pathnameBase` | `string` | `"/__server-build"` | Base pathname for generated HTTP endpoints. WebSocket endpoints use the same base with `-ws` appended. |
| `serverEntry` | `string` | none | Project-root-relative path to a module exporting a Hono-compatible app as `default` or named `app`. |
| `compile` | `boolean` | `false` | Compile standalone Bun executables for supported targets after writing `dist/server/server.mjs`. Only valid with `platform: "hono"`. |
| `platform` | `"hono" \| "cloudflare-worker"` | `"hono"` | Target runtime for the generated production server. See [`platform`](#platform). |

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

## `platform`

Set `platform` to choose the production server target:

```ts
serverBuildPlugin({
  platform: "cloudflare-worker",
});
```

- `"hono"` (default): the historical Bun + Hono output described above
  (`dist/server/server.mjs`, started with `Bun.serve`).
- `"cloudflare-worker"`: generate Cloudflare Workers-compatible ES modules
  instead. Build, then deploy independent Workers before the gateway that
  forwards to them, with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

  ```bash
  vite build
  for dir in dist/server/functions/*/; do
    npx wrangler deploy --config "$dir/wrangler.toml"
  done
  npx wrangler deploy --config dist/server/wrangler.toml
  ```

  See [Runtime and deployment](./runtime-and-deployment.md#deployment-checklist)
  for the full deployment checklist (authentication, CI/CD, secrets,
  bindings, custom domains) and output layout. In short:
  - `dist/server/functions/<name>/` (`index.mjs` + `wrangler.toml`): each
    `$server()`/HTTP endpoint emitted as its own independently deployable,
    fully self-contained Worker, so it can run and scale separately from the
    rest. Endpoints from the same source file that share module-level state,
    or call each other by name, are grouped into one Worker together since
    that state cannot span separate deployments. Skipped when `serverEntry`
    is configured — see below.
  - `dist/server/worker.mjs` + `dist/server/wrangler.toml`: without
    `serverEntry`, a thin gateway — it serves static assets and forwards
    each endpoint to the independent Worker above that implements it, via a
    generated [Service Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
    (no manual routing or custom domain needed to reach them from one
    origin). With `serverEntry`, this instead mounts every endpoint directly
    onto your app and exports it — see below.

Constraints:

- `$ws()` is not supported with `platform: "cloudflare-worker"`. Cloudflare
  Workers needs Durable Objects to coordinate WebSocket connections across
  isolates, which this plugin does not generate. Builds fail with a
  descriptive error if any `$ws()` handlers are registered.
- `compile` is only valid with `platform: "hono"`; combining it with
  `platform: "cloudflare-worker"` throws at plugin setup time.
- When `serverEntry` is configured, no independent Workers are generated —
  everything is mounted on your app in `dist/server/worker.mjs` instead.
  Splitting endpoints into independent Workers would bypass your app's own
  middleware/routes for those endpoints, so the plugin doesn't: it mounts
  everything on your app, exactly like `platform: "hono"` does.
- Deploy independent Workers before the gateway. The gateway's Service
  Bindings point at them by name; deploying the gateway first doesn't fail,
  but requests `502` until the Workers they target exist.

## TypeScript setup

Load all macro declarations with one type entry:

```json
{
  "compilerOptions": {
    "types": ["vite-plugin-server-sugar/types"]
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
