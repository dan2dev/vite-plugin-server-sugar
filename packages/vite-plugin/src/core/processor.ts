import ts from "typescript";
import { relative } from "node:path";
import { RolldownMagicString } from "rolldown";
import { Registry } from "./registry";
import { transpileTs, transpileStatements } from "./transpiler";
import type { ActionEntry, RuntimeImport, WsEntry } from "../types";
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
  registry: Registry<ActionEntry>;
  /** Registry for `$ws()` handlers. Optional for callers that only care about $action(). */
  wsRegistry?: Registry<WsEntry>;
  root: string;
  /**
   * When true, emit a console warning for `$action()`/`$ws()` bodies
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

  if (!/(?:\$action|\$ws)\s*\(/.test(code)) {
    registry.unregisterFile(id);
    wsRegistry.unregisterFile(id);
    return null;
  }

  const sf = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const helperImports: string[] = [];
  const entries: ActionEntry[] = [];
  const wsEntries: WsEntry[] = [];
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
  const clientArgsName = uniqueLocalName("__actionArgs");
  const clientWsConnectHelperName = uniqueLocalName(CLIENT_WS_CONNECT_EXPORT);
  const clientWsArgsName = uniqueLocalName("__wsArgs");

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
    kind: "action" | "ws",
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
      node.expression.text === "$action"
    ) {
      const call = node;
      const arg = node.arguments[0];

      if (!arg || !ts.isFunctionLike(arg)) {
        return;
      }

      const endpoint = uniqueEndpoint(
        inferBackendLabel(call, sf, "$action"),
        call,
        "action",
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
        if (name === "$action") continue;
        if (
          bound.has(name) ||
          fileImportNames.has(name) ||
          KNOWN_GLOBALS.has(name)
        )
          continue;
        allHandlerFreeRefs.add(name);
      }

      handlerNodes.set(endpoint, { node: arg, kind: "action" });

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

      if (!arg || !isValidWebsocketHandlersArg(arg)) {
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
        (n.expression.text === "$action" || n.expression.text === "$ws")
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

  function warnOnUncapturedReferences(
    fn: ts.Node,
    endpoint: string,
    kind: "action" | "ws",
    moduleLocalNames: Set<string>,
  ): void {
    const bound = collectBoundNames(fn);
    const free: string[] = [];
    for (const name of collectValueReferences(fn)) {
      if (name === "$action" || name === "$ws") continue;
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

  // Sibling handler names are handled separately in the per-file IIFE.
  const siblingHandlerNames = new Set(
    [...entries, ...wsEntries]
      .filter((e) => e.originalName)
      .map((e) => e.originalName!),
  );

  /**
   * Names of module-level declarations that are transitively needed by at
   * least one backend/websocket handler in this file.
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
   * at least one backend/websocket handler in this file.
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

  // Remove the `declare function $action: ...;` / `declare function $ws: ...;` shims, if present.
  const declareActionMatch = /declare\s+function\s+\$action\s*[<(][^;]*;/.exec(code);
  if (declareActionMatch) {
    replacements.push({
      start: declareActionMatch.index,
      end: declareActionMatch.index + declareActionMatch[0].length,
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

  // Emit deferred warnings now that we know which module-level names are captured.
  if (handlerNodes.size > 0 && options.emitWarnings) {
    const moduleLocalNames = new Set(namesDefinedInModuleAndNeededByServer);
    // Sibling handlers are available as named locals in the IIFE.
    for (const name of siblingHandlerNames) {
      moduleLocalNames.add(name);
    }
    for (const [endpoint, { node, kind }] of handlerNodes) {
      warnOnUncapturedReferences(node, endpoint, kind, moduleLocalNames);
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
