import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Plugin, ViteDevServer } from "vite";

import type { ServerBuildPluginOptions } from "./types";
import { Registry } from "./core/registry";
import { processFile } from "./core/processor";
import {
  invalidateBackendFileModules,
  invalidateBackendModules,
} from "./dev-server/hmr";
import {
  handleGeneratedBackendRequest,
  loadServerApp,
  nodeRequestToWeb,
  requestUrl,
  writeWebResponse,
} from "./dev-server/middleware";
import {
  loadVirtualModule,
  resolveVirtualId,
} from "./dev-server/virtual-modules";
import { generateBundleContent } from "./build/bundle-generator";
import { bundleServerSource, compileServer } from "./build/bundler";
import {
  API_PREFIX,
  RESOLVED_CLIENT_HELPER_ID,
  RESOLVED_FILE_PREFIX,
  RESOLVED_PREFIX,
} from "./constants";
import { normalizePath } from "./utils/path";

export function serverBuildPlugin(
  options: ServerBuildPluginOptions = {},
): Plugin {
  const port = options.port ?? 3001;
  const serverEntry = options.serverEntry;
  const compile = options.compile === true;
  const registry = new Registry();

  let root = process.cwd();
  let distOutDir = resolve(root, "dist");
  let clientOutDir = resolve(distOutDir, "client");
  let serverOutDir = resolve(distOutDir, "server");
  let serverEntryPath: string | null = null;

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
        /\.(tsx?)$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        const code = readFileSync(full, "utf-8");
        processFile(code, full, { registry, root, emitWarnings: true });
      }
    }
  }

  return {
    name: "vite-plugin-server-build",

    config(config, { command }) {
      const build = config.build ?? (config.build = {});
      build.outDir = clientBuildOutDir(build.outDir ?? "dist");

      if (command === "serve") {
        const devOptions = config.server ?? (config.server = {});
        devOptions.port ??= port;
      }
    },

    configResolved(resolvedConfig) {
      root = resolvedConfig.root;
      clientOutDir = resolve(root, resolvedConfig.build.outDir);
      distOutDir = dirname(clientOutDir);
      serverOutDir = resolve(distOutDir, "server");
      serverEntryPath = serverEntry ? resolve(root, serverEntry) : null;
    },

    buildStart() {
      registry.clear();
      scanDir(root);
      if (registry.size > 0) {
        console.log(
          `[server-build] Registered ${registry.size} backend endpoints.`,
        );
      }
    },

    resolveId(id) {
      return resolveVirtualId(id);
    },

    load(id) {
      return loadVirtualModule(id, registry);
    },

    configureServer(server: ViteDevServer) {
      scanDir(server.config.root);
      if (registry.size > 0) {
        console.log(
          `[server-build] Dev server ready with ${registry.size} endpoints.`,
        );
      }

      server.middlewares.use(async (req, res, next) => {
        const pathname = requestUrl(req).pathname;
        if (!pathname.startsWith(API_PREFIX)) return next();

        let endpoint: string;
        try {
          endpoint = decodeURIComponent(pathname.slice(API_PREFIX.length));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad request" }));
          return;
        }

        await handleGeneratedBackendRequest(
          server,
          req,
          res,
          endpoint,
          registry,
        );
      });

      if (serverEntry) {
        server.middlewares.use(async (req, res, next) => {
          try {
            const app = await loadServerApp(
              server,
              serverEntry,
              serverEntryPath,
            );
            if (!app) return next();

            const response = await app.fetch(await nodeRequestToWeb(req));
            if (response.status === 404) return next();

            await writeWebResponse(res, response);
          } catch (e) {
            if (e instanceof Error) server.ssrFixStacktrace(e);
            const msg = e instanceof Error ? e.message : String(e);
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(msg);
          }
        });
      }

      server.watcher.on("change", (file) => {
        if (/\.(tsx?)$/.test(file) && !file.endsWith(".d.ts")) {
          const previousEndpoints = registry.getEndpointsForFile(file);
          try {
            const code = readFileSync(file, "utf-8");
            processFile(code, file, { registry, root, emitWarnings: true });
            invalidateBackendModules(server, [
              ...previousEndpoints,
              ...registry.getEndpointsForFile(file),
            ]);
            invalidateBackendFileModules(server, [file]);
          } catch {
            registry.unregisterFile(file);
            invalidateBackendModules(server, previousEndpoints);
            invalidateBackendFileModules(server, [file]);
          }
        }
      });

      server.watcher.on("unlink", (file) => {
        const previousEndpoints = registry.getEndpointsForFile(file);
        registry.unregisterFile(file);
        invalidateBackendModules(server, previousEndpoints);
        invalidateBackendFileModules(server, [file]);
      });
    },

    transform(code, id) {
      if (
        id.includes("node_modules") ||
        id.startsWith(RESOLVED_PREFIX) ||
        id.startsWith(RESOLVED_FILE_PREFIX) ||
        id === RESOLVED_CLIENT_HELPER_ID
      ) {
        return null;
      }

      return processFile(code, id, { registry, root });
    },

    async writeBundle() {
      cleanDistRoot();
      rmSync(serverOutDir, { recursive: true, force: true });

      const content = generateBundleContent(
        registry,
        serverEntry,
        serverEntryPath,
        serverOutDir,
        clientOutDir,
        port,
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
}

export type { ServerBuildPluginOptions } from "./types";
