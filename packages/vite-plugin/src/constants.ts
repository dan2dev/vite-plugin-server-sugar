export const API_PREFIX = "/__server-build/";
export const VIRTUAL_PREFIX = "virtual:server-build/backend/";
export const RESOLVED_PREFIX = "\0virtual:server-build/backend/";
export const VIRTUAL_FILE_PREFIX = "virtual:server-build/backend-file/";
export const RESOLVED_FILE_PREFIX = "\0virtual:server-build/backend-file/";
export const CLIENT_HELPER_ID = "virtual:server-build/backend-fetch";
export const RESOLVED_CLIENT_HELPER_ID = "\0virtual:server-build/backend-fetch";
export const CLIENT_FETCH_EXPORT = "__backendFetch";

export const WS_API_PREFIX = "/__server-build-ws/";
export const VIRTUAL_WS_PREFIX = "virtual:server-build/websocket/";
export const RESOLVED_WS_PREFIX = "\0virtual:server-build/websocket/";
// Note: websocket() handlers share the same per-file combined module as
// backend() handlers (VIRTUAL_FILE_PREFIX) so module-level state declared in
// a file is a single shared instance, not duplicated per handler kind.
export const CLIENT_WS_HELPER_ID = "virtual:server-build/websocket-connect";
export const RESOLVED_CLIENT_WS_HELPER_ID =
  "\0virtual:server-build/websocket-connect";
export const CLIENT_WS_CONNECT_EXPORT = "__websocketConnect";

// Dev mode runs the per-file virtual module (which defines each websocket()
// handler) and the Vite HTTP upgrade handler (dev-server/ws-upgrade.ts) as
// separate module instances. Both sides reach the same connection-tracking
// Map by storing it under this key on `globalThis` (lazily created by
// whichever side runs first) so `chat.send(...)` can broadcast to sockets
// registered by the upgrade handler. The production bundle is a single
// generated file, so it tracks connections with a plain top-level Map instead.
export const WS_RUNTIME_GLOBAL_KEY = "__server_build_ws_connections__";
