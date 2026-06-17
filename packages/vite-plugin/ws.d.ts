/**
 * Ambient declaration for the `$ws()` macro injected by vite-plugin-server-build.
 *
 * - On the server the handlers run for the lifetime of each connection.
 * - In the browser the call is replaced with `{ connect(...args) }`, which
 *   opens a `Ws` to the generated endpoint and returns a small
 *   wrapper for sending/receiving JSON-serializable messages.
 *
 * `args` passed to `connect(...)` are forwarded to the server and exposed as
 * `ws.args` inside every handler for the lifetime of that connection (e.g.
 * for passing an auth token).
 *
 * The value returned by `$ws()` has the same type signature wherever
 * it's referenced. On the client, call `.connect()` to open a connection. On
 * the server, call `.send()` from any sibling `$server()`/`$ws()`
 * handler in the same file to broadcast JSON-serializable data to every
 * currently open connection for this endpoint.
 *
 * Just like `$server()` infers `Args`/`R` from the function you pass it,
 * `$ws()` infers its message types from the handlers you pass it — no
 * explicit type arguments needed for the common case:
 *
 * @example
 *   interface ChatMessage { text: string }
 *   interface ChatBroadcast { text: string; from: string }
 *
 *   export const chat = $ws({
 *     // `data` annotated -> inferred as the client-to-server message type.
 *     // `ws` annotated -> inferred as the server-to-client message type.
 *     onOpen(ws: ServerWs<ChatBroadcast>) {
 *       console.log("connected with args", ws.args);
 *     },
 *     onMessage(ws: ServerWs<ChatBroadcast>, data: ChatMessage) {
 *       ws.send({ text: data.text, from: "server" });
 *     },
 *     onClose(ws: ServerWs<ChatBroadcast>) {},
 *   });
 *
 *   // server: broadcast to every connected client from a sibling $server() handler
 *   export const announce = $server(async (text: string) => {
 *     chat.send({ text, from: "server" });
 *   });
 *
 *   // client: connect()/send()/onMessage() are typed from the inference above
 *   const conn = chat.connect(authToken);
 *   conn.onMessage((data) => console.log(data.text, data.from));
 *   conn.send({ text: "hello" });
 *
 * Leaving handlers unannotated keeps the previous untyped behavior (`unknown`).
 * To type `connect()`'s arguments (and therefore `ws.args`), either annotate
 * `ws: ServerWs<TServerToClient, TConnectArgs>` or pass explicit type
 * arguments: `$ws<ChatMessage, ChatBroadcast, [authToken: string]>({...})`.
 */
interface ServerWs<
  TServerToClient = unknown,
  TConnectArgs extends unknown[] = unknown[],
> {
  /** Arguments passed to `connect(...)` on the client for this connection. */
  args: TConnectArgs;
  /** Serializes `data` to JSON and sends it to the client. */
  send(data: TServerToClient): void;
  /** Closes the connection. */
  close(code?: number, reason?: string): void;
}

interface WsHandlers<
  TClientToServer = unknown,
  TServerToClient = TClientToServer,
  TConnectArgs extends unknown[] = unknown[],
> {
  onOpen?(ws: ServerWs<TServerToClient, TConnectArgs>): void;
  onMessage?(
    ws: ServerWs<TServerToClient, TConnectArgs>,
    data: TClientToServer,
  ): void;
  onClose?(ws: ServerWs<TServerToClient, TConnectArgs>): void;
}

interface WsConnection<TClientToServer = unknown, TServerToClient = TClientToServer> {
  /** Sends JSON-serializable `data` to the server over the connection. */
  send(data: TClientToServer): void;
  /** Registers a callback invoked with each JSON-deserialized message from the server. */
  onMessage(callback: (data: TServerToClient) => void): void;
  /** Registers a callback invoked when the connection closes. */
  onClose(callback: (event: CloseEvent) => void): void;
  /** Closes the connection. */
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

declare function $ws<
  TClientToServer = unknown,
  TServerToClient = TClientToServer,
  TConnectArgs extends unknown[] = unknown[],
>(
  handlers: WsHandlers<TClientToServer, TServerToClient, TConnectArgs>,
): {
  /** Client: opens a new connection to this endpoint. */
  connect(...args: TConnectArgs): WsConnection<TClientToServer, TServerToClient>;
  /**
   * Server: serializes `data` to JSON and broadcasts it to every currently
   * open connection for this endpoint. Call from a sibling `$server()` or
   * `$ws()` handler in the same file.
   */
  send(data: TServerToClient): void;
};
