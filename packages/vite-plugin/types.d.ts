/// <reference path="./server.d.ts" />
/// <reference path="./ws.d.ts" />
/// <reference path="./worker.d.ts" />

/**
 * Loads all vite-plugin-server-sugar macro globals from one TypeScript
 * `compilerOptions.types` entry and re-exports their reusable helper types.
 */
export type {
  Awaitable,
  BodyServerFunction,
  FetchOptions,
  QueryServerFunction,
  ServerContext,
  ServerContextRequest,
  ServerFunction,
  ServerQueryShape,
  ServerQueryValue,
  UntypedServerQuery,
} from "./server.js";
export type {
  ServerWs,
  WsConnection,
  WsEndpoint,
  WsHandlers,
} from "./ws.js";
export type { WorkerClient, WorkerMethods } from "./worker.js";
