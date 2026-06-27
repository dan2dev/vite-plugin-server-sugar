import { createServerBuildPlugin } from "./plugin";
import type { ServerBuildPluginOptions } from "./types";

/**
 * Build-only Rollup entrypoint.
 *
 * The Vite entrypoint remains the primary integration and includes dev-server
 * middleware/HMR. This Rollup variant exposes the shared build hooks for users
 * who bundle the client with Rollup and want the generated Bun server output.
 */
export function serverBuildRollupPlugin(
  options: ServerBuildPluginOptions = {},
) {
  return createServerBuildPlugin(options, "rollup");
}

export default serverBuildRollupPlugin;
export type { ServerBuildPluginOptions };
