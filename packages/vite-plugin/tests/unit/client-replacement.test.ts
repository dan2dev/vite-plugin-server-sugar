import { describe, it, expect } from 'vitest';
import { processFile } from '../../src/core/processor';
import { Registry } from '../../src/core/registry';
import { createEndpointPaths } from '../../src/endpoint-paths';
import type { ServerEntry, WsEntry } from '../../src/types';

function makeOptions(overrides: Partial<Parameters<typeof processFile>[2]> = {}) {
  return {
    registry: new Registry<ServerEntry>(),
    wsRegistry: new Registry<WsEntry>(),
    root: '/project',
    ...overrides,
  };
}

describe('client replacement output', () => {
  describe('$server() replacement produces async arrow function with __serverFetch', () => {
    it('replaces $server() call with async arrow function calling __serverFetch', () => {
      const code = `const getTodos = $server(async (limit: number) => {
  return db.query(limit);
});`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain('__serverFetch');
      expect(result!.code).toContain('async (...__serverArgs)');
      expect(result!.code).toContain('JSON.stringify(__serverArgs)');
    });

    it('includes import for __serverFetch from the virtual module', () => {
      const code = `const getTodos = $server(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain(
        'import { __serverFetch } from "virtual:server-build/server-fetch"',
      );
    });

    it('includes the correct URL-encoded endpoint in the __serverFetch call', () => {
      const code = `const getTodos = $server(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      // The endpoint URL should contain the API prefix and the endpoint path
      expect(result!.code).toContain('/__server-build/');
      expect(result!.code).toContain('get-todos');
    });

    it('uses a custom pathname base in the __serverFetch call', () => {
      const code = `const getTodos = $server(async () => []);`;
      const result = processFile(
        code,
        '/project/src/todos.ts',
        makeOptions({ endpointPaths: createEndpointPaths('/rpc') }),
      );
      expect(result).not.toBeNull();
      expect(result!.code).toContain('/rpc/todos/get-todos');
      expect(result!.code).not.toContain('/__server-build/');
    });
  });

  describe('$ws() replacement produces object with connect method calling __wsConnect', () => {
    it('replaces $ws() call with object containing connect method', () => {
      const code = `const chat = $ws({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain('__wsConnect');
      expect(result!.code).toContain('connect:');
      expect(result!.code).toContain('(...__wsArgs)');
    });

    it('includes import for __wsConnect from the virtual module', () => {
      const code = `const chat = $ws({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain(
        'import { __wsConnect } from "virtual:server-build/ws-connect"',
      );
    });

    it('includes the correct Ws endpoint URL', () => {
      const code = `const chat = $ws({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain('/__server-build-ws/');
      expect(result!.code).toContain('chat');
    });

    it('uses a custom pathname base in the __wsConnect call', () => {
      const code = `const chat = $ws({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(
        code,
        '/project/src/chat.ts',
        makeOptions({ endpointPaths: createEndpointPaths('/rpc') }),
      );
      expect(result).not.toBeNull();
      expect(result!.code).toContain('/rpc-ws/chat/chat');
      expect(result!.code).not.toContain('/__server-build-ws/');
    });
  });

  describe('aliased import when __serverFetch identifier already exists in file', () => {
    it('uses aliased import when __serverFetch is already defined in the file', () => {
      const code = `const __serverFetch = "something else";
const getTodos = $server(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      // Should use an alias like __serverFetch_1
      expect(result!.code).toContain('__serverFetch_1');
      expect(result!.code).toContain(
        '__serverFetch as __serverFetch_1',
      );
    });

    it('uses aliased import when __wsConnect is already defined in the file', () => {
      const code = `const __wsConnect = "something else";
const chat = $ws({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain('__wsConnect_1');
      expect(result!.code).toContain(
        '__wsConnect as __wsConnect_1',
      );
    });
  });

  describe('declare function $server / declare function $ws shims are stripped', () => {
    it('strips declare function $server shim from output', () => {
      const code = `declare function $server<Args extends unknown[], R>(fn: (...args: Args) => R | Promise<R>): (...args: Args) => Promise<Awaited<R>>;
const getTodos = $server(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).not.toContain('declare function $server');
    });

    it('strips declare function $ws shim from output', () => {
      const code = `declare function $ws<T>(handlers: T): { connect: () => void };
const chat = $ws({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).not.toContain('declare function $ws');
    });

    it('strips both shims when both are present', () => {
      const code = `declare function $server<T>(fn: T): T;
declare function $ws<T>(handlers: T): any;
const getTodos = $server(async () => []);
const chat = $ws({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/app.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).not.toContain('declare function $server');
      expect(result!.code).not.toContain('declare function $ws');
    });
  });
});
