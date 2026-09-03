import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hash } from "../utils/crypto";

const MAX_WORKER_NAME_LENGTH = 63;

function sanitizeWorkerNameSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Best-effort project name for generated `wrangler.toml` files, derived from
 * the nearest `package.json` `name` field and sanitized to a valid Cloudflare
 * Worker name (`[a-z0-9-]`). Falls back to a generic default when
 * `package.json` is missing, unreadable, or has no usable `name`.
 */
export function resolveProjectName(root: string): string {
  try {
    const raw = readFileSync(join(root, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { name?: unknown };
    if (typeof pkg.name === "string") {
      const sanitized = sanitizeWorkerNameSegment(pkg.name);
      if (sanitized) return sanitized;
    }
  } catch {
    // Missing, unreadable, or invalid package.json: fall through to the default.
  }
  return "server-build";
}

/**
 * Derives a short, filesystem- and Worker-name-safe slug for a group of
 * endpoints served by one independent Worker. Endpoint names are already
 * unique per registry, so the joined slug is unique too; long joins fall
 * back to a truncated form with a stable hash suffix.
 */
export function slugForEndpoints(endpoints: string[]): string {
  const raw = sanitizeWorkerNameSegment(
    endpoints.map((e) => e.replace(/\//g, "-")).join("_"),
  );
  if (raw.length > 0 && raw.length <= 48) return raw;
  const base = raw || "handler";
  return `${base.slice(0, 40)}-${hash(endpoints.join("|"))}`;
}

/** Combines a base name with an optional suffix, keeping the result within Cloudflare's Worker name length limit. */
export function workerName(base: string, suffix?: string): string {
  const full = suffix ? `${base}-${suffix}` : base;
  const sanitized = sanitizeWorkerNameSegment(full) || "server-build";
  if (sanitized.length <= MAX_WORKER_NAME_LENGTH) return sanitized;
  return `${sanitized.slice(0, MAX_WORKER_NAME_LENGTH - 9)}-${hash(full)}`;
}

/** Today's date as `YYYY-MM-DD`, the format Cloudflare requires for `compatibility_date`. */
export function todayCompatibilityDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export interface AggregateWranglerConfigOptions {
  name: string;
  /** Worker entry file, relative to the generated `wrangler.toml`. */
  main: string;
  /** Client build directory Cloudflare should serve as static assets, relative to the generated `wrangler.toml`. */
  assetsDirectory: string;
  /** Generated API prefix, e.g. `/__server-build/`. */
  apiPrefix: string;
  compatibilityDate: string;
}

/**
 * Generates the `wrangler.toml` for the combined Worker: static assets are
 * served directly by Cloudflare (with SPA fallback to `index.html`), and the
 * Worker only runs for the generated API prefix.
 */
export function generateAggregateWranglerConfig(
  options: AggregateWranglerConfigOptions,
): string {
  const apiGlob = `${options.apiPrefix}*`;
  return [
    `name = ${tomlString(options.name)}`,
    `main = ${tomlString(options.main)}`,
    `compatibility_date = ${tomlString(options.compatibilityDate)}`,
    "",
    "# Cloudflare serves files under `directory` directly and falls back to",
    "# index.html for unmatched GET requests (single-page-application mode).",
    "# The Worker itself only runs for the generated API prefix below.",
    "[assets]",
    `directory = ${tomlString(options.assetsDirectory)}`,
    `binding = "ASSETS"`,
    `not_found_handling = "single-page-application"`,
    `run_worker_first = [${tomlString(apiGlob)}]`,
    "",
  ].join("\n");
}

export interface FunctionWranglerConfigOptions {
  name: string;
  /** Worker entry file, relative to the generated `wrangler.toml`. */
  main: string;
  compatibilityDate: string;
}

/**
 * Generates the `wrangler.toml` for an independent per-function Worker: a
 * pure API Worker with no assets binding of its own.
 */
export function generateFunctionWranglerConfig(
  options: FunctionWranglerConfigOptions,
): string {
  return [
    `name = ${tomlString(options.name)}`,
    `main = ${tomlString(options.main)}`,
    `compatibility_date = ${tomlString(options.compatibilityDate)}`,
    "",
  ].join("\n");
}
