import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ViteDevServer } from 'vite';
import { Registry } from '../../src/core/registry';
import type { WebSocketEntry } from '../../src/types';

/**
 * Unit tests for the WebSocket upgrade handler (ws-upgrade.ts).
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

// Mock the 'ws' module — vi.mock is auto-hoisted by vitest
const mockHandleUpgrade = vi.fn();

vi.mock('ws', () => {
  return {
    WebSocketServer: class {
      constructor() {}
      handleUpgrade(
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: unknown) => void,
      ) {
        mockHandleUpgrade(_req, _socket, _head, cb);
        // Create a mock raw WebSocket (EventEmitter with send/close)
        const mockWs = Object.assign(new EventEmitter(), {
          send: vi.fn(),
          close: vi.fn(),
        });
        cb(mockWs);
      }
    },
  };
});

// Import after mock declaration (vitest hoists vi.mock automatically)
const { setupWebsocketUpgrade } = await import(
  '../../src/dev-server/ws-upgrade'
);

function createMockSocket(): Duplex & { destroy: ReturnType<typeof vi.fn> } {
  const socket = new EventEmitter() as unknown as Duplex & {
    destroy: ReturnType<typeof vi.fn>;
  };
  (socket as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy = vi.fn();
  return socket;
}

function createMockRequest(url: string): IncomingMessage {
  return {
    url,
    headers: { host: 'localhost:5173' },
    socket: { encrypted: false },
  } as unknown as IncomingMessage;
}

function setupWithRegistry(wsRegistry: Registry<WebSocketEntry>): {
  server: ViteDevServer;
  triggerUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
} {
  const httpServer = new EventEmitter();
  const server = {
    httpServer,
    ssrLoadModule: vi.fn(),
  } as unknown as ViteDevServer;

  setupWebsocketUpgrade(server, wsRegistry);

  const listeners = httpServer.listeners('upgrade');
  const triggerUpgrade = listeners[listeners.length - 1] as (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;

  return { server, triggerUpgrade };
}

describe('WebSocket Upgrade Handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockHandleUpgrade.mockClear();
  });

  describe('Requirement 6.1: Requests without /__server-build-ws/ prefix are ignored', () => {
    it('does not destroy the socket for unrelated upgrade requests', () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      const { triggerUpgrade } = setupWithRegistry(wsRegistry);
      const socket = createMockSocket();
      const req = createMockRequest('/some/other/path');

      triggerUpgrade(req, socket, Buffer.alloc(0));

      expect(socket.destroy).not.toHaveBeenCalled();
    });

    it('ignores Vite HMR WebSocket upgrades', () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      const { triggerUpgrade } = setupWithRegistry(wsRegistry);
      const socket = createMockSocket();
      const req = createMockRequest('/__vite_hmr');

      triggerUpgrade(req, socket, Buffer.alloc(0));

      expect(socket.destroy).not.toHaveBeenCalled();
    });
  });

  describe('Requirement 6.2: Unregistered endpoint path destroys socket', () => {
    it('destroys the socket when endpoint is not in the registry', () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      const { triggerUpgrade } = setupWithRegistry(wsRegistry);
      const socket = createMockSocket();
      const req = createMockRequest('/__server-build-ws/chat');

      triggerUpgrade(req, socket, Buffer.alloc(0));

      expect(socket.destroy).toHaveBeenCalled();
    });

    it('destroys the socket for a path not matching any registered endpoint', () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      wsRegistry.set('notifications', {
        file: '/src/notifications.ts',
      } as WebSocketEntry);

      const { triggerUpgrade } = setupWithRegistry(wsRegistry);
      const socket = createMockSocket();
      const req = createMockRequest('/__server-build-ws/unknown-endpoint');

      triggerUpgrade(req, socket, Buffer.alloc(0));

      expect(socket.destroy).toHaveBeenCalled();
    });
  });

  describe('Requirement 6.3: Invalid percent-encoding destroys socket without crash', () => {
    it('destroys socket for %ZZ invalid encoding without throwing', () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      const { triggerUpgrade } = setupWithRegistry(wsRegistry);
      const socket = createMockSocket();
      const req = createMockRequest('/__server-build-ws/%ZZ');

      expect(() => {
        triggerUpgrade(req, socket, Buffer.alloc(0));
      }).not.toThrow();

      expect(socket.destroy).toHaveBeenCalled();
    });

    it('destroys socket for %GG%HH malformed sequence without throwing', () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      const { triggerUpgrade } = setupWithRegistry(wsRegistry);
      const socket = createMockSocket();
      const req = createMockRequest('/__server-build-ws/%GG%HH');

      expect(() => {
        triggerUpgrade(req, socket, Buffer.alloc(0));
      }).not.toThrow();

      expect(socket.destroy).toHaveBeenCalled();
    });
  });

  describe('Requirement 6.4: Invalid ?args= JSON defaults to empty array', () => {
    it('defaults to empty array when args is invalid JSON', async () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      wsRegistry.set('chat', { file: '/src/chat.ts' } as WebSocketEntry);

      const { server, triggerUpgrade } = setupWithRegistry(wsRegistry);

      let capturedArgs: unknown[] | undefined;
      (server.ssrLoadModule as ReturnType<typeof vi.fn>).mockResolvedValue({
        default: {
          onOpen(ws: { args: unknown[] }) {
            capturedArgs = ws.args;
          },
        },
      });

      const socket = createMockSocket();
      const req = createMockRequest(
        '/__server-build-ws/chat?args=not-valid-json{{{',
      );

      // Suppress the debug log
      vi.spyOn(console, 'error').mockImplementation(() => {});

      triggerUpgrade(req, socket, Buffer.alloc(0));

      await vi.waitFor(() => {
        expect(capturedArgs).toBeDefined();
      });

      expect(capturedArgs).toEqual([]);
    });

    it('defaults to empty array when args query parameter is absent', async () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      wsRegistry.set('chat', { file: '/src/chat.ts' } as WebSocketEntry);

      const { server, triggerUpgrade } = setupWithRegistry(wsRegistry);

      let capturedArgs: unknown[] | undefined;
      (server.ssrLoadModule as ReturnType<typeof vi.fn>).mockResolvedValue({
        default: {
          onOpen(ws: { args: unknown[] }) {
            capturedArgs = ws.args;
          },
        },
      });

      const socket = createMockSocket();
      const req = createMockRequest('/__server-build-ws/chat');

      vi.spyOn(console, 'error').mockImplementation(() => {});

      triggerUpgrade(req, socket, Buffer.alloc(0));

      await vi.waitFor(() => {
        expect(capturedArgs).toBeDefined();
      });

      expect(capturedArgs).toEqual([]);
    });
  });

  describe('Requirement 6.5: onOpen handler throwing closes socket with code 1011', () => {
    it('closes socket with code 1011 when onOpen throws', async () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      wsRegistry.set('chat', { file: '/src/chat.ts' } as WebSocketEntry);

      const { server, triggerUpgrade } = setupWithRegistry(wsRegistry);

      let mockWsInstance: EventEmitter & { close: ReturnType<typeof vi.fn> };

      mockHandleUpgrade.mockImplementation(
        (
          _req: unknown,
          _socket: unknown,
          _head: unknown,
          cb: (ws: unknown) => void,
        ) => {
          const ws = Object.assign(new EventEmitter(), {
            send: vi.fn(),
            close: vi.fn(),
          });
          mockWsInstance = ws;
          cb(ws);
        },
      );

      (server.ssrLoadModule as ReturnType<typeof vi.fn>).mockResolvedValue({
        default: {
          onOpen() {
            throw new Error('Handler exploded');
          },
        },
      });

      const socket = createMockSocket();
      const req = createMockRequest('/__server-build-ws/chat');

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      triggerUpgrade(req, socket, Buffer.alloc(0));

      // Wait for the async handler to settle
      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Handler exploded'),
        );
      });

      // Verify the socket was closed with code 1011
      expect(mockWsInstance!.close).toHaveBeenCalledWith(1011, 'Internal error');

      consoleSpy.mockRestore();
    });

    it('closes socket with code 1011 when ssrLoadModule rejects', async () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      wsRegistry.set('chat', { file: '/src/chat.ts' } as WebSocketEntry);

      const { server, triggerUpgrade } = setupWithRegistry(wsRegistry);

      let mockWsInstance: EventEmitter & { close: ReturnType<typeof vi.fn> };

      mockHandleUpgrade.mockImplementation(
        (
          _req: unknown,
          _socket: unknown,
          _head: unknown,
          cb: (ws: unknown) => void,
        ) => {
          const ws = Object.assign(new EventEmitter(), {
            send: vi.fn(),
            close: vi.fn(),
          });
          mockWsInstance = ws;
          cb(ws);
        },
      );

      (server.ssrLoadModule as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Module load failed'),
      );

      const socket = createMockSocket();
      const req = createMockRequest('/__server-build-ws/chat');

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      triggerUpgrade(req, socket, Buffer.alloc(0));

      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Module load failed'),
        );
      });

      // Verify the socket was closed with code 1011
      expect(mockWsInstance!.close).toHaveBeenCalledWith(1011, 'Internal error');

      consoleSpy.mockRestore();
    });
  });

  describe('Requirement 6.6: Invalid JSON in WebSocket message passes raw string to onMessage', () => {
    it('passes raw string when message is not valid JSON', async () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      wsRegistry.set('chat', { file: '/src/chat.ts' } as WebSocketEntry);

      const { server, triggerUpgrade } = setupWithRegistry(wsRegistry);

      let receivedData: unknown;
      let mockWsInstance: EventEmitter | undefined;

      (server.ssrLoadModule as ReturnType<typeof vi.fn>).mockResolvedValue({
        default: {
          onOpen() {},
          onMessage(_ws: unknown, data: unknown) {
            receivedData = data;
          },
        },
      });

      // Override mockHandleUpgrade to capture the ws instance
      mockHandleUpgrade.mockImplementation(
        (
          _req: unknown,
          _socket: unknown,
          _head: unknown,
          cb: (ws: unknown) => void,
        ) => {
          const ws = Object.assign(new EventEmitter(), {
            send: vi.fn(),
            close: vi.fn(),
          });
          mockWsInstance = ws;
          cb(ws);
        },
      );

      const socket = createMockSocket();
      const req = createMockRequest('/__server-build-ws/chat');

      vi.spyOn(console, 'error').mockImplementation(() => {});

      triggerUpgrade(req, socket, Buffer.alloc(0));

      // Wait for the async handler to register the 'message' listener
      await vi.waitFor(() => {
        expect(mockWsInstance).toBeDefined();
      });

      // Give the async IIFE time to complete setup
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Emit a message with invalid JSON
      const invalidJsonMsg = Buffer.from('not json at all {{{');
      mockWsInstance!.emit('message', invalidJsonMsg);

      await vi.waitFor(() => {
        expect(receivedData).toBeDefined();
      });

      expect(receivedData).toBe('not json at all {{{');
    });

    it('passes parsed object when message is valid JSON', async () => {
      const wsRegistry = new Registry<WebSocketEntry>();
      wsRegistry.set('chat', { file: '/src/chat.ts' } as WebSocketEntry);

      const { server, triggerUpgrade } = setupWithRegistry(wsRegistry);

      let receivedData: unknown;
      let mockWsInstance: EventEmitter | undefined;

      (server.ssrLoadModule as ReturnType<typeof vi.fn>).mockResolvedValue({
        default: {
          onOpen() {},
          onMessage(_ws: unknown, data: unknown) {
            receivedData = data;
          },
        },
      });

      mockHandleUpgrade.mockImplementation(
        (
          _req: unknown,
          _socket: unknown,
          _head: unknown,
          cb: (ws: unknown) => void,
        ) => {
          const ws = Object.assign(new EventEmitter(), {
            send: vi.fn(),
            close: vi.fn(),
          });
          mockWsInstance = ws;
          cb(ws);
        },
      );

      const socket = createMockSocket();
      const req = createMockRequest('/__server-build-ws/chat');

      vi.spyOn(console, 'error').mockImplementation(() => {});

      triggerUpgrade(req, socket, Buffer.alloc(0));

      await vi.waitFor(() => {
        expect(mockWsInstance).toBeDefined();
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Emit a message with valid JSON
      const validJsonMsg = Buffer.from(JSON.stringify({ text: 'hello' }));
      mockWsInstance!.emit('message', validJsonMsg);

      await vi.waitFor(() => {
        expect(receivedData).toBeDefined();
      });

      expect(receivedData).toEqual({ text: 'hello' });
    });
  });
});
