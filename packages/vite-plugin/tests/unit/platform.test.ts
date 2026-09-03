import { describe, it, expect } from 'vitest';
import { resolvePlatform } from '../../src/build/platform';

describe('resolvePlatform', () => {
  it('defaults to "hono" when platform is not set', () => {
    expect(resolvePlatform({})).toBe('hono');
  });

  it('accepts "hono" explicitly', () => {
    expect(resolvePlatform({ platform: 'hono' })).toBe('hono');
  });

  it('accepts "cloudflare-worker"', () => {
    expect(resolvePlatform({ platform: 'cloudflare-worker' })).toBe('cloudflare-worker');
  });

  it('throws a descriptive error for an unknown platform value', () => {
    expect(() =>
      // @ts-expect-error intentionally invalid to exercise the runtime guard
      resolvePlatform({ platform: 'netlify-edge' }),
    ).toThrow(/Invalid platform "netlify-edge"/);
  });

  it('throws when compile is combined with cloudflare-worker', () => {
    expect(() =>
      resolvePlatform({ platform: 'cloudflare-worker', compile: true }),
    ).toThrow(/"compile".*platform: "hono"/);
  });

  it('allows compile with the default (hono) platform', () => {
    expect(resolvePlatform({ compile: true })).toBe('hono');
  });

  it('allows compile: false with cloudflare-worker', () => {
    expect(resolvePlatform({ platform: 'cloudflare-worker', compile: false })).toBe(
      'cloudflare-worker',
    );
  });
});
