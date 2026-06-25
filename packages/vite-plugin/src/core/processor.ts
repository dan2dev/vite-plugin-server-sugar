import ts from "typescript";
import { relative } from "node:path";
import { RolldownMagicString } from "rolldown";
import { Registry } from "./registry";
import { transpileTs, transpileStatements } from "./transpiler";
import type { ServerEntry, RuntimeImport, WsEntry, WorkerEntry } from "../types";
import {
  API_PREFIX,
  CLIENT_FETCH_EXPORT,
  CLIENT_HELPER_ID,
  CLIENT_HTTP_FETCH_EXPORT,
  CLIENT_HTTP_HELPER_ID,
  CLIENT_WS_CONNECT_EXPORT,
  CLIENT_WS_HELPER_ID,
  CLIENT_WORKER_HELPER_ID,
  CLIENT_WORKER_PROXY_EXPORT,
  VIRTUAL_WORKER_PREFIX,
  WS_API_PREFIX,
} from "../constants";
import { HTTP_METHOD_MACROS, HTTP_METHODS_WITH_BODY } from "../types";
import { normalizePath } from "../utils/path";
import { toKebabCase } from "../utils/crypto";
import {
  collectIdentifierNames,
  collectReferencedNames,
  collectValueReferences,
  collectBoundNames,
  isReferenceIdentifier,
  inferBackendLabel,
} from "../utils/ast";

/**
 * Identifiers that resolve to ambient globals available in the Bun server
 * runtime, so referencing them inside a `server()`/`ws()` body is
 * fine even though they are neither imported nor declared locally.
 */
const KNOWN_GLOBALS = new Set<string>([
  "globalThis",
  "Bun",
  "process",
  "console",
  "fetch",
  "crypto",
  "performance",
  "Response",
  "Request",
  "Headers",
  "FormData",
  "Blob",
  "File",
  "URL",
  "URLSearchParams",
  "AbortController",
  "AbortSignal",
  "TextEncoder",
  "TextDecoder",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "WebSocket",
  "structuredClone",
  "atob",
  "btoa",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "queueMicrotask",
  "JSON",
  "Math",
  "Date",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "BigInt",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "Promise",
  "RegExp",
  "Proxy",
  "Reflect",
  "Intl",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "EvalError",
  "ReferenceError",
  "URIError",
  "AggregateError",
  "Function",
  "NaN",
  "Infinity",
  "undefined",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

const WS_HANDLER_KEYS = new Set(["onOpen", "onMessage", "onClose"]);

function isValidWsHandlersArg(arg: ts.Node): arg is ts.ObjectLiteralExpression {
  if (!ts.isObjectLiteralExpression(arg)) return false;

  return arg.properties.some((prop) => {
    if (
      ts.isMethodDeclaration(prop) &&
      ts.isIdentifier(prop.name) &&
      WS_HANDLER_KEYS.has(prop.name.text)
    ) {
      return true;
    }
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      WS_HANDLER_KEYS.has(prop.name.text)
    ) {
      return ts.isFunctionLike(prop.initializer);
    }
    return false;
  });
}

export interface ProcessorOptions {
  registry: Registry<ServerEntry>;
  /** Registry for `$ws()` handlers. Optional for callers that only care about $server(). */
  wsRegistry?: Registry<WsEntry>;
  /** Registry for `$worker()` handlers. */
  workerRegistry?: Registry<WorkerEntry>;
  /**
   * Map of endpoint → Rollup/Rolldown `emitFile` reference ID for worker chunks.
   * When present, the processor generates `import.meta.ROLLUP_FILE_URL_<refId>` as
   * the worker URL (build mode). When absent, it falls back to the Vite dev-server
   * `/@id/virtual:server-build/worker/<endpoint>` URL.
   */
  workerReferenceIds?: Map<string, string>;
  root: string;
  /**
   * When true, emit a console warning for `$server()`/`$ws()` bodies
   * that reference values they will not receive on the server (not imports,
   * parameters, locals, or known globals).
   */
  emitWarnings?: boolean;
}

export interface ProcessResult {
  code: string;
  map: string | null;
}

export function processFile(
  code: string,
  id: string,
  options: ProcessorOptions,
): ProcessResult | null {
  const { registry, root } = options;
  const wsRegistry = options.wsRegistry ?? new Registry<WsEntry>();
  const workerRegistry = options.workerRegistry;

  if (!/(?:\$server|\$ws|\$worker|\$get|\$post|\$put|\$patch|\$delete|\$head)\s*\(/.test(code)) {
    registry.unregisterFile(id);
    wsRegistry.unregisterFile(id);
    workerRegistry?.unregisterFile(id);
    return null;
  }

  const sf = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const helperImports: string[] = [];
  const entries: ServerEntry[] = [];
  const wsEntries: WsEntry[] = [];
  const workerEntries: WorkerEntry[] = [];
  const usedEndpoints = new Set<string>();
  // Per-worker free refs for sibling stub resolution (separate from server/ws allHandlerFreeRefs)
  const workerFreeRefs = new Map<string, Set<string>>();
  // Per-worker set of module-level names inlined into the worker module (used to suppress false-positive warnings)
  const workerModuleLocalNames = new Map<string, Set<string>>();

  function uniqueLocalName(base: string): string {
    const usedNames = collectIdentifierNames(sf);
    let name = base;
    let suffix = 1;

    while (usedNames.has(name)) {
      name = `${base}_${suffix}`;
      suffix += 1;
    }

    return name;
  }

  const clientFetchHelperName = uniqueLocalName(CLIENT_FETCH_EXPORT);
  const clientArgsName = uniqueLocalName("__serverArgs");
  const clientWsConnectHelperName = uniqueLocalName(CLIENT_WS_CONNECT_EXPORT);
  const clientWsArgsName = uniqueLocalName("__wsArgs");
  const clientWorkerProxyHelperName = uniqueLocalName(CLIENT_WORKER_PROXY_EXPORT);
  const clientHttpFetchHelperName = uniqueLocalName(CLIENT_HTTP_FETCH_EXPORT);
  let hasHttpEntries = false;

  function endpointName(file: string, name: string): string {
    let rel = normalizePath(relative(root, file));
    if (rel.startsWith("src/")) rel = rel.slice(4);
    const base = rel.replace(/\.(tsx?|jsx?)$/, "");

    const segments = [...base.split("/"), name];
    return segments.map(toKebabCase).join("/");
  }

  function endpointUrl(endpoint: string): string {
    return API_PREFIX + endpoint.split("/").map(encodeURIComponent).join("/");
  }

  function wsEndpointUrl(endpoint: string): string {
    return WS_API_PREFIX + endpoint.split("/").map(encodeURIComponent).join("/");
  }

  function collectRuntimeImports(usedNames: Set<string>): RuntimeImport[] {
    const imports: RuntimeImport[] = [];

    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

      const specifier = statement.moduleSpecifier.text;
      const importClause = statement.importClause;
      if (!importClause || importClause.isTypeOnly) continue;

      const runtimeImport: RuntimeImport = {
        named: [],
        specifier,
      };

      if (importClause.name && usedNames.has(importClause.name.text)) {
        runtimeImport.defaultName = importClause.name.text;
      }

      const namedBindings = importClause.namedBindings;
      if (namedBindings) {
        if (ts.isNamespaceImport(namedBindings)) {
          if (usedNames.has(namedBindings.name.text)) {
            runtimeImport.namespaceName = namedBindings.name.text;
          }
        } else {
          for (const element of namedBindings.elements) {
            if (element.isTypeOnly || !usedNames.has(element.name.text))
              continue;

            runtimeImport.named.push({
              imported: element.propertyName?.text ?? element.name.text,
              local: element.name.text,
            });
          }
        }
      }

      if (
        runtimeImport.defaultName ||
        runtimeImport.namespaceName ||
        runtimeImport.named.length > 0
      ) {
        imports.push(runtimeImport);
      }
    }

    return imports;
  }

  function uniqueEndpoint(
    label: string,
    call: ts.CallExpression,
    kind: "server" | "ws" | "worker",
  ): string {
    const endpoint = endpointName(id, label);
    if (!usedEndpoints.has(endpoint)) {
      usedEndpoints.add(endpoint);
      return endpoint;
    }

    const { line, character } = sf.getLineAndCharacterOfPosition(
      call.getStart(sf),
    );
    const fallbackLabel = `${kind}@${line + 1}:${character + 1}`;
    const duplicateEndpoint = endpointName(id, `${label}.${fallbackLabel}`);
    usedEndpoints.add(duplicateEndpoint);
    return duplicateEndpoint;
  }

  function originalNameOf(call: ts.CallExpression): string | undefined {
    if (
      ts.isVariableDeclaration(call.parent) &&
      call.parent.initializer === call &&
      ts.isIdentifier(call.parent.name)
    ) {
      return call.parent.name.text;
    }
    return undefined;
  }

  function walk(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "$server"
    ) {
      const call = node;
      const arg = node.arguments[0];

      if (!arg || !ts.isFunctionLike(arg)) {
        return;
      }

      const endpoint = uniqueEndpoint(
        inferBackendLabel(call, sf, "$server"),
        call,
        "server",
      );

      const fnSource = code.slice(arg.getStart(sf), arg.getEnd());
      const fnJs = transpileTs(fnSource);
      const imports = collectRuntimeImports(collectReferencedNames(arg));
      const originalName = originalNameOf(call);

      entries.push({ endpoint, imports, fnJs, file: id, originalName });

      // Collect names the handler references that aren't imports/globals/bound.
      // These are candidates for module-level capture via the IIFE.
      const bound = collectBoundNames(arg);
      for (const name of collectValueReferences(arg)) {
        if (name === "$server") continue;
        if (
          bound.has(name) ||
          fileImportNames.has(name) ||
          KNOWN_GLOBALS.has(name)
        )
          continue;
        allHandlerFreeRefs.add(name);
      }

      handlerNodes.set(endpoint, { node: arg, kind: "server" });

      const fetchWrapper = [
        `async (...${clientArgsName}) => ${clientFetchHelperName}(`,
        `${JSON.stringify(endpointUrl(endpoint))}, `,
        `JSON.stringify(${clientArgsName}))`,
      ].join("");

      replacements.push({
        start: call.getStart(sf),
        end: call.getEnd(),
        text: fetchWrapper,
      });
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "$ws"
    ) {
      const call = node;
      const arg = node.arguments[0];

      if (!arg || !isValidWsHandlersArg(arg)) {
        return;
      }

      const endpoint = uniqueEndpoint(
        inferBackendLabel(call, sf, "$ws"),
        call,
        "ws",
      );

      const handlersSource = `(${code.slice(arg.getStart(sf), arg.getEnd())})`;
      const handlersJs = transpileTs(handlersSource);
      const imports = collectRuntimeImports(collectReferencedNames(arg));
      const originalName = originalNameOf(call);

      wsEntries.push({ endpoint, imports, handlersJs, file: id, originalName });

      const bound = collectBoundNames(arg);
      for (const name of collectValueReferences(arg)) {
        if (name === "$ws") continue;
        if (
          bound.has(name) ||
          fileImportNames.has(name) ||
          KNOWN_GLOBALS.has(name)
        )
          continue;
        allHandlerFreeRefs.add(name);
      }

      handlerNodes.set(endpoint, { node: arg, kind: "ws" });

      const connectWrapper = [
        `{ connect: (...${clientWsArgsName}) => ${clientWsConnectHelperName}(`,
        `${JSON.stringify(wsEndpointUrl(endpoint))}, `,
        `${clientWsArgsName}) }`,
      ].join("");

      replacements.push({
        start: call.getStart(sf),
        end: call.getEnd(),
        text: connectWrapper,
      });
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "$worker"
    ) {
      const call = node;
      const arg = node.arguments[0];

      if (!arg || !ts.isFunctionLike(arg)) {
        return;
      }

      const endpoint = uniqueEndpoint(
        inferBackendLabel(call, sf, "$worker"),
        call,
        "worker",
      );

      const fnSource = code.slice(arg.getStart(sf), arg.getEnd());
      const fnJs = transpileTs(fnSource);
      const imports = collectRuntimeImports(collectReferencedNames(arg));
      const originalName = originalNameOf(call);

      // Track per-worker free refs separately (don't pollute server/ws allHandlerFreeRefs)
      const bound = collectBoundNames(arg);
      const freeRefsForEntry = new Set<string>();
      for (const name of collectValueReferences(arg)) {
        if (name === "$worker") continue;
        if (bound.has(name) || fileImportNames.has(name) || KNOWN_GLOBALS.has(name)) continue;
        freeRefsForEntry.add(name);
      }
      workerFreeRefs.set(endpoint, freeRefsForEntry);

      workerEntries.push({
        endpoint,
        imports,
        fnJs,
        file: id,
        originalName,
        siblingServerStubs: [],
        siblingWsStubs: [],
      });

      handlerNodes.set(endpoint, { node: arg, kind: "worker" });

      // Build mode: use import.meta.ROLLUP_FILE_URL_<refId> so rolldown resolves the
      // URL of the separately-emitted worker chunk. Dev mode: use the Vite /@id/ URL.
      const refId = options.workerReferenceIds?.get(endpoint);
      const workerUrl = refId
        ? `import.meta.ROLLUP_FILE_URL_${refId}`
        : JSON.stringify(`/@id/${VIRTUAL_WORKER_PREFIX}${endpoint}`);

      // Returns a Proxy that routes method calls to the shared worker thread.
      const workerWrapper = `${clientWorkerProxyHelperName}(${workerUrl})`;

      replacements.push({
        start: call.getStart(sf),
        end: call.getEnd(),
        text: workerWrapper,
      });
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      HTTP_METHOD_MACROS.has(node.expression.text)
    ) {
      const call = node;
      const macroName = node.expression.text;
      const httpMethod = HTTP_METHOD_MACROS.get(macroName)!;
      const arg = node.arguments[0];

      if (!arg || !ts.isFunctionLike(arg)) {
        return;
      }

      const endpoint = uniqueEndpoint(
        inferBackendLabel(call, sf, macroName),
        call,
        "server",
      );

      const fnSource = code.slice(arg.getStart(sf), arg.getEnd());
      const fnJs = transpileTs(fnSource);
      const imports = collectRuntimeImports(collectReferencedNames(arg));
      const originalName = originalNameOf(call);

      entries.push({ endpoint, imports, fnJs, file: id, originalName, httpMethod });
      hasHttpEntries = true;

      const bound = collectBoundNames(arg);
      for (const name of collectValueReferences(arg)) {
        if (HTTP_METHOD_MACROS.has(name)) continue;
        if (
          bound.has(name) ||
          fileImportNames.has(name) ||
          KNOWN_GLOBALS.has(name)
        )
          continue;
        allHandlerFreeRefs.add(name);
      }

      handlerNodes.set(endpoint, { node: arg, kind: "server" });

      const url = JSON.stringify(endpointUrl(endpoint));
      const fetchWrapper = HTTP_METHODS_WITH_BODY.has(httpMethod)
        ? `async (__body, __query, __options) => ${clientHttpFetchHelperName}(${JSON.stringify(httpMethod)}, ${url}, __body, __query, __options)`
        : `async (__query, __options) => ${clientHttpFetchHelperName}(${JSON.stringify(httpMethod)}, ${url}, undefined, __query, __options)`;

      replacements.push({
        start: call.getStart(sf),
        end: call.getEnd(),
        text: fetchWrapper,
      });
      return;
    }

    ts.forEachChild(node, walk);
  }

  function collectFileImportNames(): Set<string> {
    const names = new Set<string>();
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;

      if (clause.name) names.add(clause.name.text);
      const namedBindings = clause.namedBindings;
      if (!namedBindings) continue;
      if (ts.isNamespaceImport(namedBindings)) {
        names.add(namedBindings.name.text);
      } else {
        for (const element of namedBindings.elements) {
          if (!element.isTypeOnly) names.add(element.name.text);
        }
      }
    }
    return names;
  }

  /**
   * Returns true when the statement contains a server() or ws() call
   * and should be excluded from module-level declaration collection.
   */
  function statementHasHandlerCall(statement: ts.Node): boolean {
    let found = false;
    const check = (n: ts.Node): void => {
      if (found) return;
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        (n.expression.text === "$server" || n.expression.text === "$ws" || n.expression.text === "$worker" || HTTP_METHOD_MACROS.has(n.expression.text))
      ) {
        found = true;
        return;
      }
      ts.forEachChild(n, check);
    };
    check(statement);
    return found;
  }

  /**
   * Returns the names introduced at the TOP LEVEL of a statement — i.e. the
   * public bindings of the declaration without recursing into the body.
   *
   * For `const { a, b } = foo()` → `{ a, b }`.
   * For `function App() { ... }` → `{ App }` (not the locals inside App).
   */
  function statementTopLevelBindings(statement: ts.Statement): Set<string> {
    const names = new Set<string>();

    function addName(n: ts.BindingName): void {
      if (ts.isIdentifier(n)) {
        names.add(n.text);
      } else {
        for (const el of (n as ts.BindingPattern).elements) {
          if (ts.isBindingElement(el)) addName(el.name);
        }
      }
    }

    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations)
        addName(decl.name);
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name
    ) {
      addName(statement.name);
    }

    return names;
  }

  // Names referenced by any server/ws handler in this file that are
  // not:
  // - import-bound (captured via collectRuntimeImports)
  // - function parameters / local variables (bound inside the handler)
  // - known globals
  //
  // Populated during walk(). Used by collectModuleDeclsJs() to select which
  // module-level declarations to emit into the per-file IIFE.
  const allHandlerFreeRefs = new Set<string>();

  // Always compute import names — needed to filter allHandlerFreeRefs.
  const fileImportNames = collectFileImportNames();

  function warnOnUncapturedReferences(
    fn: ts.Node,
    endpoint: string,
    kind: "server" | "ws" | "worker",
    moduleLocalNames: Set<string>,
  ): void {
    const bound = collectBoundNames(fn);
    const free: string[] = [];
    for (const name of collectValueReferences(fn)) {
      if (name === "$server" || name === "$ws") continue;
      if (
        bound.has(name) ||
        fileImportNames.has(name) ||
        KNOWN_GLOBALS.has(name) ||
        moduleLocalNames.has(name)
      )
        continue;
      free.push(name);
    }
    if (free.length === 0) return;

    const list = free.map((name) => `'${name}'`).join(", ");
    const isOne = free.length === 1;
    console.warn(
      `[server-build] ${normalizePath(relative(root, id))}: ${kind} handler "${endpoint}" references ` +
        `${list} which ${isOne ? "is" : "are"} not imported, a parameter, or a known global. ` +
        `${isOne ? "It" : "They"} will be undefined when the handler runs on the server.`,
    );
  }

  // Store handler AST nodes for deferred warning emission (warnings need
  // moduleLocalNames which is only known after walk completes and
  // collectModuleDeclsJs runs).
  const handlerNodes = new Map<
    string,
    { node: ts.Node; kind: "server" | "ws" | "worker" }
  >();

  ts.forEachChild(sf, walk);
  if (replacements.length === 0) {
    registry.unregisterFile(id);
    wsRegistry.unregisterFile(id);
    workerRegistry?.unregisterFile(id);
    return null;
  }

  // Sibling handler names are handled separately in the per-file IIFE.
  const siblingHandlerNames = new Set(
    [...entries, ...wsEntries]
      .filter((e) => e.originalName)
      .map((e) => e.originalName!),
  );

  /**
   * Names of module-level declarations that are transitively needed by at
   * least one server/ws handler in this file.
   */
  const namesNeededByServer = new Set(allHandlerFreeRefs);
  const namesDefinedInModuleAndNeededByServer = new Set<string>();

  // Sibling handlers are declared as locals in the IIFE, so they don't need
  // module-level capture from the perspective of the server-side code generator.
  for (const name of siblingHandlerNames) {
    namesNeededByServer.delete(name);
  }

  // Transitively expand namesNeededByServer: find declarations that satisfy
  // names we need, and add their own references to the set.
  let serverChanged = true;
  while (serverChanged) {
    serverChanged = false;
    for (const statement of sf.statements) {
      if (
        ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)
      )
        continue;
      if (statementHasHandlerCall(statement)) continue;

      const bindings = statementTopLevelBindings(statement);
      if (bindings.size === 0) continue;

      if ([...bindings].some((b) => namesNeededByServer.has(b))) {
        for (const b of bindings) {
          if (!namesDefinedInModuleAndNeededByServer.has(b)) {
            namesDefinedInModuleAndNeededByServer.add(b);
            serverChanged = true;
          }
        }
        for (const ref of collectValueReferences(statement)) {
          if (
            !namesNeededByServer.has(ref) &&
            !fileImportNames.has(ref) &&
            !KNOWN_GLOBALS.has(ref)
          ) {
            namesNeededByServer.add(ref);
            serverChanged = true;
          }
        }
      }
    }
  }

  /**
   * Collect transpiled JS for module-level declarations that are REFERENCED by
   * at least one server/ws handler in this file.
   */
  function collectModuleDeclsJs(): string {
    const parts: string[] = [];

    for (const statement of sf.statements) {
      if (ts.isImportDeclaration(statement)) continue;
      if (ts.isExportDeclaration(statement)) continue;
      if (ts.isInterfaceDeclaration(statement)) continue;
      if (ts.isTypeAliasDeclaration(statement)) continue;
      if (ts.isModuleDeclaration(statement)) continue;

      const modifiers = ts.canHaveModifiers(statement)
        ? ts.getModifiers(statement)
        : undefined;
      if (modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword))
        continue;

      if (statementHasHandlerCall(statement)) continue;

      const bindings = statementTopLevelBindings(statement);
      if (bindings.size === 0) continue;

      if ([...bindings].some((b) => namesDefinedInModuleAndNeededByServer.has(b))) {
        const stmtSource = code
          .slice(statement.getFullStart(), statement.getEnd())
          .trim();
        if (!stmtSource) continue;
        const js = transpileStatements(stmtSource);
        if (js) parts.push(js);
      }
    }

    return parts.join("\n");
  }

  // Track whether any cross-reference was found so the bundle generator can
  // force IIFE mode even without shared state.
  let hasSiblingCrossRefs = false;
  for (const name of siblingHandlerNames) {
    if (allHandlerFreeRefs.delete(name)) {
      hasSiblingCrossRefs = true;
    }
  }

  function getImportedNames(statement: ts.ImportDeclaration): Set<string> {
    const names = new Set<string>();
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) return names;

    if (clause.name) names.add(clause.name.text);

    const namedBindings = clause.namedBindings;
    if (namedBindings) {
      if (ts.isNamespaceImport(namedBindings)) {
        names.add(namedBindings.name.text);
      } else {
        for (const element of namedBindings.elements) {
          if (!element.isTypeOnly) names.add(element.name.text);
        }
      }
    }

    return names;
  }

  const handlerCallRanges = replacements.map(({ start, end }) => ({
    start,
    end,
  }));

  function pushHelperImport(text: string): void {
    helperImports.push(text);
  }

  if (entries.some((e) => !e.httpMethod)) {
    const importClause =
      clientFetchHelperName === CLIENT_FETCH_EXPORT
        ? CLIENT_FETCH_EXPORT
        : `${CLIENT_FETCH_EXPORT} as ${clientFetchHelperName}`;
    pushHelperImport(
      `import { ${importClause} } from ${JSON.stringify(CLIENT_HELPER_ID)};`,
    );
  }

  if (wsEntries.length > 0) {
    const importClause =
      clientWsConnectHelperName === CLIENT_WS_CONNECT_EXPORT
        ? CLIENT_WS_CONNECT_EXPORT
        : `${CLIENT_WS_CONNECT_EXPORT} as ${clientWsConnectHelperName}`;
    pushHelperImport(
      `import { ${importClause} } from ${JSON.stringify(CLIENT_WS_HELPER_ID)};`,
    );
  }

  if (workerEntries.length > 0) {
    // Resolve sibling stubs for same-file $server/$ws references inside worker bodies
    for (const entry of workerEntries) {
      const freeRefs = workerFreeRefs.get(entry.endpoint) ?? new Set<string>();
      for (const serverEntry of entries) {
        if (serverEntry.originalName && freeRefs.has(serverEntry.originalName)) {
          entry.siblingServerStubs.push({
            name: serverEntry.originalName,
            url: endpointUrl(serverEntry.endpoint),
          });
        }
      }
      for (const wsEntry of wsEntries) {
        if (wsEntry.originalName && freeRefs.has(wsEntry.originalName)) {
          entry.siblingWsStubs.push({
            name: wsEntry.originalName,
            url: wsEndpointUrl(wsEntry.endpoint),
          });
        }
      }
    }

    // Per-worker: collect module-level declarations referenced by the worker body.
    // These are variables/functions defined in the same file that aren't imports,
    // globals, bound parameters, or sibling server/ws stubs — they need to be
    // inlined into the worker module so the function body can reference them.
    for (const entry of workerEntries) {
      const freeRefs = workerFreeRefs.get(entry.endpoint) ?? new Set<string>();
      const siblingNames = new Set([
        ...entry.siblingServerStubs.map((s) => s.name),
        ...entry.siblingWsStubs.map((s) => s.name),
      ]);

      const namesNeededByWorker = new Set<string>();
      for (const name of freeRefs) {
        if (!siblingNames.has(name)) namesNeededByWorker.add(name);
      }
      if (namesNeededByWorker.size === 0) continue;

      // Transitively expand: a needed declaration may itself reference other
      // module-level names that also need to be included.
      const namesDefinedInModule = new Set<string>();
      let workerModuleChanged = true;
      while (workerModuleChanged) {
        workerModuleChanged = false;
        for (const statement of sf.statements) {
          if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) continue;
          if (statementHasHandlerCall(statement)) continue;
          const bindings = statementTopLevelBindings(statement);
          if (bindings.size === 0) continue;
          if ([...bindings].some((b) => namesNeededByWorker.has(b))) {
            for (const b of bindings) {
              if (!namesDefinedInModule.has(b)) { namesDefinedInModule.add(b); workerModuleChanged = true; }
            }
            for (const ref of collectValueReferences(statement)) {
              if (!namesNeededByWorker.has(ref) && !fileImportNames.has(ref) && !KNOWN_GLOBALS.has(ref)) {
                namesNeededByWorker.add(ref);
                workerModuleChanged = true;
              }
            }
          }
        }
      }

      if (namesDefinedInModule.size === 0) continue;

      const fnNode = handlerNodes.get(entry.endpoint)?.node;
      const allImportNames = fnNode ? collectReferencedNames(fnNode) : new Set<string>();
      const declParts: string[] = [];

      for (const statement of sf.statements) {
        if (ts.isImportDeclaration(statement)) continue;
        if (ts.isExportDeclaration(statement)) continue;
        if (ts.isInterfaceDeclaration(statement)) continue;
        if (ts.isTypeAliasDeclaration(statement)) continue;
        if (ts.isModuleDeclaration(statement)) continue;
        const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
        if (modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
        if (statementHasHandlerCall(statement)) continue;
        const bindings = statementTopLevelBindings(statement);
        if (bindings.size === 0) continue;
        if ([...bindings].some((b) => namesDefinedInModule.has(b))) {
          for (const name of collectValueReferences(statement)) {
            allImportNames.add(name);
          }
          const stmtSource = code.slice(statement.getFullStart(), statement.getEnd()).trim();
          if (stmtSource) {
            const js = transpileStatements(stmtSource);
            if (js) declParts.push(js);
          }
        }
      }

      workerModuleLocalNames.set(entry.endpoint, namesDefinedInModule);

      if (declParts.length > 0) {
        entry.moduleDeclsJs = declParts.join("\n");
        // Recompute imports: also include those needed by the inlined declarations
        entry.imports = collectRuntimeImports(allImportNames);
      }
    }

    // Single invoke helper import
    const workerInvokeImportClause =
      clientWorkerProxyHelperName === CLIENT_WORKER_PROXY_EXPORT
        ? CLIENT_WORKER_PROXY_EXPORT
        : `${CLIENT_WORKER_PROXY_EXPORT} as ${clientWorkerProxyHelperName}`;
    pushHelperImport(
      `import { ${workerInvokeImportClause} } from ${JSON.stringify(CLIENT_WORKER_HELPER_ID)};`,
    );
  }

  if (hasHttpEntries) {
    const httpImportClause =
      clientHttpFetchHelperName === CLIENT_HTTP_FETCH_EXPORT
        ? CLIENT_HTTP_FETCH_EXPORT
        : `${CLIENT_HTTP_FETCH_EXPORT} as ${clientHttpFetchHelperName}`;
    pushHelperImport(
      `import { ${httpImportClause} } from ${JSON.stringify(CLIENT_HTTP_HELPER_ID)};`,
    );
  }

  function isInsideRange(
    position: number,
    ranges: Array<{ start: number; end: number }>,
  ): boolean {
    return ranges.some(({ start, end }) => position >= start && position < end);
  }

  type StatementInfo = {
    statement: ts.Statement;
    bindings: Set<string>;
    refs: Set<string>;
    isImport: boolean;
    isCandidate: boolean;
    isRoot: boolean;
  };

  const statementInfos: StatementInfo[] = [];
  for (const statement of sf.statements) {
    const isImport = ts.isImportDeclaration(statement);
    const isExportDecl =
      ts.isExportDeclaration(statement) || ts.isExportAssignment(statement);
    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    const isExported = modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    const hasHandler = statementHasHandlerCall(statement);
    const isType =
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement);
    const isDeclare = modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.DeclareKeyword,
    );

    const bindings = isImport
      ? getImportedNames(statement)
      : statementTopLevelBindings(statement);
    const refs = new Set<string>();

    const collectRefs = (node: ts.Node) => {
      if (isInsideRange(node.getStart(sf), handlerCallRanges)) return;
      if (ts.isIdentifier(node) && isReferenceIdentifier(node)) {
        if (!KNOWN_GLOBALS.has(node.text) && !bindings.has(node.text)) {
          refs.add(node.text);
        }
      }
      ts.forEachChild(node, collectRefs);
    };
    collectRefs(statement);

    const isCandidate =
      !isImport &&
      !isExportDecl &&
      !isExported &&
      !hasHandler &&
      !isType &&
      !isDeclare &&
      bindings.size > 0 &&
      [...bindings].some((b) => namesDefinedInModuleAndNeededByServer.has(b));
    const isRoot = !isImport && !isCandidate;

    statementInfos.push({
      statement,
      bindings,
      refs,
      isImport,
      isCandidate,
      isRoot,
    });
  }

  const neededByClient = new Set<string>();
  for (const info of statementInfos) {
    if (info.isRoot) {
      for (const name of info.bindings) neededByClient.add(name);
      for (const name of info.refs) neededByClient.add(name);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const info of statementInfos) {
      if ([...info.bindings].some((b) => neededByClient.has(b))) {
        for (const ref of info.refs) {
          if (!neededByClient.has(ref)) {
            neededByClient.add(ref);
            changed = true;
          }
        }
      }
    }
  }

  for (const info of statementInfos) {
    if (info.isImport || info.isCandidate) {
      const isNeeded = [...info.bindings].some((b) => neededByClient.has(b));
      if (info.bindings.size > 0 && !isNeeded) {
        replacements.push({
          start: info.statement.getFullStart(),
          end: info.statement.getEnd(),
          text: "",
        });
      }
    }
  }

  // Remove the `declare function $server: ...;` / `declare function $ws: ...;` shims, if present.
  const declareServerMatch = /declare\s+function\s+\$server\s*[<(][^;]*;/.exec(code);
  if (declareServerMatch) {
    replacements.push({
      start: declareServerMatch.index,
      end: declareServerMatch.index + declareServerMatch[0].length,
      text: "",
    });
  }
  const declareWsMatch =
    /declare\s+function\s+\$ws\s*[<(][^;]*;/.exec(code);
  if (declareWsMatch) {
    replacements.push({
      start: declareWsMatch.index,
      end: declareWsMatch.index + declareWsMatch[0].length,
      text: "",
    });
  }
  const declareWorkerMatch =
    /declare\s+function\s+\$worker\s*[<(][^;]*;/.exec(code);
  if (declareWorkerMatch) {
    replacements.push({
      start: declareWorkerMatch.index,
      end: declareWorkerMatch.index + declareWorkerMatch[0].length,
      text: "",
    });
  }
  for (const macroName of HTTP_METHOD_MACROS.keys()) {
    const escaped = macroName.replace("$", "\\$");
    const re = new RegExp(`declare\\s+function\\s+${escaped}\\s*[<(][^;]*;`);
    const match = re.exec(code);
    if (match) {
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        text: "",
      });
    }
  }
  {
    const declareServerRequestMatch = /interface\s+ServerRequest\s*<[^{]*\{[^}]*\}/.exec(code);
    if (declareServerRequestMatch) {
      replacements.push({
        start: declareServerRequestMatch.index,
        end: declareServerRequestMatch.index + declareServerRequestMatch[0].length,
        text: "",
      });
    }
  }

  // Emit deferred warnings now that we know which module-level names are captured.
  if (handlerNodes.size > 0 && options.emitWarnings) {
    const serverWsLocalNames = new Set(namesDefinedInModuleAndNeededByServer);
    // Sibling handlers are available as named locals in the IIFE.
    for (const name of siblingHandlerNames) {
      serverWsLocalNames.add(name);
    }
    for (const [endpoint, { node, kind }] of handlerNodes) {
      // For workers, use the per-worker inlined module decls so we don't
      // warn about names that are correctly inlined into the worker module.
      const localNames =
        kind === "worker"
          ? new Set([...serverWsLocalNames, ...(workerModuleLocalNames.get(endpoint) ?? [])])
          : serverWsLocalNames;
      warnOnUncapturedReferences(node, endpoint, kind, localNames);
    }
  }

  const moduleDeclsJs = collectModuleDeclsJs() || undefined;

  registry.unregisterFile(id);
  registry.registerFile(
    id,
    entries.map((e) => e.endpoint),
  );
  for (const entry of entries) {
    entry.moduleDeclsJs = moduleDeclsJs;
    entry.hasSiblingCrossRefs = hasSiblingCrossRefs;
    registry.set(entry.endpoint, entry);
  }

  wsRegistry.unregisterFile(id);
  wsRegistry.registerFile(
    id,
    wsEntries.map((e) => e.endpoint),
  );
  for (const entry of wsEntries) {
    entry.moduleDeclsJs = moduleDeclsJs;
    entry.hasSiblingCrossRefs = hasSiblingCrossRefs;
    wsRegistry.set(entry.endpoint, entry);
  }

  workerRegistry?.unregisterFile(id);
  if (workerEntries.length > 0) {
    workerRegistry?.registerFile(
      id,
      workerEntries.map((e) => e.endpoint),
    );
    for (const entry of workerEntries) {
      workerRegistry?.set(entry.endpoint, entry);
    }
  }

  const magic = new RolldownMagicString(code);
  for (const h of helperImports) {
    magic.prepend(`${h}\n`);
  }
  for (const r of replacements) {
    if (r.start === r.end) {
      if (r.start === 0) magic.appendLeft(0, r.text);
      else magic.appendRight(r.start, r.text);
    } else if (r.text === "") {
      magic.remove(r.start, r.end);
    } else {
      magic.overwrite(r.start, r.end, r.text);
    }
  }

  return {
    code: magic.toString(),
    map: magic
      .generateMap({ source: id, includeContent: true, hires: true })
      .toString(),
  };
}
