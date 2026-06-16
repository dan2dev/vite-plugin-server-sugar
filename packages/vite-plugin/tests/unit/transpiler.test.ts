import { describe, it, expect } from 'vitest';
import { transpileTs, transpileStatements } from '../../src/core/transpiler';

describe('transpiler', () => {
  describe('transpileTs — arrow function type annotation stripping', () => {
    it('strips parameter and return type annotations from arrow function', () => {
      const input = '(x: number): string => x.toString()';
      const result = transpileTs(input);
      expect(result).toBe('(x) => x.toString()');
    });

    it('does not produce a trailing semicolon', () => {
      const input = '(a: string, b: number): boolean => a.length > b';
      const result = transpileTs(input);
      expect(result).not.toMatch(/;$/);
    });

    it('strips async arrow function type annotations', () => {
      const input = 'async (x: number): Promise<string> => x.toString()';
      const result = transpileTs(input);
      expect(result).toBe('async (x) => x.toString()');
    });
  });

  describe('transpileTs — generic type parameter removal', () => {
    it('removes generic type parameters while preserving function body', () => {
      const input = '<T>(x: T): T => x';
      const result = transpileTs(input);
      expect(result).toBe('(x) => x');
    });

    it('removes multiple generic type parameters', () => {
      const input = '<T, U>(x: T, y: U): [T, U] => [x, y]';
      const result = transpileTs(input);
      expect(result).toBe('(x, y) => [x, y]');
    });

    it('removes constrained generic type parameters', () => {
      const input = '<T extends string>(x: T): T => x';
      const result = transpileTs(input);
      expect(result).toBe('(x) => x');
    });
  });

  describe('transpileStatements — export modifier stripping', () => {
    it('strips export from a const declaration', () => {
      const input = 'export const foo = 1;';
      const result = transpileStatements(input);
      expect(result).toBe('const foo = 1;');
    });

    it('strips export from a function declaration', () => {
      const input = 'export function bar() { return 42; }';
      const result = transpileStatements(input);
      expect(result).toBe('function bar() { return 42; }');
    });

    it('strips export default from a function declaration', () => {
      const input = 'export default function baz() { return 99; }';
      const result = transpileStatements(input);
      expect(result).toBe('function baz() { return 99; }');
    });

    it('strips export default from an expression', () => {
      const input = 'export default 42;';
      const result = transpileStatements(input);
      expect(result).toBe('42;');
    });

    it('strips export from multiple statements', () => {
      const input = 'export const a = 1;\nexport const b = 2;';
      const result = transpileStatements(input);
      expect(result).toBe('const a = 1;\nconst b = 2;');
    });
  });

  describe('transpileTs — "use strict" directive removal', () => {
    it('removes "use strict" directive from expression output', () => {
      const input = '(x: number) => x + 1';
      const result = transpileTs(input);
      expect(result).not.toContain('use strict');
      expect(result).toBe('(x) => x + 1');
    });
  });

  describe('transpileStatements — "use strict" directive removal', () => {
    it('removes "use strict" directive from statement output', () => {
      const input = 'const x: number = 42;';
      const result = transpileStatements(input);
      expect(result).not.toContain('use strict');
      expect(result).toBe('const x = 42;');
    });
  });
});
