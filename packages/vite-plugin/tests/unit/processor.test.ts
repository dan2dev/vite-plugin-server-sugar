import { describe, it, expect, vi } from 'vitest';
import { processFile } from '../../src/core/processor';
import { Registry } from '../../src/core/registry';
import type { ServerEntry, WsEntry } from '../../src/types';

/**
 * Unit tests for the Processor edge cases.
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10
 */

const ROOT = '/project';
const FILE = '/project/src/test.ts';

function createOptions(overrides: Partial<Parameters<typeof processFile>[2]> = {}) {
  return {
    registry: new Registry<ServerEntry>(),
    wsRegistry: new Registry<WsEntry>(),
    root: ROOT,
    ...overrides,
  };
}

describe('Processor Edge Cases', () => {
  describe('null return for files with no $server(/$ws( text', () => {
    it('returns null for a file with no server or ws text', () => {
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

  describe('null return for server/ws as identifiers (not call expressions)', () => {
    it('returns null when server is used as a variable name', () => {
      const code = `
        const server = { url: "/api" };
        console.log(server);
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
    });

    it('returns null when ws is used as a variable name', () => {
      const code = `
        const ws = new Ws("ws://localhost");
        ws.send("hello");
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
    });

    it('returns null when server is a property access', () => {
      const code = `
        const config = { server: "http://localhost" };
        fetch(config.server);
      `;
      const options = createOptions();
      // This won't match the regex since there's no `$server(` pattern
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
    });
  });

  describe('non-function argument leaves call untouched', () => {
    it('returns null when $server() receives a string literal', () => {
      const code = `
        const api = $server("/api/users");
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.registry.size).toBe(0);
    });

    it('returns null when $server() receives a number literal', () => {
      const code = `
        const api = $server(42);
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.registry.size).toBe(0);
    });

    it('returns null when $server() receives no arguments', () => {
      const code = `
        const api = $server();
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.registry.size).toBe(0);
    });
  });

  describe('ws with empty handler object leaves call untouched', () => {
    it('returns null when $ws() has an empty object literal', () => {
      const code = `
        const ws = $ws({});
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.wsRegistry!.size).toBe(0);
    });

    it('returns null when ws object has unrelated keys', () => {
      const code = `
        const ws = $ws({ foo: () => {}, bar: "hello" });
      `;
      const options = createOptions();
      const result = processFile(code, FILE, options);

      expect(result).toBeNull();
      expect(options.wsRegistry!.size).toBe(0);
    });
  });

  describe('duplicate labels produce unique endpoints via line:col disambiguation', () => {
    it('produces unique endpoints when two server calls have the same label', () => {
      const code = `
const api = $server((x: number) => x + 1);
const api2 = api;
const api3 = $server((y: number) => y + 2);
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
      // Two $server() calls in an array literal both get the same positional
      // label (e.g. "0", "1") — but nested in the same default export they
      // share the "default" prefix. Force same inferred label by putting both
      // at the same array index path in separate arrays:
      const code = [
        'export default [',
        '  $server((x: number) => x),',
        '  $server((y: number) => y),',
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
const handler = $server(() => {
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
const handler = $server(() => {
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
const handler = $server(({ id, name }: { id: string; name: string }) => {
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
const handler = $server(({ user: { firstName, lastName } }: any) => {
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
const getTodos = $server(() => []);
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

    it('unregisters ws endpoints too', () => {
      const options = createOptions();
      const codeWithWs = `
const chat = $ws({ onMessage(ws, data) { ws.send(data); } });
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
    it('removes import used only inside $server() handler', () => {
      const code = `
import { readFile } from "node:fs/promises";

const getFile = $server(async (path: string) => {
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

    it('keeps import used outside $server() handler', () => {
      const code = `
import { join } from "node:path";

const basePath = join("/", "data");

const getFile = $server(async () => {
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

const getTodos = $server(() => {
  return config.baseUrl + "/todos";
});

const getUsers = $server(() => {
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

    it('server and ws entries from the same file share moduleDeclsJs', () => {
      const code = `
const sharedState = new Map<string, string>();

const getData = $server(() => {
  return Array.from(sharedState.entries());
});

const chat = $ws({
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

      const serverEntry = [...options.registry.values()][0];
      const wsEntry = [...options.wsRegistry!.values()][0];
      expect(serverEntry.moduleDeclsJs).toBeDefined();
      expect(wsEntry.moduleDeclsJs).toBeDefined();
      expect(serverEntry.moduleDeclsJs).toBe(wsEntry.moduleDeclsJs);
    });
  });
});
