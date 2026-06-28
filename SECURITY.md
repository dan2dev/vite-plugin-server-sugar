# Security Policy

## Supported Versions

Security fixes are provided for the latest published release of
`vite-plugin-server-sugar`.

## Reporting A Vulnerability

Please report suspected vulnerabilities privately by email:

duocraft.tech@gmail.com

Include the affected version, a description of the issue, reproduction steps or
proof of concept if available, and any known impact. Do not open a public issue
until the vulnerability has been triaged and disclosure has been coordinated.

The project aims to acknowledge vulnerability reports within 14 days. Confirmed
vulnerabilities are fixed as quickly as practical, prioritized by severity and
exploitability.

## Disclosure

After a fix is available, the project will publish the vulnerability details in
release notes or a GitHub security advisory when appropriate. Release notes must
identify any publicly known runtime vulnerability fixed in that release that had
a CVE or similar identifier when the release was created.

## Security Notes

This package is a Vite/Rollup/Rolldown plugin. It does not store user passwords
or long-lived credentials.

The package uses Node's `crypto` module with SHA-256 for deterministic internal
identifier generation. It does not implement its own cryptographic algorithms.
