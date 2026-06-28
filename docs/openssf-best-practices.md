# OpenSSF Best Practices Badge Audit

This document records the current `vite-plugin-server-sugar` evidence for the
OpenSSF Best Practices passing badge.

Criteria source:
https://www.bestpractices.dev/en/criteria/0

## Verified Locally

Run from `packages/vite-plugin` on 2026-06-28:

```bash
bun run test
bun run typecheck
bun run build
bun audit
```

Results:

- `bun run test`: 24 test files passed, 275 tests passed.
- `bun run typecheck`: passed.
- `bun run build`: passed.
- `bun audit`: no vulnerabilities found.

## Badge Evidence URLs

Use these public project URLs when filling the badge form after the changes are
pushed to GitHub:

- Project description: `README.md`
- How to obtain: `README.md`, npm package link
- Feedback and bug reports: GitHub issues, linked from `README.md`
- Contribution process: `CONTRIBUTING.md`
- Contribution requirements and test policy: `CONTRIBUTING.md`
- License: `LICENSE`
- Basic and interface documentation: `README.md` and
  `packages/vite-plugin/ARCHITECTURE.md`
- Release notes: `CHANGELOG.md`
- Vulnerability reporting process: `SECURITY.md`
- Build and test instructions: `CONTRIBUTING.md` and
  `packages/vite-plugin/package.json`
- CI evidence: `.github/workflows/ci.yml`
- Dependency update tracking: `.github/dependabot.yml`

## Passing Badge Status

Likely met by repository evidence:

- Basic website description, package acquisition, issue tracker, contribution
  process, and contribution requirements.
- MIT FLOSS license in a standard location.
- English documentation and interface documentation.
- Public git repository, interim changes, version tags, and SemVer package
  versions.
- Human-readable release notes.
- Public bug-report archive through GitHub issues.
- Published private vulnerability-report process.
- Working build system and automated tests.
- Test policy for major functionality.
- Strict TypeScript checks and no unaddressed local warnings.
- MITM-resistant project and package URLs using HTTPS.
- No dependency vulnerabilities found by `bun audit`.

Maintainer/account-side confirmations still needed:

- The GitHub repository must be public and issues must be enabled.
- The maintainer must confirm that a majority of recent bug reports and
  enhancement requests, if any exist in the 2-12 month window, have received a
  response.
- The maintainer must confirm the project is actively maintained.
- The maintainer must confirm secure-development knowledge criteria.
- The maintainer must confirm there are no unpatched publicly known
  medium-or-higher vulnerabilities older than 60 days.
- If private vulnerability reports were received in the last 6 months, the
  maintainer must confirm initial responses were sent within 14 days.

## Notes For Form Answers

For cryptography-related criteria, this package does not implement
cryptographic protocols. It calls Node's `crypto` module with SHA-256 for
deterministic internal identifier generation.

For password-storage criteria, mark N/A. The package does not store passwords.

For dynamic analysis related to memory-unsafe languages, mark N/A. The package
is TypeScript.
