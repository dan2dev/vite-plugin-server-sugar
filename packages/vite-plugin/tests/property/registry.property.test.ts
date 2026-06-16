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
 * Checks the bidirectional invariant between the main endpoint map and the file index.
 *
 * 1. For every endpoint in the main map, get the entry's file, then check the file index
 *    for that file contains the endpoint.
 * 2. For every file in the file index, for each endpoint in the file's set, check it
 *    exists in the main map with matching file.
 */
function checkInvariant(registry: Registry<{ file: string }>): boolean {
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

  // Direction 1: For every endpoint in the main map,
  // the file index for its file must contain that endpoint.
  for (const endpoint of endpointPool) {
    const entry = registry.get(endpoint);
    if (entry) {
      const fileEndpoints = registry.getEndpointsForFile(entry.file);
      if (!fileEndpoints.has(endpoint)) {
        return false;
      }
    }
  }

  // Direction 2: For every file in the file index, for each endpoint in the file's set,
  // the main map must have that endpoint with matching file.
  for (const file of filePool) {
    const endpoints = registry.getEndpointsForFile(file);
    for (const endpoint of endpoints) {
      const entry = registry.get(endpoint);
      if (!entry || entry.file !== file) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Generates sequences of registry operations that model realistic processor
 * usage where endpoint ownership is properly maintained.
 *
 * The processor's pattern is:
 *   unregisterFile(file) → registerFile(file, endpoints) → set(ep, entry) for each ep
 *
 * When an endpoint moves to a new file, the old file must be unregistered first.
 * This generator ensures that constraint while producing diverse operation sequences.
 */
function arbCoordinatedOps(): fc.Arbitrary<RegistryOp[]> {
  const files = [
    'src/api.ts',
    'src/handlers.ts',
    'src/routes.ts',
    'lib/services.ts',
    'modules/auth.ts',
  ];

  const endpoints = [
    'api/get-users',
    'api/create-user',
    'api/delete-user',
    'auth/login',
    'auth/logout',
    'data/fetch',
    'ws/chat',
    'ws/notifications',
  ];

  return fc
    .record({
      opTypes: fc.array(
        fc.oneof(
          { weight: 5, arbitrary: fc.constant('process' as const) },
          { weight: 2, arbitrary: fc.constant('remove' as const) },
          { weight: 1, arbitrary: fc.constant('clear' as const) },
        ),
        { minLength: 2, maxLength: 20 },
      ),
      fileChoices: fc.array(fc.integer({ min: 0, max: files.length - 1 }), {
        minLength: 20,
        maxLength: 20,
      }),
      endpointSubsets: fc.array(
        fc.uniqueArray(fc.integer({ min: 0, max: endpoints.length - 1 }), {
          minLength: 1,
          maxLength: 4,
        }),
        { minLength: 20, maxLength: 20 },
      ),
    })
    .map(({ opTypes, fileChoices, endpointSubsets }) => {
      // Track which endpoints are owned by which file
      const ownership = new Map<string, string>(); // endpoint → file
      const ops: RegistryOp[] = [];

      for (let i = 0; i < opTypes.length; i++) {
        const opType = opTypes[i];
        const file = files[fileChoices[i % fileChoices.length]];

        switch (opType) {
          case 'process': {
            const epIdxs = endpointSubsets[i % endpointSubsets.length];
            const chosenEndpoints = epIdxs.map((idx) => endpoints[idx]);

            // Before claiming these endpoints, unregister any file that
            // currently owns them (simulates other files being re-processed)
            for (const ep of chosenEndpoints) {
              const currentOwner = ownership.get(ep);
              if (currentOwner && currentOwner !== file) {
                ops.push({ type: 'unregisterFile', file: currentOwner });
                for (const [e, f] of ownership) {
                  if (f === currentOwner) ownership.delete(e);
                }
              }
            }

            // Processor pattern: unregister → registerFile → set each
            ops.push({ type: 'unregisterFile', file });
            ops.push({ type: 'registerFile', file, endpoints: chosenEndpoints });
            for (const ep of chosenEndpoints) {
              ops.push({ type: 'set', endpoint: ep, file });
            }

            // Update ownership
            for (const [e, f] of ownership) {
              if (f === file) ownership.delete(e);
            }
            for (const ep of chosenEndpoints) {
              ownership.set(ep, file);
            }
            break;
          }
          case 'remove': {
            ops.push({ type: 'unregisterFile', file });
            for (const [e, f] of ownership) {
              if (f === file) ownership.delete(e);
            }
            break;
          }
          case 'clear': {
            ops.push({ type: 'clear' });
            ownership.clear();
            break;
          }
        }
      }

      return ops;
    });
}

describe('Registry', () => {
  it('Property 1: stateful invariant consistency', () => {
    // Feature: vite-plugin-quality-testing, Property 1: Registry Stateful Invariant Consistency
    // **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
    fc.assert(
      fc.property(arbCoordinatedOps(), (ops) => {
        const registry = new Registry<{ file: string }>();
        for (const op of ops) {
          applyOp(registry, op);
        }
        return checkInvariant(registry);
      }),
      { numRuns: 100 },
    );
  });
});
