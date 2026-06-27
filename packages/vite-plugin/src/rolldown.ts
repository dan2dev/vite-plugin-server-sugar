import { createServerBuildPlugin } from "./plugin";
import type { ServerBuildPluginOptions } from "./types";

/**
 * Build-only Rolldown entrypoint.
 *
 * The Vite entrypoint remains the primary integration and includes dev-server
 * middleware/HMR. This Rolldown variant exposes the shared build hooks for users
 * who bundle the client with Rolldown directly.
 */
export function serverBuildRolldownPlugin(
  options: ServerBuildPluginOptions = {},
) {
  return createServerBuildPlugin(options, "rolldown");
}

export default serverBuildRolldownPlugin;
export type { ServerBuildPluginOptions };
