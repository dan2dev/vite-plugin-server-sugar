# Runtime and deployment

This page covers the default `platform: "hono"` output first. See
[Cloudflare Workers output](#cloudflare-workers-output) for
`platform: "cloudflare-worker"`.

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

## Deployment checklist (`platform: "hono"`)

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

## Cloudflare Workers output

See [`examples/basic-worker`](../examples/basic-worker) for a working app —
`npm run build && npm run preview` builds it and runs the combined Worker
locally on `workerd` via `wrangler dev`.

Set `platform: "cloudflare-worker"` to generate Cloudflare Workers-compatible
ES modules instead of a Bun server:

```ts
serverBuildPlugin({
  platform: "cloudflare-worker",
});
```

```txt
dist/
  client/
    index.html
    assets/
  server/
    worker.mjs            # combined Worker: every endpoint (+ serverEntry app)
    wrangler.toml
    functions/
      todos-get-todos/
        index.mjs          # independent Worker for just this endpoint
        wrangler.toml
      admin-users-delete-user/
        index.mjs
        wrangler.toml
```

Neither Worker script serves static files itself. `dist/server/wrangler.toml`
configures Cloudflare's own asset system to serve `dist/client` directly and
fall back to `index.html` for unmatched `GET` requests
(`not_found_handling = "single-page-application"`); the Worker only runs for
the generated API prefix (`run_worker_first`). This means there is no
Bun-specific static-file-serving code to port: Cloudflare serves assets
faster than a Worker could, from its edge cache.

### Combined Worker (`worker.mjs`)

- Registers generated `$server()` and HTTP helper endpoints under
  `/{pathnameBase}/*`, using the same request/response contract as
  `platform: "hono"`.
- Mounts a custom Hono app when `serverEntry` is configured, so your app's own
  middleware also runs for generated endpoints.
- Exports the Hono app directly (`export default app`), which Cloudflare
  Workers' module format accepts as a `fetch`-compatible handler.

Deploy it with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
cd dist/server
wrangler deploy
```

### Independent per-function Workers (`functions/<name>/`)

Unless `serverEntry` is configured, every `$server()`/HTTP endpoint is also
emitted as its own self-contained Worker module — a pure API Worker with no
assets binding — so it can be deployed, scaled, and versioned independently
of the rest:

```bash
cd dist/server/functions/todos-get-todos
wrangler deploy
```

Endpoints from the same source file that share module-level state, or call
each other by their original name, are grouped into a single Worker together
(the directory name joins their endpoint names), since that state cannot be
split across separately-deployed Workers. Once that join would exceed
Cloudflare's 63-character Worker name limit, it's truncated with a short
stable hash suffix instead — still deterministic, just less readable at a
glance. `examples/basic-worker` has a group large enough to show this; run
its build and look under `dist/server/functions/` for a real one.

These Workers are deployed on their own; the plugin does not wire routing
between them and the combined Worker's origin. To keep the client's
same-origin fetch calls (`/{pathnameBase}/<endpoint>`) working unchanged,
attach each one to the relevant path with a
[Cloudflare Route](https://developers.cloudflare.com/workers/configuration/routing/routes/)
on the same domain as the combined Worker or your static site.

When `serverEntry` is configured, this directory is not generated — see
[`platform`](./configuration.md#platform) for why.

### Constraints

- **No `$ws()`.** Cloudflare Workers needs Durable Objects to coordinate
  WebSocket connections across isolates; this plugin does not generate them.
  Builds fail with a descriptive error if any `$ws()` handlers are
  registered while `platform: "cloudflare-worker"` is set.
- **No `compile`.** `compile: true` produces standalone Bun executables and
  is rejected at plugin setup time when combined with
  `platform: "cloudflare-worker"`.
- **Runtime-only globals are still your responsibility.** Handlers that
  reference `Bun`, `process`, or Node built-ins run fine on `platform: "hono"`
  but will fail on Cloudflare Workers unless the API is available there (for
  example, via the `nodejs_compat` compatibility flag).

### Deployment checklist

1. Add [Wrangler](https://developers.cloudflare.com/workers/wrangler/) as a
   dev dependency (it drives every step below):

   ```bash
   npm install -D wrangler
   ```

2. Authenticate once per machine:

   ```bash
   npx wrangler login
   ```

   This opens a browser to authorize Wrangler against your Cloudflare
   account. For CI (no browser), skip `login` and instead set
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as environment
   variables — see [CI/CD](#cicd) below.

3. Build:

   ```bash
   vite build
   ```

   This writes `dist/client`, `dist/server/worker.mjs` +
   `dist/server/wrangler.toml`, and (unless `serverEntry` is configured)
   `dist/server/functions/<name>/`.

4. Deploy the combined Worker — serves every endpoint plus the client build:

   ```bash
   npx wrangler deploy --config dist/server/wrangler.toml
   ```

   The first deploy prints a `*.workers.dev` URL; that's your app. Re-run
   steps 3–4 for every subsequent deploy — build always comes first, since
   `wrangler.toml` is generated fresh each time (see the note on
   [bindings and secrets](#bindings-secrets-and-custom-domains) below).

5. Optionally, deploy one or more independent per-function Workers the same
   way, each from its own generated directory:

   ```bash
   npx wrangler deploy --config dist/server/functions/todos-get-todos/wrangler.toml
   ```

   Wire routing from your main domain to it separately — see
   [Independent per-function Workers](#independent-per-function-workers-functionsname) above.

#### Bindings, secrets, and custom domains

`dist/server/wrangler.toml` is fully regenerated on every build — the plugin
only knows about `name`, `main`, `compatibility_date`, and the assets
config. It does not (yet) have a way to merge in extra Wrangler
configuration, so:

- **Secrets** (API keys, tokens, connection strings) should go through
  [`wrangler secret put NAME`](https://developers.cloudflare.com/workers/configuration/secrets/)
  instead of the config file. Secrets are stored server-side and survive
  every future `wrangler deploy` regardless of what's in `wrangler.toml`, so
  you only need to set them once. Read them from handlers via the Hono
  context's `c.env` (available on HTTP method handlers; not on plain
  `$server()` handlers, which don't receive a context — use an `$get()`/
  `$post()` handler if a call needs bindings or secrets).
- **KV/D1/R2 bindings, `[vars]`, and `[[routes]]`/custom domains** are
  declared in `wrangler.toml` itself, so add them to the generated
  `dist/server/wrangler.toml` after each build and before each deploy (a
  small post-build script that appends the extra TOML works well in CI).
  Unlike secrets, plain `[vars]` **are** replaced by whatever the deployed
  config contains — pass `--keep-vars` to `wrangler deploy` if you set vars
  through the dashboard and want a build without them in `wrangler.toml` to
  leave those alone.
- A [custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
  is just a `[[routes]]` entry with `custom_domain = true`, added the same
  way.

#### CI/CD

Any CI system works as long as it builds first, then runs `wrangler deploy`
with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set. For example,
with GitHub Actions:

```yaml
name: Deploy to Cloudflare Workers
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: npm ci
      - run: npx vite build
      - run: npx wrangler deploy --config dist/server/wrangler.toml
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Create the API token under **My Profile → API Tokens** in the Cloudflare
dashboard (the "Edit Cloudflare Workers" template covers the permissions
`wrangler deploy` needs) and find the account ID on the Workers & Pages
overview page. Add both as repository secrets.

## Runtime requirements

- Vite integration: Vite `>=6.0.0`.
- Build-only Rollup integration: Rollup `>=4.0.0`.
- Build-only Rolldown integration: Rolldown `>=1.0.0`.
- Generated production server: Bun for `platform: "hono"` (default);
  [Wrangler](https://developers.cloudflare.com/workers/wrangler/) /
  Cloudflare Workers for `platform: "cloudflare-worker"`.
- `hono` peer dependency: `>=4.0.0`.
