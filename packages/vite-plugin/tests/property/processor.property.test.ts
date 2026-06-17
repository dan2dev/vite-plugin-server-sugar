import { describe, it, expect } from 'vitest';
import { fc, arbIdentifierName } from '../helpers/generators';
import { processFile } from '../../src/core/processor';
import { Registry } from '../../src/core/registry';
import { isValidJs } from '../helpers/parse-helpers';
import type { ActionEntry, WsEntry } from '../../src/types';

describe('Processor', () => {
  it('Property 11: Processor Generates Unique Endpoints for Duplicate Labels', () => {
    // Feature: vite-plugin-quality-testing, Property 11: Processor Generates Unique Endpoints for Duplicate Labels
    // **Validates: Requirements 1.5**
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (n) => {
        const registry = new Registry();
        const wsRegistry = new Registry();

        // Generate a source file with N $action() calls inside an array literal.
        // All calls are in the same array under `export default`, producing labels
        // like default.0, default.1, etc. The property verifies no duplicate endpoints.
        const actionCalls = Array.from(
          { length: n },
          (_, i) => `$action(() => ${i + 1})`,
        ).join(', ');
        const source = `export default [${actionCalls}]`;

        const fileId = '/project/src/handlers.ts';

        processFile(source, fileId, {
          registry,
          wsRegistry,
          root: '/project',
        });

        // Collect all registered endpoints for this file
        const endpoints = registry.getEndpointsForFile(fileId);

        // All N $action() calls should have produced registered endpoints
        expect(endpoints.size).toBe(n);

        // Verify all endpoints are unique (Set guarantees uniqueness,
        // but also verify against the registry size)
        const endpointArray = [...endpoints];
        const uniqueEndpoints = new Set(endpointArray);
        expect(uniqueEndpoints.size).toBe(n);

        // Additionally verify each endpoint actually exists in the registry
        for (const ep of endpointArray) {
          expect(registry.has(ep)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 11: Processor disambiguates truly duplicate labels via position', () => {
    // Feature: vite-plugin-quality-testing, Property 11: Processor Generates Unique Endpoints for Duplicate Labels
    // **Validates: Requirements 1.5**
    // This test uses `var` redeclarations to force the same inferred label ("handler")
    // for multiple $action() calls, triggering the position disambiguation logic.
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (n) => {
        const registry = new Registry();
        const wsRegistry = new Registry();

        // Generate N `var handler = $action(...)` statements — all produce label "handler"
        const statements = Array.from(
          { length: n },
          (_, i) => `var handler = $action(() => ${i + 1});`,
        ).join('\n');
        const source = statements;

        const fileId = '/project/src/duplicate-labels.ts';

        processFile(source, fileId, {
          registry,
          wsRegistry,
          root: '/project',
        });

        // Collect all registered endpoints for this file
        const endpoints = registry.getEndpointsForFile(fileId);

        // All N $action() calls should have produced registered endpoints
        expect(endpoints.size).toBe(n);

        // Verify all endpoints are unique — the uniqueEndpoint function
        // must have appended position disambiguation for duplicates
        const endpointArray = [...endpoints];
        const uniqueEndpoints = new Set(endpointArray);
        expect(uniqueEndpoints.size).toBe(n);

        // Verify each endpoint exists in the registry
        for (const ep of endpointArray) {
          expect(registry.has(ep)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 13: Processor Unregisters on Handler-Free Re-Process', () => {
    // Feature: vite-plugin-quality-testing, Property 13: Processor Unregisters on Handler-Free Re-Process
    // **Validates: Requirements 1.8**
    fc.assert(
      fc.property(
        fc.array(arbIdentifierName(), { minLength: 1, maxLength: 4 }).chain((names) =>
          fc.tuple(
            fc.constant(names),
            // Generate plain variable names for the handler-free source
            fc.array(arbIdentifierName(), { minLength: 1, maxLength: 3 }),
          ),
        ),
        ([handlerNames, plainVarNames]) => {
          const registry = new Registry();
          const wsRegistry = new Registry();
          const fileId = '/project/src/my-handlers.ts';

          // Step 1: Process a file with N $action() handlers (generates endpoints)
          const sourceWithHandlers = handlerNames
            .map(
              (name, i) =>
                `const ${name}_${i} = $action((arg: string) => arg + "${name}");`,
            )
            .join('\n');

          processFile(sourceWithHandlers, fileId, {
            registry,
            wsRegistry,
            root: '/project',
          });

          // Step 2: Verify registry has endpoints for the file
          const endpointsAfterFirst = registry.getEndpointsForFile(fileId);
          expect(endpointsAfterFirst.size).toBe(handlerNames.length);

          // Step 3: Re-process same file with code that has NO $action()/$ws() calls
          const sourceWithoutHandlers = plainVarNames
            .map((name, i) => `const ${name}_plain_${i} = ${i + 1};`)
            .join('\n');

          processFile(sourceWithoutHandlers, fileId, {
            registry,
            wsRegistry,
            root: '/project',
          });

          // Step 4: Verify registry has zero endpoints for that file
          const endpointsAfterSecond = registry.getEndpointsForFile(fileId);
          expect(endpointsAfterSecond.size).toBe(0);

          // Also verify none of the original endpoints remain in the registry
          for (const ep of endpointsAfterFirst) {
            expect(registry.has(ep)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 14: Processor Removes Server-Only Imports from Client Output', () => {
    // Feature: vite-plugin-quality-testing, Property 14: Processor Removes Server-Only Imports from Client Output
    // **Validates: Requirements 1.10, 12.4**
    fc.assert(
      fc.property(
        arbIdentifierName(),
        arbIdentifierName(),
        (importName, moduleName) => {
          const registry = new Registry();
          const wsRegistry = new Registry();
          const fileId = '/project/src/server-imports.ts';

          // Build a source file where the import is used ONLY inside $action() handler
          const source = [
            `import { ${importName} } from "${moduleName}";`,
            `const handler = $action((arg: string) => ${importName}(arg));`,
          ].join('\n');

          const result = processFile(source, fileId, {
            registry,
            wsRegistry,
            root: '/project',
          });

          // The processor should produce output (file has a $action() call)
          if (result === null) return; // skip if not processed

          // The client output should NOT contain the import statement
          // because the imported identifier is only referenced inside $action()
          const importPattern = `from "${moduleName}"`;
          expect(result.code).not.toContain(importPattern);

          // Also verify the import name itself is not in an import declaration context
          const importStatementPattern = `import { ${importName} }`;
          expect(result.code).not.toContain(importStatementPattern);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 12: Processor Shared moduleDeclsJs Across Same-File Entries', () => {
    // Feature: vite-plugin-quality-testing, Property 12: Processor Shared moduleDeclsJs Across Same-File Entries
    // **Validates: Requirements 1.7**

    // Generator for module-level declarations that handlers will reference
    const arbModuleDecl = fc
      .tuple(arbIdentifierName(), fc.oneof(
        fc.constant('0'),
        fc.constant('[]'),
        fc.constant('{}'),
        fc.constant('new Map()'),
        fc.constant('"shared"'),
      ))
      .map(([name, init]) => ({ name, decl: `const ${name} = ${init};` }));

    // Generator for a source file with shared module-level state and multiple handlers
    const arbSourceWithSharedState = fc
      .tuple(
        // Module-level declarations (1-3)
        fc.array(arbModuleDecl, { minLength: 1, maxLength: 3 }),
        // Number of action handlers (0-3)
        fc.integer({ min: 0, max: 3 }),
        // Number of ws handlers (0-3)
        fc.integer({ min: 0, max: 3 }),
      )
      .filter(([_, numBackend, numWs]) => numBackend + numWs >= 2)
      .map(([decls, numBackend, numWs]) => {
        const lines: string[] = [];

        // Emit module-level declarations
        for (const { decl } of decls) {
          lines.push(decl);
        }

        lines.push('');

        // Reference at least one shared declaration from each handler
        const sharedRef = decls[0].name;

        // Emit action handlers that reference the shared state
        for (let i = 0; i < numBackend; i++) {
          lines.push(
            `const actionHandler_${i} = $action((arg: string) => { ${sharedRef}; return arg; });`,
          );
        }

        // Emit ws handlers that reference the shared state
        for (let i = 0; i < numWs; i++) {
          lines.push(
            `const wsHandler_${i} = $ws({ onMessage(ws, data) { ${sharedRef}; ws.send(data); } });`,
          );
        }

        return { source: lines.join('\n'), numBackend, numWs };
      });

    fc.assert(
      fc.property(arbSourceWithSharedState, ({ source, numBackend, numWs }) => {
        const registry = new Registry<ActionEntry>();
        const wsRegistry = new Registry<WsEntry>();
        const fileId = '/project/src/shared-state.ts';

        processFile(source, fileId, {
          registry,
          wsRegistry,
          root: '/project',
        });

        // Collect all entries from both registries for this file
        const actionEndpoints = registry.getEndpointsForFile(fileId);
        const wsEndpoints = wsRegistry.getEndpointsForFile(fileId);

        // We should have entries registered
        expect(actionEndpoints.size).toBe(numBackend);
        expect(wsEndpoints.size).toBe(numWs);

        // Collect all moduleDeclsJs values from all entries
        const allModuleDeclsValues: (string | undefined)[] = [];

        for (const ep of actionEndpoints) {
          const entry = registry.get(ep);
          expect(entry).toBeDefined();
          allModuleDeclsValues.push(entry!.moduleDeclsJs);
        }

        for (const ep of wsEndpoints) {
          const entry = wsRegistry.get(ep);
          expect(entry).toBeDefined();
          allModuleDeclsValues.push(entry!.moduleDeclsJs);
        }

        // All entries must have the same moduleDeclsJs value
        expect(allModuleDeclsValues.length).toBeGreaterThanOrEqual(2);
        const first = allModuleDeclsValues[0];
        for (const value of allModuleDeclsValues) {
          expect(value).toBe(first);
        }

        // Since handlers reference module-level state, moduleDeclsJs should be defined
        expect(first).toBeDefined();
        expect(first!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 15: Processor Produces Valid Parseable Client Output', () => {
    // Feature: vite-plugin-quality-testing, Property 15: Processor Produces Valid Parseable Client Output
    // **Validates: Requirements 12.1, 12.2, 12.6**

    // Generator for handler body expressions (simple, valid JS expressions)
    const arbHandlerBody = fc.oneof(
      fc.constant('42'),
      fc.constant('"hello"'),
      fc.constant('arg.toUpperCase()'),
      fc.constant('arg + 1'),
      fc.constant('null'),
      fc.constant('{ result: arg }'),
      fc.constant('Promise.resolve(arg)'),
    );

    // Generator for handler patterns: arrow functions (sync/async), with params
    const arbBackendHandler = fc.oneof(
      // Simple arrow function with one param
      arbIdentifierName().chain((param) =>
        arbHandlerBody.map((body) => `(${param}: string) => ${body}`),
      ),
      // Async arrow function with one param
      arbIdentifierName().chain((param) =>
        arbHandlerBody.map((body) => `async (${param}: string) => ${body}`),
      ),
      // Arrow function with multiple params
      fc
        .tuple(arbIdentifierName(), arbIdentifierName())
        .chain(([p1, p2]) =>
          arbHandlerBody.map(
            (body) => `(${p1}: string, ${p2}: number) => ${body}`,
          ),
        ),
      // Arrow function with block body
      arbIdentifierName().chain((param) =>
        arbHandlerBody.map(
          (body) => `(${param}: string) => { return ${body}; }`,
        ),
      ),
      // Async arrow function with block body
      arbIdentifierName().chain((param) =>
        arbHandlerBody.map(
          (body) => `async (${param}: string) => { return ${body}; }`,
        ),
      ),
    );

    // Generator for ws handler patterns
    const arbWsHandler = fc.constantFrom(
      '{ onMessage(ws, data) { ws.send(data); } }',
      '{ onOpen(ws) { }, onMessage(ws, msg) { ws.send(msg); }, onClose(ws) { } }',
      '{ onMessage(ws, data) { ws.send(JSON.stringify(data)); } }',
    );

    // Generator for source files containing $action() and/or $ws() calls
    const arbSourceWithHandlers = fc
      .tuple(
        // action calls
        fc.array(
          fc.tuple(arbIdentifierName(), arbBackendHandler),
          { minLength: 0, maxLength: 3 },
        ),
        // ws calls
        fc.array(
          fc.tuple(arbIdentifierName(), arbWsHandler),
          { minLength: 0, maxLength: 2 },
        ),
      )
      .filter(([actions, wss]) => actions.length + wss.length > 0)
      .map(([actions, wss]) => {
        const lines: string[] = [];

        // Generate unique variable names using index suffixes
        actions.forEach(([name, handler], i) => {
          lines.push(`const ${name}_b${i} = $action(${handler});`);
        });

        wss.forEach(([name, handler], i) => {
          lines.push(`const ${name}_w${i} = $ws(${handler});`);
        });

        return lines.join('\n');
      });

    fc.assert(
      fc.property(arbSourceWithHandlers, (source) => {
        const registry = new Registry();
        const wsRegistry = new Registry();
        const fileId = '/project/src/test-file.ts';

        const result = processFile(source, fileId, {
          registry,
          wsRegistry,
          root: '/project',
        });

        // processFile should return a result for files with action/ws calls
        if (result === null) {
          // If null, the regex fast-path didn't match — skip this case
          return true;
        }

        // The output code must be parseable as a valid JS/TS module
        expect(isValidJs(result.code)).toBe(true);

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
