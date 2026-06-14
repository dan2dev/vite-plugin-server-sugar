declare function backend<Args extends unknown[], R>(
  fn: (...args: Args) => R | Promise<R>,
): (...args: Args) => Promise<Awaited<R>>;
