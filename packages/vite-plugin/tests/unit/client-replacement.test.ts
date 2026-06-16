import { describe, it, expect } from 'vitest';
import { processFile } from '../../src/core/processor';
import { Registry } from '../../src/core/registry';
import type { BackendEntry, WebSocketEntry } from '../../src/types';

function makeOptions() {
  return {
    registry: new Registry<BackendEntry>(),
    wsRegistry: new Registry<WebSocketEntry>(),
    root: '/project',
  };
}

describe('client replacement output', () => {
  describe('backend() replacement produces async arrow function with __backendFetch', () => {
    it('replaces backend() call with async arrow function calling __backendFetch', () => {
      const code = `const getTodos = backend(async (limit: number) => {
  return db.query(limit);
});`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain('__backendFetch');
      expect(result!.code).toContain('async (...__backendArgs)');
      expect(result!.code).toContain('JSON.stringify(__backendArgs)');
    });

    it('includes import for __backendFetch from the virtual module', () => {
      const code = `const getTodos = backend(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain(
        'import { __backendFetch } from "virtual:server-build/backend-fetch"',
      );
    });

    it('includes the correct URL-encoded endpoint in the __backendFetch call', () => {
      const code = `const getTodos = backend(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      // The endpoint URL should contain the API prefix and the endpoint path
      expect(result!.code).toContain('/__server-build/');
      expect(result!.code).toContain('get-todos');
    });
  });

  describe('websocket() replacement produces object with connect method calling __websocketConnect', () => {
    it('replaces websocket() call with object containing connect method', () => {
      const code = `const chat = websocket({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain('__websocketConnect');
      expect(result!.code).toContain('connect:');
      expect(result!.code).toContain('(...__websocketArgs)');
    });

    it('includes import for __websocketConnect from the virtual module', () => {
      const code = `const chat = websocket({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain(
        'import { __websocketConnect } from "virtual:server-build/websocket-connect"',
      );
    });

    it('includes the correct WebSocket endpoint URL', () => {
      const code = `const chat = websocket({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain('/__server-build-ws/');
      expect(result!.code).toContain('chat');
    });
  });

  describe('aliased import when __backendFetch identifier already exists in file', () => {
    it('uses aliased import when __backendFetch is already defined in the file', () => {
      const code = `const __backendFetch = "something else";
const getTodos = backend(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      // Should use an alias like __backendFetch_1
      expect(result!.code).toContain('__backendFetch_1');
      expect(result!.code).toContain(
        '__backendFetch as __backendFetch_1',
      );
    });

    it('uses aliased import when __websocketConnect is already defined in the file', () => {
      const code = `const __websocketConnect = "something else";
const chat = websocket({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain('__websocketConnect_1');
      expect(result!.code).toContain(
        '__websocketConnect as __websocketConnect_1',
      );
    });
  });

  describe('declare const backend / declare function websocket shims are stripped', () => {
    it('strips declare const backend shim from output', () => {
      const code = `declare const backend: <T extends (...args: any[]) => any>(fn: T) => T;
const getTodos = backend(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).not.toContain('declare const backend');
    });

    it('strips declare function websocket shim from output', () => {
      const code = `declare function websocket<T>(handlers: T): { connect: () => void };
const chat = websocket({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).not.toContain('declare function websocket');
    });

    it('strips both shims when both are present', () => {
      const code = `declare const backend: <T extends (...args: any[]) => any>(fn: T) => T;
declare function websocket<T>(handlers: T): { connect: () => void };
const getTodos = backend(async () => []);
const chat = websocket({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/app.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).not.toContain('declare const backend');
      expect(result!.code).not.toContain('declare function websocket');
    });
  });
});
