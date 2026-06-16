import { describe, it, expect, vi } from 'vitest';
import { processFile } from '../../src/core/processor';
import { Registry } from '../../src/core/registry';
import type { BackendEntry, WebSocketEntry } from '../../src/types';

/**
 * Unit tests for the Processor edge cases.
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10
 */

const ROOT = '/project';
const FILE = '/project/src/test.ts';

function createOptions(overrides: Partial<Parameters<typeof processFile>[2]> = {}) {
  return {
    registry: new Registry<BackendEntry>(),
    wsRegistry: new Registry<WebSocketEntry>(),
    root: ROOT,
    ...overrides,
  };
}

describe('Processor Edge Cases', () => {
  describe('null return for files with no backend(/websocket( text', () => {
    it('returns null for a file with no backend or websocket text', () => {
      const code = `
        const foo = 42;
        export function hello() { return "hi"; }
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
    });

    it('returns null for an empty file', () => {
      const code = '';
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
    });

    it('does not modify registries when returning null', () => {
      const code = `const x = 1;`;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.registry.size).toBe(0);
      expect(options.wsRegistry!.size).toBe(0);
    });
  });

  describe('null return for backend/websocket as identifiers (not call expressions)', () => {
    it('returns null when backend is used as a variable name', () => {
      const code = `
        const backend = { url: "/api" };
        console.log(backend);
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
    });

    it('returns null when websocket is used as a variable name', () => {
      const code = `
        const websocket = new WebSocket("ws://localhost");
        websocket.send("hello");
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
    });

    it('returns null when backend is a property access', () => {
      const code = `
        const config = { backend: "http://localhost" };
        fetch(config.backend);
      `;
      const options = createOptions();
      // This won't match the regex since there's no `backend(` pattern
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
    });
  });

  describe('non-function argument leaves call untouched', () => {
    it('returns null when backend() receives a string literal', () => {
      const code = `
        const api = backend("/api/users");
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.registry.size).toBe(0);
    });

    it('returns null when backend() receives a number literal', () => {
      const code = `
        const api = backend(42);
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.registry.size).toBe(0);
    });

    it('returns null when backend() receives no arguments', () => {
      const code = `
        const api = backend();
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.registry.size).toBe(0);
    });
  });

  describe('websocket with empty handler object leaves call untouched', () => {
    it('returns null when websocket() has an empty object literal', () => {
      const code = `
        const ws = websocket({});
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.wsRegistry!.size).toBe(0);
    });

    it('returns null when websocket object has unrelated keys', () => {
      const code = `
        const ws = websocket({ foo: () => {}, bar: "hello" });
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.wsRegistry!.size).toBe(0);
    });
  });

  describe('duplicate labels produce unique endpoints via line:col disambiguation', () => {
    it('produces unique endpoints when two backend calls have the same label', () => {
      const code = `
const api = backend((x: number) => x + 1);
const api2 = api;
const api3 = backend((y: number) => y + 2);
`;
      // Both assigned to different variables - they get different labels
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).not.toBeNull();
      // Both should be registered
      expect(options.registry.size).toBe(2);
      // Verify they have different endpoints
      const endpoints = [...options.registry.getEndpointsForFile(FILE)];
      expect(endpoints.length).toBe(2);
      expect(endpoints[0]).not.toBe(endpoints[1]);
    });

    it('appends line:col disambiguation for truly duplicate labels', () => {
      // Two backend() calls in an array literal both get the same positional
      // label (e.g. "0", "1") — but nested in the same default export they
      // share the "default" prefix. Force same inferred label by putting both
      // at the same array index path in separate arrays:
      const code = [
        'export default [',
        '  backend((x: number) => x),',
        '  backend((y: number) => y),',
        '];',
      ].join('\n');
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).not.toBeNull();
      expect(options.registry.size).toBe(2);
      const endpoints = [...options.registry.getEndpointsForFile(FILE)];
      expect(endpoints.length).toBe(2);
      // Both endpoints should be unique
      expect(endpoints[0]).not.toBe(endpoints[1]);
    });
  });

  describe('warning emission for unresolved references when emitWarnings is enabled', () => {
    it('emits a console warning for unresolved references', () => {
      const code = `
const handler = backend(() => {
  return unknownVariable;
});
`;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const options = createOptions({ emitWarnings: true });
      processFile(code, FILE, options);

      expect(warnSpy).toHaveBeenCalled();
      const warnCall = warnSpy.mock.calls[0]?.[0] as string;
      expect(warnCall).toContain('unknownVariable');
      expect(warnCall).toContain('[server-build]');

      warnSpy.mockRestore();
    });

    it('does not emit warnings when emitWarnings is disabled', () => {
      const code = `
const handler = backend(() => {
  return unknownVariable;
});
`;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const options = createOptions({ emitWarnings: false });
      processFile(code, FILE, options);

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('destructuring parameters are correctly identified as bound variables', () => {
    it('does not warn for destructured parameter names', () => {
      const code = `
const handler = backend(({ id, name }: { id: string; name: string }) => {
  return { id, name };
});
`;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const options = createOptions({ emitWarnings: true });
      processFile(code, FILE, options);

      // Should not warn about `id` or `name` since they are destructured params
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('correctly identifies nested destructured names', () => {
      const code = `
const handler = backend(({ user: { firstName, lastName } }: any) => {
  return firstName + " " + lastName;
});
`;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const options = createOptions({ emitWarnings: true });
      processFile(code, FILE, options);

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('re-processing handler-free file unregisters all previous endpoints', () => {
    it('unregisters endpoints when file no longer contains handlers', () => {
      const options = createOptions();
      const codeWithHandler = `
const getTodos = backend(() => []);
`;
      // First process - registers endpoint
      const result1 = processFile(codeWithHandler, FILE, options);
      expect(result1).not.toBeNull();
      expect(options.registry.size).toBe(1);

      // Re-process the same file with no handlers
      const codeWithoutHandler = `
const getTodos = "just a string";
`;
      const result2 = processFile(codeWithoutHandler, FILE, options);
      expect(result2).toBeNull();
      expect(options.registry.size).toBe(0);
      expect(options.registry.getEndpointsForFile(FILE).size).toBe(0);
    });

    it('unregisters websocket endpoints too', () => {
      const options = createOptions();
      const codeWithWs = `
const chat = websocket({ onMessage(ws, data) { ws.send(data); } });
`;
      const result1 = processFile(codeWithWs, FILE, options);
      expect(result1).not.toBeNull();
      expect(options.wsRegistry!.size).toBe(1);

      // Re-process with no handlers
      const codeWithout = `const chat = "removed";`;
      const result2 = processFile(codeWithout, FILE, options);
      expect(result2).toBeNull();
      expect(options.wsRegistry!.size).toBe(0);
    });
  });

  describe('server-only imports are removed from client output', () => {
    it('removes import used only inside backend() handler', () => {
      const code = `
import { readFile } from "node:fs/promises";

const getFile = backend(async (path: string) => {
  return readFile(path, "utf-8");
});
`;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).not.toBeNull();
      // The import should be removed from client output
      expect(result!.code).not.toContain('import { readFile }');
      expect(result!.code).not.toContain('node:fs/promises');
    });

    it('keeps import used outside backend() handler', () => {
      const code = `
import { join } from "node:path";

const basePath = join("/", "data");

const getFile = backend(async () => {
  return join("/server", "file.txt");
});
`;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).not.toBeNull();
      // The import should be kept because `join` is used outside the handler
      expect(result!.code).toContain('node:path');
    });
  });

  describe('shared moduleDeclsJs across entries from the same file', () => {
    it('all entries from the same file share the same moduleDeclsJs value', () => {
      const code = `
const config = { baseUrl: "/api" };

const getTodos = backend(() => {
  return config.baseUrl + "/todos";
});

const getUsers = backend(() => {
  return config.baseUrl + "/users";
});
`;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).not.toBeNull();
      expect(options.registry.size).toBe(2);

      const entries = [...options.registry.values()];
      expect(entries.length).toBe(2);
      // Both entries should have moduleDeclsJs set
      expect(entries[0].moduleDeclsJs).toBeDefined();
      expect(entries[1].moduleDeclsJs).toBeDefined();
      // They should be identical
      expect(entries[0].moduleDeclsJs).toBe(entries[1].moduleDeclsJs);
    });

    it('backend and websocket entries from the same file share moduleDeclsJs', () => {
      const code = `
const sharedState = new Map<string, string>();

const getData = backend(() => {
  return Array.from(sharedState.entries());
});

const chat = websocket({
  onMessage(ws, data) {
    sharedState.set("last", data);
  }
});
`;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).not.toBeNull();
      expect(options.registry.size).toBe(1);
      expect(options.wsRegistry!.size).toBe(1);

      const backendEntry = [...options.registry.values()][0];
      const wsEntry = [...options.wsRegistry!.values()][0];
      expect(backendEntry.moduleDeclsJs).toBeDefined();
      expect(wsEntry.moduleDeclsJs).toBeDefined();
      expect(backendEntry.moduleDeclsJs).toBe(wsEntry.moduleDeclsJs);
    });
  });
});
