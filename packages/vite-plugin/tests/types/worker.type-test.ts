/// <reference path="../../worker.d.ts" />
import { describe, expectTypeOf, it } from 'vitest';
import type { WorkerClient } from '../../worker';

describe('$worker type inference', () => {
  it('infers every method parameter tuple and awaited result independently', () => {
    const worker = $worker(() => ({
      increment(value: number, by = 1) {
        return value + by;
      },
      async label(prefix: string, ...ids: number[]) {
        return ids.map((id) => `${prefix}${id}`);
      },
      reset() {},
    }));

    expectTypeOf(worker.increment).parameters.toEqualTypeOf<[
      value: number,
      by?: number,
    ]>();
    expectTypeOf(worker.increment).returns.toEqualTypeOf<Promise<number>>();
    expectTypeOf(worker.label).parameters.toEqualTypeOf<[
      prefix: string,
      ...ids: number[],
    ]>();
    expectTypeOf(worker.label).returns.toEqualTypeOf<Promise<string[]>>();
    expectTypeOf(worker.reset).returns.toEqualTypeOf<Promise<void>>();
  });

  it('supports async factories and named worker interfaces', () => {
    interface Calculator {
      add(left: number, right: number): number;
      format(value: number): Promise<string>;
    }

    const worker = $worker(async (): Promise<Calculator> => ({
      add: (left, right) => left + right,
      format: async (value) => String(value),
    }));

    expectTypeOf(worker).toEqualTypeOf<WorkerClient<Calculator>>();
    expectTypeOf(worker.add).toBeCallableWith(1, 2);
    expectTypeOf(worker.format).returns.toEqualTypeOf<Promise<string>>();
  });

  it('rejects non-callable worker properties', () => {
    $worker(() => ({
      run() {},
      // @ts-expect-error worker contexts may only expose methods
      state: 1,
    }));
  });
});
