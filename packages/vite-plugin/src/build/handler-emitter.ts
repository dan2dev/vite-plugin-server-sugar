import type { Registry } from "../core/registry";
import type { ServerEntry, WsEntry } from "../types";
import { runtimeImportSpecifier } from "../dev-server/virtual-modules";
import { serverConstName, wsConstName } from "../utils/crypto";

/**
 * Shared codegen for the parts of the generated production server that are
 * identical across every target platform: collecting and aliasing runtime
 * imports, emitting per-file handler declarations (including the
 * shared-state IIFE), and building the `__serverHandlers`/`__wsHandlers`
 * lookup tables plus the RPC dispatch route. Platform-specific generators
 * (Bun + Hono in `bundle-generator.ts`, Cloudflare Workers in
 * `cloudflare-bundle-generator.ts`) compose these with their own
 * static-asset-serving and process-entry code.
 */

interface SpecifierBindings {
  default?: string;
  namespace?: string;
  named: Map<string, string>;
}

export interface FactoryArgs {
  locals: string[];
  aliases: string[];
}

export interface CollectedImports {
  /** Deduplicated top-level `import ... from '...';` lines. */
  importLines: string[];
  /**
   * Per-endpoint locals/aliases used to re-bind original import names inside
   * each handler's factory wrapper, keyed by `entry.endpoint`.
   */
  factoryArgsByEndpoint: Map<string, FactoryArgs>;
}

function importedNameToken(imported: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(imported)
    ? imported
    : JSON.stringify(imported);
}

/**
 * Collects runtime imports referenced by every `$server()`/HTTP and `$ws()`
 * handler in the given registries, assigning each distinct import a unique
 * top-level alias so same-named imports from different source files don't
 * collide once inlined into one generated module.
 */
export function collectHandlerImports(
  registry: Registry<ServerEntry>,
  wsRegistry: Registry<WsEntry> | undefined,
  serverOutDir: string,
): CollectedImports {
  const aliasByKey = new Map<string, string>();
  const bindingsBySpecifier = new Map<string, SpecifierBindings>();
  const factoryArgsByEndpoint = new Map<string, FactoryArgs>();
  let aliasCount = 0;

  const aliasFor = (key: string): string => {
    let alias = aliasByKey.get(key);
    if (!alias) {
      alias = `__dep_${aliasCount++}`;
      aliasByKey.set(key, alias);
    }
    return alias;
  };

  const bindingsFor = (specifier: string): SpecifierBindings => {
    let bindings = bindingsBySpecifier.get(specifier);
    if (!bindings) {
      bindings = { named: new Map() };
      bindingsBySpecifier.set(specifier, bindings);
    }
    return bindings;
  };

  function registerImports(entry: {
    endpoint: string;
    file: string;
    imports: ServerEntry["imports"];
  }): void {
    const locals: string[] = [];
    const aliases: string[] = [];

    for (const runtimeImport of entry.imports) {
      const specifier = runtimeImportSpecifier(
        entry.file,
        runtimeImport.specifier,
        serverOutDir,
      );
      const bindings = bindingsFor(specifier);

      if (runtimeImport.defaultName) {
        const alias = aliasFor(JSON.stringify(["default", specifier]));
        bindings.default = alias;
        locals.push(runtimeImport.defaultName);
        aliases.push(alias);
      }
      if (runtimeImport.namespaceName) {
        const alias = aliasFor(JSON.stringify(["namespace", specifier]));
        bindings.namespace = alias;
        locals.push(runtimeImport.namespaceName);
        aliases.push(alias);
      }
      for (const { imported, local } of runtimeImport.named) {
        const alias = aliasFor(JSON.stringify(["named", specifier, imported]));
        bindings.named.set(imported, alias);
        locals.push(local);
        aliases.push(alias);
      }
    }

    factoryArgsByEndpoint.set(entry.endpoint, { locals, aliases });
  }

  for (const entry of registry.values()) registerImports(entry);
  if (wsRegistry) {
    for (const entry of wsRegistry.values()) registerImports(entry);
  }

  const importLines: string[] = [];
  for (const [specifier, bindings] of bindingsBySpecifier) {
    const quoted = JSON.stringify(specifier);
    if (bindings.default) {
      importLines.push(`import ${bindings.default} from ${quoted};`);
    }
    if (bindings.namespace) {
      importLines.push(`import * as ${bindings.namespace} from ${quoted};`);
    }
    if (bindings.named.size > 0) {
      const items = [...bindings.named]
        .map(
          ([imported, alias]) => `${importedNameToken(imported)} as ${alias}`,
        )
        .join(", ");
      importLines.push(`import { ${items} } from ${quoted};`);
    }
  }

  return { importLines, factoryArgsByEndpoint };
}

/**
 * Emits per-source-file handler declarations: a plain `const` for handlers
 * with no shared state, or a state-sharing IIFE when the file has
 * module-level declarations or handlers reference each other by name.
 *
 * `$ws()` handler expressions are wrapped with `__wrapWs(...)`; callers that
 * include `$ws()` entries must emit the `__wrapWs` runtime helper themselves.
 */
export function emitHandlerDeclarations(
  registry: Registry<ServerEntry>,
  wsRegistry: Registry<WsEntry> | undefined,
  factoryArgsByEndpoint: Map<string, FactoryArgs>,
): string[] {
  const lines: string[] = [];

  // Group entries by source file so module-level declarations (e.g. `const
  // state = {}`) are shared across all handlers from the same file —
  // including across server() and ws() handlers in the same file.
  const entriesByFile = new Map<
    string,
    { server: ServerEntry[]; ws: WsEntry[] }
  >();
  function fileBucket(file: string) {
    let bucket = entriesByFile.get(file);
    if (!bucket) {
      bucket = { server: [], ws: [] };
      entriesByFile.set(file, bucket);
    }
    return bucket;
  }
  for (const entry of registry.values()) fileBucket(entry.file).server.push(entry);
  if (wsRegistry) {
    for (const entry of wsRegistry.values()) fileBucket(entry.file).ws.push(entry);
  }

  for (const [, { server: fileBackend, ws: fileWs }] of entriesByFile) {
    const first = fileBackend[0] ?? fileWs[0];
    const moduleDeclsJs = first?.moduleDeclsJs ?? "";
    const hasSiblingCrossRefs = first?.hasSiblingCrossRefs ?? false;
    const useIIFE = !!moduleDeclsJs || hasSiblingCrossRefs;

    function handlerExpr(entry: { endpoint: string }, exprJs: string): string {
      const { locals, aliases } = factoryArgsByEndpoint.get(entry.endpoint)!;
      return locals.length === 0
        ? exprJs
        : `((${locals.join(", ")}) => (${exprJs}))(${aliases.join(", ")})`;
    }

    function wsHandlerExpr(entry: { endpoint: string }, exprJs: string): string {
      return `__wrapWs(${JSON.stringify(entry.endpoint)}, ${handlerExpr(entry, exprJs)})`;
    }

    if (!useIIFE) {
      // No module-level state and no sibling cross-refs: emit each handler individually.
      for (const entry of fileBackend) {
        const constName = serverConstName(entry.endpoint);
        lines.push(`const ${constName} = ${handlerExpr(entry, entry.fnJs)};`, "");
      }
      for (const entry of fileWs) {
        const constName = wsConstName(entry.endpoint);
        lines.push(
          `const ${constName} = ${wsHandlerExpr(entry, entry.handlersJs)};`,
          "",
        );
      }
    } else {
      // Wrap all handlers from this file in an IIFE so they share the same
      // module-level state and can reference each other by their original names.
      const constNames = [
        ...fileBackend.map((e) => serverConstName(e.endpoint)),
        ...fileWs.map((e) => wsConstName(e.endpoint)),
      ];
      lines.push(`const { ${constNames.join(", ")} } = (() => {`);

      if (moduleDeclsJs) {
        for (const declLine of moduleDeclsJs.split("\n")) {
          lines.push(`  ${declLine}`);
        }
      }

      // Declare each handler as a named local so siblings can call each other.
      for (const entry of fileBackend) {
        const constName = serverConstName(entry.endpoint);
        const localName = entry.originalName ?? constName;
        lines.push(`  const ${localName} = ${handlerExpr(entry, entry.fnJs)};`);
      }
      for (const entry of fileWs) {
        const constName = wsConstName(entry.endpoint);
        const localName = entry.originalName ?? constName;
        lines.push(
          `  const ${localName} = ${wsHandlerExpr(entry, entry.handlersJs)};`,
        );
      }

      lines.push("  return {");

      for (const entry of fileBackend) {
        const constName = serverConstName(entry.endpoint);
        const localName = entry.originalName ?? constName;
        lines.push(`    ${constName}: ${localName},`);
      }
      for (const entry of fileWs) {
        const constName = wsConstName(entry.endpoint);
        const localName = entry.originalName ?? constName;
        lines.push(`    ${constName}: ${localName},`);
      }

      lines.push("  };", "})();", "");
    }
  }

  return lines;
}

/** Builds the `const __serverHandlers = {...};` lookup table used by the dispatch route. */
export function emitServerHandlersMap(registry: Registry<ServerEntry>): string[] {
  const lines: string[] = ["const __serverHandlers = {"];
  for (const entry of registry.values()) {
    lines.push(
      `  ${JSON.stringify(entry.endpoint)}: { fn: ${serverConstName(entry.endpoint)}${entry.httpMethod ? `, method: ${JSON.stringify(entry.httpMethod)}` : ""} },`,
    );
  }
  lines.push("};", "");
  return lines;
}

/** Builds the `const __wsHandlers = {...};` lookup table used by the WebSocket upgrade handler. */
export function emitWsHandlersMap(wsRegistry: Registry<WsEntry>): string[] {
  const lines: string[] = ["const __wsHandlers = {"];
  for (const entry of wsRegistry.values()) {
    lines.push(`  ${JSON.stringify(entry.endpoint)}: ${wsConstName(entry.endpoint)},`);
  }
  lines.push("};", "");
  return lines;
}

/**
 * Builds the `app.all('<apiPrefix>*', ...)` RPC dispatch route. This only
 * uses standard Hono `Context`/Fetch API methods, so it is identical across
 * every target platform.
 */
export function emitApiDispatchRoute(apiPrefix: string): string[] {
  return [
    `app.all('${apiPrefix}*', async (c) => {`,
    "  const url = new URL(c.req.url);",
    "  let endpoint;",
    "  try {",
    `    endpoint = decodeURIComponent(url.pathname.slice(${apiPrefix.length}));`,
    "  } catch {",
    '    return c.json({ error: "Bad request" }, 400);',
    "  }",
    "  const entry = __serverHandlers[endpoint];",
    "",
    "  if (!entry) {",
    "    return c.json({ error: `Handler not found for endpoint: ${endpoint}` }, 404);",
    "  }",
    "",
    '  const expectedMethod = entry.method || "POST";',
    "  if (c.req.method !== expectedMethod) {",
    '    return c.json({ error: "Method not allowed" }, 405, { Allow: expectedMethod });',
    "  }",
    "",
    "  try {",
    "    let result;",
    "    if (entry.method) {",
    "      result = await entry.fn(c);",
    "    } else {",
    '      const contentType = c.req.header("content-type");',
    '      const contentMime = contentType?.split(";", 1)[0]?.trim().toLowerCase();',
    '      if (contentMime && contentMime !== "application/json" && !contentMime.endsWith("+json")) {',
    '        return c.json({ error: "Unsupported media type. Expected application/json" }, 415);',
    "      }",
    "      let payload;",
    "      try {",
    "        const rawBody = await c.req.text();",
    "        const trimmedBody = rawBody.trim();",
    "        payload = trimmedBody.length > 0 ? JSON.parse(trimmedBody) : [];",
    "      } catch {",
    '        return c.json({ error: "Invalid JSON payload" }, 400);',
    "      }",
    "      const args = Array.isArray(payload) ? payload : [payload];",
    "      result = await entry.fn(...args);",
    "    }",
    "    if (result instanceof Response) return result;",
    "    if (result === undefined) return c.body(null, 204);",
    "    return c.json(result);",
    "  } catch (e) {",
    "    const message = e instanceof Error ? e.message : String(e);",
    "    console.error(`[server-build] Error in ${endpoint}:`, e);",
    "    return c.json({ error: message }, 500);",
    "  }",
    "});",
    "",
  ];
}
