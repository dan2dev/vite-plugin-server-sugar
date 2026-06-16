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
