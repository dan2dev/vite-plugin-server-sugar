import type { Plugin } from "vite";

import { createServerBuildPlugin } from "./plugin";
import type { ServerBuildPluginOptions } from "./types";

export function serverBuildPlugin(
  options: ServerBuildPluginOptions = {},
): Plugin {
  return createServerBuildPlugin(options, "vite") as Plugin;
}

export default serverBuildPlugin;

export { createServerBuildPlugin } from "./plugin";
export type { ServerBuildPluginHost } from "./plugin";
export type { ServerBuildPluginOptions } from "./types";
