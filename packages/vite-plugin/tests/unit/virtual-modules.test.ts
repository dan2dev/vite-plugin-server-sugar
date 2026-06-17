import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/core/registry';
import {
  loadVirtualModule,
  runtimeImportSpecifier,
  virtualServerFileId,
} from '../../src/dev-server/virtual-modules';
import {
  RESOLVED_CLIENT_HELPER_ID,
  RESOLVED_CLIENT_WS_HELPER_ID,
  RESOLVED_FILE_PREFIX,
  RESOLVED_PREFIX,
  RESOLVED_WS_PREFIX,
  CLIENT_FETCH_EXPORT,
  CLIENT_WS_CONNECT_EXPORT,
} from '../../src/constants';
import { serverConstName, wsConstName } from '../../src/utils/crypto';
import type { ServerEntry, WsEntry } from '../../src/types';

/**
 * Unit tests for the Virtual Module Loader.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

function makeServerEntry(
  endpoint: string,
  file: string,
  opts: Partial<ServerEntry> = {},
): ServerEntry {
  return {
    endpoint,
    file,
    imports: [],
    fnJs: '(args) => args',
    ...opts,
  };
}

function makeWsEntry(
  endpoint: string,
  file: string,
  opts: Partial<WsEntry> = {},
): WsEntry {
  return {
    endpoint,
    file,
    imports: [],
    handlersJs: '{ onMessage(ws, data) { ws.send(data); } }',
    ...opts,
  };
}

describe('Virtual Module Loader', () => {
  describe('client fetch helper module', () => {
    it('exports async __serverFetch function', () => {
      const registry = new Registry<ServerEntry>();
      const result = loadVirtualModule(RESOLVED_CLIENT_HELPER_ID, registry);

      expect(result).not.toBeUndefined();
      expect(result!.code).toContain(`export async function ${CLIENT_FETCH_EXPORT}(`);
    });

    it('__serverFetch performs a POST with JSON body and error handling', () => {
      const registry = new Registry<ServerEntry>();
      const result = loadVirtualModule(RESOLVED_CLIENT_HELPER_ID, registry);

      expect(result!.code).toContain("method: 'POST'");
      expect(result!.code).toContain("'Content-Type': 'application/json'");
      expect(result!.code).toContain('body: __body');
      expect(result!.code).toContain('if (!__r.ok)');
      expect(result!.code).toContain('throw new Error');
    });

    it('returns map: null', () => {
      const registry = new Registry<ServerEntry>();
      const result = loadVirtualModule(RESOLVED_CLIENT_HELPER_ID, registry);

      expect(result!.map).toBeNull();
    });
  });

  describe('client Ws connect helper', () => {
    it('exports __wsConnect function', () => {
      const registry = new Registry<ServerEntry>();
      const result = loadVirtualModule(RESOLVED_CLIENT_WS_HELPER_ID, registry);

      expect(result).not.toBeUndefined();
      expect(result!.code).toContain(`export function ${CLIENT_WS_CONNECT_EXPORT}(`);
    });

    it('__wsConnect constructs a Ws URL and returns send/onMessage/onClose/close/readyState', () => {
      const registry = new Registry<ServerEntry>();
      const result = loadVirtualModule(RESOLVED_CLIENT_WS_HELPER_ID, registry);

      expect(result!.code).toContain('new WebSocket(__url)');
      expect(result!.code).toContain('send(data)');
      expect(result!.code).toContain('onMessage(cb)');
      expect(result!.code).toContain('onClose(cb)');
      expect(result!.code).toContain('close(...args)');
      expect(result!.code).toContain('readyState');
    });

    it('returns map: null', () => {
      const registry = new Registry<ServerEntry>();
      const result = loadVirtualModule(RESOLVED_CLIENT_WS_HELPER_ID, registry);

      expect(result!.map).toBeNull();
    });
  });

  describe('per-file combined module', () => {
    it('imports and exports all handler constants', () => {
      const file = '/src/api/todos.ts';
      const registry = new Registry<ServerEntry>();
      const entry1 = makeServerEntry('get-todos', file);
      const entry2 = makeServerEntry('add-todo', file);

      registry.set('get-todos', entry1);
      registry.set('add-todo', entry2);
      registry.registerFile(file, ['get-todos', 'add-todo']);

      const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(file);
      const result = loadVirtualModule(resolvedId, registry);

      expect(result).not.toBeUndefined();

      const const1 = serverConstName('get-todos');
      const const2 = serverConstName('add-todo');

      expect(result!.code).toContain(`const ${const1}`);
      expect(result!.code).toContain(`const ${const2}`);
      expect(result!.code).toContain(`export { ${const1}, ${const2} }`);
    });

    it('includes runtime imports from entries', () => {
      const file = '/src/api/todos.ts';
      const registry = new Registry<ServerEntry>();
      const entry = makeServerEntry('get-todos', file, {
        imports: [
          {
            specifier: 'some-lib',
            named: [{ imported: 'helper', local: 'helper' }],
          },
        ],
      });

      registry.set('get-todos', entry);
      registry.registerFile(file, ['get-todos']);

      const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(file);
      const result = loadVirtualModule(resolvedId, registry);

      expect(result!.code).toContain('import { helper } from "some-lib"');
    });

    it('deduplicates identical import lines', () => {
      const file = '/src/api/todos.ts';
      const registry = new Registry<ServerEntry>();
      const sharedImport = {
        specifier: 'some-lib',
        named: [{ imported: 'helper', local: 'helper' }],
      };
      const entry1 = makeServerEntry('get-todos', file, {
        imports: [sharedImport],
      });
      const entry2 = makeServerEntry('add-todo', file, {
        imports: [sharedImport],
      });

      registry.set('get-todos', entry1);
      registry.set('add-todo', entry2);
      registry.registerFile(file, ['get-todos', 'add-todo']);

      const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(file);
      const result = loadVirtualModule(resolvedId, registry);

      const importCount = (result!.code.match(/import { helper } from "some-lib"/g) || []).length;
      expect(importCount).toBe(1);
    });

    it('returns undefined when file has no registered entries', () => {
      const registry = new Registry<ServerEntry>();
      const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent('/src/empty.ts');
      const result = loadVirtualModule(resolvedId, registry);

      expect(result).toBeUndefined();
    });

    it('includes both server and ws entries from the same file', () => {
      const file = '/src/api/chat.ts';
      const registry = new Registry<ServerEntry>();
      const wsRegistry = new Registry<WsEntry>();

      const serverEntry = makeServerEntry('send-message', file);
      const wsEntry = makeWsEntry('chat-ws', file);

      registry.set('send-message', serverEntry);
      registry.registerFile(file, ['send-message']);
      wsRegistry.set('chat-ws', wsEntry);
      wsRegistry.registerFile(file, ['chat-ws']);

      const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(file);
      const result = loadVirtualModule(resolvedId, registry, wsRegistry);

      expect(result).not.toBeUndefined();
      expect(result!.code).toContain(serverConstName('send-message'));
      expect(result!.code).toContain(wsConstName('chat-ws'));
    });
  });

  describe('per-endpoint module', () => {
    it('re-exports the hashed constant as default', () => {
      const file = '/src/api/todos.ts';
      const registry = new Registry<ServerEntry>();
      const entry = makeServerEntry('get-todos', file);

      registry.set('get-todos', entry);
      registry.registerFile(file, ['get-todos']);

      const resolvedId = RESOLVED_PREFIX + 'get-todos';
      const result = loadVirtualModule(resolvedId, registry);

      expect(result).not.toBeUndefined();

      const constName = serverConstName('get-todos');
      const fileVirtualId = virtualServerFileId(file);
      expect(result!.code).toContain(`export { ${constName} as default }`);
      expect(result!.code).toContain(`from ${JSON.stringify(fileVirtualId)}`);
    });

    it('returns undefined for an unregistered endpoint', () => {
      const registry = new Registry<ServerEntry>();
      const resolvedId = RESOLVED_PREFIX + 'nonexistent';
      const result = loadVirtualModule(resolvedId, registry);

      expect(result).toBeUndefined();
    });

    it('re-exports ws endpoint correctly', () => {
      const file = '/src/api/chat.ts';
      const registry = new Registry<ServerEntry>();
      const wsRegistry = new Registry<WsEntry>();
      const wsEntry = makeWsEntry('chat-ws', file);

      wsRegistry.set('chat-ws', wsEntry);
      wsRegistry.registerFile(file, ['chat-ws']);

      const resolvedId = RESOLVED_WS_PREFIX + 'chat-ws';
      const result = loadVirtualModule(resolvedId, registry, wsRegistry);

      expect(result).not.toBeUndefined();

      const constName = wsConstName('chat-ws');
      const fileVirtualId = virtualServerFileId(file);
      expect(result!.code).toContain(`export { ${constName} as default }`);
      expect(result!.code).toContain(`from ${JSON.stringify(fileVirtualId)}`);
    });

    it('returns undefined for unregistered ws endpoint', () => {
      const registry = new Registry<ServerEntry>();
      const wsRegistry = new Registry<WsEntry>();

      const resolvedId = RESOLVED_WS_PREFIX + 'nonexistent';
      const result = loadVirtualModule(resolvedId, registry, wsRegistry);

      expect(result).toBeUndefined();
    });
  });

  describe('mixed handlers with shared state', () => {
    it('wraps handlers in IIFE when moduleDeclsJs is set', () => {
      const file = '/src/api/chat.ts';
      const registry = new Registry<ServerEntry>();
      const wsRegistry = new Registry<WsEntry>();

      const serverEntry = makeServerEntry('send-message', file, {
        moduleDeclsJs: 'let counter = 0;',
        originalName: 'sendMessage',
      });
      const wsEntry = makeWsEntry('chat-ws', file, {
        moduleDeclsJs: 'let counter = 0;',
        originalName: 'chatWs',
      });

      registry.set('send-message', serverEntry);
      registry.registerFile(file, ['send-message']);
      wsRegistry.set('chat-ws', wsEntry);
      wsRegistry.registerFile(file, ['chat-ws']);

      const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(file);
      const result = loadVirtualModule(resolvedId, registry, wsRegistry);

      expect(result).not.toBeUndefined();
      // IIFE pattern
      expect(result!.code).toContain('= (() => {');
      expect(result!.code).toContain('})();');
      // Shared state inside IIFE
      expect(result!.code).toContain('let counter = 0;');
    });

    it('includes __wrapWs helper when ws entries exist', () => {
      const file = '/src/api/chat.ts';
      const registry = new Registry<ServerEntry>();
      const wsRegistry = new Registry<WsEntry>();

      const serverEntry = makeServerEntry('send-message', file, {
        moduleDeclsJs: 'let state = {};',
      });
      const wsEntry = makeWsEntry('chat-ws', file, {
        moduleDeclsJs: 'let state = {};',
      });

      registry.set('send-message', serverEntry);
      registry.registerFile(file, ['send-message']);
      wsRegistry.set('chat-ws', wsEntry);
      wsRegistry.registerFile(file, ['chat-ws']);

      const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(file);
      const result = loadVirtualModule(resolvedId, registry, wsRegistry);

      expect(result!.code).toContain('function __wrapWs(');
      expect(result!.code).toContain('__wsConnections');
    });

    it('uses IIFE when hasSiblingCrossRefs is true even without moduleDeclsJs', () => {
      const file = '/src/api/helpers.ts';
      const registry = new Registry<ServerEntry>();

      const entry1 = makeServerEntry('foo', file, {
        hasSiblingCrossRefs: true,
        originalName: 'foo',
      });
      const entry2 = makeServerEntry('bar', file, {
        hasSiblingCrossRefs: true,
        originalName: 'bar',
      });

      registry.set('foo', entry1);
      registry.set('bar', entry2);
      registry.registerFile(file, ['foo', 'bar']);

      const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(file);
      const result = loadVirtualModule(resolvedId, registry);

      expect(result!.code).toContain('= (() => {');
      expect(result!.code).toContain('})();');
    });

    it('IIFE return block maps original names to const names', () => {
      const file = '/src/api/chat.ts';
      const registry = new Registry<ServerEntry>();
      const wsRegistry = new Registry<WsEntry>();

      const serverEntry = makeServerEntry('send-msg', file, {
        moduleDeclsJs: 'let x = 1;',
        originalName: 'sendMsg',
      });
      const wsEntry = makeWsEntry('chat-conn', file, {
        moduleDeclsJs: 'let x = 1;',
        originalName: 'chatConn',
      });

      registry.set('send-msg', serverEntry);
      registry.registerFile(file, ['send-msg']);
      wsRegistry.set('chat-conn', wsEntry);
      wsRegistry.registerFile(file, ['chat-conn']);

      const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(file);
      const result = loadVirtualModule(resolvedId, registry, wsRegistry);

      const bConstName = serverConstName('send-msg');
      const wConstName = wsConstName('chat-conn');

      // Inside the IIFE, locals use originalName
      expect(result!.code).toContain('const sendMsg =');
      expect(result!.code).toContain('const chatConn = __wrapWs(');
      // Return block maps to const names
      expect(result!.code).toContain(`${bConstName}: sendMsg`);
      expect(result!.code).toContain(`${wConstName}: chatConn`);
    });
  });

  describe('relative specifier resolution', () => {
    it('resolves relative specifier using source file directory as base', () => {
      const result = runtimeImportSpecifier(
        '/project/src/api/todos.ts',
        './utils',
        null,
      );

      // Should resolve to absolute path: /project/src/api/utils
      expect(result).toBe('/project/src/api/utils');
    });

    it('resolves parent relative specifier', () => {
      const result = runtimeImportSpecifier(
        '/project/src/api/todos.ts',
        '../shared/db',
        null,
      );

      expect(result).toBe('/project/src/shared/db');
    });

    it('returns non-relative specifiers unchanged', () => {
      const result = runtimeImportSpecifier(
        '/project/src/api/todos.ts',
        'some-package',
        null,
      );

      expect(result).toBe('some-package');
    });

    it('uses fromDir to produce relative import path when provided', () => {
      const result = runtimeImportSpecifier(
        '/project/src/api/todos.ts',
        './utils',
        '/project/src',
      );

      // The target is /project/src/api/utils, relative from /project/src → ./api/utils
      expect(result).toBe('./api/utils');
    });

    it('non-relative specifiers are unchanged even when fromDir is provided', () => {
      const result = runtimeImportSpecifier(
        '/project/src/api/todos.ts',
        'lodash',
        '/project/src',
      );

      expect(result).toBe('lodash');
    });

    it('combined module resolves relative imports in rendered code', () => {
      const file = '/project/src/api/todos.ts';
      const registry = new Registry<ServerEntry>();
      const entry = makeServerEntry('get-todos', file, {
        imports: [
          {
            specifier: './db',
            named: [{ imported: 'query', local: 'query' }],
          },
        ],
      });

      registry.set('get-todos', entry);
      registry.registerFile(file, ['get-todos']);

      const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(file);
      const result = loadVirtualModule(resolvedId, registry);

      // When fromDir is null, relative imports resolve to absolute paths
      expect(result!.code).toContain('/project/src/api/db');
    });
  });
});
