import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateBundleContent } from '../../src/build/bundle-generator';
import { Registry } from '../../src/core/registry';
import type { ActionEntry, WsEntry } from '../../src/types';
import { arbActionEntry, arbWsEntry, arbIdentifierName } from '../helpers/generators';

describe('Bundle Generator', () => {
  it('Property 19: Bundle Generator Structural Validity for Non-Empty Registries', () => {
    // Feature: vite-plugin-quality-testing, Property 19: Bundle Generator Structural Validity for Non-Empty Registries
    // **Validates: Requirements 4.1, 4.2, 14.1**

    fc.assert(
      fc.property(
        fc.array(arbActionEntry(), { minLength: 0, maxLength: 5 }),
        fc.array(arbWsEntry(), { minLength: 0, maxLength: 5 }),
        (actionEntries, wsEntries) => {
          // Ensure at least one entry exists (non-empty registry)
          if (actionEntries.length === 0 && wsEntries.length === 0) return;

          // Deduplicate endpoints to avoid registry conflicts
          const usedEndpoints = new Set<string>();
          const dedupedBackend: ActionEntry[] = [];
          for (const entry of actionEntries) {
            if (!usedEndpoints.has(entry.endpoint)) {
              usedEndpoints.add(entry.endpoint);
              dedupedBackend.push(entry);
            }
          }
          const dedupedWs: WsEntry[] = [];
          for (const entry of wsEntries) {
            if (!usedEndpoints.has(entry.endpoint)) {
              usedEndpoints.add(entry.endpoint);
              dedupedWs.push(entry);
            }
          }

          if (dedupedBackend.length === 0 && dedupedWs.length === 0) return;

          const registry = new Registry<ActionEntry>();
          for (const entry of dedupedBackend) {
            registry.set(entry.endpoint, entry);
            registry.registerFile(entry.file, [entry.endpoint]);
          }

          let wsRegistry: Registry<WsEntry> | undefined;
          if (dedupedWs.length > 0) {
            wsRegistry = new Registry<WsEntry>();
            for (const entry of dedupedWs) {
              wsRegistry.set(entry.endpoint, entry);
              wsRegistry.registerFile(entry.file, [entry.endpoint]);
            }
          }

          const output = generateBundleContent(
            registry,
            undefined,
            null,
            '/out/server',
            '/out/client',
            3001,
            wsRegistry,
          );

          expect(output).not.toBeNull();

          // (1) Exactly one Bun.serve( call
          const bunServeMatches = output!.match(/Bun\.serve\(/g) ?? [];
          expect(bunServeMatches.length).toBe(1);

          // (2) A POST route handler for /__server-build/*
          expect(output!).toContain("'/__server-build/*'");
          expect(output!).toContain('.post(');

          // (3) When ws entries exist, a ws: configuration block
          if (dedupedWs.length > 0) {
            expect(output!).toContain('websocket:');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 20: Bundle Generator Unique Import Aliases', () => {
    // Feature: vite-plugin-quality-testing, Property 20: Bundle Generator Unique Import Aliases
    // **Validates: Requirements 4.4**

    // Generate entries from different files that share import local names but different specifiers.
    // This ensures that even when two files both `import { helper } from 'moduleA'` and
    // `import { helper } from 'moduleB'`, the bundle generator produces unique __dep_N aliases.
    const arbSharedLocalEntries = fc
      .tuple(
        // A shared local binding name used by entries from different files
        arbIdentifierName(),
        // Number of entries (2-5 entries from different files sharing the same local name)
        fc.integer({ min: 2, max: 5 }),
      )
      .chain(([sharedLocal, count]) =>
        fc
          .tuple(
            // Generate unique file paths
            fc
              .array(arbIdentifierName(), { minLength: count, maxLength: count })
              .map((names) => names.map((n, i) => `src/file_${i}_${n}.ts`)),
            // Generate unique specifiers (different modules)
            fc
              .array(arbIdentifierName(), { minLength: count, maxLength: count })
              .map((names) => names.map((n, i) => `module-${i}-${n}`)),
            // Generate endpoint names
            fc
              .array(arbIdentifierName(), { minLength: count, maxLength: count })
              .map((names) => names.map((n, i) => `api/endpoint-${i}-${n}`)),
          )
          .map(([files, specifiers, endpoints]) => ({
            sharedLocal,
            entries: files.map((file, i) => ({
              file,
              specifier: specifiers[i],
              endpoint: endpoints[i],
            })),
          })),
      );

    fc.assert(
      fc.property(arbSharedLocalEntries, ({ sharedLocal, entries }) => {
        const registry = new Registry<ActionEntry>();

        for (const { file, specifier, endpoint } of entries) {
          const entry: ActionEntry = {
            endpoint,
            file,
            fnJs: '(x) => x',
            imports: [
              {
                named: [{ imported: sharedLocal, local: sharedLocal }],
                specifier,
              },
            ],
          };
          registry.set(endpoint, entry);
          registry.registerFile(file, [endpoint]);
        }

        const output = generateBundleContent(
          registry,
          undefined, // no serverEntry
          null, // no serverEntryPath
          '/out/server',
          '/out/client',
          3001,
        );

        expect(output).not.toBeNull();

        // Extract all __dep_N identifiers from the output
        const depAliases = output!.match(/__dep_\d+/g) ?? [];

        // Get unique alias declarations (the distinct __dep_N identifiers used)
        const uniqueAliasNames = new Set(depAliases);

        // Each entry contributes one import with one named binding → should produce
        // one unique alias per entry since they all have different specifiers
        // Verify no duplicates in the declarations by checking import statements
        const importLines = output!
          .split('\n')
          .filter((line) => line.startsWith('import ') && line.includes('__dep_'));

        // Extract the __dep_N aliases from import declarations
        const declaredAliases: string[] = [];
        for (const line of importLines) {
          const matches = line.match(/__dep_\d+/g);
          if (matches) declaredAliases.push(...matches);
        }

        // All declared aliases must be unique (no duplicates)
        const uniqueDeclared = new Set(declaredAliases);
        expect(uniqueDeclared.size).toBe(declaredAliases.length);

        // There should be at least as many unique aliases as there are entries
        // (since each entry imports a different module under the same local name)
        expect(uniqueDeclared.size).toBeGreaterThanOrEqual(entries.length);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 21: Bundle Generator IIFE Wrapping with moduleDeclsJs', () => {
    // Feature: vite-plugin-quality-testing, Property 21: Bundle Generator IIFE Wrapping with moduleDeclsJs
    // **Validates: Requirements 4.5**

    // Generate entries from the same file where moduleDeclsJs is non-empty.
    // The bundle generator should wrap them in an IIFE with the moduleDeclsJs inside.
    const arbModuleDeclsJs = fc.oneof(
      fc.constant('const shared = 0;'),
      fc.constant('let counter = 0;'),
      arbIdentifierName().map((n) => `const ${n} = [];`),
      arbIdentifierName().map((n) => `let ${n} = new Map();`),
      arbIdentifierName().map((n) => `const ${n} = {};`),
    );

    const arbSameFileEntries = fc
      .tuple(
        // A shared file path
        arbIdentifierName().map((n) => `src/${n}.ts`),
        // moduleDeclsJs content (non-empty)
        arbModuleDeclsJs,
        // Number of entries from this file (2-4)
        fc.integer({ min: 2, max: 4 }),
      )
      .chain(([file, moduleDeclsJs, count]) =>
        fc
          .array(arbIdentifierName(), { minLength: count, maxLength: count })
          .map((names) => ({
            file,
            moduleDeclsJs,
            entries: names.map((name, i) => ({
              endpoint: `api/${name}-${i}`,
              originalName: name,
            })),
          })),
      );

    fc.assert(
      fc.property(arbSameFileEntries, ({ file, moduleDeclsJs, entries }) => {
        const registry = new Registry<ActionEntry>();

        for (const { endpoint, originalName } of entries) {
          const entry: ActionEntry = {
            endpoint,
            file,
            fnJs: '(x) => x',
            imports: [],
            originalName,
            moduleDeclsJs,
          };
          registry.set(endpoint, entry);
        }
        registry.registerFile(
          file,
          entries.map((e) => e.endpoint),
        );

        const output = generateBundleContent(
          registry,
          undefined, // no serverEntry
          null, // no serverEntryPath
          '/out/server',
          '/out/client',
          3001,
        );

        expect(output).not.toBeNull();

        // (1) Verify output contains IIFE opening pattern: `(() => {`
        expect(output!).toContain('(() => {');

        // (2) Verify output contains IIFE closing pattern: `})()`
        expect(output!).toContain('})()');

        // (3) Verify the moduleDeclsJs content appears inside the IIFE body.
        // The IIFE starts at `(() => {` and ends at `})()`.
        // The moduleDeclsJs content should be between them.
        const iifeStart = output!.indexOf('(() => {');
        const iifeEnd = output!.indexOf('})();', iifeStart);
        expect(iifeEnd).toBeGreaterThan(iifeStart);

        const iifeBody = output!.slice(iifeStart, iifeEnd);
        // moduleDeclsJs lines appear indented inside the IIFE
        for (const declLine of moduleDeclsJs.split('\n')) {
          expect(iifeBody).toContain(declLine.trim());
        }
      }),
      { numRuns: 100 },
    );
  });
});
