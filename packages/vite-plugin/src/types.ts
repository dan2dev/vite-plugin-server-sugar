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
}

export interface FetchApp {
  fetch(request: Request): Response | Promise<Response>;
}
