import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateCloudflareFunctionBundles,
  generateCloudflareWorkerBundle,
} from '../../src/build/cloudflare-bundle-generator';
import { Registry } from '../../src/core/registry';
import { createEndpointPaths } from '../../src/endpoint-paths';
import type { ServerEntry, WsEntry } from '../../src/types';

let tempDir: string;
let serverEntryPath: string;

beforeAll(() => {
  tempDir = join(tmpdir(), `cloudflare-bundle-gen-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  serverEntryPath = join(tempDir, 'server.ts');
  writeFileSync(
    serverEntryPath,
    `import { Hono } from 'hono';\nexport default new Hono();\n`,
  );
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeServerEntry(overrides: Partial<ServerEntry> & { endpoint: string; file: string }): ServerEntry {
  return {
    imports: [],
    fnJs: '(args) => args',
    originalName: undefined,
    moduleDeclsJs: undefined,
    hasSiblingCrossRefs: undefined,
    ...overrides,
  };
}

function makeWsEntry(overrides: Partial<WsEntry> & { endpoint: string; file: string }): WsEntry {
  return {
    imports: [],
    handlersJs: '({ onMessage(ws, data) { ws.send(data); } })',
    originalName: undefined,
    moduleDeclsJs: undefined,
    hasSiblingCrossRefs: undefined,
    ...overrides,
  };
}

describe('generateCloudflareWorkerBundle', () => {
  it('returns null when there are no endpoints and no serverEntry', () => {
    const registry = new Registry<ServerEntry>();
    const result = generateCloudflareWorkerBundle(registry, undefined, null, tempDir);
    expect(result).toBeNull();
  });

  it('throws when serverEntry is configured but the file does not exist', () => {
    const registry = new Registry<ServerEntry>();
    const missing = join(tempDir, 'missing-server.ts');
    expect(() =>
      generateCloudflareWorkerBundle(registry, 'missing-server.ts', missing, tempDir),
    ).toThrow(/missing-server\.ts.*does not exist/);
  });

  it('throws a descriptive error when $ws() endpoints are registered', () => {
    const registry = new Registry<ServerEntry>();
    const wsRegistry = new Registry<WsEntry>();
    const wsEntry = makeWsEntry({ endpoint: 'chat/chat', file: join(tempDir, 'src/chat.ts') });
    wsRegistry.set(wsEntry.endpoint, wsEntry);

    expect(() =>
      generateCloudflareWorkerBundle(registry, undefined, null, tempDir, wsRegistry),
    ).toThrow(/does not support \$ws\(\).*chat\/chat/s);
  });

  it('generates a Hono-free forwarding gateway with no Bun-only APIs and no inlined handler code', () => {
    const registry = new Registry<ServerEntry>();
    const entry = makeServerEntry({ endpoint: 'todos/get-todos', file: join(tempDir, 'src/todos.ts') });
    registry.set(entry.endpoint, entry);

    const result = generateCloudflareWorkerBundle(registry, undefined, null, tempDir, undefined, undefined, [
      { endpoints: ['todos/get-todos'], binding: 'SVC_TODOS_GET_TODOS', workerName: 'my-app-todos-get-todos' },
    ]);

    expect(result).not.toBeNull();
    // No serverEntry: the combined Worker is a gateway, not Hono, and never
    // duplicates handler code or a framework baseline.
    expect(result).not.toContain('hono');
    expect(result).not.toContain('Hono');
    expect(result).not.toContain(entry.fnJs);
    expect(result).toContain('async function __dispatch(request, env)');
    expect(result).toContain('export default {');
    expect(result).toContain('fetch(request, env)');
    // Routes the endpoint to its independent Worker's Service Binding.
    expect(result).toContain('"todos/get-todos": "SVC_TODOS_GET_TODOS"');
    expect(result).toContain('service.fetch(request)');
    // Requests outside the API prefix 404 instead of forwarding anywhere.
    expect(result).toContain('url.pathname.startsWith("/__server-build/")');
    expect(result).toContain('new Response("Not Found", { status: 404 })');
    // Cloudflare's own asset system serves static files; the Worker must not
    // reach for Bun-only APIs or try to serve files off disk itself.
    expect(result).not.toContain('Bun.serve');
    expect(result).not.toContain('Bun.file');
    expect(result).not.toContain('Bun.env');
    expect(result).not.toContain('fileURLToPath');
  });

  it('handles an unavailable upstream Worker without throwing', () => {
    const registry = new Registry<ServerEntry>();
    const entry = makeServerEntry({ endpoint: 'todos/get-todos', file: join(tempDir, 'src/todos.ts') });
    registry.set(entry.endpoint, entry);

    const result = generateCloudflareWorkerBundle(registry, undefined, null, tempDir, undefined, undefined, [
      { endpoints: ['todos/get-todos'], binding: 'SVC_TODOS_GET_TODOS', workerName: 'my-app-todos-get-todos' },
    ])!;

    expect(result).toContain('try {');
    expect(result).toContain('is unavailable');
    expect(result).toContain('502');
  });

  it('gateway has no routes and 404s everything when there are no independent Workers to forward to', () => {
    const registry = new Registry<ServerEntry>();
    const entry = makeServerEntry({ endpoint: 'todos/get-todos', file: join(tempDir, 'src/todos.ts') });
    registry.set(entry.endpoint, entry);

    const result = generateCloudflareWorkerBundle(registry, undefined, null, tempDir)!;

    expect(result).toContain('const __routes = {\n};');
  });

  it('mounts generated endpoints onto a configured serverEntry app', () => {
    const registry = new Registry<ServerEntry>();
    const entry = makeServerEntry({ endpoint: 'todos/get-todos', file: join(tempDir, 'src/todos.ts') });
    registry.set(entry.endpoint, entry);

    const result = generateCloudflareWorkerBundle(
      registry,
      'server.ts',
      serverEntryPath,
      tempDir,
    );

    expect(result).not.toBeNull();
    expect(result).toContain("import * as __serverEntry from");
    expect(result).toContain('__serverEntry.default ?? __serverEntry.app');
    expect(result).toContain("typeof app.fetch !== 'function'");
    expect(result).toContain('export default app;');
  });

  it('respects a custom pathnameBase for the dispatch route', () => {
    const registry = new Registry<ServerEntry>();
    const entry = makeServerEntry({ endpoint: 'todos/get-todos', file: join(tempDir, 'src/todos.ts') });
    registry.set(entry.endpoint, entry);

    const result = generateCloudflareWorkerBundle(
      registry,
      undefined,
      null,
      tempDir,
      undefined,
      createEndpointPaths('/rpc'),
    );

    expect(result).not.toBeNull();
    expect(result).toContain('url.pathname.startsWith("/rpc/")');
    expect(result).not.toContain('url.pathname.startsWith("/__server-build/")');
  });
});

describe('generateCloudflareFunctionBundles', () => {
  it('returns an empty array when the registry is empty', () => {
    const registry = new Registry<ServerEntry>();
    expect(generateCloudflareFunctionBundles(registry, undefined, tempDir)).toEqual([]);
  });

  it('returns an empty array when serverEntry is configured', () => {
    const registry = new Registry<ServerEntry>();
    const entry = makeServerEntry({ endpoint: 'todos/get-todos', file: join(tempDir, 'src/todos.ts') });
    registry.set(entry.endpoint, entry);

    expect(generateCloudflareFunctionBundles(registry, 'server.ts', tempDir)).toEqual([]);
  });

  it('throws a descriptive error when $ws() endpoints are registered', () => {
    const registry = new Registry<ServerEntry>();
    const wsRegistry = new Registry<WsEntry>();
    const wsEntry = makeWsEntry({ endpoint: 'chat/chat', file: join(tempDir, 'src/chat.ts') });
    wsRegistry.set(wsEntry.endpoint, wsEntry);

    expect(() =>
      generateCloudflareFunctionBundles(registry, undefined, tempDir, wsRegistry),
    ).toThrow(/does not support \$ws\(\)/);
  });

  it('emits one independent bundle per endpoint when they share no state', () => {
    const registry = new Registry<ServerEntry>();
    const a = makeServerEntry({ endpoint: 'todos/get-todos', file: join(tempDir, 'src/todos.ts') });
    const b = makeServerEntry({ endpoint: 'users/get-user', file: join(tempDir, 'src/users.ts') });
    registry.set(a.endpoint, a);
    registry.set(b.endpoint, b);

    const bundles = generateCloudflareFunctionBundles(registry, undefined, tempDir);

    expect(bundles).toHaveLength(2);
    const bySlug = new Map(bundles.map((bundle) => [bundle.slug, bundle]));

    const todos = bySlug.get('todos-get-todos');
    expect(todos).toBeDefined();
    expect(todos!.endpoints).toEqual(['todos/get-todos']);
    expect(todos!.source).toContain('"todos/get-todos"');
    expect(todos!.source).not.toContain('"users/get-user"');
    expect(todos!.source).toContain('export default {');
    expect(todos!.source).not.toContain('Hono');

    const users = bySlug.get('users-get-user');
    expect(users).toBeDefined();
    expect(users!.endpoints).toEqual(['users/get-user']);
    expect(users!.source).toContain('"users/get-user"');
    expect(users!.source).not.toContain('"todos/get-todos"');
    expect(users!.source).not.toContain('Hono');
  });

  it('groups same-file endpoints that share module-level state into one bundle', () => {
    const registry = new Registry<ServerEntry>();
    const sharedDecls = 'let count = 0;';
    const inc = makeServerEntry({
      endpoint: 'counter/increment',
      file: join(tempDir, 'src/counter.ts'),
      fnJs: '() => { count += 1; return count; }',
      originalName: 'increment',
      moduleDeclsJs: sharedDecls,
    });
    const get = makeServerEntry({
      endpoint: 'counter/get-count',
      file: join(tempDir, 'src/counter.ts'),
      fnJs: '() => count',
      originalName: 'getCount',
      moduleDeclsJs: sharedDecls,
    });
    registry.set(inc.endpoint, inc);
    registry.set(get.endpoint, get);

    const bundles = generateCloudflareFunctionBundles(registry, undefined, tempDir);

    expect(bundles).toHaveLength(1);
    expect(bundles[0].endpoints.sort()).toEqual(['counter/get-count', 'counter/increment']);
    expect(bundles[0].source).toContain('let count = 0;');
    expect(bundles[0].source).toContain('"counter/increment"');
    expect(bundles[0].source).toContain('"counter/get-count"');
  });

  it('keeps endpoints from different files independent even when names collide after slugification', () => {
    const registry = new Registry<ServerEntry>();
    const a = makeServerEntry({ endpoint: 'a/handler', file: join(tempDir, 'src/a.ts') });
    const b = makeServerEntry({ endpoint: 'b/handler', file: join(tempDir, 'src/b.ts') });
    registry.set(a.endpoint, a);
    registry.set(b.endpoint, b);

    const bundles = generateCloudflareFunctionBundles(registry, undefined, tempDir);
    const slugs = bundles.map((bundle) => bundle.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
