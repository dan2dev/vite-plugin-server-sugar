import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import type { ViteDevServer } from 'vite';
import { invalidateBackendModules } from '../../src/dev-server/hmr';
import { RESOLVED_PREFIX } from '../../src/constants';

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
        // When the file is deleted, we call invalidateBackendModules with all those endpoints.
        // All corresponding virtual modules should be invalidated.

        // Compute the expected virtual module IDs for these endpoints
        const expectedVirtualIds = endpoints.map(
          (ep) => RESOLVED_PREFIX + ep,
        );

        // Create a mock server whose module graph knows about these virtual modules
        const { server, invalidatedIds } = createMockServer(expectedVirtualIds);

        // Simulate file deletion: invalidate all endpoints the file was registered with
        invalidateBackendModules(server, endpoints);

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
