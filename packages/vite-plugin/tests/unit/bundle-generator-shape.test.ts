import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateBundleContent } from '../../src/build/bundle-generator';
import { Registry } from '../../src/core/registry';
import type { BackendEntry, WebSocketEntry } from '../../src/types';

/**
 * Unit tests for Bundle Generator structural shape.
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 *
 * These tests verify the STRUCTURAL SHAPE of the generated output string
 * by checking for specific patterns, keywords, and code constructs.
 */

describe('Bundle Generator Structural Shape', () => {
  let tempDir: string;
  let serverEntryPath: string;
  let serverOutDir: string;
  let clientOutDir: string;

  beforeAll(() => {
    tempDir = join(tmpdir(), `bundle-gen-shape-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    serverEntryPath = join(tempDir, 'server.ts');
    writeFileSync(
      serverEntryPath,
      `import { Hono } from 'hono';\nexport default new Hono();\n`,
    );
    serverOutDir = join(tempDir, 'dist', 'server');
    clientOutDir = join(tempDir, 'dist', 'client');
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeBackendEntry(endpoint: string, file: string): BackendEntry {
    return {
      endpoint,
      imports: [],
      fnJs: '(arg) => arg',
      file,
    };
  }

  function makeWsEntry(endpoint: string, file: string): WebSocketEntry {
    return {
      endpoint,
      imports: [],
      handlersJs: '{ onMessage(ws, data) { ws.send(data); } }',
      file,
    };
  }

  function generateWithBackendEntry(): string {
    const registry = new Registry<BackendEntry>();
    const entry = makeBackendEntry('my-endpoint', join(tempDir, 'src', 'handlers.ts'));
    registry.set('my-endpoint', entry);
    registry.registerFile(entry.file, ['my-endpoint']);

    const result = generateBundleContent(
      registry,
      'server.ts',
      serverEntryPath,
      serverOutDir,
      clientOutDir,
      3001,
    );
    expect(result).not.toBeNull();
    return result!;
  }

  function generateWithServerEntryOnly(): string {
    const registry = new Registry<BackendEntry>();

    const result = generateBundleContent(
      registry,
      'server.ts',
      serverEntryPath,
      serverOutDir,
      clientOutDir,
      3001,
    );
    expect(result).not.toBeNull();
    return result!;
  }

  function generateWithWebSocketEntry(): string {
    const registry = new Registry<BackendEntry>();
    const wsRegistry = new Registry<WebSocketEntry>();
    const wsEntry = makeWsEntry('chat', join(tempDir, 'src', 'chat.ts'));
    wsRegistry.set('chat', wsEntry);
    wsRegistry.registerFile(wsEntry.file, ['chat']);

    const result = generateBundleContent(
      registry,
      'server.ts',
      serverEntryPath,
      serverOutDir,
      clientOutDir,
      3001,
      wsRegistry,
    );
    expect(result).not.toBeNull();
    return result!;
  }

  describe('Requirement 14.1: Exactly one Bun.serve({...}) call', () => {
    it('output contains exactly one Bun.serve( occurrence with backend entries only', () => {
      const output = generateWithBackendEntry();
      const matches = output.match(/Bun\.serve\(/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(1);
    });

    it('output contains exactly one Bun.serve( occurrence with websocket entries', () => {
      const output = generateWithWebSocketEntry();
      const matches = output.match(/Bun\.serve\(/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(1);
    });

    it('output contains exactly one Bun.serve( occurrence with server entry only', () => {
      const output = generateWithServerEntryOnly();
      const matches = output.match(/Bun\.serve\(/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(1);
    });
  });

  describe('Requirement 14.2: Static asset middleware with Cache-Control headers', () => {
    it('output contains Cache-Control header for asset files', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain('Cache-Control');
    });

    it('output sets immutable cache for assets in /assets/ path', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain('public, max-age=31536000, immutable');
    });

    it('output sets must-revalidate cache for non-asset files', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain('public, max-age=0, must-revalidate');
    });

    it('output checks if pathname includes /assets/ for cache strategy', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain('/assets/');
    });
  });

  describe('Requirement 14.3: SPA fallback route for unmatched GET requests', () => {
    it('output contains SPA fallback serving index.html', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain('index.html');
    });

    it('output has a GET catch-all route for SPA fallback', () => {
      const output = generateWithBackendEntry();
      // The SPA fallback uses app.get("*", ...)
      expect(output).toContain('app.get("*"');
    });

    it('output serves index.html with text/html content type', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain('text/html; charset=utf-8');
    });
  });

  describe('Requirement 14.4: serverEntry import validates .fetch() export', () => {
    it('output validates that server entry exports a fetch function', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain("typeof app.fetch !== 'function'");
    });

    it('output throws descriptive error when fetch export is missing', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain('must export a Hono app');
    });

    it('output imports server entry as namespace', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain("import * as __serverEntry from");
    });

    it('output extracts default or named app export from server entry', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain('__serverEntry.default ?? __serverEntry.app');
    });
  });

  describe('Requirement 14.5: 405 handler for non-POST to /__server-build/*', () => {
    it('output contains a 405 Method not allowed handler', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain('405');
      expect(output).toContain('Method not allowed');
    });

    it('output uses app.all to catch non-POST methods on the API prefix', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain("app.all('/__server-build/");
    });

    it('output includes Allow: POST header in the 405 response', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain("Allow: 'POST'");
    });
  });

  describe('Requirement 14.6: (req) => app.fetch(req) binding pattern', () => {
    it('output uses (req) => app.fetch(req) in Bun.serve without websockets', () => {
      const output = generateWithBackendEntry();
      expect(output).toContain('(req) => app.fetch(req)');
    });

    it('output does NOT use bare app.fetch reference (unsafe this context)', () => {
      const output = generateWithBackendEntry();
      // The unsafe pattern would be: fetch: app.fetch,
      expect(output).not.toContain('fetch: app.fetch,');
    });

    it('output uses app.fetch(req) in websocket fetch handler', () => {
      const output = generateWithWebSocketEntry();
      // With websockets, the fetch handler calls app.fetch(req) for non-WS requests
      expect(output).toContain('return app.fetch(req)');
    });

    it('output does NOT use bare app.fetch as function value with websockets', () => {
      const output = generateWithWebSocketEntry();
      expect(output).not.toContain('fetch: app.fetch,');
    });
  });
});
