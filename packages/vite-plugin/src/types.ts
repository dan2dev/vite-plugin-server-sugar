export interface RuntimeImport {
  defaultName?: string;
  namespaceName?: string;
  named: Array<{ imported: string; local: string }>;
  specifier: string;
}

export interface BackendEntry {
  endpoint: string;
  imports: RuntimeImport[];
  /** Transpiled JS arrow-function expression (types stripped). */
  fnJs: string;
  file: string;
  /**
   * Original source identifier when the handler is assigned via
   * `const originalName = backend(...)`. Used by the bundle generator to
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
   * file that are not backend handlers. All entries from the same file share
   * the same value. When non-empty, the bundle generator wraps all handlers
   * from this file in a per-file IIFE so they close over the same state.
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

export interface ServerBuildPluginOptions {
  /** Port for the generated production Bun server. Default: 3001 */
  port?: number;
  /** Hono app entry point for custom endpoints. */
  serverEntry?: string;
  /** Compile standalone Bun executables for every supported target. Default: false */
  compile?: boolean;
}

export interface FetchApp {
  fetch(request: Request): Response | Promise<Response>;
}
