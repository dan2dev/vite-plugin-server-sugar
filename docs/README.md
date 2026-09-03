# vite-plugin-server-sugar docs

`vite-plugin-server-sugar` is a Vite plugin for keeping small Hono server
features next to client code. It rewrites compile-time macros such as
`$server()`, `$ws()`, and `$worker()` into browser-safe clients, then emits a
production server that runs the original server code — a Bun + Hono server by
default, or Cloudflare Workers modules with `platform: "cloudflare-worker"`.

## Start here

- [Getting started](./getting-started.md): install the package, configure Vite,
  add macro types, write the first server function, and run the generated
  production server.
- [Macro reference](./macros.md): `$server()`, HTTP method helpers, `$ws()`,
  `$worker()`, typing patterns, and shared state behavior.
- [Configuration reference](./configuration.md): plugin options, Vite setup,
  Rollup/Rolldown entrypoints, and TypeScript setup.
- [Runtime and deployment](./runtime-and-deployment.md): generated endpoint
  paths, request/response contracts, build output, static asset serving, Bun
  deployment, and Cloudflare Workers deployment.
- [Troubleshooting](./troubleshooting.md): common setup, runtime, typing, and
  build issues.

## Example apps

The [basic PWA example](../examples/basic-pwa) exercises the complete public
surface on the default `platform: "hono"` output:

- `$server()` CRUD calls.
- `$get()`, `$post()`, `$put()`, `$patch()`, `$delete()`, and `$head()`.
- `$ws()` chat and broadcast.
- `$worker()` method proxies.
- A custom Hono `serverEntry`.
- Shared state and transform edge cases.

The [basic Worker example](../examples/basic-worker) uses the same
`$server()`/HTTP macros with `platform: "cloudflare-worker"` instead,
previewed locally with `wrangler dev` (`workerd`). It shows how the plugin
groups endpoints that share module-level state into one independent Worker,
and splits the rest into one Worker per endpoint.

## Package docs

- [Root README](../README.md)
- [Package README](../packages/vite-plugin/README.md)
- [Architecture notes](../packages/vite-plugin/ARCHITECTURE.md)
- [Changelog](../CHANGELOG.md)
