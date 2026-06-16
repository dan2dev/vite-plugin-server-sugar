/// <reference path="../../backend.d.ts" />
import { describe, expectTypeOf, it } from 'vitest';

/**
 * Type tests for backend() type inference.
 *
 * Validates: Requirements 10.1, 10.2, 10.6
 */
describe('backend type inference', () => {
  it('infers matching client wrapper parameter types from typed parameters', () => {
    // **Validates: Requirements 10.1**
    const wrapper = backend((x: number, y: string) => ({ x, y }));

    expectTypeOf(wrapper).parameter(0).toEqualTypeOf<number>();
    expectTypeOf(wrapper).parameter(1).toEqualTypeOf<string>();
    expectTypeOf(wrapper).parameters.toEqualTypeOf<[number, string]>();
  });

  it('infers Promise<Awaited<R>> return type on client', () => {
    // **Validates: Requirements 10.2**
    const syncWrapper = backend((x: number) => x * 2);
    expectTypeOf(syncWrapper).returns.toEqualTypeOf<Promise<number>>();

    const asyncWrapper = backend(async (name: string) => ({ name, id: 1 }));
    expectTypeOf(asyncWrapper).returns.toEqualTypeOf<Promise<{ name: string; id: number }>>();

    // Nested Promise should be flattened via Awaited
    const nestedPromise = backend(async () => Promise.resolve(42));
    expectTypeOf(nestedPromise).returns.toEqualTypeOf<Promise<number>>();
  });

  it('produces compile error when passing non-function to backend()', () => {
    // **Validates: Requirements 10.6**
    // @ts-expect-error passing a string literal is not a valid function argument
    backend('not a function');

    // @ts-expect-error passing a number is not a valid function argument
    backend(42);

    // @ts-expect-error passing an object is not a valid function argument
    backend({ key: 'value' });
  });
});
