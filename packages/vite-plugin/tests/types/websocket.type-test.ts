/// <reference path="../../websocket.d.ts" />
import { describe, it, expectTypeOf } from 'vitest';

/**
 * Type tests for websocket type inference.
 * Validates: Requirements 10.3, 10.4, 10.5, 10.7
 */

describe('websocket type inference', () => {
  it('websocket() with ServerWebSocket<TServerToClient> infers matching onMessage callback type on client connection', () => {
    // Requirement 10.3: websocket() with handlers annotated with ServerWebSocket<TServerToClient>
    // infers connect() returns a WebSocketConnection with matching onMessage callback type

    interface ServerMessage {
      text: string;
      from: string;
    }

    interface ClientMessage {
      text: string;
    }

    const chat = websocket({
      onMessage(ws: ServerWebSocket<ServerMessage>, data: ClientMessage) {
        ws.send({ text: data.text, from: 'server' });
      },
    });

    const conn = chat.connect();

    // The onMessage callback should receive ServerMessage (TServerToClient)
    expectTypeOf(conn.onMessage).parameter(0).toEqualTypeOf<(data: ServerMessage) => void>();
  });

  it('onMessage handler typed data infers correct send() type on client connection', () => {
    // Requirement 10.4: onMessage handler with typed `data` parameter infers
    // send() on the client connection accepts that same type

    interface IncomingPayload {
      action: string;
      value: number;
    }

    interface OutgoingPayload {
      status: string;
      timestamp: number;
    }

    const endpoint = websocket({
      onMessage(ws: ServerWebSocket<OutgoingPayload>, data: IncomingPayload) {
        ws.send({ status: 'ok', timestamp: Date.now() });
      },
    });

    const connection = endpoint.connect();

    // Client send() should accept IncomingPayload (TClientToServer - the `data` type from onMessage)
    expectTypeOf(connection.send).toBeCallableWith({ action: 'test', value: 42 });
    expectTypeOf(connection.send).parameter(0).toEqualTypeOf<IncomingPayload>();
  });

  it('ws.args typed via ServerWebSocket<T, TConnectArgs> requires typed connect() arguments', () => {
    // Requirement 10.5: ServerWebSocket<T, TConnectArgs> types connect() to require those args

    interface BroadcastMsg {
      content: string;
    }

    type ConnectArgs = [token: string, roomId: number];

    const room = websocket({
      onOpen(ws: ServerWebSocket<BroadcastMsg, ConnectArgs>) {
        // ws.args should be typed as ConnectArgs
        const [token, roomId] = ws.args;
        expectTypeOf(token).toBeString();
        expectTypeOf(roomId).toBeNumber();
      },
      onMessage(ws: ServerWebSocket<BroadcastMsg, ConnectArgs>, data: string) {
        ws.send({ content: data });
      },
    });

    // connect() must accept the typed arguments
    expectTypeOf(room.connect).toBeCallableWith('my-token', 123);
    expectTypeOf(room.connect).parameters.toEqualTypeOf<ConnectArgs>();
  });

  it('WebSocketHandlers only accepts objects with onOpen/onMessage/onClose keys', () => {
    // Requirement 10.7: WebSocketHandlers interface only accepts objects
    // with onOpen, onMessage, or onClose method keys

    // Valid: all recognized handler keys
    websocket({
      onOpen(ws: ServerWebSocket) {},
      onMessage(ws: ServerWebSocket, data: unknown) {},
      onClose(ws: ServerWebSocket) {},
    });

    // Valid: subset of handler keys
    websocket({
      onMessage(ws: ServerWebSocket, data: string) {},
    });

    websocket({
      onOpen(ws: ServerWebSocket) {},
      onClose(ws: ServerWebSocket) {},
    });

    // @ts-expect-error - invalid handler key 'onError' should not be accepted
    websocket({
      onError(ws: ServerWebSocket) {},
    });

    // @ts-expect-error - invalid handler key 'onConnect' should not be accepted
    websocket({
      onConnect(ws: ServerWebSocket) {},
    });

    // @ts-expect-error - invalid handler key 'message' should not be accepted
    websocket({
      message(ws: ServerWebSocket, data: unknown) {},
    });
  });
});
