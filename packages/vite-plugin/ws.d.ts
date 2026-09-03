interface ServerSugarWs<
  TServerToClient = unknown,
  TConnectArgs extends unknown[] = unknown[],
> {
  /** Arguments passed to `connect(...)` for this connection. */
  args: TConnectArgs;
  /** Serializes `data` to JSON and sends it to this client. */
  send(data: TServerToClient): void;
  close(code?: number, reason?: string): void;
}

interface ServerSugarWsHandlers<
  TClientToServer = unknown,
  TServerToClient = TClientToServer,
  TConnectArgs extends unknown[] = unknown[],
> {
  onOpen?(ws: ServerSugarWs<TServerToClient, TConnectArgs>): void;
  onMessage?(
    ws: ServerSugarWs<TServerToClient, TConnectArgs>,
    data: TClientToServer,
  ): void;
  onClose?(ws: ServerSugarWs<TServerToClient, TConnectArgs>): void;
}

interface ServerSugarWsConnection<
  TClientToServer = unknown,
  TServerToClient = TClientToServer,
> {
  send(data: TClientToServer): void;
  onMessage(callback: (data: TServerToClient) => void): void;
  onClose(callback: (event: CloseEvent) => void): void;
  close(code?: number, reason?: string): void;
  readonly readyState: 0 | 1 | 2 | 3;
}

/** Server-side socket passed to `$ws()` lifecycle handlers. */
export type ServerWs<
  TServerToClient = unknown,
  TConnectArgs extends unknown[] = unknown[],
> = ServerSugarWs<TServerToClient, TConnectArgs>;

/** Lifecycle handlers accepted by `$ws()`. */
export type WsHandlers<
  TClientToServer = unknown,
  TServerToClient = TClientToServer,
  TConnectArgs extends unknown[] = unknown[],
> = ServerSugarWsHandlers<TClientToServer, TServerToClient, TConnectArgs>;

/** Typed browser connection returned by `WsEndpoint.connect()`. */
export type WsConnection<
  TClientToServer = unknown,
  TServerToClient = TClientToServer,
> = ServerSugarWsConnection<TClientToServer, TServerToClient>;

export interface WsEndpoint<
  TClientToServer = unknown,
  TServerToClient = TClientToServer,
  TConnectArgs extends unknown[] = unknown[],
> {
  /** Client: opens a new connection to this endpoint. */
  connect(
    ...args: TConnectArgs
  ): WsConnection<TClientToServer, TServerToClient>;
  /** Server: broadcasts data to every open connection for this endpoint. */
  send(data: TServerToClient): void;
}

declare global {
  interface ServerWs<
    TServerToClient = unknown,
    TConnectArgs extends unknown[] = unknown[],
  > extends ServerSugarWs<TServerToClient, TConnectArgs> {}

  interface WsHandlers<
    TClientToServer = unknown,
    TServerToClient = TClientToServer,
    TConnectArgs extends unknown[] = unknown[],
  > extends ServerSugarWsHandlers<
      TClientToServer,
      TServerToClient,
      TConnectArgs
    > {}

  interface WsConnection<
    TClientToServer = unknown,
    TServerToClient = TClientToServer,
  > extends ServerSugarWsConnection<TClientToServer, TServerToClient> {}

  /**
   * Creates a typed WebSocket endpoint. Message types and connection argument
   * tuples are inferred from annotated handler parameters, or can be supplied
   * explicitly.
   *
   * @example
   * const chat = $ws<ClientMessage, ServerMessage, [token: string]>({
   *   onMessage(ws, message) { ws.send({ text: message.text }); },
   * });
   */
  function $ws<
    TClientToServer = unknown,
    TServerToClient = TClientToServer,
    TConnectArgs extends unknown[] = unknown[],
  >(
    handlers: WsHandlers<TClientToServer, TServerToClient, TConnectArgs>,
  ): WsEndpoint<TClientToServer, TServerToClient, TConnectArgs>;
}
