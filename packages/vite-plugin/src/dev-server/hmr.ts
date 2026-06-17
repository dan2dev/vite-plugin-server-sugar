import type { ViteDevServer } from "vite";
import type { InvalidationGraph } from "../types";
import {
  RESOLVED_FILE_PREFIX,
  RESOLVED_PREFIX,
  RESOLVED_WORKER_PREFIX,
  RESOLVED_WS_PREFIX,
} from "../constants";

function virtualServerId(endpoint: string): string {
  return RESOLVED_PREFIX + endpoint;
}

function virtualWsId(endpoint: string): string {
  return RESOLVED_WS_PREFIX + endpoint;
}

function virtualWorkerId(endpoint: string): string {
  return RESOLVED_WORKER_PREFIX + endpoint;
}

function virtualServerFileId(file: string): string {
  return RESOLVED_FILE_PREFIX + encodeURIComponent(file);
}

function invalidateServerModulesInGraph<TModule>(
  graph: InvalidationGraph<TModule> | undefined,
  endpoints: string[],
  timestamp: number,
): void {
  if (!graph) return;

  const seen = new Set<TModule>();
  for (const endpoint of endpoints) {
    const mod = graph.getModuleById(virtualServerId(endpoint));
    if (mod) {
      graph.invalidateModule(mod, seen, timestamp, true);
    }
  }
}

function invalidateServerFileModulesInGraph<TModule>(
  graph: InvalidationGraph<TModule> | undefined,
  files: string[],
  timestamp: number,
): void {
  if (!graph) return;

  const seen = new Set<TModule>();
  for (const file of files) {
    const mod = graph.getModuleById(virtualServerFileId(file));
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

export function invalidateServerModules(
  server: ViteDevServer,
  endpoints: Iterable<string>,
): void {
  const uniqueEndpoints = [...new Set(endpoints)];
  if (uniqueEndpoints.length === 0) return;

  const timestamp = Date.now();
  for (const graph of moduleGraphs(server)) {
    invalidateServerModulesInGraph(graph, uniqueEndpoints, timestamp);
  }
}

function invalidateWsModulesInGraph<TModule>(
  graph: InvalidationGraph<TModule> | undefined,
  endpoints: string[],
  timestamp: number,
): void {
  if (!graph) return;

  const seen = new Set<TModule>();
  for (const endpoint of endpoints) {
    const mod = graph.getModuleById(virtualWsId(endpoint));
    if (mod) {
      graph.invalidateModule(mod, seen, timestamp, true);
    }
  }
}

export function invalidateWsModules(
  server: ViteDevServer,
  endpoints: Iterable<string>,
): void {
  const uniqueEndpoints = [...new Set(endpoints)];
  if (uniqueEndpoints.length === 0) return;

  const timestamp = Date.now();
  for (const graph of moduleGraphs(server)) {
    invalidateWsModulesInGraph(graph, uniqueEndpoints, timestamp);
  }
}

function invalidateWorkerModulesInGraph<TModule>(
  graph: InvalidationGraph<TModule> | undefined,
  endpoints: string[],
  timestamp: number,
): void {
  if (!graph) return;

  const seen = new Set<TModule>();
  for (const endpoint of endpoints) {
    const mod = graph.getModuleById(virtualWorkerId(endpoint));
    if (mod) {
      graph.invalidateModule(mod, seen, timestamp, true);
    }
  }
}

export function invalidateWorkerModules(
  server: ViteDevServer,
  endpoints: Iterable<string>,
): void {
  const uniqueEndpoints = [...new Set(endpoints)];
  if (uniqueEndpoints.length === 0) return;

  const timestamp = Date.now();
  for (const graph of moduleGraphs(server)) {
    invalidateWorkerModulesInGraph(graph, uniqueEndpoints, timestamp);
  }
}

export function invalidateServerFileModules(
  server: ViteDevServer,
  files: Iterable<string>,
): void {
  const uniqueFiles = [...new Set(files)];
  if (uniqueFiles.length === 0) return;

  const timestamp = Date.now();
  for (const graph of moduleGraphs(server)) {
    invalidateServerFileModulesInGraph(graph, uniqueFiles, timestamp);
  }
}
