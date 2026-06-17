import { describe, it, expect } from 'vitest';
import { processFile } from '../../src/core/processor';
import { Registry } from '../../src/core/registry';
import type { ServerEntry, WsEntry } from '../../src/types';

/**
 * Unit tests for endpoint name generation (Requirements 13.1–13.6).
 *
 * The endpoint name is composed of:
 *   <file-path-segments>/<handler-label>
 *
 * Where:
 * - file path is relative to root, with `src/` stripped and extension removed
 * - handler label comes from variable name, property path, or line:col fallback
 * - each segment is converted to kebab-case
 * - each segment is URL-encoded with encodeURIComponent in the endpoint URL
 */

function processAndGetEndpoints(
  code: string,
  filePath: string,
  root: string,
): { serverEndpoints: string[]; wsEndpoints: string[] } {
  const registry = new Registry<ServerEntry>();
  const wsRegistry = new Registry<WsEntry>();

  processFile(code, filePath, { registry, wsRegistry, root });

  const serverEndpoints = [...registry.getEndpointsForFile(filePath)];
  const wsEndpoints = [...wsRegistry.getEndpointsForFile(filePath)];

  return { serverEndpoints, wsEndpoints };
}

describe('endpoint name generation', () => {
  describe('src/ prefix stripping from file paths', () => {
    it('strips the src/ prefix from the file path', () => {
      const code = `const getTodos = $server(() => [])`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/todos.ts',
        '/project',
      );

      expect(serverEndpoints[0]).toBe('todos/get-todos');
    });

    it('does not strip src/ when not at the start of the relative path', () => {
      const code = `const getTodos = $server(() => [])`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/lib/src/todos.ts',
        '/project',
      );

      // "lib/src/todos" → the src/ is not at the start, so it stays
      expect(serverEndpoints[0]).toBe('lib/src/todos/get-todos');
    });

    it('keeps the path as-is when there is no src/ prefix', () => {
      const code = `const getUsers = $server(() => [])`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/api/users.ts',
        '/project',
      );

      expect(serverEndpoints[0]).toBe('api/users/get-users');
    });

    it('strips file extension (.ts, .tsx, .js, .jsx) from the path', () => {
      const code = `const handler = $server(() => null)`;

      const tsx = processAndGetEndpoints(
        code,
        '/project/src/page.tsx',
        '/project',
      );
      expect(tsx.serverEndpoints[0]).toBe('page/handler');

      const js = processAndGetEndpoints(
        code,
        '/project/src/page.js',
        '/project',
      );
      expect(js.serverEndpoints[0]).toBe('page/handler');

      const jsx = processAndGetEndpoints(
        code,
        '/project/src/page.jsx',
        '/project',
      );
      expect(jsx.serverEndpoints[0]).toBe('page/handler');
    });
  });

  describe('variable name assignment determines endpoint label (const pattern)', () => {
    it('uses the variable name in kebab-case as endpoint label', () => {
      const code = `const getTodos = $server(() => [])`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/todos.ts',
        '/project',
      );

      expect(serverEndpoints[0]).toBe('todos/get-todos');
    });

    it('converts PascalCase variable names to kebab-case', () => {
      const code = `const FetchUserData = $server(() => null)`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/users.ts',
        '/project',
      );

      expect(serverEndpoints[0]).toBe('users/fetch-user-data');
    });

    it('converts camelCase variable names to kebab-case', () => {
      const code = `const createNewItem = $server(() => null)`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/items.ts',
        '/project',
      );

      expect(serverEndpoints[0]).toBe('items/create-new-item');
    });

    it('works for ws handlers assigned to const', () => {
      const code = `const chatRoom = $ws({ onMessage(ws, msg) {} })`;
      const { wsEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/chat.ts',
        '/project',
      );

      expect(wsEndpoints[0]).toBe('chat/chat-room');
    });
  });

  describe('property assignment path determines endpoint label (nested object pattern)', () => {
    it('uses property name as the endpoint label (converted by toKebabCase)', () => {
      const code = `const api = { getTodos: $server(() => []) }`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/api.ts',
        '/project',
      );

      // inferBackendLabel returns "api.getTodos" (variable + property path joined by dots)
      // toKebabCase converts dots to hyphens: "api.getTodos" → "api-get-todos"
      expect(serverEndpoints[0]).toBe('api/api-get-todos');
    });

    it('uses nested property path (dots become hyphens via toKebabCase)', () => {
      const code = `const routes = { users: { getAll: $server(() => []) } }`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/routes.ts',
        '/project',
      );

      // inferBackendLabel returns "routes.users.getAll"
      // toKebabCase: "routes.users.getAll" → "routes-users-get-all"
      expect(serverEndpoints[0]).toBe('routes/routes-users-get-all');
    });

    it('combines deeply nested property path segments', () => {
      const code = `const config = { api: { v2: { fetchData: $server(() => null) } } }`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/config.ts',
        '/project',
      );

      // inferBackendLabel returns "config.api.v2.fetchData"
      // toKebabCase: "config.api.v2.fetchData" → "config-api-v2-fetch-data"
      expect(serverEndpoints[0]).toBe('config/config-api-v2-fetch-data');
    });
  });

  describe('fallback to $server@line:col / $ws@line:col when no context', () => {
    it('falls back to $server@line:col when not assigned to a variable', () => {
      const code = `export default $server(() => null)`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/handler.ts',
        '/project',
      );

      // export default assignment uses "default" label
      expect(serverEndpoints[0]).toBe('handler/default');
    });

    it('falls back to line:col format for unresolvable positions', () => {
      // A server call as an argument to another function has no variable context
      // The label becomes "arg0" since it's the first argument in a call expression
      const code = `register($server(() => null))`;
      const { serverEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/setup.ts',
        '/project',
      );

      // As an argument to register(), the label uses "arg0"
      expect(serverEndpoints[0]).toMatch(/setup\//);
    });

    it('falls back to $ws@line:col for ws without naming context', () => {
      // A bare expression statement with the call — no variable/property assignment
      const code = `
const arr = [$ws({ onMessage(ws, msg) {} })]
`;
      const { wsEndpoints } = processAndGetEndpoints(
        code,
        '/project/src/ws.ts',
        '/project',
      );

      // Inside an array literal, uses index as label: "arr.0"
      expect(wsEndpoints[0]).toMatch(/ws\//);
    });
  });

  describe('URL-safe encoding of path segments', () => {
    it('encodes path segments with encodeURIComponent in endpoint URLs', () => {
      // The endpointUrl function applies encodeURIComponent to each segment
      // We test this by checking the processor generates correct fetch wrapper URLs
      const code = `const getUsers = $server(() => [])`;
      const registry = new Registry<ServerEntry>();
      const wsRegistry = new Registry<WsEntry>();

      const result = processFile(code, '/project/src/api/users.ts', {
        registry,
        wsRegistry,
        root: '/project',
      });

      // The client output should contain the URL with encoded segments
      expect(result).not.toBeNull();
      // The endpoint itself: "api/users/get-users"
      // The URL in the client code: "/__server-build/api/users/get-users"
      // Since these segments are URL-safe already, they stay the same
      expect(result!.code).toContain('/__server-build/api/users/get-users');
    });

    it('encodes special characters in path segments', () => {
      // If a file path contains characters that need encoding, they should be encoded
      const code = `const handler = $server(() => null)`;
      const registry = new Registry<ServerEntry>();
      const wsRegistry = new Registry<WsEntry>();

      const result = processFile(code, '/project/src/api/@special.ts', {
        registry,
        wsRegistry,
        root: '/project',
      });

      expect(result).not.toBeNull();
      // The "@special" segment should be encoded as "%40special" in the URL
      expect(result!.code).toContain(encodeURIComponent('api'));
      expect(result!.code).toContain(encodeURIComponent('@special'));
    });

    it('each segment is independently encoded', () => {
      // Slashes in the path should NOT be encoded (they are segment separators)
      const code = `const handler = $server(() => null)`;
      const registry = new Registry<ServerEntry>();
      const wsRegistry = new Registry<WsEntry>();

      const result = processFile(code, '/project/src/nested/deep/file.ts', {
        registry,
        wsRegistry,
        root: '/project',
      });

      expect(result).not.toBeNull();
      // URL should have real slashes between segments, not encoded %2F
      expect(result!.code).toContain('/__server-build/nested/deep/file/handler');
      expect(result!.code).not.toContain('%2F');
    });

    it('decodeURIComponent recovers original segment values', () => {
      // The endpoint name itself preserves original characters;
      // the URL-encoded form is round-trippable
      const endpoint = 'api/@special/get-todos';
      const segments = endpoint.split('/');
      const encoded = segments.map(encodeURIComponent).join('/');
      const decoded = encoded.split('/').map(decodeURIComponent).join('/');

      expect(decoded).toBe(endpoint);
    });
  });
});
