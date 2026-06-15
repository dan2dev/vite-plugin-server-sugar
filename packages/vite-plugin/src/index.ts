import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

import type { ServerBuildPluginOptions } from './types';
import { Registry } from './core/registry';
import { processFile } from './core/processor';
import { requestUrl } from './dev-server/middleware';
import { invalidateBackendModules } from './dev-server/hmr';
import { BunDevServer } from './dev-server/bun-dev-server';
import { loadVirtualModule, resolveVirtualId } from './dev-server/virtual-modules';
import { generateBundleContent } from './build/bundle-generator';
import { compileServer, writeServerSource } from './build/bundler';
import { API_PREFIX, RESOLVED_CLIENT_HELPER_ID, RESOLVED_PREFIX } from './constants';
import { normalizePath } from './utils/path';

export function serverBuildPlugin(options: ServerBuildPluginOptions = {}): Plugin {
  const port = options.port ?? 3001;
  const serverEntry = options.serverEntry;
  const compile = options.compile === true;
  const registry = new Registry();

  let root = process.cwd();
  let distOutDir = resolve(root, 'dist');
  let clientOutDir = resolve(distOutDir, 'client');
  let serverOutDir = resolve(distOutDir, 'server');
  let serverEntryPath: string | null = null;

  function clientBuildOutDir(outDir: string): string {
    const normalized = normalizePath(outDir).replace(/\/+$/, '');
    if (normalized.endsWith('/client')) {
      return outDir;
    }

    return join(outDir, 'client');
  }

  function cleanDistRoot(): void {
    const dist = resolve(distOutDir);
    const projectRoot = resolve(root);
    if (dist === projectRoot || !dist.startsWith(projectRoot + sep)) return;

    mkdirSync(dist, { recursive: true });
    for (const entry of readdirSync(dist, { withFileTypes: true })) {
      if (entry.name === 'client' || entry.name === 'server') continue;
      rmSync(join(dist, entry.name), { recursive: true, force: true });
    }
  }

  function shouldSkipDirectory(dir: string, name: string): boolean {
    const full = resolve(dir);
    return (
      name === 'node_modules' ||
      name === '.git' ||
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
        !entry.name.endsWith('.d.ts')
      ) {
        const code = readFileSync(full, 'utf-8');
        processFile(code, full, { registry, root, emitWarnings: true });
      }
    }
  }

  return {
    name: 'vite-plugin-server-build',

    config(config) {
      const build = config.build ?? (config.build = {});
      build.outDir = clientBuildOutDir(build.outDir ?? 'dist');
    },

    configResolved(resolvedConfig) {
      root = resolvedConfig.root;
      clientOutDir = resolve(root, resolvedConfig.build.outDir);
      distOutDir = dirname(clientOutDir);
      serverOutDir = resolve(distOutDir, 'server');
      serverEntryPath = serverEntry ? resolve(root, serverEntry) : null;
    },

    buildStart() {
      registry.clear();
      scanDir(root);
      if (registry.size > 0) {
        console.log(`[server-build] Registered ${registry.size} backend endpoints.`);
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
        console.log(`[server-build] Dev server ready with ${registry.size} endpoints.`);
      }

      const cacheDir = resolve(root, 'node_modules', '.cache', 'server-build');
      const bunDevServer = new BunDevServer(port, serverEntryPath, cacheDir);

      if (registry.size > 0 || serverEntryPath) {
        bunDevServer.start(registry);
        server.httpServer?.on('close', () => bunDevServer.stop());
      }

      server.watcher.on('change', (file) => {
        if (/\.(tsx?)$/.test(file) && !file.endsWith('.d.ts')) {
          const previousEndpoints = registry.getEndpointsForFile(file);
          try {
            const code = readFileSync(file, 'utf-8');
            processFile(code, file, { registry, root, emitWarnings: true });
            invalidateBackendModules(server, [
              ...previousEndpoints,
              ...registry.getEndpointsForFile(file),
            ]);
          } catch {
            registry.unregisterFile(file);
            invalidateBackendModules(server, previousEndpoints);
          }
          bunDevServer.restart(registry);
        }
      });

      server.watcher.on('unlink', (file) => {
        const previousEndpoints = registry.getEndpointsForFile(file);
        registry.unregisterFile(file);
        invalidateBackendModules(server, previousEndpoints);
        bunDevServer.restart(registry);
      });

      server.middlewares.use(async (req, res, next) => {
        const pathname = requestUrl(req).pathname;
        if (!pathname.startsWith(API_PREFIX)) return next();
        try {
          await bunDevServer.proxy(req, res);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Backend unavailable: ' + msg }));
        }
      });

      if (serverEntry) {
        server.middlewares.use(async (req, res, next) => {
          try {
            await bunDevServer.proxyOrNext(req, res, next);
          } catch {
            next();
          }
        });
      }
    },

    transform(code, id) {
      if (
        id.includes('node_modules') ||
        id.startsWith(RESOLVED_PREFIX) ||
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

      const serverSource = writeServerSource(content, serverOutDir);
      console.log(`[server-build] Wrote production server to ${normalizePath(relative(root, serverSource))}.`);

      if (compile) {
        try {
          const outfiles = await compileServer(serverSource, serverOutDir);
          const relativeOutfiles = outfiles
            .map((outfile) => normalizePath(relative(root, outfile)))
            .join(', ');
          console.log(`[server-build] Compiled production server for ${outfiles.length} targets: ${relativeOutfiles}.`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.error(`[server-build] Failed to compile the production server: ${msg}`);
        }
      }
    },
  };
}

export type { ServerBuildPluginOptions } from './types';
