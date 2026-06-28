/**
 * Ambient declaration for the `$server()` macro injected by vite-plugin-server-sugar.
 *
 * - On the server the original function runs directly.
 * - In the browser it is replaced with a typed `fetch` wrapper.
 *
 * The argument tuple `Args` and resolved return type `R` are inferred
 * automatically from the function literal you pass in.
 *
 * @example
 *   export const getUser = $server(async (params: { id: string }) => {
 *     return { name: "Alice", id: params.id };
 *   });
 *   // inferred as: (params: { id: string }) => Promise<{ name: string; id: string }>
 */
declare function $server<Args extends unknown[], R>(
  fn: (...args: Args) => R | Promise<R>,
): (...args: Args) => Promise<Awaited<R>>;

/**
 * Request wrapper providing convenience methods for HTTP method handlers.
 * A subset of Hono's `HonoRequest` so that a real Hono context satisfies
 * this interface at runtime.
 *
 * @template TBody  — JSON body type (for `$post`/`$put`/`$patch`).
 * @template TQuery — Query-string shape. When explicitly provided (e.g.
 *   `{ id: string }`), `query(key)` returns the exact value type and the
 *   client-side stub requires the matching query object. When left as the
 *   default, `query(key)` returns `string | undefined` and the client-side
 *   query argument is optional.
 */
interface ServerContextRequest<TBody = unknown, TQuery extends Record<string, string> = Record<string, string>> {
  readonly raw: Request;
  readonly url: string;
  readonly method: string;
  param(key: string): string | undefined;
  param(): Record<string, string>;
  query<K extends string & keyof TQuery>(key: K): string extends keyof TQuery ? string | undefined : TQuery[K];
  query(key: string): string | undefined;
  query(): string extends keyof TQuery ? Record<string, string> : TQuery;
  header(name: string): string | undefined;
  header(): Record<string, string>;
  json(): Promise<TBody>;
  text(): Promise<string>;
}

/**
 * Context object passed to HTTP method handlers (`$get`, `$post`, etc.).
 * At runtime this is the Hono `Context` (production and dev-with-serverEntry)
 * or a lightweight compatible wrapper (dev without serverEntry).
 *
 * @template TBody  — JSON body type (inferred from `$post`/`$put`/`$patch`).
 * @template TQuery — Query-string shape.
 *
 * @example
 *   // Untyped query — client call is `getItems()` or `getItems({ page: "2" })`
 *   export const getItems = $get(async (c) => {
 *     const page = c.req.query('page');   // string | undefined
 *     return [{ id: 1 }];
 *   });
 *
 *   // Typed query — client call requires `getItem({ id: "123" })`
 *   export const getItem = $get(async (c: ServerContext<never, { id: string }>) => {
 *     const id = c.req.query('id');       // string (exact type)
 *     return { id };
 *   });
 *
 *   // Typed body — client call is `createItem({ name: "foo" })`
 *   export const createItem = $post(async (c: ServerContext<{ name: string }>) => {
 *     const body = await c.req.json();    // { name: string }
 *     return { id: 1, name: body.name };
 *   });
 */
interface ServerContext<TBody = unknown, TQuery extends Record<string, string> = Record<string, string>> {
  req: ServerContextRequest<TBody, TQuery>;
}

interface FetchOptions {
  headers?: Record<string, string>;
}

declare function $get<TQuery extends Record<string, string>, R>(
  fn: (c: ServerContext<never, TQuery>) => R | Promise<R>,
): string extends keyof TQuery
  ? (query?: Record<string, string>, options?: FetchOptions) => Promise<Awaited<R>>
  : (query: TQuery, options?: FetchOptions) => Promise<Awaited<R>>;

declare function $post<TBody, TQuery extends Record<string, string>, R>(
  fn: (c: ServerContext<TBody, TQuery>) => R | Promise<R>,
): string extends keyof TQuery
  ? (body: TBody, query?: Record<string, string>, options?: FetchOptions) => Promise<Awaited<R>>
  : (body: TBody, query: TQuery, options?: FetchOptions) => Promise<Awaited<R>>;

declare function $put<TBody, TQuery extends Record<string, string>, R>(
  fn: (c: ServerContext<TBody, TQuery>) => R | Promise<R>,
): string extends keyof TQuery
  ? (body: TBody, query?: Record<string, string>, options?: FetchOptions) => Promise<Awaited<R>>
  : (body: TBody, query: TQuery, options?: FetchOptions) => Promise<Awaited<R>>;

declare function $patch<TBody, TQuery extends Record<string, string>, R>(
  fn: (c: ServerContext<TBody, TQuery>) => R | Promise<R>,
): string extends keyof TQuery
  ? (body: TBody, query?: Record<string, string>, options?: FetchOptions) => Promise<Awaited<R>>
  : (body: TBody, query: TQuery, options?: FetchOptions) => Promise<Awaited<R>>;

declare function $delete<TQuery extends Record<string, string>, R>(
  fn: (c: ServerContext<never, TQuery>) => R | Promise<R>,
): string extends keyof TQuery
  ? (query?: Record<string, string>, options?: FetchOptions) => Promise<Awaited<R>>
  : (query: TQuery, options?: FetchOptions) => Promise<Awaited<R>>;

declare function $head<TQuery extends Record<string, string>, R>(
  fn: (c: ServerContext<never, TQuery>) => R | Promise<R>,
): string extends keyof TQuery
  ? (query?: Record<string, string>, options?: FetchOptions) => Promise<Awaited<R>>
  : (query: TQuery, options?: FetchOptions) => Promise<Awaited<R>>;
