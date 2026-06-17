import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { Registry } from '../../src/core/registry';
import { handleGeneratedServerRequest } from '../../src/dev-server/middleware';
import { arbEndpointName } from '../helpers/generators';
import { API_PREFIX } from '../../src/constants';

/**
 * Property-based tests for middleware request handling.
 * Feature: vite-plugin-quality-testing, Property 26 & 27
 * Validates: Requirements 7.4, 7.7
 */

interface TestEntry {
  file: string;
  endpoint: string;
}

function makeEntry(file: string, endpoint: string): TestEntry {
  return { file, endpoint };
}

function createMockReq(body: string): IncomingMessage {
  const chunks: Buffer[] = [Buffer.from(body)];

  const req = {
    method: 'POST',
    url: '/__server-build/test',
    headers: { host: 'localhost', 'content-type': 'application/json' },
    socket: { encrypted: false },
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === 'data') {
        queueMicrotask(() => {
          for (const chunk of chunks) cb(chunk);
        });
      }
      if (event === 'end') {
        queueMicrotask(() => {
          queueMicrotask(() => cb());
        });
      }
      return req;
    },
  } as unknown as IncomingMessage;

  return req;
}

function createMockRes(): ServerResponse & {
  _statusCode: number;
  _headers: Record<string, string>;
  _body: string;
  _ended: boolean;
} {
  const res = {
    _statusCode: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    _ended: false,
    get statusCode() {
      return this._statusCode;
    },
    set statusCode(code: number) {
      this._statusCode = code;
    },
    writeHead(code: number, headers?: Record<string, string>) {
      this._statusCode = code;
      if (headers) {
        Object.assign(this._headers, headers);
      }
      return this;
    },
    setHeader(name: string, value: string) {
      this._headers[name] = value;
      return this;
    },
    end(body?: string) {
      if (body !== undefined) this._body = body;
      this._ended = true;
      return this;
    },
  } as unknown as ServerResponse & {
    _statusCode: number;
    _headers: Record<string, string>;
    _body: string;
    _ended: boolean;
  };

  return res;
}

function createMockServer(handlerFn: (...args: unknown[]) => unknown): ViteDevServer {
  return {
    ssrLoadModule: vi.fn().mockResolvedValue({ default: handlerFn }),
  } as unknown as ViteDevServer;
}

/**
 * Generator for non-array JSON values: objects, strings, numbers, booleans, null.
 * Excludes arrays since we specifically want to test the wrapping behavior for non-arrays.
 */
function arbNonArrayJsonValue(): fc.Arbitrary<unknown> {
  const arbJsonDouble = fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .filter((n) => !Object.is(n, -0));

  return fc.oneof(
    // JSON objects (non-array)
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.oneof(
        fc.string({ maxLength: 20 }),
        fc.integer(),
        arbJsonDouble,
        fc.boolean(),
        fc.constant(null),
      ),
      { minKeys: 0, maxKeys: 5 },
    ),
    // JSON strings
    fc.string({ maxLength: 50 }),
    // JSON numbers (integers and doubles)
    fc.integer(),
    arbJsonDouble,
    // JSON booleans
    fc.boolean(),
    // JSON null
    fc.constant(null),
  );
}

describe('Middleware Property Tests', () => {
  let registry: Registry<TestEntry>;

  beforeEach(() => {
    registry = new Registry<TestEntry>();
    registry.set('test', makeEntry('/src/test.ts', 'test'));
    registry.registerFile('/src/test.ts', ['test']);
  });

  it('Property 26: Middleware Wraps Non-Array JSON in Single-Element Array', () => {
    // Feature: vite-plugin-quality-testing, Property 26: Middleware Wraps Non-Array JSON in Single-Element Array
    // For any valid JSON value that is not an array, serverArgsFromBody wraps it in [value],
    // so the handler receives the value as its first (and only) argument.
    fc.assert(
      fc.asyncProperty(arbNonArrayJsonValue(), async (value) => {
        const receivedArgs: unknown[][] = [];
        const handler = (...args: unknown[]) => {
          receivedArgs.push(args);
          return 'ok';
        };

        const body = JSON.stringify(value);
        const req = createMockReq(body);
        const res = createMockRes();
        const server = createMockServer(handler);

        await handleGeneratedServerRequest(server, req, res, 'test', registry);

        // The handler should have been called exactly once
        expect(receivedArgs.length).toBe(1);
        // The handler should receive exactly one argument (the non-array value wrapped in [value] then spread)
        expect(receivedArgs[0].length).toBe(1);
        // The argument should deeply equal the original value
        expect(receivedArgs[0][0]).toEqual(value);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 27: Middleware Percent-Encoding Round-Trip Dispatch', () => {
    // Feature: vite-plugin-quality-testing, Property 27: Middleware Percent-Encoding Round-Trip Dispatch
    // **Validates: Requirements 7.7**
    // For any valid endpoint name, encoding it with encodeURIComponent and then
    // decoding with decodeURIComponent SHALL recover the original endpoint name,
    // enabling correct handler dispatch.
    fc.assert(
      fc.asyncProperty(arbEndpointName(), async (endpointName) => {
        // 1. Verify the encoding round-trip recovers the original name
        const encoded = encodeURIComponent(endpointName);
        const decoded = decodeURIComponent(encoded);
        expect(decoded).toBe(endpointName);

        // 2. Simulate the full dispatch path:
        // The URL would be `/__server-build/<encoded>`, and the server extracts
        // the endpoint by slicing the prefix and decoding.
        const urlPath = API_PREFIX + encoded;
        const extractedEndpoint = decodeURIComponent(urlPath.slice(API_PREFIX.length));
        expect(extractedEndpoint).toBe(endpointName);

        // 3. Verify the middleware can dispatch to the correct handler using the decoded name
        const dispatchedEndpoints: string[] = [];
        const handler = (..._args: unknown[]) => {
          dispatchedEndpoints.push(endpointName);
          return 'dispatched';
        };

        // Register the endpoint with the decoded name
        const localRegistry = new Registry<TestEntry>();
        localRegistry.set(endpointName, makeEntry('/src/test.ts', endpointName));
        localRegistry.registerFile('/src/test.ts', [endpointName]);

        const body = JSON.stringify([]);
        const req = createMockReq(body);
        const res = createMockRes();
        const server = createMockServer(handler);

        // Dispatch using the decoded endpoint name (as the middleware would after decoding)
        await handleGeneratedServerRequest(server, req, res, extractedEndpoint, localRegistry);

        // The handler should have been called
        expect(dispatchedEndpoints.length).toBe(1);
        expect(dispatchedEndpoints[0]).toBe(endpointName);
        // Response should be successful
        expect(res._statusCode).toBe(200);
      }),
      { numRuns: 100 },
    );
  });
});
