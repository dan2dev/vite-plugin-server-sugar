import { describe, it, expect } from 'vitest';
import {
  hash,
  toKebabCase,
  backendConstName,
  websocketConstName,
} from '../../src/utils/crypto';

const VALID_JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

describe('crypto utilities', () => {
  describe('hash', () => {
    it('returns a consistent 8-character hex string for the same input', () => {
      const result1 = hash('hello');
      const result2 = hash('hello');
      expect(result1).toBe(result2);
      expect(result1).toHaveLength(8);
      expect(result1).toMatch(/^[0-9a-f]{8}$/);
    });

    it('returns different hashes for different inputs', () => {
      expect(hash('foo')).not.toBe(hash('bar'));
    });

    it('handles empty string input', () => {
      const result = hash('');
      expect(result).toHaveLength(8);
      expect(result).toMatch(/^[0-9a-f]{8}$/);
    });

    it('handles unicode input', () => {
      const result = hash('こんにちは');
      expect(result).toHaveLength(8);
      expect(result).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('toKebabCase', () => {
    it('converts camelCase to kebab-case', () => {
      expect(toKebabCase('camelCase')).toBe('camel-case');
    });

    it('converts PascalCase to kebab-case', () => {
      expect(toKebabCase('PascalCase')).toBe('pascal-case');
    });

    it('replaces spaces with hyphens', () => {
      expect(toKebabCase('hello world')).toBe('hello-world');
    });

    it('replaces underscores with hyphens', () => {
      expect(toKebabCase('hello_world')).toBe('hello-world');
    });

    it('replaces dots with hyphens', () => {
      expect(toKebabCase('hello.world')).toBe('hello-world');
    });

    it('produces lowercase output', () => {
      const result = toKebabCase('SomeComplexName');
      expect(result).toBe(result.toLowerCase());
    });

    it('does not produce consecutive hyphens', () => {
      const result = toKebabCase('hello__world');
      expect(result).not.toMatch(/--/);
    });

    it('handles multiple consecutive separators without producing consecutive hyphens', () => {
      const result = toKebabCase('a___b...c   d');
      expect(result).not.toMatch(/--/);
    });
  });

  describe('backendConstName', () => {
    it('handles endpoints with / characters', () => {
      const result = backendConstName('/api/users');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with . characters', () => {
      const result = backendConstName('api.users.get');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with @ characters', () => {
      const result = backendConstName('@scope/package');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with mixed special characters', () => {
      const result = backendConstName('/api/@user/profile.get');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('produces consistent output for the same input', () => {
      const result1 = backendConstName('/api/todos');
      const result2 = backendConstName('/api/todos');
      expect(result1).toBe(result2);
    });

    it('starts with __backend_ prefix', () => {
      const result = backendConstName('test');
      expect(result).toMatch(/^__backend_/);
    });
  });

  describe('websocketConstName', () => {
    it('handles endpoints with / characters', () => {
      const result = websocketConstName('/ws/chat');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with . characters', () => {
      const result = websocketConstName('ws.chat.room');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with @ characters', () => {
      const result = websocketConstName('@scope/socket');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with mixed special characters', () => {
      const result = websocketConstName('/ws/@room/live.stream');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('produces consistent output for the same input', () => {
      const result1 = websocketConstName('/ws/chat');
      const result2 = websocketConstName('/ws/chat');
      expect(result1).toBe(result2);
    });

    it('starts with __ws_ prefix', () => {
      const result = websocketConstName('test');
      expect(result).toMatch(/^__ws_/);
    });
  });
});
