export interface RuntimeImport {
  defaultName?: string;
  namespaceName?: string;
  named: Array<{ imported: string; local: string }>;
  specifier: string;
}

export interface ServerEntry {
  endpoint: string;
  imports: RuntimeImport[];
  /** Transpiled JS arrow-function expression (types stripped). */
  fnJs: string;
  file: string;
  /**
   * Original source identifier when the handler is assigned via
   * `const originalName = $server(...)`. Used by the bundle generator to
   * declare named locals inside the per-file IIFE so sibling handlers can
   * call each other by their original names.
   */
  originalName?: string;
  /**
   * True when at least one handler in this file references another sibling
   * handler by its original name. Causes the bundle generator to use IIFE
   * mode even when there is no shared module-level state.
   */
  hasSiblingCrossRefs?: boolean;
  /**
   * Transpiled JS of module-level (non-import) declarations from the source
   * file that are not $server handlers. All entries from the same file share
   * the same value. When non-empty, the bundle generator wraps all handlers
   * from this file in a per-file IIFE so they close over the same state.
   */
  moduleDeclsJs?: string;
}

export interface WsEntry {
  endpoint: string;
  imports: RuntimeImport[];
  /**
   * Transpiled JS object-expression (types stripped) with the optional
   * `onOpen` / `onMessage` / `onClose` handlers, e.g. `({ onMessage(ws, data) {...} })`.
   */
  handlersJs: string;
  file: string;
  /**
   * Original source identifier when assigned via `const x = $ws(...)`.
   * Used by the bundle generator to declare named locals inside the per-file
   * IIFE so sibling handlers ($server or $ws) can reference each other.
   */
  originalName?: string;
  /**
   * True when at least one handler in this file references another sibling
   * handler ($server or $ws) by its original name.
   */
  hasSiblingCrossRefs?: boolean;
  /**
   * Transpiled JS of module-level declarations shared with sibling $server()/
   * $ws() handlers from the same file. See {@link ServerEntry.moduleDeclsJs}.
   */
  moduleDeclsJs?: string;
}

export interface InvalidationGraph<TModule> {
  getModuleById(id: string): TModule | undefined;
  invalidateModule(
    mod: TModule,
    seen?: Set<TModule>,
    timestamp?: number,
    isHmr?: boolean,
    softInvalidate?: boolean,
  ): void;
}

export interface WorkerEntry {
  endpoint: string;
  imports: RuntimeImport[];
  /** Transpiled JS arrow-function expression (types stripped). */
  fnJs: string;
  file: string;
  originalName?: string;
  hasSiblingCrossRefs?: boolean;
  moduleDeclsJs?: string;
  /** Client-side fetch stubs for same-file $server() siblings referenced by the worker body. */
  siblingServerStubs: Array<{ name: string; url: string }>;
  /** Client-side connect stubs for same-file $ws() siblings referenced by the worker body. */
  siblingWsStubs: Array<{ name: string; url: string }>;
}

export interface ServerBuildPluginOptions {
  /** Port for the generated production Bun server. Default: 3001 */
  port?: number;
  /** Hono app entry point for custom endpoints. */
  serverEntry?: string;
  /**
   * Compile standalone Bun executables for every supported target. Default: false.
   * Requires either Bun runtime (`globalThis.Bun`) or `bun` available on PATH.
   */
  compile?: boolean;
}

export interface FetchApp {
  fetch(request: Request): Response | Promise<Response>;
}
