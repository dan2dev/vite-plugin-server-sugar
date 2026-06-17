import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import type { ViteDevServer } from 'vite';
import { invalidateServerModules, invalidateWsModules } from '../../src/dev-server/hmr';
import { RESOLVED_PREFIX, RESOLVED_WS_PREFIX } from '../../src/constants';

/**
 * Property-based tests for HMR invalidation.
 * Feature: vite-plugin-quality-testing
 */

/**
 * Creates a mock ViteDevServer with a module graph that tracks invalidation calls.
 * Returns the server and a record of which module IDs were invalidated.
 */
function createMockServer(knownModuleIds: string[]): {
  server: ViteDevServer;
  invalidatedIds: string[];
} {
  const invalidatedIds: string[] = [];

  // Create module objects for each known ID
  const modules = new Map<string, { id: string }>();
  for (const id of knownModuleIds) {
    modules.set(id, { id });
  }

  const moduleGraph = {
    getModuleById: (id: string) => modules.get(id),
    invalidateModule: (mod: { id: string }, _seen?: Set<unknown>, _timestamp?: number, _isHmr?: boolean) => {
      invalidatedIds.push(mod.id);
    },
  };

  const server = {
    moduleGraph,
  } as unknown as ViteDevServer;

  return { server, invalidatedIds };
}

/**
 * Creates a mock ViteDevServer with BOTH a mixed module graph and an SSR module graph,
 * tracking invalidation calls in both graphs separately.
 */
function createDualGraphMockServer(knownModuleIds: string[]): {
  server: ViteDevServer;
  mixedInvalidatedIds: string[];
  ssrInvalidatedIds: string[];
} {
  const mixedInvalidatedIds: string[] = [];
  const ssrInvalidatedIds: string[] = [];

  // Create module objects for each known ID (shared across both graphs)
  const mixedModules = new Map<string, { id: string }>();
  const ssrModules = new Map<string, { id: string }>();
  for (const id of knownModuleIds) {
    mixedModules.set(id, { id });
    ssrModules.set(id, { id });
  }

  const mixedGraph = {
    getModuleById: (id: string) => mixedModules.get(id),
    invalidateModule: (mod: { id: string }, _seen?: Set<unknown>, _timestamp?: number, _isHmr?: boolean) => {
      mixedInvalidatedIds.push(mod.id);
    },
  };

  const ssrGraph = {
    getModuleById: (id: string) => ssrModules.get(id),
    invalidateModule: (mod: { id: string }, _seen?: Set<unknown>, _timestamp?: number, _isHmr?: boolean) => {
      ssrInvalidatedIds.push(mod.id);
    },
  };

  const server = {
    moduleGraph: mixedGraph,
    environments: {
      ssr: {
        moduleGraph: ssrGraph,
      },
    },
  } as unknown as ViteDevServer;

  return { server, mixedInvalidatedIds, ssrInvalidatedIds };
}

/**
 * Generator for endpoint names (1-5 unique endpoint names).
 */
function arbEndpointSet(): fc.Arbitrary<string[]> {
  const segment = fc.stringMatching(/^[a-z][a-z0-9\-]{0,9}$/);
  const endpointName = fc
    .array(segment, { minLength: 1, maxLength: 3 })
    .map((segments) => segments.join('/'));

  return fc
    .uniqueArray(endpointName, { minLength: 1, maxLength: 5, comparator: 'SameValue' });
}

describe('HMR Property Tests', () => {
  it('Property 28: HMR Invalidates Union of Previous and New Endpoints in All Graphs', () => {
    /**
     * Feature: vite-plugin-quality-testing, Property 28: HMR Invalidates Union of Previous and New Endpoints in All Graphs
     * **Validates: Requirements 11.1, 11.2, 11.5**
     *
     * For any set of previous endpoints and new endpoints for a file change,
     * invalidateServerModules and invalidateWsModules SHALL be called
     * with the union of both sets, and SHALL operate on both the SSR module graph
     * and the mixed module graph when both exist.
     */
    fc.assert(
      fc.property(
        arbEndpointSet(),
        arbEndpointSet(),
        (previousEndpoints, newEndpoints) => {
          // Compute the union of previous and new endpoints
          const union = [...new Set([...previousEndpoints, ...newEndpoints])];

          // --- Test server invalidation ---
          const serverVirtualIds = union.map((ep) => RESOLVED_PREFIX + ep);
          const {
            server: serverServer,
            mixedInvalidatedIds: serverMixedIds,
            ssrInvalidatedIds: serverSsrIds,
          } = createDualGraphMockServer(serverVirtualIds);

          // Call invalidateServerModules with the union (simulating what HMR does on file change)
          invalidateServerModules(serverServer, union);

          // All union endpoints should be invalidated in both graphs
          expect(serverMixedIds.length).toBe(union.length);
          expect(serverSsrIds.length).toBe(union.length);

          for (const ep of union) {
            const expectedId = RESOLVED_PREFIX + ep;
            expect(serverMixedIds).toContain(expectedId);
            expect(serverSsrIds).toContain(expectedId);
          }

          // --- Test ws invalidation ---
          const wsVirtualIds = union.map((ep) => RESOLVED_WS_PREFIX + ep);
          const {
            server: wsServer,
            mixedInvalidatedIds: wsMixedIds,
            ssrInvalidatedIds: wsSsrIds,
          } = createDualGraphMockServer(wsVirtualIds);

          // Call invalidateWsModules with the union
          invalidateWsModules(wsServer, union);

          // All union endpoints should be invalidated in both graphs
          expect(wsMixedIds.length).toBe(union.length);
          expect(wsSsrIds.length).toBe(union.length);

          for (const ep of union) {
            const expectedId = RESOLVED_WS_PREFIX + ep;
            expect(wsMixedIds).toContain(expectedId);
            expect(wsSsrIds).toContain(expectedId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 29: HMR Invalidates All Modules for Deleted Files', () => {
    /**
     * Feature: vite-plugin-quality-testing, Property 29: HMR Invalidates All Modules for Deleted Files
     * Validates: Requirements 11.3
     *
     * For any file that was previously registered with a set of endpoint names,
     * when that file is deleted, all virtual modules corresponding to those
     * endpoints SHALL be invalidated.
     */
    fc.assert(
      fc.property(arbEndpointSet(), (endpoints) => {
        // The file was previously registered with these endpoints.
        // When the file is deleted, we call invalidateServerModules with all those endpoints.
        // All corresponding virtual modules should be invalidated.

        // Compute the expected virtual module IDs for these endpoints
        const expectedVirtualIds = endpoints.map(
          (ep) => RESOLVED_PREFIX + ep,
        );

        // Create a mock server whose module graph knows about these virtual modules
        const { server, invalidatedIds } = createMockServer(expectedVirtualIds);

        // Simulate file deletion: invalidate all endpoints the file was registered with
        invalidateServerModules(server, endpoints);

        // ALL virtual modules corresponding to those endpoints must be invalidated
        expect(invalidatedIds.length).toBe(endpoints.length);

        // Every expected virtual module ID should appear in the invalidated set
        for (const expectedId of expectedVirtualIds) {
          expect(invalidatedIds).toContain(expectedId);
        }
      }),
      { numRuns: 100 },
    );
  });
});
