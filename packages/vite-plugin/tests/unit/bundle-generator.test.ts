import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateBundleContent } from '../../src/build/bundle-generator';
import { Registry } from '../../src/core/registry';
import type { ActionEntry, WsEntry } from '../../src/types';

let tempDir: string;

beforeAll(() => {
  tempDir = join(tmpdir(), `bundle-gen-unit-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeActionEntry(overrides: Partial<ActionEntry> & { endpoint: string; file: string }): ActionEntry {
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

describe('Bundle Generator Output Structure', () => {
  describe('Backend entries produce Hono POST route for /__server-build/*', () => {
    it('should produce a POST route for /__server-build/* when action entries exist', () => {
      const registry = new Registry<ActionEntry>();
      const entry = makeActionEntry({
        endpoint: 'api/get-todos',
        file: join(tempDir, 'src/todos.ts'),
        fnJs: '(id) => ({ id })',
      });
      registry.set(entry.endpoint, entry);
      registry.registerFile(entry.file, [entry.endpoint]);

      const result = generateBundleContent(
        registry,
        undefined,
        null,
        tempDir,
        join(tempDir, 'client'),
        3001,
      );

      expect(result).not.toBeNull();
      expect(result).toContain("app.post('/__server-build/*'");
      expect(result).toContain('decodeURIComponent');
      expect(result).toContain('application/json');
      expect(result).toContain('JSON.parse');
      expect(result).toContain('handler(...args)');
    });
  });

  describe('Websocket entries produce Bun.serve config with fetch and ws block', () => {
    it('should produce Bun.serve with fetch and ws lifecycle handlers', () => {
      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();
      const wsEntry = makeWsEntry({
        endpoint: 'ws/chat',
        file: join(tempDir, 'src/chat.ts'),
      });
      wsRegistry.set(wsEntry.endpoint, wsEntry);
      wsRegistry.registerFile(wsEntry.file, [wsEntry.endpoint]);

      const result = generateBundleContent(
        registry,
        undefined,
        null,
        tempDir,
        join(tempDir, 'client'),
        3001,
        wsRegistry,
      );

      expect(result).not.toBeNull();
      expect(result).toContain('Bun.serve({');
      expect(result).toContain('fetch(req, server)');
      expect(result).toContain('websocket:');
      expect(result).toContain('open(ws)');
      expect(result).toContain('message(ws, raw)');
      expect(result).toContain('close(ws)');
    });
  });

  describe('Null return when no action, ws, or server entries exist', () => {
    it('should return null when registries are empty and no serverEntry', () => {
      const registry = new Registry<ActionEntry>();

      const result = generateBundleContent(
        registry,
        undefined,
        null,
        tempDir,
        join(tempDir, 'client'),
        3001,
      );

      expect(result).toBeNull();
    });

    it('should return null when registries are empty and wsRegistry is also empty', () => {
      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();

      const result = generateBundleContent(
        registry,
        undefined,
        null,
        tempDir,
        join(tempDir, 'client'),
        3001,
        wsRegistry,
      );

      expect(result).toBeNull();
    });
  });

  describe('Unique __dep_N aliases for import collisions across files', () => {
    it('should produce unique __dep_N aliases when two files import different modules under the same local name', () => {
      const registry = new Registry<ActionEntry>();

      const entry1 = makeActionEntry({
        endpoint: 'api/file1-handler',
        file: join(tempDir, 'src/file1.ts'),
        fnJs: '(x) => x',
        imports: [
          {
            specifier: 'lodash',
            defaultName: undefined,
            namespaceName: undefined,
            named: [{ imported: 'map', local: 'map' }],
          },
        ],
      });

      const entry2 = makeActionEntry({
        endpoint: 'api/file2-handler',
        file: join(tempDir, 'src/file2.ts'),
        fnJs: '(y) => y',
        imports: [
          {
            specifier: 'ramda',
            defaultName: undefined,
            namespaceName: undefined,
            named: [{ imported: 'map', local: 'map' }],
          },
        ],
      });

      registry.set(entry1.endpoint, entry1);
      registry.set(entry2.endpoint, entry2);
      registry.registerFile(entry1.file, [entry1.endpoint]);
      registry.registerFile(entry2.file, [entry2.endpoint]);

      const result = generateBundleContent(
        registry,
        undefined,
        null,
        tempDir,
        join(tempDir, 'client'),
        3001,
      );

      expect(result).not.toBeNull();
      // Should have unique aliases for each import
      expect(result).toContain('__dep_0');
      expect(result).toContain('__dep_1');
      // Both specifiers should appear as separate import statements
      expect(result).toContain('"lodash"');
      expect(result).toContain('"ramda"');
    });
  });

  describe('IIFE wrapping for same-file entries with moduleDeclsJs', () => {
    it('should wrap handlers in an IIFE when moduleDeclsJs is set', () => {
      const registry = new Registry<ActionEntry>();

      const sharedDecls = 'const counter = 0;';
      const entry1 = makeActionEntry({
        endpoint: 'api/handler-a',
        file: join(tempDir, 'src/shared.ts'),
        fnJs: '() => counter',
        originalName: 'handlerA',
        moduleDeclsJs: sharedDecls,
      });
      const entry2 = makeActionEntry({
        endpoint: 'api/handler-b',
        file: join(tempDir, 'src/shared.ts'),
        fnJs: '() => counter + 1',
        originalName: 'handlerB',
        moduleDeclsJs: sharedDecls,
      });

      registry.set(entry1.endpoint, entry1);
      registry.set(entry2.endpoint, entry2);
      registry.registerFile(entry1.file, [entry1.endpoint, entry2.endpoint]);

      const result = generateBundleContent(
        registry,
        undefined,
        null,
        tempDir,
        join(tempDir, 'client'),
        3001,
      );

      expect(result).not.toBeNull();
      // IIFE pattern: destructuring from (() => { ... })()
      expect(result).toContain('= (() => {');
      expect(result).toContain('})();');
      // The shared module declarations should be inside the IIFE
      expect(result).toContain('const counter = 0;');
      // Return object with handler names
      expect(result).toContain('return {');
    });
  });

  describe('Error thrown when serverEntry file does not exist', () => {
    it('should throw when serverEntry is configured but file does not exist', () => {
      const registry = new Registry<ActionEntry>();
      const nonExistentPath = join(tempDir, 'non-existent-server.ts');

      expect(() =>
        generateBundleContent(
          registry,
          'non-existent-server.ts',
          nonExistentPath,
          tempDir,
          join(tempDir, 'client'),
          3001,
        ),
      ).toThrow(/serverEntry.*does not exist/);
    });
  });

  describe('process.execPath / fileURLToPath dual-path for static file resolution', () => {
    it('should use process.execPath for compiled Bun and fileURLToPath for normal ESM', () => {
      const registry = new Registry<ActionEntry>();
      const entry = makeActionEntry({
        endpoint: 'api/hello',
        file: join(tempDir, 'src/hello.ts'),
        fnJs: '() => "hello"',
      });
      registry.set(entry.endpoint, entry);
      registry.registerFile(entry.file, [entry.endpoint]);

      const result = generateBundleContent(
        registry,
        undefined,
        null,
        tempDir,
        join(tempDir, 'client'),
        3001,
      );

      expect(result).not.toBeNull();
      // Dual-path detection: check for $bunfs detection
      expect(result).toContain('import.meta.url');
      expect(result).toContain('$bunfs');
      expect(result).toContain('dirname(fileURLToPath(__moduleUrl))');
      expect(result).toContain('dirname(process.execPath)');
    });
  });

  describe('Directory traversal prevention', () => {
    it('should produce code that rejects paths escaping client root', () => {
      const registry = new Registry<ActionEntry>();
      const entry = makeActionEntry({
        endpoint: 'api/safe',
        file: join(tempDir, 'src/safe.ts'),
        fnJs: '() => null',
      });
      registry.set(entry.endpoint, entry);
      registry.registerFile(entry.file, [entry.endpoint]);

      const result = generateBundleContent(
        registry,
        undefined,
        null,
        tempDir,
        join(tempDir, 'client'),
        3001,
      );

      expect(result).not.toBeNull();
      // Directory traversal checks present in generated code
      expect(result).toContain('relative(resolvedClientRoot, filePath)');
      expect(result).toContain('relativePath === ".."');
      expect(result).toContain('relativePath.startsWith("../")');
      expect(result).toContain('isAbsolute(relativePath)');
      // Returns 404 for traversal
      expect(result).toContain('"Not found", 404');
    });
  });

  describe('PORT validation (integer between 1 and 65535)', () => {
    it('should produce code that validates PORT is a valid integer between 1 and 65535', () => {
      const registry = new Registry<ActionEntry>();
      const entry = makeActionEntry({
        endpoint: 'api/port-test',
        file: join(tempDir, 'src/port.ts'),
        fnJs: '() => "ok"',
      });
      registry.set(entry.endpoint, entry);
      registry.registerFile(entry.file, [entry.endpoint]);

      const result = generateBundleContent(
        registry,
        undefined,
        null,
        tempDir,
        join(tempDir, 'client'),
        3001,
      );

      expect(result).not.toBeNull();
      // PORT validation logic
      expect(result).toContain('Number.isInteger(__parsedPort)');
      expect(result).toContain('__parsedPort >= 1');
      expect(result).toContain('__parsedPort <= 65535');
      // Fallback to configured port
      expect(result).toContain(': 3001');
      // Warning for invalid PORT values
      expect(result).toContain('Invalid PORT value');
    });

    it('should embed the configured port as fallback', () => {
      const registry = new Registry<ActionEntry>();
      const entry = makeActionEntry({
        endpoint: 'api/custom-port',
        file: join(tempDir, 'src/custom.ts'),
        fnJs: '() => "ok"',
      });
      registry.set(entry.endpoint, entry);
      registry.registerFile(entry.file, [entry.endpoint]);

      const result = generateBundleContent(
        registry,
        undefined,
        null,
        tempDir,
        join(tempDir, 'client'),
        8080,
      );

      expect(result).not.toBeNull();
      expect(result).toContain(': 8080');
    });
  });
});
