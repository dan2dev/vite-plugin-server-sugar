import type { ViteDevServer } from 'vite';
import type { InvalidationGraph } from '../types';
import { RESOLVED_PREFIX } from '../constants';

function virtualBackendId(endpoint: string): string {
  return RESOLVED_PREFIX + endpoint;
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

export function invalidateBackendModules(server: ViteDevServer, endpoints: Iterable<string>): void {
  const uniqueEndpoints = [...new Set(endpoints)];
  if (uniqueEndpoints.length === 0) return;

  const timestamp = Date.now();
  const mixedGraph = server.moduleGraph as unknown as InvalidationGraph<unknown>;
  const ssrGraph = (
    server as ViteDevServer & {
      environments?: { ssr?: { moduleGraph?: InvalidationGraph<unknown> } };
    }
  ).environments?.ssr?.moduleGraph;

  invalidateBackendModulesInGraph(mixedGraph, uniqueEndpoints, timestamp);
  if (ssrGraph && ssrGraph !== mixedGraph) {
    invalidateBackendModulesInGraph(ssrGraph, uniqueEndpoints, timestamp);
  }
}
