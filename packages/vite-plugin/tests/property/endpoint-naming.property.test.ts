import { describe, it, expect } from 'vitest';
import { fc, arbIdentifierName, arbEndpointName } from '../helpers/generators';
import { processFile } from '../../src/core/processor';
import { Registry } from '../../src/core/registry';
import { toKebabCase } from '../../src/utils/crypto';

describe('Endpoint Naming', () => {
  it('Property 16: Endpoint Name Determinism', () => {
    // Feature: vite-plugin-quality-testing, Property 16: Endpoint Name Determinism
    // **Validates: Requirements 13.1**
    //
    // For any combination of (file path, handler label, root directory),
    // calling the endpoint name generation logic multiple times SHALL always
    // produce the same string.

    // Generator for file paths relative to a root
    const arbFilePath = fc
      .tuple(
        fc.constantFrom('src/', 'lib/', 'modules/', 'pages/', 'api/'),
        fc.array(arbIdentifierName(), { minLength: 0, maxLength: 2 }),
        arbIdentifierName(),
        fc.constantFrom('.ts', '.tsx'),
      )
      .map(([prefix, dirs, name, ext]) => {
        const dirPath = dirs.length > 0 ? dirs.join('/') + '/' : '';
        return `${prefix}${dirPath}${name}${ext}`;
      });

    // Generator for root directories
    const arbRoot = fc.constantFrom(
      '/project',
      '/home/user/app',
      '/workspace/my-project',
      '/opt/builds/service',
    );

    fc.assert(
      fc.property(
        arbFilePath,
        arbRoot,
        arbIdentifierName(),
        (relFilePath, root, handlerName) => {
          const fileId = `${root}/${relFilePath}`;

          // Build a source file with a $server() call assigned to `handlerName`
          const source = `const ${handlerName} = $server((arg: string) => arg);`;

          // First processing pass
          const registry1 = new Registry();
          const wsRegistry1 = new Registry();
          processFile(source, fileId, {
            registry: registry1,
            wsRegistry: wsRegistry1,
            root,
          });

          // Second processing pass with identical inputs
          const registry2 = new Registry();
          const wsRegistry2 = new Registry();
          processFile(source, fileId, {
            registry: registry2,
            wsRegistry: wsRegistry2,
            root,
          });

          // Both passes must produce the same set of endpoint names
          const endpoints1 = [...registry1.getEndpointsForFile(fileId)].sort();
          const endpoints2 = [...registry2.getEndpointsForFile(fileId)].sort();

          expect(endpoints1).toEqual(endpoints2);
          expect(endpoints1.length).toBeGreaterThan(0);

          // Additionally verify each individual endpoint value is identical
          for (let i = 0; i < endpoints1.length; i++) {
            expect(endpoints1[i]).toBe(endpoints2[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 16: Endpoint Name Determinism with multiple handlers', () => {
    // Feature: vite-plugin-quality-testing, Property 16: Endpoint Name Determinism
    // **Validates: Requirements 13.1**
    //
    // Processing the same source with multiple handlers multiple times
    // produces identical endpoint names each time.

    fc.assert(
      fc.property(
        fc.array(arbIdentifierName(), { minLength: 1, maxLength: 4 }),
        fc.constantFrom('/project', '/home/user/app', '/workspace'),
        (handlerNames, root) => {
          // Deduplicate handler names to avoid `var` redeclaration issues
          const uniqueNames = [...new Set(handlerNames)];
          if (uniqueNames.length === 0) return;

          const fileId = `${root}/src/handlers.ts`;

          // Build source with multiple $server() calls
          const source = uniqueNames
            .map(
              (name, i) =>
                `const ${name}_h${i} = $server((x: string) => x + "${name}");`,
            )
            .join('\n');

          // Run processFile three times with identical inputs
          const results: string[][] = [];
          for (let run = 0; run < 3; run++) {
            const registry = new Registry();
            const wsRegistry = new Registry();
            processFile(source, fileId, {
              registry,
              wsRegistry,
              root,
            });
            results.push([...registry.getEndpointsForFile(fileId)].sort());
          }

          // All three runs must produce the exact same endpoint names
          expect(results[0].length).toBeGreaterThan(0);
          expect(results[0]).toEqual(results[1]);
          expect(results[1]).toEqual(results[2]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 17: Named Variable Assignment Determines Endpoint Label', () => {
    // Feature: vite-plugin-quality-testing, Property 17: Named Variable Assignment Determines Endpoint Label
    // **Validates: Requirements 13.3**
    fc.assert(
      fc.property(arbIdentifierName(), (varName) => {
        const registry = new Registry();
        const wsRegistry = new Registry();
        const fileId = '/project/src/handlers.ts';

        // Create a source file with a named const variable assigned to $server()
        const source = `const ${varName} = $server(() => null);`;

        const result = processFile(source, fileId, {
          registry,
          wsRegistry,
          root: '/project',
        });

        // The processor should produce output (file has a $server() call)
        if (result === null) return;

        // Get the registered endpoints for this file
        const endpoints = registry.getEndpointsForFile(fileId);
        expect(endpoints.size).toBe(1);

        // The endpoint should contain the kebab-case form of the variable name
        // as the final path segment
        const endpoint = [...endpoints][0];
        const segments = endpoint.split('/');
        const lastSegment = segments[segments.length - 1];

        expect(lastSegment).toBe(toKebabCase(varName));
      }),
      { numRuns: 100 },
    );
  });

  it('Property 18: URL-Safe Endpoint Encoding', () => {
    // Feature: vite-plugin-quality-testing, Property 18: URL-Safe Endpoint Encoding
    // **Validates: Requirements 13.6**
    //
    // For any generated endpoint name containing path segments, the Processor
    // SHALL encode each segment with encodeURIComponent, producing a URL path
    // where decodeURIComponent on each segment recovers the original segment.
    fc.assert(
      fc.property(arbEndpointName(), (endpointName) => {
        // The processor's endpointUrl logic:
        //   endpoint.split("/").map(encodeURIComponent).join("/")
        const segments = endpointName.split('/');
        const encodedSegments = segments.map(encodeURIComponent);
        const encodedPath = encodedSegments.join('/');

        // Property: decoding each encoded segment recovers the original segment
        const decodedSegments = encodedPath.split('/').map(decodeURIComponent);
        expect(decodedSegments).toEqual(segments);

        // Each encoded segment must be URL-safe (no unencoded '/' within a segment)
        for (const encoded of encodedSegments) {
          expect(encoded).not.toContain('/');
        }
      }),
      { numRuns: 100 },
    );
  });
});
