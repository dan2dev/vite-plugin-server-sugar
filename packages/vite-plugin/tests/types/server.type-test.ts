/// <reference path="../../server.d.ts" />
import { describe, expectTypeOf, it } from 'vitest';

/**
 * Type tests for $server() type inference.
 *
 * Validates: Requirements 10.1, 10.2, 10.6
 */
describe('server type inference', () => {
  it('infers matching client wrapper parameter types from typed parameters', () => {
    // **Validates: Requirements 10.1**
    const wrapper = $server((x: number, y: string) => ({ x, y }));

    expectTypeOf(wrapper).parameter(0).toEqualTypeOf<number>();
    expectTypeOf(wrapper).parameter(1).toEqualTypeOf<string>();
    expectTypeOf(wrapper).parameters.toEqualTypeOf<[number, string]>();
  });

  it('infers Promise<Awaited<R>> return type on client', () => {
    // **Validates: Requirements 10.2**
    const syncWrapper = $server((x: number) => x * 2);
    expectTypeOf(syncWrapper).returns.toEqualTypeOf<Promise<number>>();

    const asyncWrapper = $server(async (name: string) => ({ name, id: 1 }));
    expectTypeOf(asyncWrapper).returns.toEqualTypeOf<Promise<{ name: string; id: number }>>();

    // Nested Promise should be flattened via Awaited
    const nestedPromise = $server(async () => Promise.resolve(42));
    expectTypeOf(nestedPromise).returns.toEqualTypeOf<Promise<number>>();
  });

  it('produces compile error when passing non-function to $server()', () => {
    // **Validates: Requirements 10.6**
    // @ts-expect-error passing a string literal is not a valid function argument
    $server('not a function');

    // @ts-expect-error passing a number is not a valid function argument
    $server(42);

    // @ts-expect-error passing an object is not a valid function argument
    $server({ key: 'value' });
  });
});
