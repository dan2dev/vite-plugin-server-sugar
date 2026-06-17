export const API_PREFIX = "/__server-build/";
export const VIRTUAL_PREFIX = "virtual:server-build/server/";
export const RESOLVED_PREFIX = "\0virtual:server-build/server/";
export const VIRTUAL_FILE_PREFIX = "virtual:server-build/server-file/";
export const RESOLVED_FILE_PREFIX = "\0virtual:server-build/server-file/";
export const CLIENT_HELPER_ID = "virtual:server-build/server-fetch";
export const RESOLVED_CLIENT_HELPER_ID = "\0virtual:server-build/server-fetch";
export const CLIENT_FETCH_EXPORT = "__serverFetch";

export const WS_API_PREFIX = "/__server-build-ws/";
export const VIRTUAL_WS_PREFIX = "virtual:server-build/ws/";
export const RESOLVED_WS_PREFIX = "\0virtual:server-build/ws/";
// Note: $ws() handlers share the same per-file combined module as
// $server() handlers (VIRTUAL_FILE_PREFIX) so module-level state declared in
// a file is a single shared instance, not duplicated per handler kind.
export const CLIENT_WS_HELPER_ID = "virtual:server-build/ws-connect";
export const RESOLVED_CLIENT_WS_HELPER_ID =
  "\0virtual:server-build/ws-connect";
export const CLIENT_WS_CONNECT_EXPORT = "__wsConnect";

// Dev mode runs the per-file virtual module (which defines each ws()
// handler) and the Vite HTTP upgrade handler (dev-server/ws-upgrade.ts) as
// separate module instances. Both sides reach the same connection-tracking
// Map by storing it under this key on `globalThis` (lazily created by
// whichever side runs first) so `chat.send(...)` can broadcast to sockets
// registered by the upgrade handler. The production bundle is a single
// generated file, so it tracks connections with a plain top-level Map instead.
export const WS_RUNTIME_GLOBAL_KEY = "__server_build_ws_connections__";

export const VIRTUAL_WORKER_PREFIX = "virtual:server-build/worker/";
export const RESOLVED_WORKER_PREFIX = "\0virtual:server-build/worker/";
export const CLIENT_WORKER_HELPER_ID = "virtual:server-build/worker-invoke";
export const RESOLVED_CLIENT_WORKER_HELPER_ID = "\0virtual:server-build/worker-invoke";
export const CLIENT_WORKER_PROXY_EXPORT = "__workerCreateProxy";
