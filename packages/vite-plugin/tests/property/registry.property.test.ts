import { describe, it } from 'vitest';
import { arbRegistryOps, type RegistryOp, fc } from '../helpers/generators';
import { Registry } from '../../src/core/registry';

/**
 * Applies a single registry operation to the given registry instance.
 */
function applyOp(registry: Registry<{ file: string }>, op: RegistryOp): void {
  switch (op.type) {
    case 'set':
      registry.set(op.endpoint, { file: op.file });
      break;
    case 'registerFile':
      registry.registerFile(op.file, op.endpoints);
      break;
    case 'unregisterFile':
      registry.unregisterFile(op.file);
      break;
    case 'clear':
      registry.clear();
      break;
  }
}

/**
 * Reference model that mirrors the Registry's internal logic.
 * Used to verify the Registry's observable behavior matches expectations
 * for any arbitrary sequence of operations.
 */
class RegistryModel {
  /** endpoint → file (mirrors Registry's private registry map) */
  endpoints = new Map<string, string>();
  /** file → Set<endpoint> (mirrors Registry's private entriesByFile map) */
  fileIndex = new Map<string, Set<string>>();

  apply(op: RegistryOp): void {
    switch (op.type) {
      case 'set':
        this.endpoints.set(op.endpoint, op.file);
        break;
      case 'registerFile':
        this.doUnregister(op.file);
        this.fileIndex.set(op.file, new Set(op.endpoints));
        break;
      case 'unregisterFile':
        this.doUnregister(op.file);
        break;
      case 'clear':
        this.endpoints.clear();
        this.fileIndex.clear();
        break;
    }
  }

  private doUnregister(file: string): void {
    const names = this.fileIndex.get(file);
    if (!names) return;
    for (const endpoint of names) {
      if (this.endpoints.get(endpoint) === file) {
        this.endpoints.delete(endpoint);
      }
    }
    this.fileIndex.delete(file);
  }
}

/**
 * Checks the stateful invariant: after applying any sequence of operations,
 * the Registry's observable state (main map and file index) matches our
 * reference model exactly. This verifies:
 *
 * 1. The main endpoint map contains the same entries as the model.
 * 2. The file-to-endpoints index contains the same mappings as the model.
 * 3. Every endpoint listed in a file's index set that exists in the main map
 *    with that file maintains bidirectional consistency (when operations
 *    follow the processor pattern: registerFile → set).
 */
function checkInvariant(registry: Registry<{ file: string }>, model: RegistryModel): boolean {
  const endpointPool = [
    'api/get-users',
    'api/create-user',
    'api/delete-user',
    'auth/login',
    'auth/logout',
    'data/fetch',
    'ws/chat',
    'ws/notifications',
  ];

  const filePool = [
    'src/api.ts',
    'src/handlers.ts',
    'src/routes.ts',
    'lib/services.ts',
    'modules/auth.ts',
  ];

  // Verify main endpoint map consistency with model
  for (const endpoint of endpointPool) {
    const entry = registry.get(endpoint);
    const modelFile = model.endpoints.get(endpoint);

    if (entry && !modelFile) return false;
    if (!entry && modelFile) return false;
    if (entry && modelFile && entry.file !== modelFile) return false;
  }

  // Verify file-to-endpoints index consistency with model
  for (const file of filePool) {
    const realEndpoints = registry.getEndpointsForFile(file);
    const modelEndpoints = model.fileIndex.get(file) ?? new Set<string>();

    if (realEndpoints.size !== modelEndpoints.size) return false;
    for (const ep of realEndpoints) {
      if (!modelEndpoints.has(ep)) return false;
    }
    for (const ep of modelEndpoints) {
      if (!realEndpoints.has(ep)) return false;
    }
  }

  // Verify the consistency invariant that the Registry guarantees:
  // After unregisterFile(f), no endpoint that was tracked by f's index
  // remains in the main map with file === f. We verify this transitively
  // by confirming that any endpoint in a file's index that IS also in
  // the main map with that same file maintains the forward link.
  for (const file of filePool) {
    const fileEndpoints = registry.getEndpointsForFile(file);
    for (const endpoint of fileEndpoints) {
      const entry = registry.get(endpoint);
      // If the endpoint is both in the file index AND in the main map
      // with the SAME file, the bidirectional link is maintained.
      // If entry exists with a DIFFERENT file, that's fine — it means
      // another `set` overwrote the file without going through registerFile.
      // The invariant we check: the model agrees with this state.
      if (entry && entry.file === file) {
        // Bidirectional link exists — verify model agrees
        if (model.endpoints.get(endpoint) !== file) return false;
        const modelFileEps = model.fileIndex.get(file);
        if (!modelFileEps || !modelFileEps.has(endpoint)) return false;
      }
    }
  }

  return true;
}

describe('Registry', () => {
  it('Property 1: stateful invariant consistency', () => {
    // Feature: vite-plugin-quality-testing, Property 1: Registry Stateful Invariant Consistency
    // **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
    fc.assert(
      fc.property(arbRegistryOps(), (ops) => {
        const registry = new Registry<{ file: string }>();
        const model = new RegistryModel();

        for (const op of ops) {
          applyOp(registry, op);
          model.apply(op);
        }

        return checkInvariant(registry, model);
      }),
      { numRuns: 100 },
    );
  });
});
