/** Structural constraint for the callable properties exposed by a worker. */
export type WorkerMethods<T extends object> = {
  [K in keyof T]: (...args: never[]) => unknown;
};

/** Async client proxy generated from a `$worker()` factory result. */
export type WorkerClient<T extends WorkerMethods<T>> = {
  [K in keyof T]: T[K] extends (...args: infer TArgs) => infer TReturn
    ? (...args: TArgs) => Promise<Awaited<TReturn>>
    : never;
};

declare global {
  /**
   * Creates a dedicated Web Worker whose returned methods become typed async
   * client proxies. Parameter tuples and awaited return values are inferred
   * independently for every method.
   */
  function $worker<T extends WorkerMethods<T>>(
    factory: () => T | PromiseLike<T>,
  ): WorkerClient<T>;
}
