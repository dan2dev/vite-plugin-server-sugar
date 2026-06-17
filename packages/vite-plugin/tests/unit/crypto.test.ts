import { describe, it, expect } from 'vitest';
import {
  hash,
  toKebabCase,
  actionConstName,
  wsConstName,
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

  describe('actionConstName', () => {
    it('handles endpoints with / characters', () => {
      const result = actionConstName('/api/users');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with . characters', () => {
      const result = actionConstName('api.users.get');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with @ characters', () => {
      const result = actionConstName('@scope/package');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with mixed special characters', () => {
      const result = actionConstName('/api/@user/profile.get');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('produces consistent output for the same input', () => {
      const result1 = actionConstName('/api/todos');
      const result2 = actionConstName('/api/todos');
      expect(result1).toBe(result2);
    });

    it('starts with __action_ prefix', () => {
      const result = actionConstName('test');
      expect(result).toMatch(/^__action_/);
    });
  });

  describe('wsConstName', () => {
    it('handles endpoints with / characters', () => {
      const result = wsConstName('/ws/chat');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with . characters', () => {
      const result = wsConstName('ws.chat.room');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with @ characters', () => {
      const result = wsConstName('@scope/socket');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('handles endpoints with mixed special characters', () => {
      const result = wsConstName('/ws/@room/live.stream');
      expect(result).toMatch(VALID_JS_IDENTIFIER);
    });

    it('produces consistent output for the same input', () => {
      const result1 = wsConstName('/ws/chat');
      const result2 = wsConstName('/ws/chat');
      expect(result1).toBe(result2);
    });

    it('starts with __ws_ prefix', () => {
      const result = wsConstName('test');
      expect(result).toMatch(/^__ws_/);
    });
  });
});
