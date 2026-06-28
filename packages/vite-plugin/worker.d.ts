/**
 * Ambient declaration for the `$worker()` macro injected by vite-plugin-server-sugar.
 *
 * Creates a dedicated Web Worker thread with shared context. The factory runs
 * once inside the worker and the returned object's methods are exposed to the
 * main thread as async functions. All methods share the same worker thread and
 * closure state, so variables defined in the factory persist across calls.
 *
 * Calling `$server()` or `$ws()` functions from inside the worker just works —
 * `fetch` and `WebSocket` are available in Web Workers.
 *
 * @example
 *   export const counterWorker = $worker(() => {
 *     let count = 0;
 *     function increment() { return ++count; }
 *     function reset() { count = 0; }
 *     function getCount() { return count; }
 *     return { increment, reset, getCount };
 *   });
 *   // counterWorker.increment: () => Promise<number>
 *   // counterWorker.getCount:  () => Promise<number>
 *   await counterWorker.increment(); // → 1
 *   await counterWorker.increment(); // → 2  (shared state)
 *
 * @example Calling $server() siblings from inside the worker
 *   const getItems = $server(async () => db.query(...).all());
 *
 *   export const processorWorker = $worker(() => {
 *     async function process(limit: number) {
 *       const items = await getItems(); // fetch call — works in workers
 *       return items.slice(0, limit).map(i => i.name.toUpperCase());
 *     }
 *     return { process };
 *   });
 *   // processorWorker.process: (limit: number) => Promise<string[]>
 */
declare function $worker<T extends Record<string, (...args: any[]) => any>>(
  factory: () => T | Promise<T>,
): { [K in keyof T]: (...args: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>> };
