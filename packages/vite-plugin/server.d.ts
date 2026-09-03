/** A value returned synchronously or through any Promise-compatible object. */
export type Awaitable<T> = T | PromiseLike<T>;

/** Query values accepted by the generated URLSearchParams client. */
export type ServerQueryValue = string | undefined;

/**
 * Ensures every declared property in a query object is a string (or an
 * optional string) without requiring an index signature. This means both
 * object type aliases and named interfaces are accepted.
 */
export type ServerQueryShape<TQuery extends object> = {
  [K in keyof TQuery]: ServerQueryValue;
};

export type UntypedServerQuery = Record<string, string>;

interface ServerSugarContextRequest<
  TBody = unknown,
  TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
> {
  readonly raw: Request;
  readonly url: string;
  readonly method: string;
  param(key: string): string | undefined;
  param(): Record<string, string>;
  query<K extends string & keyof TQuery>(
    key: K,
  ): string extends keyof TQuery ? string | undefined : TQuery[K];
  query(key: string): string | undefined;
  query(): string extends keyof TQuery ? Record<string, string> : TQuery;
  header(name: string): string | undefined;
  header(): Record<string, string>;
  json(): Promise<TBody>;
  text(): Promise<string>;
}

interface ServerSugarContext<
  TBody = unknown,
  TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
> {
  req: ServerSugarContextRequest<TBody, TQuery>;
}

interface ServerSugarFetchOptions {
  headers?: Readonly<Record<string, string>>;
}

/** Typed request facade exposed as `ServerContext.req`. */
export type ServerContextRequest<
  TBody = unknown,
  TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
> = ServerSugarContextRequest<TBody, TQuery>;

/**
 * Context passed to HTTP method handlers.
 *
 * @example
 * `ServerContext<{ name: string }, { dryRun?: string }>`
 */
export type ServerContext<
  TBody = unknown,
  TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
> = ServerSugarContext<TBody, TQuery>;

/** Extra options accepted by generated HTTP clients. */
export type FetchOptions = ServerSugarFetchOptions;

/** Client function produced from a `$server()` handler. */
export type ServerFunction<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> = (...args: TArgs) => Promise<Awaited<TReturn>>;

/** Client function produced by `$get()`, `$delete()`, or `$head()`. */
export type QueryServerFunction<
  TQuery extends ServerQueryShape<TQuery>,
  TReturn,
> = string extends keyof TQuery
  ? (
      query?: UntypedServerQuery,
      options?: FetchOptions,
    ) => Promise<Awaited<TReturn>>
  : (query: TQuery, options?: FetchOptions) => Promise<Awaited<TReturn>>;

/** Client function produced by `$post()`, `$put()`, or `$patch()`. */
export type BodyServerFunction<
  TBody,
  TQuery extends ServerQueryShape<TQuery>,
  TReturn,
> = string extends keyof TQuery
  ? (
      body: TBody,
      query?: UntypedServerQuery,
      options?: FetchOptions,
    ) => Promise<Awaited<TReturn>>
  : (
      body: TBody,
      query: TQuery,
      options?: FetchOptions,
    ) => Promise<Awaited<TReturn>>;

declare global {
  /**
   * Ambient declaration for the `$server()` macro injected by
   * vite-plugin-server-sugar. Parameters, including optional and rest
   * parameters, and the awaited return type are inferred from the handler.
   *
   * @example
   * const getUser = $server(async (id: string) => ({ id, name: "Ada" }));
   * // (id: string) => Promise<{ id: string; name: string }>
   */
  function $server<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn,
  ): ServerFunction<TArgs, TReturn>;

  /**
   * Request wrapper available to HTTP method handlers. It is the common
   * subset implemented by the built-in development context and Hono.
   */
  interface ServerContextRequest<
    TBody = unknown,
    TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
  > extends ServerSugarContextRequest<TBody, TQuery> {}

  /** Context passed to `$get()`, `$post()`, and the other HTTP macros. */
  interface ServerContext<
    TBody = unknown,
    TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
  > extends ServerSugarContext<TBody, TQuery> {}

  /** Extra options accepted by generated HTTP clients. */
  interface FetchOptions extends ServerSugarFetchOptions {}

  function $get<
    TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
    TReturn = unknown,
  >(
    fn: (c: ServerContext<never, TQuery>) => TReturn,
  ): QueryServerFunction<TQuery, TReturn>;

  function $post<
    TBody = unknown,
    TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
    TReturn = unknown,
  >(
    fn: (c: ServerContext<TBody, TQuery>) => TReturn,
  ): BodyServerFunction<TBody, TQuery, TReturn>;

  function $put<
    TBody = unknown,
    TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
    TReturn = unknown,
  >(
    fn: (c: ServerContext<TBody, TQuery>) => TReturn,
  ): BodyServerFunction<TBody, TQuery, TReturn>;

  function $patch<
    TBody = unknown,
    TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
    TReturn = unknown,
  >(
    fn: (c: ServerContext<TBody, TQuery>) => TReturn,
  ): BodyServerFunction<TBody, TQuery, TReturn>;

  function $delete<
    TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
    TReturn = unknown,
  >(
    fn: (c: ServerContext<never, TQuery>) => TReturn,
  ): QueryServerFunction<TQuery, TReturn>;

  function $head<
    TQuery extends ServerQueryShape<TQuery> = UntypedServerQuery,
    TReturn = unknown,
  >(
    fn: (c: ServerContext<never, TQuery>) => TReturn,
  ): QueryServerFunction<TQuery, TReturn>;
}
