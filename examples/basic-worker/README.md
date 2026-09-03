# vite-plugin-server-sugar example: Cloudflare Workers

A minimal Vite app that targets `platform: "cloudflare-worker"` instead of
the default Bun + Hono server. See [`examples/basic-pwa`](../basic-pwa) for
the full macro surface (`$ws()`, `$worker()`, a custom `serverEntry`) on the
default platform. This example stays framework-free (no React) and skips
`$ws()` — genuinely unsupported here, see [Constraints](#constraints) — to
keep the focus on the Cloudflare output. It also skips `$worker()`, the
dedicated-Web-Worker macro: that one still works fine with
`platform: "cloudflare-worker"` (it's an unrelated, client-side-only
feature), it's just left out here to avoid confusing "`$worker()`" with
"Cloudflare Worker." The todo endpoints use a Cloudflare D1 database, so
their data survives Worker restarts both locally and after deployment.

```ts
// vite.config.ts
serverBuildPlugin({
  platform: "cloudflare-worker",
});
```

That platform setting is the only plugin difference from a normal setup.
`$server()` and the HTTP method macros (`$get`, `$post`, ...) work exactly
the same as they do with `platform: "hono"` — same endpoint paths, same
request/response contract.
What changes is the production output: instead of one Bun server, every
endpoint becomes its own independent Cloudflare Worker, fronted by a thin
gateway Worker that serves the client build and forwards to them — deployed
with [Wrangler](https://developers.cloudflare.com/workers/wrangler/) and
served locally by `workerd` (the same runtime Cloudflare's edge uses).

This app has no `serverEntry`, so none of the generated output uses Hono —
dispatch is hand-written directly against the Fetch API. That's what keeps
the independent Workers (below) cheap: each one ships as just that dispatch
glue plus its own handler code, not another copy of a shared framework.
`hono` isn't even a dependency of this example.

## Run

Install dependencies:

```bash
npm install
# or: bun install
```

Start the complete app locally:

```bash
npm run dev
```

This builds the app, adds the D1 binding to the generated todos Worker,
applies [`migrations/0001_create_todos.sql`](./migrations/0001_create_todos.sql),
and starts the gateway plus all four function Workers on
`http://localhost:8787`. It uses local `workerd` storage, so no Cloudflare
account is needed. D1 data is stored in `.wrangler/state` and remains there
across restarts; remove that directory if you want a fresh local database.

The usual Vite-only dev server cannot supply a Cloudflare D1 binding. For
that reason, this example's `dev` command intentionally runs the
production-like Wrangler stack instead of `vite` directly.

## Build

```bash
npm run build
```

This writes the client build to `dist/client` and, because of
`platform: "cloudflare-worker"`, writes Cloudflare Worker output to
`dist/server` instead of a Bun server. The final build step runs
[`scripts/configure-d1.mjs`](./scripts/configure-d1.mjs), which appends the
D1 binding to the generated todos Worker config:

```txt
dist/
  client/
    index.html
    assets/
  server/
    worker.mjs             # gateway: serves dist/client, forwards API calls below
    wrangler.toml
    functions/
      todos-.../            # listTodos, addTodo, toggleTodo, deleteTodo, todoCount
        index.mjs            # grouped D1-backed handlers
        wrangler.toml        # includes the DB binding after the post-build step
      counter-.../           # increment, resetCount, getCount
        index.mjs            # (grouped: they all share the `count` variable)
        wrangler.toml
      health-get-health/
        index.mjs            # getHealth (its own Worker: no shared state)
        wrangler.toml
      health-ping/
        index.mjs            # ping (its own Worker: no shared state)
        wrangler.toml
```

`worker.mjs` doesn't implement any endpoint itself — every one is
implemented *only* by its independent Worker under `functions/<name>/`.
`worker.mjs` serves `dist/client` and, for API requests, looks up which
independent Worker owns the endpoint and forwards to it through a generated
[Service Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
— a same-server call, not a network request, and nothing to wire up by hand.

The plugin generates every `.mjs` file and base `wrangler.toml`; the example's
post-build script adds its application-specific D1 binding. See
[`src/todos.ts`](./src/todos.ts), [`src/counter.ts`](./src/counter.ts),
and [`src/health.ts`](./src/health.ts) for why some handlers get grouped into
one Worker and others don't: it comes down to whether they close over the
same module-level declarations, not which file they happen to live in.

The `functions/*-.../` directory names above are exactly what gets generated:
grouped Workers name their directory by joining every endpoint they contain,
then truncate to a short hash suffix once that join gets long (generated
deployment names are capped at 54 characters so Wrangler's default preview
URLs accept them) — run the build yourself and look under
`dist/server/functions/` for the real names.

For these 10 tiny handlers, `worker.mjs` comes out to about **1.9 KB** — just
a routing table and forwarding glue, no handler code or imports at all — and
each independent Worker to roughly 3–5 KB. That's only this small because
there's no Hono anywhere in it; the same shape of output with Hono bundled into a
single combined Worker (as it would be with a `serverEntry` configured)
would run closer to 40 KB.

## Preview with `workerd` locally

```bash
npm run preview
```

`preview` is an alias for the same build/migrate/start flow as `dev`.
[`scripts/local.mjs`](./scripts/local.mjs) discovers the generated function
directories, applies pending migrations with `--local`, and passes every
config to one `wrangler dev` session. Service Bindings therefore resolve the
same way they do in production, and D1 reads and writes use the explicit
`.wrangler/state` persistence directory.

The equivalent manual Wrangler command after a build is:

```bash
npx wrangler dev \
  --persist-to .wrangler/state \
  -c dist/server/wrangler.toml \
  -c dist/server/functions/health-get-health/wrangler.toml \
  -c dist/server/functions/health-ping/wrangler.toml \
  -c "dist/server/functions/todos-.../wrangler.toml" \
  -c "dist/server/functions/counter-.../wrangler.toml"
  # (replace the todos-.../counter-... paths with the real directory names
  # from your own build — see the note above)
```

The local script also runs the equivalent of this command first:

```bash
npx wrangler d1 migrations apply DB --local \
  --persist-to .wrangler/state \
  -c "dist/server/functions/todos-.../wrangler.toml"
```

Then try:

```bash
curl http://localhost:8787/__server-build/todos/list-todos
curl http://localhost:8787/__server-build/todos/add-todo \
  -X POST -H 'content-type: application/json' \
  -d '{"text":"persists across restarts"}'
curl http://localhost:8787/__server-build/counter/increment -X POST -H 'content-type: application/json' -d '[]'
curl http://localhost:8787/__server-build/health/ping
```

To preview one of the independent per-function Workers on its own instead
— bypassing the gateway entirely — point `wrangler dev` at just its config:

```bash
npx wrangler dev --config dist/server/functions/health-ping/wrangler.toml
```

That Worker only knows about `health/ping` — every other endpoint 404s from
it, since it's a genuinely separate deployment with no access to the other
Workers' code or state.

## Deploy

Deploy the complete app:

```bash
npm run deploy
# or: bun run deploy
```

The deploy script looks for a D1 database named `basic-worker-todos` and
creates it when it does not exist. It then applies pending migrations to the
remote database, deploys each independent Worker, and deploys the gateway
last. It requires `wrangler login` first, or a `CLOUDFLARE_API_TOKEN` in CI.
Set `CLOUDFLARE_D1_DATABASE_ID=<uuid>` to skip name lookup and creation, which
is useful when a CI environment should target one specific database.

Every `wrangler.toml` here is regenerated by `npm run build`, which is why
the D1 binding is applied by a repeatable post-build script instead of a
manual edit. It belongs on the todos Worker, not the gateway, because the
gateway never runs handler code. Use the same approach for KV/R2 bindings,
`[vars]`, or custom domains. Secrets (`wrangler secret put NAME`) persist
outside the generated config. See
[Bindings, secrets, and custom domains](https://github.com/dan2dev/vite-plugin-server-sugar/blob/main/docs/runtime-and-deployment.md#bindings-secrets-and-custom-domains)
and the full
[deployment checklist](https://github.com/dan2dev/vite-plugin-server-sugar/blob/main/docs/runtime-and-deployment.md#deployment-checklist)
(including a CI/CD example) for the details.

## Constraints

Two things that work with the default `platform: "hono"` do not work here,
and the plugin fails the build with a clear error (or refuses to start) if
you try:

- **`$ws()`** — Cloudflare Workers needs Durable Objects to coordinate
  WebSocket connections across isolates, which this plugin does not
  generate.
- **`compile: true`** — that option produces standalone Bun executables and
  only makes sense for `platform: "hono"`.
- **A custom `serverEntry` Hono app still works**, but disables independent
  per-function Workers: every endpoint gets mounted on your app in
  `dist/server/worker.mjs` instead (which stops being a gateway and goes
  back to running handler code directly, like `platform: "hono"` does), so
  your app's middleware keeps running for all of them. This example leaves
  `serverEntry` unset specifically to show the independent-Worker behavior.

See
[Runtime and deployment](https://github.com/dan2dev/vite-plugin-server-sugar/blob/main/docs/runtime-and-deployment.md#cloudflare-workers-output)
for the full reference.

## Files

- [`src/todos.ts`](./src/todos.ts): D1-backed CRUD with `$get()`, `$post()`,
  `$patch()`, and `$delete()`, grouped into one independent Worker.
- [`migrations/0001_create_todos.sql`](./migrations/0001_create_todos.sql):
  D1 schema for the persistent todos table.
- [`scripts/configure-d1.mjs`](./scripts/configure-d1.mjs): adds the D1
  binding to the generated todos Worker config after each build.
- [`scripts/local.mjs`](./scripts/local.mjs): applies local migrations and
  starts the complete multi-Worker Wrangler session with persistent state.
- [`scripts/deploy.mjs`](./scripts/deploy.mjs): migrates remote D1, deploys
  the function Workers, then deploys the gateway.
- [`src/counter.ts`](./src/counter.ts): a second, separate shared-state group
  — its own independent Worker.
- [`src/health.ts`](./src/health.ts): two handlers with no shared state —
  each becomes its own independent Worker, even though they're in the same
  file.
- [`src/main.ts`](./src/main.ts): plain TypeScript UI calling all of the
  above like normal async functions.
- [`vite.config.ts`](./vite.config.ts): the one-line plugin config change.
