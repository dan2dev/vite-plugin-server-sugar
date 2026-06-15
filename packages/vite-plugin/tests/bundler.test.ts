import { describe, expect, test } from 'bun:test';
import { compileTargets } from '../src/build/bundler';

describe('Bundler compile targets', () => {
  test('includes every supported standalone Bun target', () => {
    expect(compileTargets).toEqual([
      'bun-darwin-x64',
      'bun-darwin-arm64',
      'bun-linux-x64',
      'bun-linux-arm64',
      'bun-linux-x64-musl',
      'bun-linux-arm64-musl',
      'bun-windows-x64',
      'bun-windows-arm64',
    ]);
  });
});
