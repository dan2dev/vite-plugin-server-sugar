import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { transpileTs } from '../../src/core/transpiler';

describe('Transpiler Property Tests', () => {
  it('Property 4: Transpiler Round-Trip Evaluation', () => {
    // Feature: vite-plugin-quality-testing, Property 4: Transpiler Round-Trip Evaluation
    // **Validates: Requirements 2.5**
    //
    // For any valid TypeScript expression consisting of pure arithmetic/string operations,
    // the result of evaluating transpileTs(expr) as JavaScript SHALL produce the same value
    // as evaluating the original expression in a TypeScript-aware context.

    // Generator for pure arithmetic expressions (no division to avoid division by zero)
    const arbArithmeticExpr = fc.oneof(
      // Simple integer literals
      fc.integer({ min: -1000, max: 1000 }).map((n) => String(n)),
      // Binary arithmetic: a op b
      fc
        .tuple(
          fc.integer({ min: -1000, max: 1000 }),
          fc.constantFrom('+', '-', '*'),
          fc.integer({ min: -1000, max: 1000 }),
        )
        .map(([a, op, b]) => `(${a} ${op} ${b})`),
      // Nested arithmetic: (a op b) op c
      fc
        .tuple(
          fc.integer({ min: -100, max: 100 }),
          fc.constantFrom('+', '-', '*'),
          fc.integer({ min: -100, max: 100 }),
          fc.constantFrom('+', '-', '*'),
          fc.integer({ min: -100, max: 100 }),
        )
        .map(([a, op1, b, op2, c]) => `((${a} ${op1} ${b}) ${op2} ${c})`),
    );

    // Generator for pure string expressions
    const arbStringExpr = fc.oneof(
      // Simple string literals (avoid problematic characters)
      fc
        .string({ minLength: 0, maxLength: 10, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')) })
        .map((s) => `"${s}"`),
      // String concatenation
      fc
        .tuple(
          fc.string({ minLength: 0, maxLength: 5, unit: fc.constantFrom(...'abcdefgh'.split('')) }),
          fc.string({ minLength: 0, maxLength: 5, unit: fc.constantFrom(...'ijklmnop'.split('')) }),
        )
        .map(([a, b]) => `"${a}" + "${b}"`),
      // Template literals with numeric expressions
      fc
        .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }))
        .map(([a, b]) => `\`\${${a} + ${b}}\``),
    );

    // Combined generator for pure expressions
    const arbPureExpr = fc.oneof(arbArithmeticExpr, arbStringExpr);

    fc.assert(
      fc.property(arbPureExpr, (expr) => {
        const transpiled = transpileTs(expr);

        // Evaluate both the original expression and the transpiled output
        // Since these are pure arithmetic/string expressions with no type annotations,
        // both should produce the same value
        const originalValue = eval(expr);
        const transpiledValue = eval(transpiled);

        expect(transpiledValue).toEqual(originalValue);
      }),
      { numRuns: 100 },
    );
  });
});
