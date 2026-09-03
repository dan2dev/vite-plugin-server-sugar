/// <reference path="../../types.d.ts" />
import { describe, expectTypeOf, it } from 'vitest';
import type {} from 'vite-plugin-server-sugar/types';
import type {
  BodyServerFunction,
  QueryServerFunction,
  ServerContext,
  ServerFunction,
} from 'vite-plugin-server-sugar/server';
import type {
  ServerWs,
  WsConnection,
  WsEndpoint,
} from 'vite-plugin-server-sugar/ws';
import type {
  WorkerClient,
  WorkerMethods,
} from 'vite-plugin-server-sugar/worker';
import type {
  ServerContext as UnifiedServerContext,
  WorkerClient as UnifiedWorkerClient,
  WsEndpoint as UnifiedWsEndpoint,
} from 'vite-plugin-server-sugar/types';

describe('published type entrypoints', () => {
  it('resolves the unified ambient entrypoint', () => {
    expectTypeOf($server).toBeFunction();
    expectTypeOf($get).toBeFunction();
    expectTypeOf($ws).toBeFunction();
    expectTypeOf($worker).toBeFunction();
  });

  it('exports reusable server, websocket, and worker types', () => {
    expectTypeOf<ServerContext>().toBeObject();
    expectTypeOf<ServerFunction>().toBeFunction();
    expectTypeOf<QueryServerFunction<Record<string, string>, unknown>>().toBeFunction();
    expectTypeOf<BodyServerFunction<unknown, Record<string, string>, unknown>>().toBeFunction();
    expectTypeOf<ServerWs>().toBeObject();
    expectTypeOf<WsConnection>().toBeObject();
    expectTypeOf<WsEndpoint>().toBeObject();
    expectTypeOf<WorkerMethods<{ run(): void }>>().toBeObject();
    expectTypeOf<WorkerClient<{ run(): void }>>().toBeObject();
    expectTypeOf<UnifiedServerContext>().toEqualTypeOf<ServerContext>();
    expectTypeOf<UnifiedWsEndpoint>().toEqualTypeOf<WsEndpoint>();
    expectTypeOf<UnifiedWorkerClient<{ run(): void }>>().toEqualTypeOf<
      WorkerClient<{ run(): void }>
    >();
  });
});
