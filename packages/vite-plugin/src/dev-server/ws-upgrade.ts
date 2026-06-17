import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ViteDevServer } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { Registry } from "../core/registry";
import type { WsEntry } from "../types";
import { VIRTUAL_WS_PREFIX, WS_API_PREFIX, WS_RUNTIME_GLOBAL_KEY } from "../constants";
import { requestUrl } from "./middleware";

type ServerWs = WebSocket & { args: unknown[] };

interface WsHandlers {
  onOpen?(ws: ServerWs): void;
  onMessage?(ws: ServerWs, data: unknown): void;
  onClose?(ws: ServerWs): void;
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
 * Same registry the generated virtual module reads from (see
 * dev-server/virtual-modules.ts) so a `<name>.send(data)` call broadcasts to
 * sockets registered here. Shared via `globalThis` since the two run as
 * separate module instances.
 */
function wsConnections(): Map<string, Set<ServerWs>> {
  const g = globalThis as Record<string, unknown>;
  return (g[WS_RUNTIME_GLOBAL_KEY] ??= new Map()) as Map<
    string,
    Set<ServerWs>
  >;
}

/**
 * Hooks into the Vite dev server's underlying HTTP server to upgrade
 * connections for `ws()` endpoints in-process, using the `ws`
 * package (Bun's own server uses native `Bun.serve` upgrades instead — see
 * build/bundle-generator.ts). Running in-process means a file's `server()`
 * and `ws()` handlers share the same module instance and therefore
 * the same module-level state in dev mode, matching production.
 */
export function setupWsUpgrade(
  server: ViteDevServer,
  wsRegistry: Registry<WsEntry>,
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
            const handlers = mod.default as WsHandlers;

            const ws = rawSocket as ServerWs;
            ws.args = args;
            const rawSend = rawSocket.send.bind(rawSocket);
            rawSocket.send = ((data: unknown) =>
              rawSend(JSON.stringify(data))) as typeof rawSocket.send;

            const conns = wsConnections();
            let endpointConns = conns.get(endpoint);
            if (!endpointConns) {
              endpointConns = new Set();
              conns.set(endpoint, endpointConns);
            }
            endpointConns.add(ws);

            // Wired before onOpen() runs so the socket is still untracked on
            // close even if onOpen() throws (the catch below closes it).
            rawSocket.on("close", () => {
              wsConnections().get(endpoint)?.delete(ws);
              handlers.onClose?.(ws);
            });

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
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(
              `[server-build] Error in ws handler '${endpoint}': ${msg}`,
            );
            rawSocket.close(1011, "Internal error");
          }
        })();
      });
    },
  );
}
