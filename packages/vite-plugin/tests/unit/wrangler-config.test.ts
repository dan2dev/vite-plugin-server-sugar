import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateAggregateWranglerConfig,
  generateFunctionWranglerConfig,
  resolveProjectName,
  serviceBindingName,
  slugForEndpoints,
  todayCompatibilityDate,
  workerName,
} from '../../src/build/wrangler-config';

describe('resolveProjectName', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = join(tmpdir(), `wrangler-config-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sanitizes a scoped package name into a valid Worker name', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: '@acme/cool-app' }));
    expect(resolveProjectName(tempDir)).toBe('acme-cool-app');
  });

  it('falls back to a generic default when package.json is missing', () => {
    const emptyDir = join(tempDir, 'no-package-json');
    mkdirSync(emptyDir, { recursive: true });
    expect(resolveProjectName(emptyDir)).toBe('server-build');
  });

  it('falls back to a generic default when package.json has no usable name', () => {
    const dir = join(tempDir, 'blank-name');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '' }));
    expect(resolveProjectName(dir)).toBe('server-build');
  });

  it('falls back to a generic default when package.json is invalid JSON', () => {
    const dir = join(tempDir, 'invalid-json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{ not valid json');
    expect(resolveProjectName(dir)).toBe('server-build');
  });
});

describe('slugForEndpoints', () => {
  it('replaces path separators with hyphens', () => {
    expect(slugForEndpoints(['todos/get-todos'])).toBe('todos-get-todos');
  });

  it('joins multiple endpoints into one Worker-name-safe slug', () => {
    // The `_` joiner itself gets sanitized to `-` along with the `/` in each
    // endpoint, since Cloudflare Worker names only allow `[a-z0-9-]`.
    expect(slugForEndpoints(['counter/increment', 'counter/get-count'])).toBe(
      'counter-increment-counter-get-count',
    );
  });

  it('truncates very long joins with a stable hash suffix', () => {
    const endpoints = Array.from({ length: 10 }, (_, i) => `some/very-long-endpoint-name-${i}`);
    const slug = slugForEndpoints(endpoints);
    expect(slug.length).toBeLessThanOrEqual(49);
    // Deterministic: the same input always produces the same slug.
    expect(slugForEndpoints(endpoints)).toBe(slug);
  });
});

describe('workerName', () => {
  it('combines a base name and suffix with a hyphen', () => {
    expect(workerName('server-build', 'todos-get-todos')).toBe('server-build-todos-get-todos');
  });

  it('returns the base name unchanged when no suffix is given', () => {
    expect(workerName('server-build')).toBe('server-build');
  });

  it('keeps the result within the Wrangler preview URL name limit', () => {
    const name = workerName('server-build', 'x'.repeat(100));
    expect(name.length).toBeLessThanOrEqual(54);
    expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe('serviceBindingName', () => {
  it('produces a valid, uppercase JS-identifier-safe binding name', () => {
    expect(serviceBindingName('todos-get-todos')).toBe('SVC_TODOS_GET_TODOS');
  });

  it('is deterministic for the same slug', () => {
    expect(serviceBindingName('counter-increment')).toBe(serviceBindingName('counter-increment'));
  });

  it('produces distinct names for distinct slugs', () => {
    expect(serviceBindingName('todos-get-todos')).not.toBe(serviceBindingName('users-get-user'));
  });
});

describe('todayCompatibilityDate', () => {
  it('returns a YYYY-MM-DD date string', () => {
    expect(todayCompatibilityDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('generateAggregateWranglerConfig', () => {
  it('includes assets, SPA fallback, and a scoped run_worker_first', () => {
    const toml = generateAggregateWranglerConfig({
      name: 'server-build',
      main: 'worker.mjs',
      assetsDirectory: '../client',
      apiPrefix: '/__server-build/',
      compatibilityDate: '2026-01-01',
    });

    expect(toml).toContain('name = "server-build"');
    expect(toml).toContain('main = "worker.mjs"');
    expect(toml).toContain('compatibility_date = "2026-01-01"');
    expect(toml).toContain('[assets]');
    expect(toml).toContain('directory = "../client"');
    expect(toml).toContain('binding = "ASSETS"');
    expect(toml).toContain('not_found_handling = "single-page-application"');
    expect(toml).toContain('run_worker_first = ["/__server-build/*"]');
  });

  it('scopes run_worker_first to a custom pathnameBase', () => {
    const toml = generateAggregateWranglerConfig({
      name: 'server-build',
      main: 'worker.mjs',
      assetsDirectory: '../client',
      apiPrefix: '/rpc/',
      compatibilityDate: '2026-01-01',
    });

    expect(toml).toContain('run_worker_first = ["/rpc/*"]');
  });

  it('omits [[services]] when there are no independent Workers to forward to', () => {
    const toml = generateAggregateWranglerConfig({
      name: 'server-build',
      main: 'worker.mjs',
      assetsDirectory: '../client',
      apiPrefix: '/__server-build/',
      compatibilityDate: '2026-01-01',
    });

    expect(toml).not.toContain('[[services]]');
  });

  it('adds one [[services]] block per independent Worker to forward to', () => {
    const toml = generateAggregateWranglerConfig({
      name: 'server-build',
      main: 'worker.mjs',
      assetsDirectory: '../client',
      apiPrefix: '/__server-build/',
      compatibilityDate: '2026-01-01',
      services: [
        { binding: 'SVC_TODOS_GET_TODOS', service: 'server-build-todos-get-todos' },
        { binding: 'SVC_COUNTER_INCREMENT', service: 'server-build-counter-increment' },
      ],
    });

    const matches = toml.match(/\[\[services\]\]/g);
    expect(matches).toHaveLength(2);
    expect(toml).toContain('binding = "SVC_TODOS_GET_TODOS"');
    expect(toml).toContain('service = "server-build-todos-get-todos"');
    expect(toml).toContain('binding = "SVC_COUNTER_INCREMENT"');
    expect(toml).toContain('service = "server-build-counter-increment"');
  });
});

describe('generateFunctionWranglerConfig', () => {
  it('omits an assets block for independent per-function Workers', () => {
    const toml = generateFunctionWranglerConfig({
      name: 'server-build-todos-get-todos',
      main: 'index.mjs',
      compatibilityDate: '2026-01-01',
    });

    expect(toml).toContain('name = "server-build-todos-get-todos"');
    expect(toml).toContain('main = "index.mjs"');
    expect(toml).toContain('compatibility_date = "2026-01-01"');
    expect(toml).not.toContain('[assets]');
  });
});
