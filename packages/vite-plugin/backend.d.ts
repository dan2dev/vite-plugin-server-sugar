/**
 * Ambient declaration for the `backend()` macro injected by vite-plugin-server-build.
 *
 * - On the server the original function runs directly.
 * - In the browser it is replaced with a typed `fetch` wrapper.
 *
 * The argument tuple `Args` and resolved return type `R` are inferred
 * automatically from the function literal you pass in.
 *
 * @example
 *   export const getUser = backend(async (params: { id: string }) => {
 *     return { name: "Alice", id: params.id };
 *   });
 *   // inferred as: (params: { id: string }) => Promise<{ name: string; id: string }>
 */
declare function backend<Args extends unknown[], R>(
  fn: (...args: Args) => R | Promise<R>,
): (...args: Args) => Promise<Awaited<R>>;
