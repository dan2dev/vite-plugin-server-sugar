/**
 * Ambient declaration for the `websocket()` macro injected by vite-plugin-server-build.
 *
 * - On the server the handlers run for the lifetime of each connection.
 * - In the browser the call is replaced with `{ connect(...args) }`, which
 *   opens a `WebSocket` to the generated endpoint and returns a small
 *   wrapper for sending/receiving JSON-serializable messages.
 *
 * `args` passed to `connect(...)` are forwarded to the server and exposed as
 * `ws.args` inside every handler for the lifetime of that connection (e.g.
 * for passing an auth token).
 *
 * @example
 *   export const chat = websocket({
 *     onOpen(ws) {
 *       console.log("connected with args", ws.args);
 *     },
 *     onMessage(ws, data) {
 *       ws.send({ echo: data });
 *     },
 *     onClose(ws) {},
 *   });
 *
 *   // client:
 *   const conn = chat.connect(authToken);
 *   conn.onMessage((data) => console.log(data));
 *   conn.send({ hello: "world" });
 */
interface ServerWebSocket {
  /** Arguments passed to `connect(...)` on the client for this connection. */
  args: unknown[];
  /** Serializes `data` to JSON and sends it to the client. */
  send(data: unknown): void;
  /** Closes the connection. */
  close(code?: number, reason?: string): void;
}

interface WebSocketHandlers {
  onOpen?(ws: ServerWebSocket): void;
  onMessage?(ws: ServerWebSocket, data: unknown): void;
  onClose?(ws: ServerWebSocket): void;
}

interface WebSocketConnection {
  /** Sends JSON-serializable `data` to the server over the connection. */
  send(data: unknown): void;
  /** Registers a callback invoked with each JSON-deserialized message from the server. */
  onMessage(callback: (data: unknown) => void): void;
  /** Registers a callback invoked when the connection closes. */
  onClose(callback: (event: CloseEvent) => void): void;
  /** Closes the connection. */
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

declare function websocket(
  handlers: WebSocketHandlers,
): { connect(...args: unknown[]): WebSocketConnection };
