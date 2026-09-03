import type { ServerBuildPlatform, ServerBuildPluginOptions } from "../types";

const VALID_PLATFORMS: ReadonlySet<ServerBuildPlatform> = new Set([
  "hono",
  "cloudflare-worker",
]);

/**
 * Validates and resolves the `platform` option, failing fast with a
 * descriptive error for unknown values or unsupported option combinations.
 *
 * Called at plugin-creation time (before any file scanning) so misconfiguration
 * surfaces as soon as the user's Vite config is evaluated, not mid-build.
 */
export function resolvePlatform(
  options: Pick<ServerBuildPluginOptions, "platform" | "compile">,
): ServerBuildPlatform {
  const platform = options.platform ?? "hono";

  if (!VALID_PLATFORMS.has(platform)) {
    const valid = [...VALID_PLATFORMS].map((p) => `"${p}"`).join(" | ");
    throw new Error(
      `[server-build] Invalid platform "${platform}". Expected one of: ${valid}.`,
    );
  }

  if (platform === "cloudflare-worker" && options.compile === true) {
    throw new Error(
      '[server-build] "compile" produces standalone Bun executables and is only supported with platform: "hono". Remove "compile" or switch platform to "hono".',
    );
  }

  return platform;
}
