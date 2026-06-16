import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import ts from 'typescript';
import { collectBoundNames, collectValueReferences } from '../../src/utils/ast';
import { arbIdentifierName } from '../helpers/generators';

/**
 * Helper: parse TypeScript code and return the SourceFile AST node.
 */
function parseSource(code: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Helper: find the first FunctionDeclaration in a source file.
 */
function findFunctionDeclaration(sf: ts.SourceFile): ts.FunctionDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) return stmt;
  }
  return undefined;
}

describe('AST Property Tests', () => {
  describe('Property 10: collectBoundNames Captures All Nested Declarations', () => {
    // Feature: vite-plugin-quality-testing, Property 10: collectBoundNames Captures All Nested Declarations
    // **Validates: Requirements 8.5**

    it('should capture all nested variable declarations, arrow functions, function declarations, class declarations, and catch clause bindings at arbitrary depths', () => {
      fc.assert(
        fc.property(
          // Generate between 2 and 5 unique identifier names for variable declarations
          fc.uniqueArray(arbIdentifierName(), { minLength: 2, maxLength: 5 }).filter((arr) => arr.length >= 2),
          // Generate between 1 and 3 unique identifier names for nested arrow functions
          fc.uniqueArray(arbIdentifierName(), { minLength: 1, maxLength: 3 }).filter((arr) => arr.length >= 1),
          // Generate a class name
          arbIdentifierName(),
          // Generate a catch clause variable name
          arbIdentifierName(),
          // Generate a nested function declaration name
          arbIdentifierName(),
          (varNames, arrowNames, className, catchVar, nestedFnName) => {
            // Ensure all names are unique across all groups to avoid conflicts
            const allNames = [...varNames, ...arrowNames, className, catchVar, nestedFnName];
            const uniqueNames = new Set(allNames);
            if (uniqueNames.size < allNames.length) return true; // skip if names collide

            // Build a function body with various declaration types at different nesting depths
            const varDecls = varNames.map((name, i) => `  const ${name} = ${i};`).join('\n');

            // Nested arrow functions assigned to const
            const arrowDecls = arrowNames
              .map((name) => `    const ${name} = () => { return 1; };`)
              .join('\n');

            // Build code with nested declarations at various depths
            const code = `function test() {
${varDecls}
  const nested = () => {
${arrowDecls}
  };
  function ${nestedFnName}() { return 0; }
  class ${className} { method() {} }
  try {} catch (${catchVar}) {}
}`;

            const sf = parseSource(code);
            const fnDecl = findFunctionDeclaration(sf);
            if (!fnDecl) return false;

            const boundNames = collectBoundNames(fnDecl);

            // All variable declarations should be captured
            for (const name of varNames) {
              if (!boundNames.has(name)) return false;
            }

            // All arrow function const names should be captured
            for (const name of arrowNames) {
              if (!boundNames.has(name)) return false;
            }

            // Class declaration name should be captured
            if (!boundNames.has(className)) return false;

            // Catch clause variable should be captured
            if (!boundNames.has(catchVar)) return false;

            // Nested function declaration name should be captured
            if (!boundNames.has(nestedFnName)) return false;

            // The 'nested' const (arrow function) should also be captured
            if (!boundNames.has('nested')) return false;

            return true;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should capture declarations at arbitrary nesting depths', () => {
      fc.assert(
        fc.property(
          // Generate unique names for each depth level
          fc.uniqueArray(arbIdentifierName(), { minLength: 3, maxLength: 6 }).filter((arr) => arr.length >= 3),
          // Depth of nesting (1-4)
          fc.integer({ min: 1, max: 4 }),
          (names, depth) => {
            // Build deeply nested code where each level introduces a variable
            let body = '';
            let indent = '  ';

            // Each name is declared inside a deeper nested block
            const usedNames = names.slice(0, Math.min(names.length, depth + 1));

            // First declaration at top level of function
            body += `${indent}const ${usedNames[0]} = 1;\n`;

            // Add deeper nested declarations
            for (let i = 1; i < usedNames.length; i++) {
              indent += '  ';
              if (i % 3 === 0) {
                // Nest in a class declaration
                body += `${indent}class Wrapper${i} {\n`;
                body += `${indent}  method() {\n`;
                body += `${indent}    const ${usedNames[i]} = ${i};\n`;
                body += `${indent}  }\n`;
                body += `${indent}}\n`;
              } else if (i % 3 === 1) {
                // Nest in an arrow function
                body += `${indent}const container${i} = () => {\n`;
                body += `${indent}  const ${usedNames[i]} = ${i};\n`;
                body += `${indent}};\n`;
              } else {
                // Nest in a block (if statement)
                body += `${indent}if (true) {\n`;
                body += `${indent}  const ${usedNames[i]} = ${i};\n`;
                body += `${indent}}\n`;
              }
            }

            const code = `function test() {\n${body}}`;

            const sf = parseSource(code);
            const fnDecl = findFunctionDeclaration(sf);
            if (!fnDecl) return false;

            const boundNames = collectBoundNames(fnDecl);

            // All names at any depth should be captured
            for (const name of usedNames) {
              if (!boundNames.has(name)) return false;
            }

            return true;
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 9: collectValueReferences Excludes Type-Only Identifiers', () => {
    // Feature: vite-plugin-quality-testing, Property 9: collectValueReferences Excludes Type-Only Identifiers
    // **Validates: Requirements 8.4**

    it('should exclude identifiers appearing exclusively in type annotations', () => {
      // Reserved words and built-in type names that should not be used as generated identifiers
      const reserved = new Set([
        'undefined', 'null', 'void', 'never', 'any', 'unknown',
        'number', 'string', 'boolean', 'object', 'symbol', 'bigint',
        'x', 'fn', 'return', 'true', 'false',
      ]);

      const arbTypeOnlyCode = fc
        .tuple(
          arbIdentifierName().filter((n) => !reserved.has(n)),
          arbIdentifierName().filter((n) => !reserved.has(n)),
        )
        .filter(([typeName, retType]) => typeName !== retType && typeName !== 'x' && retType !== 'x' && typeName !== 'fn' && retType !== 'fn')
        .map(([typeName, retType]) => ({
          typeName,
          retType,
          // TypeName and RetType appear only in type annotation positions
          code: `function fn(x: ${typeName}): ${retType} { return x; }`,
        }));

      fc.assert(
        fc.property(arbTypeOnlyCode, ({ typeName, retType, code }) => {
          const sourceFile = parseSource(code);
          const refs = collectValueReferences(sourceFile);

          // Type-only identifiers should NOT appear in value references
          expect(refs.has(typeName)).toBe(false);
          expect(refs.has(retType)).toBe(false);

          // Value identifier (x) SHOULD appear as it's used in `return x`
          expect(refs.has('x')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should exclude identifiers appearing exclusively in type arguments', () => {
      const reserved = new Set([
        'undefined', 'null', 'void', 'never', 'any', 'unknown',
        'number', 'string', 'boolean', 'object', 'symbol', 'bigint',
        'arr', 'Array', 'true', 'false',
      ]);

      const arbTypeArgCode = fc
        .tuple(arbIdentifierName().filter((n) => !reserved.has(n)))
        .map(([typeArg]) => ({
          typeArg,
          // TypeArg appears only as a type argument to Array<T>
          code: `const arr: Array<${typeArg}> = [];`,
        }));

      fc.assert(
        fc.property(arbTypeArgCode, ({ typeArg, code }) => {
          const sourceFile = parseSource(code);
          const refs = collectValueReferences(sourceFile);

          // Type argument identifier should NOT appear in value references
          expect(refs.has(typeArg)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('should exclude identifiers appearing exclusively in type assertion positions', () => {
      const reserved = new Set([
        'undefined', 'null', 'void', 'never', 'any', 'unknown',
        'number', 'string', 'boolean', 'object', 'symbol', 'bigint',
        'val', 'result', 'true', 'false',
      ]);

      const arbTypeAssertionCode = fc
        .tuple(arbIdentifierName().filter((n) => !reserved.has(n)))
        .map(([assertType]) => ({
          assertType,
          // assertType appears only in an `as` type assertion position
          code: `const val = 42; const result = val as unknown as ${assertType};`,
        }));

      fc.assert(
        fc.property(arbTypeAssertionCode, ({ assertType, code }) => {
          const sourceFile = parseSource(code);
          const refs = collectValueReferences(sourceFile);

          // Type assertion identifier should NOT appear in value references
          expect(refs.has(assertType)).toBe(false);

          // Value identifier 'val' SHOULD appear (used in `val as ...`)
          expect(refs.has('val')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});
