# vite-plugin-server-sugar docs

`vite-plugin-server-sugar` is a Vite plugin for keeping small Bun/Hono server
features next to client code. It rewrites compile-time macros such as
`$server()`, `$ws()`, and `$worker()` into browser-safe clients, then emits a
production server that runs the original server code.

## Start here

- [Getting started](./getting-started.md): install the package, configure Vite,
  add macro types, write the first server function, and run the generated
  production server.
- [Macro reference](./macros.md): `$server()`, HTTP method helpers, `$ws()`,
  `$worker()`, typing patterns, and shared state behavior.
- [Configuration reference](./configuration.md): plugin options, Vite setup,
  Rollup/Rolldown entrypoints, and TypeScript setup.
- [Runtime and deployment](./runtime-and-deployment.md): generated endpoint
  paths, request/response contracts, build output, static asset serving, and
  Bun deployment.
- [Troubleshooting](./troubleshooting.md): common setup, runtime, typing, and
  build issues.

## Example app

The [basic PWA example](../examples/basic-pwa) exercises the complete public
surface:

- `$server()` CRUD calls.
- `$get()`, `$post()`, `$put()`, `$patch()`, `$delete()`, and `$head()`.
- `$ws()` chat and broadcast.
- `$worker()` method proxies.
- A custom Hono `serverEntry`.
- Shared state and transform edge cases.

## Package docs

- [Root README](../README.md)
- [Package README](../packages/vite-plugin/README.md)
- [Architecture notes](../packages/vite-plugin/ARCHITECTURE.md)
- [Changelog](../CHANGELOG.md)
