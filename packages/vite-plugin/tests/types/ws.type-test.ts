/// <reference path="../../ws.d.ts" />
import { describe, it, expectTypeOf } from 'vitest';

/**
 * Type tests for ws type inference.
 * Validates: Requirements 10.3, 10.4, 10.5, 10.7
 */

describe('ws type inference', () => {
  it('$ws() with ServerWs<TServerToClient> infers matching onMessage callback type on client connection', () => {
    // Requirement 10.3: $ws() with handlers annotated with ServerWs<TServerToClient>
    // infers connect() returns a WsConnection with matching onMessage callback type

    interface ServerMessage {
      text: string;
      from: string;
    }

    interface ClientMessage {
      text: string;
    }

    const chat = $ws({
      onMessage(ws: ServerWs<ServerMessage>, data: ClientMessage) {
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
      server: string;
      value: number;
    }

    interface OutgoingPayload {
      status: string;
      timestamp: number;
    }

    const endpoint = $ws({
      onMessage(ws: ServerWs<OutgoingPayload>, data: IncomingPayload) {
        ws.send({ status: 'ok', timestamp: Date.now() });
      },
    });

    const connection = endpoint.connect();

    // Client send() should accept IncomingPayload (TClientToServer - the `data` type from onMessage)
    expectTypeOf(connection.send).toBeCallableWith({ server: 'test', value: 42 });
    expectTypeOf(connection.send).parameter(0).toEqualTypeOf<IncomingPayload>();
  });

  it('ws.args typed via ServerWs<T, TConnectArgs> requires typed connect() arguments', () => {
    // Requirement 10.5: ServerWs<T, TConnectArgs> types connect() to require those args

    interface BroadcastMsg {
      content: string;
    }

    type ConnectArgs = [token: string, roomId: number];

    const room = $ws({
      onOpen(ws: ServerWs<BroadcastMsg, ConnectArgs>) {
        // ws.args should be typed as ConnectArgs
        const [token, roomId] = ws.args;
        expectTypeOf(token).toBeString();
        expectTypeOf(roomId).toBeNumber();
      },
      onMessage(ws: ServerWs<BroadcastMsg, ConnectArgs>, data: string) {
        ws.send({ content: data });
      },
    });

    // connect() must accept the typed arguments
    expectTypeOf(room.connect).toBeCallableWith('my-token', 123);
    expectTypeOf(room.connect).parameters.toEqualTypeOf<ConnectArgs>();
  });

  it('WsHandlers only accepts objects with onOpen/onMessage/onClose keys', () => {
    // Requirement 10.7: WsHandlers interface only accepts objects
    // with onOpen, onMessage, or onClose method keys

    // Valid: all recognized handler keys
    $ws({
      onOpen(ws: ServerWs) {},
      onMessage(ws: ServerWs, data: unknown) {},
      onClose(ws: ServerWs) {},
    });

    // Valid: subset of handler keys
    $ws({
      onMessage(ws: ServerWs, data: string) {},
    });

    $ws({
      onOpen(ws: ServerWs) {},
      onClose(ws: ServerWs) {},
    });

    // @ts-expect-error - invalid handler key 'onError' should not be accepted
    $ws({
      onError(ws: ServerWs) {},
    });

    // @ts-expect-error - invalid handler key 'onConnect' should not be accepted
    $ws({
      onConnect(ws: ServerWs) {},
    });

    // @ts-expect-error - invalid handler key 'message' should not be accepted
    $ws({
      message(ws: ServerWs, data: unknown) {},
    });
  });
});
