import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ViteDevServer } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { Registry } from "../core/registry";
import type { WebSocketEntry } from "../types";
import { VIRTUAL_WS_PREFIX, WS_API_PREFIX } from "../constants";
import { requestUrl } from "./middleware";

type ServerWebSocket = WebSocket & { args: unknown[] };

interface WebSocketHandlers {
  onOpen?(ws: ServerWebSocket): void;
  onMessage?(ws: ServerWebSocket, data: unknown): void;
  onClose?(ws: ServerWebSocket): void;
}

function parseArgs(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Hooks into the Vite dev server's underlying HTTP server to upgrade
 * connections for `websocket()` endpoints in-process, using the `ws`
 * package (Bun's own server uses native `Bun.serve` upgrades instead — see
 * build/bundle-generator.ts). Running in-process means a file's `backend()`
 * and `websocket()` handlers share the same module instance and therefore
 * the same module-level state in dev mode, matching production.
 */
export function setupWebsocketUpgrade(
  server: ViteDevServer,
  wsRegistry: Registry<WebSocketEntry>,
): void {
  const httpServer = server.httpServer;
  if (!httpServer) return;

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on(
    "upgrade",
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = requestUrl(req);
      console.error("[ws-debug] upgrade request for", url.pathname);
      if (!url.pathname.startsWith(WS_API_PREFIX)) return;

      let endpoint: string;
      try {
        endpoint = decodeURIComponent(url.pathname.slice(WS_API_PREFIX.length));
      } catch {
        socket.destroy();
        return;
      }

      if (!wsRegistry.has(endpoint)) {
        socket.destroy();
        return;
      }

      const args = parseArgs(url.searchParams.get("args"));

      wss.handleUpgrade(req, socket, head, (rawSocket) => {
        void (async () => {
          try {
            const mod = await server.ssrLoadModule(VIRTUAL_WS_PREFIX + endpoint);
            const handlers = mod.default as WebSocketHandlers;

            const ws = rawSocket as ServerWebSocket;
            ws.args = args;
            const rawSend = rawSocket.send.bind(rawSocket);
            rawSocket.send = ((data: unknown) =>
              rawSend(JSON.stringify(data))) as typeof rawSocket.send;

            handlers.onOpen?.(ws);

            rawSocket.on("message", (raw: Buffer) => {
              let data: unknown;
              try {
                data = JSON.parse(raw.toString());
              } catch {
                data = raw.toString();
              }
              handlers.onMessage?.(ws, data);
            });

            rawSocket.on("close", () => {
              handlers.onClose?.(ws);
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(
              `[server-build] Error in websocket handler '${endpoint}': ${msg}`,
            );
            rawSocket.close(1011, "Internal error");
          }
        })();
      });
    },
  );
}
