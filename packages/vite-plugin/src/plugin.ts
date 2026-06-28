import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { OutputOptions } from "rolldown";

import type { ServerBuildPluginOptions } from "./types";
import type { ServerEntry, WsEntry, WorkerEntry } from "./types";
import { Registry } from "./core/registry";
import { processFile } from "./core/processor";
import {
  invalidateServerFileModules,
  invalidateServerModules,
  invalidateWorkerModules,
  invalidateWsModules,
} from "./dev-server/hmr";
import {
  handleGeneratedServerRequest,
  loadServerApp,
  nodeRequestToWeb,
  requestUrl,
  writeWebResponse,
} from "./dev-server/middleware";
import {
  loadVirtualModule,
  resolveVirtualId,
} from "./dev-server/virtual-modules";
import { setupWsUpgrade } from "./dev-server/ws-upgrade";
import { generateBundleContent } from "./build/bundle-generator";
import { bundleServerSource, compileServer } from "./build/bundler";
import {
  RESOLVED_CLIENT_HELPER_ID,
  RESOLVED_CLIENT_HTTP_HELPER_ID,
  RESOLVED_CLIENT_WS_HELPER_ID,
  RESOLVED_CLIENT_WORKER_HELPER_ID,
  RESOLVED_FILE_PREFIX,
  RESOLVED_PREFIX,
  RESOLVED_WORKER_PREFIX,
  RESOLVED_WS_PREFIX,
  VIRTUAL_PREFIX,
  VIRTUAL_WORKER_PREFIX,
} from "./constants";
import { createEndpointPaths } from "./endpoint-paths";
import { normalizePath } from "./utils/path";

export type ServerBuildPluginHost = "vite" | "rollup" | "rolldown";

type PluginContext = {
  emitFile(file: { type: "chunk"; id: string; name?: string }): string;
  error(message: string): never;
};

type ViteConfigLike = {
  build?: { outDir?: string };
  server?: { port?: number };
};

type ViteResolvedConfigLike = {
  root: string;
  build: { outDir: string };
};

type ViteServerLike = any;

type UniversalPlugin = {
  name: string;
  config?: (config: ViteConfigLike, env: { command: "serve" | "build" }) => void;
  configResolved?: (resolvedConfig: ViteResolvedConfigLike) => void;
  buildStart?: (this: PluginContext) => void;
  resolveId?: (id: string) => string | null | undefined;
  load?: (id: string) => unknown;
  configureServer?: (server: ViteServerLike) => void;
  transform?: (code: string, id: string) => unknown;
  writeBundle?: (this: PluginContext, outputOptions?: OutputOptions) => Promise<void>;
};

export function createServerBuildPlugin(
  options: ServerBuildPluginOptions = {},
  host: ServerBuildPluginHost = "vite",
): UniversalPlugin {
  const port = options.port ?? 3001;
  const serverEntry = options.serverEntry;
  const compile = options.compile === true;
  const endpointPaths = createEndpointPaths(options.pathnameBase);
  const registry = new Registry<ServerEntry>();
  const wsRegistry = new Registry<WsEntry>();
  const workerRegistry = new Registry<WorkerEntry>();
  // Rolldown reference IDs for each worker chunk (populated in buildStart, build mode only)
  const workerReferenceIds = new Map<string, string>();
  let command: "serve" | "build" = host === "vite" ? "serve" : "build";

  let root = process.cwd();
  let distOutDir = resolve(root, "dist");
  let clientOutDir = resolve(distOutDir, "client");
  let serverOutDir = resolve(distOutDir, "server");
  let serverEntryPath: string | null = null;
  let hasViteResolvedConfig = false;

  function clientBuildOutDir(outDir: string): string {
    const normalized = normalizePath(outDir).replace(/\/+$/, "");
    if (normalized.endsWith("/client")) {
      return outDir;
    }

    return join(outDir, "client");
  }

  function cleanDistRoot(): void {
    const dist = resolve(distOutDir);
    const projectRoot = resolve(root);
    if (dist === projectRoot || !dist.startsWith(projectRoot + sep)) return;

    mkdirSync(dist, { recursive: true });
    for (const entry of readdirSync(dist, { withFileTypes: true })) {
      if (entry.name === "client" || entry.name === "server") continue;
      rmSync(join(dist, entry.name), { recursive: true, force: true });
    }
  }

  function shouldSkipDirectory(dir: string, name: string): boolean {
    const full = resolve(dir);
    return (
      name === "node_modules" ||
      name === ".git" ||
      full === distOutDir ||
      full.startsWith(distOutDir + sep)
    );
  }

  function scanDir(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !shouldSkipDirectory(full, entry.name)) {
        scanDir(full);
      } else if (
        entry.isFile() &&
        /\.([jt]sx?)$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        const code = readFileSync(full, "utf-8");
        processFile(code, full, {
          registry,
          wsRegistry,
          workerRegistry,
          root,
          emitWarnings: true,
          endpointPaths,
        });
      }
    }
  }

  const plugin: UniversalPlugin = {
    name: "vite-plugin-server-sugar",

    config: host === "vite"
      ? (config, { command: cmd }) => {
          command = cmd;
          const build = config.build ?? (config.build = {});
          build.outDir = clientBuildOutDir(build.outDir ?? "dist");

          if (command === "serve") {
            const devOptions = config.server ?? (config.server = {});
            devOptions.port ??= port;
          }
        }
      : undefined,

    configResolved: host === "vite"
      ? (resolvedConfig) => {
          hasViteResolvedConfig = true;
          root = resolvedConfig.root;
          clientOutDir = resolve(root, resolvedConfig.build.outDir);
          distOutDir = dirname(clientOutDir);
          serverOutDir = resolve(distOutDir, "server");
          serverEntryPath = serverEntry ? resolve(root, serverEntry) : null;
        }
      : undefined,

    buildStart() {
      registry.clear();
      wsRegistry.clear();
      workerRegistry.clear();
      workerReferenceIds.clear();
      scanDir(root);
      if (registry.size > 0) {
        console.log(
          `[server-build] Registered ${registry.size} $server endpoints.`,
        );
      }
      if (wsRegistry.size > 0) {
        console.log(
          `[server-build] Registered ${wsRegistry.size} $ws endpoints.`,
        );
      }
      if (workerRegistry.size > 0) {
        console.log(
          `[server-build] Registered ${workerRegistry.size} $worker endpoints.`,
        );
        if (command === "build") {
          for (const entry of workerRegistry.values()) {
            const refId = this.emitFile({
              type: "chunk",
              id: VIRTUAL_WORKER_PREFIX + entry.endpoint,
              name: entry.endpoint.replace(/\//g, "-") + "-worker",
            });
            workerReferenceIds.set(entry.endpoint, refId);
          }
        }
      }
    },

    resolveId(id) {
      return resolveVirtualId(id);
    },

    load(id) {
      return loadVirtualModule(id, registry, wsRegistry, workerRegistry);
    },

    configureServer: host === "vite"
      ? (server) => {
      scanDir(server.config.root);
      if (registry.size > 0) {
        console.log(
          `[server-build] Dev server ready with ${registry.size} endpoints.`,
        );
      }
      if (wsRegistry.size > 0) {
        console.log(
          `[server-build] Dev server ready with ${wsRegistry.size} $ws endpoints.`,
        );
      }
      if (workerRegistry.size > 0) {
        console.log(
          `[server-build] Dev server ready with ${workerRegistry.size} $worker endpoints.`,
        );
      }

      setupWsUpgrade(server, wsRegistry, endpointPaths.wsPrefix);

      if (serverEntry) {
        // Track Hono app instances that have already been augmented with
        // server routes so we don't re-register on every request. When HMR
        // invalidates the server entry, a new app instance is created and
        // routes are re-registered automatically.
        const augmentedApps = new WeakSet<object>();

        server.middlewares.use(async (req: any, res: any, next: any) => {
          try {
            const app = await loadServerApp(
              server,
              serverEntry,
              serverEntryPath,
            );
            if (!app) return next();

            // Dynamically register server routes on the user's Hono app so
            // that user-defined middleware (e.g. app.all("*", ...)) also runs
            // for server requests, matching the production build behaviour.
            if (!augmentedApps.has(app as object)) {
              augmentedApps.add(app as object);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const hono = app as any;

              hono.all(`${endpointPaths.apiPrefix}*`, async (c: any) => {
                const url = new URL(c.req.url);
                let endpoint: string;
                try {
                  endpoint = decodeURIComponent(
                    url.pathname.slice(endpointPaths.apiPrefix.length),
                  );
                } catch {
                  return c.json({ error: "Bad request" }, 400);
                }

                const entry = registry.get(endpoint);
                if (!entry) {
                  return c.json(
                    {
                      error: `No server handler registered: '${endpoint}'`,
                    },
                    404,
                  );
                }

                const expectedMethod = entry.httpMethod ?? "POST";
                if (c.req.method !== expectedMethod) {
                  return c.json({ error: "Method not allowed" }, 405, {
                    Allow: expectedMethod,
                  });
                }

                try {
                  const mod = await server.ssrLoadModule(
                    VIRTUAL_PREFIX + endpoint,
                  );
                  const fn = mod.default as (...args: unknown[]) => unknown;

                  let result: unknown;
                  if (entry.httpMethod) {
                    result = await fn(c);
                  } else {
                    const contentType = c.req.header("content-type");
                    if (
                      contentType &&
                      !contentType.toLowerCase().includes("application/json")
                    ) {
                      return c.json({ error: "Unsupported media type" }, 415);
                    }

                    const rawBody = await c.req.text();
                    const body = rawBody.trim();
                    const payload = body ? JSON.parse(body) : [];
                    const args = Array.isArray(payload) ? payload : [payload];
                    result = await fn(...args);
                  }

                  if (result instanceof Response) {
                    return result;
                  }
                  if (result === undefined) {
                    return c.body(null, 204);
                  }
                  return c.json(result);
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  console.error(
                    `[server-build] Error in handler '${endpoint}': ${msg}`,
                  );
                  return c.json({ error: msg }, 500);
                }
              });
            }

            const webRequest = await nodeRequestToWeb(req);
            const pathname = new URL(webRequest.url).pathname;
            const response = await app.fetch(webRequest);

            // For server API paths the Hono app is the authority;
            // always write its response (including 404s).  For other
            // paths, a 404 means Hono didn't handle the request so we
            // fall through to Vite's internal middleware (source files,
            // HMR, etc.).
            if (
              response.status === 404 &&
              !pathname.startsWith(endpointPaths.apiPrefix)
            ) {
              return next();
            }

            await writeWebResponse(res, response);
          } catch (e) {
            if (e instanceof Error) server.ssrFixStacktrace(e);
            const msg = e instanceof Error ? e.message : String(e);
            res.writeHead(500, {
              "Content-Type": "text/plain; charset=utf-8",
            });
            res.end(msg);
          }
        });
      } else {
        // No server entry: handle server requests directly in middleware
        // (no user Hono app to route them through).
        server.middlewares.use(async (req: any, res: any, next: any) => {
          const pathname = requestUrl(req).pathname;
          if (!pathname.startsWith(endpointPaths.apiPrefix)) return next();

          let endpoint: string;
          try {
            endpoint = decodeURIComponent(
              pathname.slice(endpointPaths.apiPrefix.length),
            );
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Bad request" }));
            return;
          }

          await handleGeneratedServerRequest(
            server,
            req,
            res,
            endpoint,
            registry,
          );
        });
      }

      server.watcher.on("change", (file: string) => {
        if (/\.([jt]sx?)$/.test(file) && !file.endsWith(".d.ts")) {
          const previousEndpoints = registry.getEndpointsForFile(file);
          const previousWsEndpoints = wsRegistry.getEndpointsForFile(file);
          const previousWorkerEndpoints = workerRegistry.getEndpointsForFile(file);
          try {
            const code = readFileSync(file, "utf-8");
            processFile(code, file, {
              registry,
              wsRegistry,
              workerRegistry,
              root,
              emitWarnings: true,
              endpointPaths,
            });
            invalidateServerModules(server, [
              ...previousEndpoints,
              ...registry.getEndpointsForFile(file),
            ]);
            invalidateWsModules(server, [
              ...previousWsEndpoints,
              ...wsRegistry.getEndpointsForFile(file),
            ]);
            invalidateWorkerModules(server, [
              ...previousWorkerEndpoints,
              ...workerRegistry.getEndpointsForFile(file),
            ]);
            invalidateServerFileModules(server, [file]);
          } catch {
            registry.unregisterFile(file);
            wsRegistry.unregisterFile(file);
            workerRegistry.unregisterFile(file);
            invalidateServerModules(server, previousEndpoints);
            invalidateWsModules(server, previousWsEndpoints);
            invalidateWorkerModules(server, previousWorkerEndpoints);
            invalidateServerFileModules(server, [file]);
          }
        }
      });

      server.watcher.on("unlink", (file: string) => {
        const previousEndpoints = registry.getEndpointsForFile(file);
        const previousWsEndpoints = wsRegistry.getEndpointsForFile(file);
        const previousWorkerEndpoints = workerRegistry.getEndpointsForFile(file);
        registry.unregisterFile(file);
        wsRegistry.unregisterFile(file);
        workerRegistry.unregisterFile(file);
        invalidateServerModules(server, previousEndpoints);
        invalidateWsModules(server, previousWsEndpoints);
        invalidateWorkerModules(server, previousWorkerEndpoints);
        invalidateServerFileModules(server, [file]);
      });
    }
      : undefined,

    transform(code, id) {
      const cleanId = id.split("?")[0];
      if (
        cleanId.includes("node_modules") ||
        cleanId.startsWith(RESOLVED_PREFIX) ||
        cleanId.startsWith(RESOLVED_WS_PREFIX) ||
        cleanId.startsWith(RESOLVED_WORKER_PREFIX) ||
        cleanId.startsWith(RESOLVED_FILE_PREFIX) ||
        cleanId === RESOLVED_CLIENT_HELPER_ID ||
        cleanId === RESOLVED_CLIENT_HTTP_HELPER_ID ||
        cleanId === RESOLVED_CLIENT_WS_HELPER_ID ||
        cleanId === RESOLVED_CLIENT_WORKER_HELPER_ID
      ) {
        return null;
      }

      return processFile(code, id, {
        registry,
        wsRegistry,
        workerRegistry,
        workerReferenceIds: command === "build" ? workerReferenceIds : undefined,
        root,
        endpointPaths,
      });
    },

    async writeBundle(outputOptions?: OutputOptions) {
      if (!hasViteResolvedConfig && command === "build") {
        const outputDir = outputOptions?.dir ?? (outputOptions?.file ? dirname(outputOptions.file) : "dist");
        clientOutDir = resolve(root, outputDir);
        const normalizedClientOutDir = normalizePath(clientOutDir).replace(/\/+$/, "");
        distOutDir = normalizedClientOutDir.endsWith("/client")
          ? dirname(clientOutDir)
          : clientOutDir;
        serverOutDir = resolve(distOutDir, "server");
        serverEntryPath = serverEntry ? resolve(root, serverEntry) : null;
      }

      if (normalizePath(clientOutDir).replace(/\/+$/, "").endsWith("/client")) {
        cleanDistRoot();
      }
      rmSync(serverOutDir, { recursive: true, force: true });

      const content = generateBundleContent(
        registry,
        serverEntry,
        serverEntryPath,
        serverOutDir,
        clientOutDir,
        port,
        wsRegistry,
        endpointPaths,
      );
      if (!content) return;

      const serverSource = await bundleServerSource(
        content,
        serverOutDir,
        root,
      );
      console.log(
        `[server-build] Wrote production server to ${normalizePath(relative(root, serverSource))}.`,
      );

      if (compile) {
        try {
          const outfiles = await compileServer(serverSource, serverOutDir);
          const relativeOutfiles = outfiles
            .map((outfile) => normalizePath(relative(root, outfile)))
            .join(", ");
          console.log(
            `[server-build] Compiled production server for ${outfiles.length} targets: ${relativeOutfiles}.`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.error(
            `[server-build] Failed to compile the production server: ${msg}`,
          );
        }
      }
    },
  };

  for (const key of Object.keys(plugin) as Array<keyof UniversalPlugin>) {
    if (plugin[key] === undefined) delete plugin[key];
  }

  return plugin;
}

export type { ServerBuildPluginOptions } from "./types";
