import { describe, it, expect } from 'vitest';
import { processFile } from '../../src/core/processor';
import { Registry } from '../../src/core/registry';
import type { ActionEntry, WsEntry } from '../../src/types';

function makeOptions() {
  return {
    registry: new Registry<ActionEntry>(),
    wsRegistry: new Registry<WsEntry>(),
    root: '/project',
  };
}

describe('client replacement output', () => {
  describe('$action() replacement produces async arrow function with __actionFetch', () => {
    it('replaces $action() call with async arrow function calling __actionFetch', () => {
      const code = `const getTodos = $action(async (limit: number) => {
  return db.query(limit);
});`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain('__actionFetch');
      expect(result!.code).toContain('async (...__actionArgs)');
      expect(result!.code).toContain('JSON.stringify(__actionArgs)');
    });

    it('includes import for __actionFetch from the virtual module', () => {
      const code = `const getTodos = $action(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain(
        'import { __actionFetch } from "virtual:server-build/action-fetch"',
      );
    });

    it('includes the correct URL-encoded endpoint in the __actionFetch call', () => {
      const code = `const getTodos = $action(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      // The endpoint URL should contain the API prefix and the endpoint path
      expect(result!.code).toContain('/__server-build/');
      expect(result!.code).toContain('get-todos');
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

    it('includes the correct WebSocket endpoint URL', () => {
      const code = `const chat = $ws({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/chat.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).toContain('/__server-build-ws/');
      expect(result!.code).toContain('chat');
    });
  });

  describe('aliased import when __actionFetch identifier already exists in file', () => {
    it('uses aliased import when __actionFetch is already defined in the file', () => {
      const code = `const __actionFetch = "something else";
const getTodos = $action(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      // Should use an alias like __actionFetch_1
      expect(result!.code).toContain('__actionFetch_1');
      expect(result!.code).toContain(
        '__actionFetch as __actionFetch_1',
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

  describe('declare function $action / declare function $ws shims are stripped', () => {
    it('strips declare function $action shim from output', () => {
      const code = `declare function $action<Args extends unknown[], R>(fn: (...args: Args) => R | Promise<R>): (...args: Args) => Promise<Awaited<R>>;
const getTodos = $action(async () => []);`;
      const result = processFile(code, '/project/src/todos.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).not.toContain('declare function $action');
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
      const code = `declare function $action<T>(fn: T): T;
declare function $ws<T>(handlers: T): any;
const getTodos = $action(async () => []);
const chat = $ws({
  onMessage(ws, data: string) { ws.send(data); },
});`;
      const result = processFile(code, '/project/src/app.ts', makeOptions());
      expect(result).not.toBeNull();
      expect(result!.code).not.toContain('declare function $action');
      expect(result!.code).not.toContain('declare function $ws');
    });
  });
});
