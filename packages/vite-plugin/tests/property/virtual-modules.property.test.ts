import { describe, it, expect } from 'vitest';
import { fc, arbBackendEntry } from '../helpers/generators';
import { loadVirtualModule, virtualBackendFileId } from '../../src/dev-server/virtual-modules';
import { Registry } from '../../src/core/registry';
import { RESOLVED_PREFIX } from '../../src/constants';
import { backendConstName } from '../../src/utils/crypto';
import type { BackendEntry } from '../../src/types';

describe('Virtual Modules Property Tests', () => {
  it('Property 23: Virtual Module Per-Endpoint Re-Export Correctness', () => {
    // Feature: vite-plugin-quality-testing, Property 23: Virtual Module Per-Endpoint Re-Export Correctness
    // **Validates: Requirements 5.4**
    fc.assert(
      fc.property(arbBackendEntry(), (entry) => {
        // Set up a registry with the generated backend entry
        const registry = new Registry<BackendEntry>();
        registry.set(entry.endpoint, entry);
        registry.registerFile(entry.file, [entry.endpoint]);

        // Construct the resolved per-endpoint virtual module ID
        const resolvedId = RESOLVED_PREFIX + entry.endpoint;

        // Load the virtual module
        const result = loadVirtualModule(resolvedId, registry);

        // The result must exist
        expect(result).toBeDefined();
        expect(result!.code).toBeDefined();

        const code = result!.code;

        // The code should re-export the backendConstName as default
        const constName = backendConstName(entry.endpoint);
        const expectedFileModuleId = virtualBackendFileId(entry.file);

        // Verify the re-export pattern: export { <constName> as default } from "<per-file module>";
        expect(code).toContain(`${constName} as default`);
        expect(code).toContain(`from ${JSON.stringify(expectedFileModuleId)}`);

        // Verify it's a proper ES module re-export statement
        expect(code).toMatch(/^export \{/);
      }),
      { numRuns: 100 },
    );
  });
});
