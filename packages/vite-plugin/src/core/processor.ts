import ts from "typescript";
import { relative } from "node:path";
import { RolldownMagicString } from "rolldown";
import { Registry } from "./registry";
import { transpileTs, transpileStatements } from "./transpiler";
import type { BackendEntry, RuntimeImport, WebSocketEntry } from "../types";
import {
  API_PREFIX,
  CLIENT_FETCH_EXPORT,
  CLIENT_HELPER_ID,
  CLIENT_WS_CONNECT_EXPORT,
  CLIENT_WS_HELPER_ID,
  WS_API_PREFIX,
} from "../constants";
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
 * runtime, so referencing them inside a `backend()`/`websocket()` body is
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

function isValidWebsocketHandlersArg(arg: ts.Node): arg is ts.ObjectLiteralExpression {
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
  registry: Registry<BackendEntry>;
  /** Registry for `websocket()` handlers. Optional for callers that only care about backend(). */
  wsRegistry?: Registry<WebSocketEntry>;
  root: string;
  /**
   * When true, emit a console warning for `backend()`/`websocket()` bodies
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
  const wsRegistry = options.wsRegistry ?? new Registry<WebSocketEntry>();

  if (!/\b(?:backend|websocket)\s*\(/.test(code)) {
    registry.unregisterFile(id);
    wsRegistry.unregisterFile(id);
    return null;
  }

  const sf = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const entries: BackendEntry[] = [];
  const wsEntries: WebSocketEntry[] = [];
  const usedEndpoints = new Set<string>();

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
  const clientArgsName = uniqueLocalName("__backendArgs");
  const clientWsConnectHelperName = uniqueLocalName(CLIENT_WS_CONNECT_EXPORT);
  const clientWsArgsName = uniqueLocalName("__websocketArgs");

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
    kind: "backend" | "websocket",
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
      node.expression.text === "backend"
    ) {
      const call = node;
      const arg = node.arguments[0];

      if (!arg || !ts.isFunctionLike(arg)) {
        return;
      }

      const endpoint = uniqueEndpoint(
        inferBackendLabel(call, sf, "backend"),
        call,
        "backend",
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
        if (name === "backend") continue;
        if (
          bound.has(name) ||
          fileImportNames.has(name) ||
          KNOWN_GLOBALS.has(name)
        )
          continue;
        allHandlerFreeRefs.add(name);
      }

      handlerNodes.set(endpoint, { node: arg, kind: "backend" });

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
      node.expression.text === "websocket"
    ) {
      const call = node;
      const arg = node.arguments[0];

      if (!arg || !isValidWebsocketHandlersArg(arg)) {
        return;
      }

      const endpoint = uniqueEndpoint(
        inferBackendLabel(call, sf, "websocket"),
        call,
        "websocket",
      );

      const handlersSource = `(${code.slice(arg.getStart(sf), arg.getEnd())})`;
      const handlersJs = transpileTs(handlersSource);
      const imports = collectRuntimeImports(collectReferencedNames(arg));
      const originalName = originalNameOf(call);

      wsEntries.push({ endpoint, imports, handlersJs, file: id, originalName });

      const bound = collectBoundNames(arg);
      for (const name of collectValueReferences(arg)) {
        if (name === "websocket") continue;
        if (
          bound.has(name) ||
          fileImportNames.has(name) ||
          KNOWN_GLOBALS.has(name)
        )
          continue;
        allHandlerFreeRefs.add(name);
      }

      handlerNodes.set(endpoint, { node: arg, kind: "websocket" });

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

    ts.forEachChild(node, walk);
  }

  function collectFileImportNames(): Set<string> {
    const names = new Set<string>();
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) names.add(clause.name.text);
      const namedBindings = clause.namedBindings;
      if (!namedBindings) continue;
      if (ts.isNamespaceImport(namedBindings)) {
        names.add(namedBindings.name.text);
      } else {
        for (const element of namedBindings.elements)
          names.add(element.name.text);
      }
    }
    return names;
  }

  /**
   * Returns true when the statement contains a backend() or websocket() call
   * and should be excluded from module-level declaration collection.
   */
  function statementHasHandlerCall(statement: ts.Node): boolean {
    let found = false;
    const check = (n: ts.Node): void => {
      if (found) return;
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        (n.expression.text === "backend" || n.expression.text === "websocket")
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
        for (const el of n.elements) {
          if (ts.isBindingElement(el)) addName(el.name);
        }
      }
    }

    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations)
        addName(decl.name);
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.add(statement.name.text);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      names.add(statement.name.text);
    } else if (ts.isEnumDeclaration(statement)) {
      names.add(statement.name.text);
    }

    return names;
  }

  // Names referenced by any backend/websocket handler in this file that are
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

  /**
   * Collect transpiled JS for module-level declarations that are REFERENCED by
   * at least one backend/websocket handler in this file. Only top-level
   * bindings are checked (so a React component's local variables don't
   * accidentally match). Transitively pulls in declarations that are
   * referenced by included ones.
   */
  function collectModuleDeclsJs(): string {
    // Build a list of candidate declarations (non-import, non-handler, non-type).
    type DeclInfo = {
      statement: ts.Statement;
      bindings: Set<string>; // names this statement introduces at top level
      refs: Set<string>; // non-global, non-import names this statement uses
    };

    const candidates: DeclInfo[] = [];

    for (const statement of sf.statements) {
      if (ts.isImportDeclaration(statement)) continue;
      if (ts.isExportDeclaration(statement)) continue;
      if (ts.isInterfaceDeclaration(statement)) continue;
      if (ts.isTypeAliasDeclaration(statement)) continue;
      if (ts.isModuleDeclaration(statement)) continue;

      const modifiers = ts.canHaveModifiers(statement)
        ? ts.getModifiers(statement)
        : undefined;
      const hasDeclare = modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.DeclareKeyword,
      );
      if (hasDeclare) continue;

      if (statementHasHandlerCall(statement)) continue;

      const bindings = statementTopLevelBindings(statement);
      if (bindings.size === 0) continue; // expression-only statements

      // Collect names referenced by this statement that aren't globals or imports.
      const refs = new Set<string>();
      for (const name of collectValueReferences(statement)) {
        if (
          !KNOWN_GLOBALS.has(name) &&
          !fileImportNames.has(name) &&
          !bindings.has(name)
        ) {
          refs.add(name);
        }
      }

      candidates.push({ statement, bindings, refs });
    }

    // Transitively expand: start with what handlers directly need, then
    // include declarations that satisfy those names and add their own refs.
    const needed = new Set(allHandlerFreeRefs);
    let changed = true;
    const included = new Set<DeclInfo>();

    while (changed) {
      changed = false;
      for (const decl of candidates) {
        if (included.has(decl)) continue;
        if ([...decl.bindings].some((n) => needed.has(n))) {
          included.add(decl);
          changed = true;
          for (const ref of decl.refs) {
            if (!needed.has(ref)) {
              needed.add(ref);
              changed = true;
            }
          }
        }
      }
    }

    // Emit included declarations in document order.
    const parts: string[] = [];
    for (const decl of candidates) {
      if (!included.has(decl)) continue;
      const stmtSource = code
        .slice(decl.statement.getFullStart(), decl.statement.getEnd())
        .trim();
      if (!stmtSource) continue;
      const js = transpileStatements(stmtSource);
      if (js) parts.push(js);
    }

    return parts.join("\n");
  }

  function warnOnUncapturedReferences(
    fn: ts.Node,
    endpoint: string,
    kind: "backend" | "websocket",
    moduleLocalNames: Set<string>,
  ): void {
    const bound = collectBoundNames(fn);
    const free: string[] = [];
    for (const name of collectValueReferences(fn)) {
      if (name === "backend" || name === "websocket") continue;
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
    { node: ts.Node; kind: "backend" | "websocket" }
  >();

  ts.forEachChild(sf, walk);
  if (replacements.length === 0) {
    registry.unregisterFile(id);
    wsRegistry.unregisterFile(id);
    return null;
  }

  // Remove sibling handler names from allHandlerFreeRefs — they will be
  // declared as named locals in the per-file IIFE so they don't need
  // module-level capture. Track whether any cross-reference was found so
  // the bundle generator can force IIFE mode even without shared state.
  const siblingHandlerNames = new Set(
    [...entries, ...wsEntries]
      .filter((e) => e.originalName)
      .map((e) => e.originalName!),
  );
  let hasSiblingCrossRefs = false;
  for (const name of siblingHandlerNames) {
    if (allHandlerFreeRefs.delete(name)) {
      hasSiblingCrossRefs = true;
    }
  }

  const handlerCallRanges = replacements.map(({ start, end }) => ({
    start,
    end,
  }));

  function clientHelperInsertPosition(): number {
    let position = 0;
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement)) break;
      position = statement.getEnd();
    }
    return position;
  }

  const helperInsertPosition = clientHelperInsertPosition();
  let insertedHelperImport = false;
  function pushHelperImport(text: string): void {
    const needsLeadingNewline =
      helperInsertPosition !== 0 && !insertedHelperImport;
    replacements.push({
      start: helperInsertPosition,
      end: helperInsertPosition,
      text: `${needsLeadingNewline ? "\n" : ""}${text}\n`,
    });
    insertedHelperImport = true;
  }

  if (entries.length > 0) {
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

  function isInsideRange(
    position: number,
    ranges: Array<{ start: number; end: number }>,
  ): boolean {
    return ranges.some(({ start, end }) => position >= start && position < end);
  }

  const outsideNames = new Set<string>();
  function visitOutside(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) return;
    if (isInsideRange(node.getStart(sf), handlerCallRanges)) return;
    if (ts.isIdentifier(node) && isReferenceIdentifier(node)) {
      outsideNames.add(node.text);
    }
    ts.forEachChild(node, visitOutside);
  }
  ts.forEachChild(sf, visitOutside);

  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const importClause = statement.importClause;
    if (!importClause || importClause.isTypeOnly) continue;

    const names: string[] = [];
    if (importClause.name) names.push(importClause.name.text);
    const namedBindings = importClause.namedBindings;
    if (namedBindings) {
      if (ts.isNamespaceImport(namedBindings)) {
        names.push(namedBindings.name.text);
      } else {
        for (const element of namedBindings.elements) {
          if (!element.isTypeOnly) names.push(element.name.text);
        }
      }
    }

    if (names.length > 0 && !names.some((name) => outsideNames.has(name))) {
      replacements.push({
        start: statement.getFullStart(),
        end: statement.getEnd(),
        text: "",
      });
    }
  }

  // Remove the `declare const backend: ...;` / `declare function websocket: ...;` shims, if present.
  const declareBackendMatch = /declare\s+const\s+backend\s*:[^;]*;/.exec(code);
  if (declareBackendMatch) {
    replacements.push({
      start: declareBackendMatch.index,
      end: declareBackendMatch.index + declareBackendMatch[0].length,
      text: "",
    });
  }
  const declareWebsocketMatch =
    /declare\s+function\s+websocket\s*[<(][^;]*;/.exec(code);
  if (declareWebsocketMatch) {
    replacements.push({
      start: declareWebsocketMatch.index,
      end: declareWebsocketMatch.index + declareWebsocketMatch[0].length,
      text: "",
    });
  }

  const moduleDeclsJs = collectModuleDeclsJs() || undefined;

  // Emit deferred warnings now that we know which module-level names are captured.
  if (handlerNodes.size > 0 && options.emitWarnings) {
    // Build the set of names that are captured via the IIFE (from moduleDeclsJs).
    const moduleLocalNames = new Set<string>();
    if (moduleDeclsJs) {
      for (const statement of sf.statements) {
        if (ts.isImportDeclaration(statement)) continue;
        if (ts.isExportDeclaration(statement)) continue;
        if (statementHasHandlerCall(statement)) continue;
        for (const name of statementTopLevelBindings(statement)) {
          if (allHandlerFreeRefs.has(name)) moduleLocalNames.add(name);
        }
      }
    }
    // Sibling handlers are available as named locals in the IIFE.
    for (const name of siblingHandlerNames) {
      moduleLocalNames.add(name);
    }
    for (const [endpoint, { node, kind }] of handlerNodes) {
      warnOnUncapturedReferences(node, endpoint, kind, moduleLocalNames);
    }
  }

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

  const magic = new RolldownMagicString(code);
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
