import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { hash, actionConstName, wsConstName, toKebabCase } from '../../src/utils/crypto';
import { arbIdentifierName, arbEndpointName } from '../helpers/generators';

describe('Crypto Utilities', () => {
  it('Property 5: Crypto Hash Determinism and Format', () => {
    // Feature: vite-plugin-quality-testing, Property 5: Crypto Hash Determinism and Format
    // **Validates: Requirements 9.1**
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result1 = hash(s);
        const result2 = hash(s);

        // Determinism: hash(s) === hash(s) across invocations
        expect(result1).toBe(result2);

        // Length: always 8 characters
        expect(result1.length).toBe(8);

        // Format: lowercase hexadecimal
        expect(result1).toMatch(/^[0-9a-f]{8}$/);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 6: Crypto Functions Produce Valid JavaScript Identifiers', () => {
    // Feature: vite-plugin-quality-testing, Property 6: Crypto Functions Produce Valid JavaScript Identifiers
    // **Validates: Requirements 9.3, 9.4**
    const validIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

    // Test with arbitrary strings (including special characters like /, ., @, spaces)
    fc.assert(
      fc.property(fc.string(), (s) => {
        const actionName = actionConstName(s);
        const wsName = wsConstName(s);

        expect(actionName).toMatch(validIdentifierPattern);
        expect(wsName).toMatch(validIdentifierPattern);
      }),
      { numRuns: 100 },
    );

    // Test with realistic endpoint names from generator
    fc.assert(
      fc.property(arbEndpointName(), (s) => {
        const actionName = actionConstName(s);
        const wsName = wsConstName(s);

        expect(actionName).toMatch(validIdentifierPattern);
        expect(wsName).toMatch(validIdentifierPattern);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 7: toKebabCase Output Format Invariant', () => {
    // Feature: vite-plugin-quality-testing, Property 7: toKebabCase Output Format Invariant
    // **Validates: Requirements 9.2**

    // Test with arbitrary strings: output is lowercase and has no consecutive hyphens
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = toKebabCase(s);

        // (1) Result is entirely lowercase
        expect(result).toBe(result.toLowerCase());

        // (2) No consecutive hyphens
        expect(result).not.toContain('--');
      }),
      { numRuns: 100 },
    );

    // Test with identifier names (typical real-world inputs like camelCase, PascalCase)
    // These inputs produce clean kebab-case output (only lowercase letters, digits, and hyphens)
    fc.assert(
      fc.property(arbIdentifierName(), (s) => {
        const result = toKebabCase(s);

        // (1) Result is entirely lowercase
        expect(result).toBe(result.toLowerCase());

        // (2) Uses hyphens as separators (only lowercase letters, digits, and hyphens)
        if (result.length > 0) {
          expect(result).toMatch(/^[a-z0-9-]+$/);
        }

        // (3) No consecutive hyphens
        expect(result).not.toContain('--');
      }),
      { numRuns: 100 },
    );
  });
});
