import type { ViteDevServer } from "vite";
import type { InvalidationGraph } from "../types";
import { RESOLVED_FILE_PREFIX, RESOLVED_PREFIX } from "../constants";

function virtualBackendId(endpoint: string): string {
  return RESOLVED_PREFIX + endpoint;
}

function virtualBackendFileId(file: string): string {
  return RESOLVED_FILE_PREFIX + encodeURIComponent(file);
}

function invalidateBackendModulesInGraph<TModule>(
  graph: InvalidationGraph<TModule> | undefined,
  endpoints: string[],
  timestamp: number,
): void {
  if (!graph) return;

  const seen = new Set<TModule>();
  for (const endpoint of endpoints) {
    const mod = graph.getModuleById(virtualBackendId(endpoint));
    if (mod) {
      graph.invalidateModule(mod, seen, timestamp, true);
    }
  }
}

function invalidateBackendFileModulesInGraph<TModule>(
  graph: InvalidationGraph<TModule> | undefined,
  files: string[],
  timestamp: number,
): void {
  if (!graph) return;

  const seen = new Set<TModule>();
  for (const file of files) {
    const mod = graph.getModuleById(virtualBackendFileId(file));
    if (mod) {
      graph.invalidateModule(mod, seen, timestamp, true);
    }
  }
}

function moduleGraphs(server: ViteDevServer): InvalidationGraph<unknown>[] {
  const mixedGraph =
    server.moduleGraph as unknown as InvalidationGraph<unknown>;
  const ssrGraph = (
    server as ViteDevServer & {
      environments?: { ssr?: { moduleGraph?: InvalidationGraph<unknown> } };
    }
  ).environments?.ssr?.moduleGraph;

  return ssrGraph && ssrGraph !== mixedGraph
    ? [mixedGraph, ssrGraph]
    : [mixedGraph];
}

export function invalidateBackendModules(
  server: ViteDevServer,
  endpoints: Iterable<string>,
): void {
  const uniqueEndpoints = [...new Set(endpoints)];
  if (uniqueEndpoints.length === 0) return;

  const timestamp = Date.now();
  for (const graph of moduleGraphs(server)) {
    invalidateBackendModulesInGraph(graph, uniqueEndpoints, timestamp);
  }
}

export function invalidateBackendFileModules(
  server: ViteDevServer,
  files: Iterable<string>,
): void {
  const uniqueFiles = [...new Set(files)];
  if (uniqueFiles.length === 0) return;

  const timestamp = Date.now();
  for (const graph of moduleGraphs(server)) {
    invalidateBackendFileModulesInGraph(graph, uniqueFiles, timestamp);
  }
}
