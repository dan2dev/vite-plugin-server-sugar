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
    worker.mjs            # gateway: assets + forwards each endpoint to its Worker
    wrangler.toml
    functions/
      todos-get-todos/
        index.mjs          # independent Worker that actually implements this endpoint
        wrangler.toml
      admin-users-delete-user/
        index.mjs
        wrangler.toml
```

`worker.mjs` runs no handler code at all: every `$server()`/HTTP endpoint is
implemented *only* by its independent Worker under `functions/<name>/` (or,
with `serverEntry`, mounted onto your app instead — see below). `worker.mjs`
is a thin gateway with two jobs:

1. **Static assets.** `dist/server/wrangler.toml` configures Cloudflare's own
   asset system to serve `dist/client` directly and fall back to
   `index.html` for unmatched `GET` requests
   (`not_found_handling = "single-page-application"`); the gateway only runs
   for the generated API prefix (`run_worker_first`). No static-file-serving
   code to write or port — Cloudflare serves assets faster than a Worker
   could, from its edge cache.
2. **Routing.** For the API prefix, it looks up which independent Worker
   implements the requested endpoint and forwards the request to it via a
   [Service Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
   (`env.SVC_TODOS_GET_TODOS.fetch(request)`) — a same-server call with no
   added network latency, and no manual Cloudflare Route or custom domain
   required to reach independent Workers from one origin.

Neither the gateway nor any independent Worker uses Hono — request dispatch
is hand-written directly against the Fetch API
(`Request`/`Response`/`URL`). Measured on
[`examples/basic-worker`](../examples/basic-worker) (10 tiny handlers): the
gateway is **~1.9 KB** (just the routing table and forwarding glue — no
handler code, no imports), each independent Worker **3–4.5 KB**, versus
**42.8 KB** for a single Hono-based combined Worker. HTTP method handlers
(`$get`, `$post`, ...) still receive the same `ServerContext`-shaped object
documented in [macros](./macros.md) — `c.req.query()`, `c.req.json()`,
`c.env`, etc. — it just isn't a real Hono `Context` anymore on this platform.

### Gateway Worker (`worker.mjs`)

- Serves `dist/client` and forwards `/{pathnameBase}/*` requests to the
  independent Worker that owns each endpoint, using the same
  request/response contract as `platform: "hono"` end to end (methods, JSON
  body handling, status codes) — that contract is implemented by the
  independent Worker being forwarded to, not by the gateway.
- If an endpoint's Worker isn't deployed yet (or is down), the gateway
  returns `502` with a message naming the endpoint, instead of crashing.
- With `serverEntry` configured, this file is different: it mounts every
  endpoint directly onto your Hono app instead of forwarding anywhere (no
  independent Workers are generated in that case — see below), and exports
  it as `export default app`. Mounting onto *your* Hono app is why
  `serverEntry` still needs Hono even though the plugin's own codegen
  doesn't.

Deploy it with [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
— **after** the independent Workers it forwards to, so its Service Bindings
resolve to something real from the first request:

```bash
cd dist/server
wrangler deploy
```

### Independent per-function Workers (`functions/<name>/`)

Unless `serverEntry` is configured, every `$server()`/HTTP endpoint is
emitted as its own fully self-contained Worker module — the gateway forwards
to it, but it's also a complete Worker in its own right, reachable and
independently testable on its own:

```bash
cd dist/server/functions/todos-get-todos
wrangler deploy
```

Endpoints from the same source file that share module-level state, or call
each other by their original name, are grouped into a single Worker together
(the directory name joins their endpoint names), since that state cannot be
split across separately-deployed Workers. Generated deployment names are
capped at 54 characters so they also work with Wrangler's default preview
URLs; longer names are truncated with a short stable hash suffix — still
deterministic, just less readable at a glance. `examples/basic-worker` has a
group large enough to show this; run its build and look under
`dist/server/functions/` for a real one.

The gateway's Service Bindings to these Workers are fully generated —
there's no Cloudflare Route or custom domain to configure by hand just to
reach them from the same origin as your site.

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
- **Deploy order matters.** Without `serverEntry`, the gateway's Service
  Bindings point at the independent Workers by name — deploy those first.
  Deploying the gateway before them doesn't fail, but requests fail with a
  `502` until the Workers they target exist.
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

   This writes `dist/client`, `dist/server/functions/<name>/` (unless
   `serverEntry` is configured), and the gateway at `dist/server/worker.mjs`
   + `dist/server/wrangler.toml`.

4. Deploy every independent Worker **first** — the gateway's Service
   Bindings need them to already exist:

   ```bash
   for dir in dist/server/functions/*/; do
     npx wrangler deploy --config "$dir/wrangler.toml"
   done
   ```

5. Then deploy the gateway, which serves the client build and forwards API
   requests to whatever you deployed in step 4:

   ```bash
   npx wrangler deploy --config dist/server/wrangler.toml
   ```

   The first deploy prints a `*.workers.dev` URL; that's your app. Re-run
   steps 3–5 for every subsequent deploy — build always comes first, since
   `wrangler.toml` is generated fresh each time (see
   [bindings and secrets](#bindings-secrets-and-custom-domains) below).

With `serverEntry` configured, there's nothing to loop over — step 4
generates no independent Workers, and step 5 is the only deploy.

#### Testing Service Bindings locally

`wrangler dev` accepts multiple `--config`/`-c` flags to run several Workers
in one local session, resolving Service Bindings between them the same way
they resolve in production:

```bash
npx wrangler dev \
  -c dist/server/wrangler.toml \
  -c dist/server/functions/todos-get-todos/wrangler.toml \
  -c dist/server/functions/admin-users-delete-user/wrangler.toml \
  # ...one -c per functions/<name>/wrangler.toml
```

`examples/basic-worker`'s `npm run preview` only starts the gateway, so
requests to endpoints 404 through it locally unless you also list every
`functions/<name>/wrangler.toml` this way (or `cd` into one and run
`wrangler dev` there directly, bypassing the gateway entirely).

#### Bindings, secrets, and custom domains

Every generated `wrangler.toml` — the gateway's and each independent
Worker's — is fully regenerated on every build, and the plugin only knows
about `name`, `main`, `compatibility_date`, and (for the gateway) the assets
and Service Bindings config. It does not (yet) have a way to merge in extra
Wrangler configuration, so:

- **Add bindings and secrets to the specific Worker that needs them** — a
  KV/D1 binding a handler reads belongs on *that handler's* independent
  Worker (`dist/server/functions/<name>/wrangler.toml`), not the gateway,
  since the gateway never runs handler code. A custom domain or route
  belongs on the gateway, since that's the public entry point.
- **Secrets** (API keys, tokens, connection strings) should go through
  [`wrangler secret put NAME`](https://developers.cloudflare.com/workers/configuration/secrets/)
  instead of the config file, run against the specific Worker that needs
  them (`wrangler secret put NAME --config dist/server/functions/<name>/wrangler.toml`).
  Secrets are stored server-side and survive every future `wrangler deploy`
  regardless of what's in `wrangler.toml`, so you only need to set them
  once. Read them from handlers via `c.env` (available on HTTP method
  handlers; not on plain `$server()` handlers, which don't receive a
  context object at all — use an `$get()`/`$post()` handler if a call needs
  bindings or secrets).
- **KV/D1/R2 bindings and `[vars]`** are declared in `wrangler.toml` itself,
  so add them to the relevant generated file after each build and before
  each deploy (a small post-build script that appends the extra TOML works
  well in CI). Unlike secrets, plain `[vars]` **are** replaced by whatever
  the deployed config contains — pass `--keep-vars` to `wrangler deploy` if
  you set vars through the dashboard and want a build without them in
  `wrangler.toml` to leave those alone.
- A [custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
  is a `[[routes]]` entry with `custom_domain = true` on the **gateway's**
  `wrangler.toml`, added the same way.

#### CI/CD

Any CI system works as long as it builds first, deploys every independent
Worker, then deploys the gateway, with `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` set. For example, with GitHub Actions:

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
      - name: Deploy independent Workers
        run: |
          for dir in dist/server/functions/*/; do
            npx wrangler deploy --config "$dir/wrangler.toml"
          done
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Deploy gateway
        run: npx wrangler deploy --config dist/server/wrangler.toml
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
