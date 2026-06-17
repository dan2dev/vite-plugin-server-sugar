import { describe, it, expect } from 'vitest';
import { fc, arbBackendEntry, arbWebSocketEntry } from '../helpers/generators';
import { loadVirtualModule, virtualBackendFileId, runtimeImportSpecifier } from '../../src/dev-server/virtual-modules';
import { Registry } from '../../src/core/registry';
import { RESOLVED_PREFIX, RESOLVED_FILE_PREFIX } from '../../src/constants';
import { backendConstName, websocketConstName } from '../../src/utils/crypto';
import type { BackendEntry, WebSocketEntry } from '../../src/types';

describe('Virtual Modules Property Tests', () => {
  it('Property 22: Virtual Module Combined File Exports All Handler Constants', () => {
    // Feature: vite-plugin-quality-testing, Property 22: Virtual Module Combined File Exports All Handler Constants
    // **Validates: Requirements 5.3**
    fc.assert(
      fc.property(
        fc.array(arbBackendEntry(), { minLength: 1, maxLength: 5 }),
        fc.array(arbWebSocketEntry(), { minLength: 0, maxLength: 3 }),
        (backendEntries, wsEntries) => {
          // Force all entries to share the same file
          const sharedFile = backendEntries[0].file;
          for (const entry of backendEntries) entry.file = sharedFile;
          for (const entry of wsEntries) entry.file = sharedFile;

          // Make sure endpoints are unique
          const usedEndpoints = new Set<string>();
          const uniqueBackend: BackendEntry[] = [];
          for (const entry of backendEntries) {
            if (!usedEndpoints.has(entry.endpoint)) {
              usedEndpoints.add(entry.endpoint);
              uniqueBackend.push(entry);
            }
          }
          const uniqueWs: WebSocketEntry[] = [];
          for (const entry of wsEntries) {
            if (!usedEndpoints.has(entry.endpoint)) {
              usedEndpoints.add(entry.endpoint);
              uniqueWs.push(entry);
            }
          }

          const totalHandlers = uniqueBackend.length + uniqueWs.length;
          if (totalHandlers === 0) return; // skip degenerate case

          // Set up registries
          const registry = new Registry<BackendEntry>();
          const wsRegistry = new Registry<WebSocketEntry>();

          const allEndpoints: string[] = [];
          for (const entry of uniqueBackend) {
            registry.set(entry.endpoint, entry);
            allEndpoints.push(entry.endpoint);
          }
          registry.registerFile(sharedFile, allEndpoints);

          const wsEndpoints: string[] = [];
          for (const entry of uniqueWs) {
            wsRegistry.set(entry.endpoint, entry);
            wsEndpoints.push(entry.endpoint);
          }
          if (wsEndpoints.length > 0) {
            wsRegistry.registerFile(sharedFile, wsEndpoints);
          }

          // Load the combined per-file virtual module
          const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(sharedFile);
          const result = loadVirtualModule(resolvedId, registry, wsRegistry);

          expect(result).toBeDefined();
          const code = result!.code;

          // Build expected constant names
          const expectedBackendConsts = uniqueBackend.map((e) => backendConstName(e.endpoint));
          const expectedWsConsts = uniqueWs.map((e) => websocketConstName(e.endpoint));
          const allExpectedConsts = [...expectedBackendConsts, ...expectedWsConsts];

          // The export statement should contain exactly all N constant names
          const exportMatch = code.match(/export \{ (.+) \};/);
          expect(exportMatch).toBeTruthy();

          const exportedNames = exportMatch![1].split(',').map((s) => s.trim());
          expect(exportedNames.length).toBe(totalHandlers);

          // Each expected constant must be in the export statement
          for (const constName of allExpectedConsts) {
            expect(exportedNames).toContain(constName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

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

  it('Property 24: Virtual Module IIFE and __wrapWs for Mixed Handlers with Shared State', () => {
    // Feature: vite-plugin-quality-testing, Property 24: Virtual Module IIFE and __wrapWs for Mixed Handlers with Shared State
    // **Validates: Requirements 5.5**
    fc.assert(
      fc.property(
        arbBackendEntry(),
        arbWebSocketEntry(),
        (backendEntry, wsEntry) => {
          // Force same file and non-empty moduleDeclsJs
          const sharedFile = backendEntry.file;
          wsEntry.file = sharedFile;
          backendEntry.moduleDeclsJs = 'const shared = {};';
          wsEntry.moduleDeclsJs = 'const shared = {};';

          // Make sure endpoints are different
          if (backendEntry.endpoint === wsEntry.endpoint) {
            wsEntry.endpoint = wsEntry.endpoint + '/ws';
          }

          // Set up registries
          const registry = new Registry<BackendEntry>();
          const wsRegistry = new Registry<WebSocketEntry>();

          registry.set(backendEntry.endpoint, backendEntry);
          registry.registerFile(sharedFile, [backendEntry.endpoint]);

          wsRegistry.set(wsEntry.endpoint, wsEntry);
          wsRegistry.registerFile(sharedFile, [wsEntry.endpoint]);

          // Load the combined per-file virtual module
          const resolvedId = RESOLVED_FILE_PREFIX + encodeURIComponent(sharedFile);
          const result = loadVirtualModule(resolvedId, registry, wsRegistry);

          expect(result).toBeDefined();
          const code = result!.code;

          // Should contain an IIFE pattern ((() => {  ...  })())
          expect(code).toContain('= (() => {');
          expect(code).toContain('})();');

          // Should contain the __wrapWs helper function definition
          expect(code).toContain('function __wrapWs(');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 25: Virtual Module Resolves Relative Imports', () => {
    // Feature: vite-plugin-quality-testing, Property 25: Virtual Module Resolves Relative Imports
    // **Validates: Requirements 5.6**
    fc.assert(
      fc.property(
        fc.constantFrom('src/handlers.ts', 'lib/utils.ts', 'modules/auth/login.ts'),
        fc.constantFrom('./', '../', '../../'),
        fc.stringMatching(/^[a-z][a-z0-9\-_]{0,10}$/),
        fc.option(fc.constantFrom('/project', '/app/src', '/workspace'), { nil: null }),
        (sourceFile, prefix, moduleName, fromDir) => {
          const specifier = `${prefix}${moduleName}`;

          const result = runtimeImportSpecifier(sourceFile, specifier, fromDir);

          // Result should NOT start with ./ or ../ when fromDir is null
          // (it becomes absolute). When fromDir is provided, it becomes
          // relative to fromDir.
          // In all cases, the result should NOT be the original relative specifier
          // unchanged — it should be resolved.
          expect(result).toBeDefined();
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);

          // The result should not retain the original unresolved relative specifier
          // (unless the resolution happens to produce the same path, which is unlikely)
          // Key property: result should be different from raw specifier since resolution
          // uses the source file's directory as the base
          if (fromDir === null) {
            // With no fromDir, we get an absolute-like normalized path
            // It should NOT start with ../ or ./ (it's fully resolved)
            expect(result.startsWith('../')).toBe(false);
            expect(result.startsWith('./')).toBe(false);
          } else {
            // With fromDir, it produces a relative path from fromDir to the resolved target
            // It should start with ./ or ../ (relative to fromDir)
            expect(result.startsWith('./') || result.startsWith('../') || result.startsWith('/')).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
