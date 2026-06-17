import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { Registry } from '../../src/core/registry';
import { handleGeneratedServerRequest } from '../../src/dev-server/middleware';

/**
 * Unit tests for middleware request handling.
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

interface TestEntry {
  file: string;
  endpoint: string;
}

function makeEntry(file: string, endpoint: string): TestEntry {
  return { file, endpoint };
}

function createMockReq(options: {
  method?: string;
  url?: string;
  body?: string | null;
}): IncomingMessage {
  const { method = 'POST', url = '/__server-build/test', body = null } = options;

  const chunks: Buffer[] = body !== null ? [Buffer.from(body)] : [];
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  const req = {
    method,
    url,
    headers: { host: 'localhost' },
    socket: { encrypted: false },
    on(event: string, cb: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(cb);

      // Simulate stream behavior asynchronously
      if (event === 'data') {
        queueMicrotask(() => {
          for (const chunk of chunks) cb(chunk);
        });
      }
      if (event === 'end') {
        queueMicrotask(() => {
          // Wait for data to be emitted first
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

function createMockServer(handlerFn?: (...args: unknown[]) => unknown): ViteDevServer {
  const fn = handlerFn ?? ((...args: unknown[]) => ({ echo: args }));
  return {
    ssrLoadModule: vi.fn().mockResolvedValue({ default: fn }),
  } as unknown as ViteDevServer;
}

describe('Middleware Request Handling', () => {
  let registry: Registry<TestEntry>;

  beforeEach(() => {
    registry = new Registry<TestEntry>();
    registry.set('test', makeEntry('/src/test.ts', 'test'));
    registry.registerFile('/src/test.ts', ['test']);
  });

  describe('HTTP method validation', () => {
    it('returns 405 with Allow: POST header for GET requests', async () => {
      const req = createMockReq({ method: 'GET' });
      const res = createMockRes();
      const server = createMockServer();

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(res._statusCode).toBe(405);
      expect(res._headers['Allow']).toBe('POST');
      expect(JSON.parse(res._body)).toEqual({ error: 'Method not allowed' });
    });

    it('returns 405 with Allow: POST header for PUT requests', async () => {
      const req = createMockReq({ method: 'PUT' });
      const res = createMockRes();
      const server = createMockServer();

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(res._statusCode).toBe(405);
      expect(res._headers['Allow']).toBe('POST');
    });

    it('returns 405 with Allow: POST header for DELETE requests', async () => {
      const req = createMockReq({ method: 'DELETE' });
      const res = createMockRes();
      const server = createMockServer();

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(res._statusCode).toBe(405);
      expect(res._headers['Allow']).toBe('POST');
    });
  });

  describe('empty body handling', () => {
    it('passes empty array to handler when body is empty', async () => {
      const handler = vi.fn().mockReturnValue({ ok: true });
      const req = createMockReq({ method: 'POST', body: '' });
      const res = createMockRes();
      const server = createMockServer(handler);

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(handler).toHaveBeenCalledWith();
      expect(res._statusCode).toBe(200);
    });
  });

  describe('invalid JSON body handling', () => {
    it('returns error response for invalid JSON body', async () => {
      const req = createMockReq({ method: 'POST', body: 'not valid json{{{' });
      const res = createMockRes();
      const server = createMockServer();

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(res._statusCode).toBe(500);
      const parsed = JSON.parse(res._body);
      expect(parsed).toHaveProperty('error');
    });
  });

  describe('non-array JSON body wrapping', () => {
    it('wraps a JSON object in a single-element array', async () => {
      const handler = vi.fn().mockReturnValue('done');
      const req = createMockReq({ method: 'POST', body: JSON.stringify({ name: 'test' }) });
      const res = createMockRes();
      const server = createMockServer(handler);

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(handler).toHaveBeenCalledWith({ name: 'test' });
    });

    it('wraps a JSON string in a single-element array', async () => {
      const handler = vi.fn().mockReturnValue('done');
      const req = createMockReq({ method: 'POST', body: JSON.stringify('hello') });
      const res = createMockRes();
      const server = createMockServer(handler);

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(handler).toHaveBeenCalledWith('hello');
    });

    it('wraps a JSON number in a single-element array', async () => {
      const handler = vi.fn().mockReturnValue('done');
      const req = createMockReq({ method: 'POST', body: JSON.stringify(42) });
      const res = createMockRes();
      const server = createMockServer(handler);

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(handler).toHaveBeenCalledWith(42);
    });

    it('passes array JSON body directly as spread args', async () => {
      const handler = vi.fn().mockReturnValue('done');
      const req = createMockReq({ method: 'POST', body: JSON.stringify(['arg1', 'arg2']) });
      const res = createMockRes();
      const server = createMockServer(handler);

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(handler).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });

  describe('handler returning undefined', () => {
    it('responds with 204 and no body when handler returns undefined', async () => {
      const handler = vi.fn().mockReturnValue(undefined);
      const req = createMockReq({ method: 'POST', body: JSON.stringify([]) });
      const res = createMockRes();
      const server = createMockServer(handler);

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(res._statusCode).toBe(204);
      expect(res._body).toBe('');
    });
  });

  describe('handler throwing an error', () => {
    it('returns 500 with JSON error message when handler throws', async () => {
      const handler = vi.fn().mockImplementation(() => {
        throw new Error('Something went wrong');
      });
      const req = createMockReq({ method: 'POST', body: JSON.stringify([]) });
      const res = createMockRes();
      const server = createMockServer(handler);

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(res._statusCode).toBe(500);
      const parsed = JSON.parse(res._body);
      expect(parsed).toEqual({ error: 'Something went wrong' });
    });

    it('returns 500 with stringified error for non-Error throws', async () => {
      const handler = vi.fn().mockImplementation(() => {
        throw 'raw string error';
      });
      const req = createMockReq({ method: 'POST', body: JSON.stringify([]) });
      const res = createMockRes();
      const server = createMockServer(handler);

      await handleGeneratedServerRequest(server, req, res, 'test', registry);

      expect(res._statusCode).toBe(500);
      const parsed = JSON.parse(res._body);
      expect(parsed).toEqual({ error: 'raw string error' });
    });
  });

  describe('percent-encoded endpoint path dispatch', () => {
    it('dispatches correctly to a handler registered with decoded endpoint name', async () => {
      const endpointName = 'my-module/special endpoint';
      registry.set(endpointName, makeEntry('/src/special.ts', endpointName));
      registry.registerFile('/src/special.ts', [endpointName]);

      const handler = vi.fn().mockReturnValue({ dispatched: true });
      const req = createMockReq({ method: 'POST', body: JSON.stringify([]) });
      const res = createMockRes();
      const server = createMockServer(handler);

      // The caller (index.ts) decodes the percent-encoded path before calling
      // handleGeneratedServerRequest, so we pass the decoded endpoint directly.
      await handleGeneratedServerRequest(server, req, res, endpointName, registry);

      expect(res._statusCode).toBe(200);
      expect(JSON.parse(res._body)).toEqual({ dispatched: true });
    });

    it('round-trips percent-encoded endpoint: encode then decode matches original', async () => {
      const original = 'path/with spaces/and@symbols';
      const encoded = encodeURIComponent(original);
      const decoded = decodeURIComponent(encoded);

      // Verify the round-trip property
      expect(decoded).toBe(original);

      // Register and dispatch with decoded name
      registry.set(decoded, makeEntry('/src/encoded.ts', decoded));
      registry.registerFile('/src/encoded.ts', [decoded]);

      const handler = vi.fn().mockReturnValue('ok');
      const req = createMockReq({ method: 'POST', body: JSON.stringify([]) });
      const res = createMockRes();
      const server = createMockServer(handler);

      await handleGeneratedServerRequest(server, req, res, decoded, registry);

      expect(res._statusCode).toBe(200);
      expect(handler).toHaveBeenCalled();
    });
  });
});
