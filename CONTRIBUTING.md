# Contributing

Thanks for improving `vite-plugin-server-sugar`.

## Discussion And Issues

Use GitHub issues for bug reports, enhancement requests, and design discussion:

https://github.com/dan2dev/vite-plugin-server-sugar/issues

Before opening a new issue, search existing issues for the same problem. When
reporting a bug, include the package version, Bun version, Vite/Rollup/Rolldown
version, operating system, a small reproduction when practical, and the
expected and actual behavior.

## Pull Requests

Pull requests are welcome. Small, focused changes are easiest to review.

For non-trivial changes, open an issue first so the design and compatibility
impact can be discussed. Pull requests should describe the user-facing behavior
change, link related issues when applicable, and include tests for new behavior
or bug fixes.

## Development

The package lives in `packages/vite-plugin`.

```bash
cd packages/vite-plugin
bun install
bun run check
```

`bun run check` runs the package type check, automated tests, and production
build. Individual commands are also available:

```bash
bun run typecheck
bun run test
bun run build
bun audit
```

## Contribution Requirements

Accepted contributions must:

- Preserve the MIT license and third-party notices.
- Keep public APIs documented in `packages/vite-plugin/README.md`.
- Add or update automated tests for major new functionality and bug fixes.
- Keep TypeScript strict checks passing with no unaddressed warnings.
- Avoid committing generated build output, local environment files, secrets, or
  credentials.
- Avoid introducing runtime dependencies unless they are needed by the package
  users and are compatible with the package license.

## Release Checks

Before a production release, maintainers should run:

```bash
cd packages/vite-plugin
bun run check
bun audit
npm --cache .npm-cache pack --dry-run
```

Release notes must summarize major user-visible changes and identify any
publicly known vulnerabilities fixed in the release. If no such vulnerabilities
were fixed, the release notes should say so.
