import ts from 'typescript';
import { relative } from 'node:path';
import { RolldownMagicString } from 'rolldown';
import { Registry } from './registry';
import { transpileTs } from './transpiler';
import type { BackendEntry, RuntimeImport } from '../types';
import {
  API_PREFIX,
  CLIENT_FETCH_EXPORT,
  CLIENT_HELPER_ID
} from '../constants';
import {
  normalizePath
} from '../utils/path';
import { toKebabCase } from '../utils/crypto';
import {
  collectIdentifierNames,
  collectReferencedNames,
  collectValueReferences,
  collectBoundNames,
  isReferenceIdentifier,
  inferBackendLabel
} from '../utils/ast';

/**
 * Identifiers that resolve to ambient globals available in the Bun server
 * runtime, so referencing them inside a `backend()` body is fine even though
 * they are neither imported nor declared locally.
 */
const KNOWN_GLOBALS = new Set<string>([
  'globalThis', 'Bun', 'process', 'console', 'fetch', 'crypto', 'performance',
  'Response', 'Request', 'Headers', 'FormData', 'Blob', 'File', 'URL',
  'URLSearchParams', 'AbortController', 'AbortSignal', 'TextEncoder',
  'TextDecoder', 'ReadableStream', 'WritableStream', 'TransformStream',
  'structuredClone', 'atob', 'btoa', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'queueMicrotask', 'JSON', 'Math', 'Date',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Map',
  'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Promise', 'RegExp', 'Proxy',
  'Reflect', 'Intl', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'EvalError', 'ReferenceError', 'URIError', 'AggregateError', 'Function',
  'NaN', 'Infinity', 'undefined', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI',
  'decodeURI', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array',
  'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array',
  'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
  'BigUint64Array',
]);

export interface ProcessorOptions {
  registry: Registry;
  root: string;
  /**
   * When true, emit a console warning for `backend()` bodies that reference
   * values they will not receive on the server (not imports, parameters,
   * locals, or known globals).
   */
  emitWarnings?: boolean;
}

export interface ProcessResult {
  code: string;
  map: string | null;
}

export function processFile(code: string, id: string, options: ProcessorOptions): ProcessResult | null {
  const { registry, root } = options;

  if (!/\bbackend\s*\(/.test(code)) {
    registry.unregisterFile(id);
    return null;
  }

  const sf = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const entries: BackendEntry[] = [];
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
  const clientArgsName = uniqueLocalName('__backendArgs');

  function endpointName(file: string, name: string): string {
    let rel = normalizePath(relative(root, file));
    if (rel.startsWith('src/')) rel = rel.slice(4);
    const base = rel.replace(/\.(tsx?|jsx?)$/, '');

    const segments = [...base.split('/'), name];
    return segments.map(toKebabCase).join('/');
  }

  function endpointUrl(endpoint: string): string {
    return API_PREFIX + endpoint.split('/').map(encodeURIComponent).join('/');
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
            if (element.isTypeOnly || !usedNames.has(element.name.text)) continue;

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

  function uniqueEndpoint(label: string, call: ts.CallExpression): string {
    const endpoint = endpointName(id, label);
    if (!usedEndpoints.has(endpoint)) {
      usedEndpoints.add(endpoint);
      return endpoint;
    }

    const { line, character } = sf.getLineAndCharacterOfPosition(call.getStart(sf));
    const fallbackLabel = `backend@${line + 1}:${character + 1}`;
    const duplicateEndpoint = endpointName(id, `${label}.${fallbackLabel}`);
    usedEndpoints.add(duplicateEndpoint);
    return duplicateEndpoint;
  }

  function walk(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'backend'
    ) {
      const call = node;
      const arg = node.arguments[0];

      if (!arg || !ts.isFunctionLike(arg)) {
        return;
      }

      const endpoint = uniqueEndpoint(inferBackendLabel(call, sf), call);

      const fnSource = code.slice(arg.getStart(sf), arg.getEnd());
      const fnJs = transpileTs(fnSource);
      const imports = collectRuntimeImports(collectReferencedNames(arg));
      entries.push({ endpoint, imports, fnJs, file: id });

      if (fileImportNames) warnOnUncapturedReferences(arg, endpoint, fileImportNames);

      const fetchWrapper = [
        `async (...${clientArgsName}) => ${clientFetchHelperName}(`,
        `${JSON.stringify(endpointUrl(endpoint))}, `,
        `JSON.stringify(${clientArgsName}))`,
      ].join('');

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
      if (!clause) continue;
      if (clause.name) names.add(clause.name.text);
      const namedBindings = clause.namedBindings;
      if (!namedBindings) continue;
      if (ts.isNamespaceImport(namedBindings)) {
        names.add(namedBindings.name.text);
      } else {
        for (const element of namedBindings.elements) names.add(element.name.text);
      }
    }
    return names;
  }

  function warnOnUncapturedReferences(
    fn: ts.Node,
    endpoint: string,
    importNames: Set<string>,
  ): void {
    const bound = collectBoundNames(fn);
    const free: string[] = [];
    for (const name of collectValueReferences(fn)) {
      if (name === 'backend') continue;
      if (bound.has(name) || importNames.has(name) || KNOWN_GLOBALS.has(name)) continue;
      free.push(name);
    }
    if (free.length === 0) return;

    const list = free.map((name) => `'${name}'`).join(', ');
    const isOne = free.length === 1;
    console.warn(
      `[server-build] ${normalizePath(relative(root, id))}: backend handler "${endpoint}" references ` +
        `${list} which ${isOne ? 'is' : 'are'} not imported, a parameter, or a known global. ` +
        `${isOne ? 'It' : 'They'} will be undefined when the handler runs on the server.`,
    );
  }

  const fileImportNames = options.emitWarnings ? collectFileImportNames() : null;

  ts.forEachChild(sf, walk);
  if (replacements.length === 0) {
    registry.unregisterFile(id);
    return null;
  }

  const backendCallRanges = replacements.map(({ start, end }) => ({ start, end }));

  function clientHelperInsertPosition(): number {
    let position = 0;
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement)) break;
      position = statement.getEnd();
    }
    return position;
  }

  const helperInsertPosition = clientHelperInsertPosition();
  const importClause = clientFetchHelperName === CLIENT_FETCH_EXPORT
    ? CLIENT_FETCH_EXPORT
    : `${CLIENT_FETCH_EXPORT} as ${clientFetchHelperName}`;

  replacements.push({
    start: helperInsertPosition,
    end: helperInsertPosition,
    text: `${helperInsertPosition === 0 ? '' : '\n'}import { ${importClause} } from ${JSON.stringify(CLIENT_HELPER_ID)};\n`,
  });

  function isInsideRange(position: number, ranges: Array<{ start: number; end: number }>): boolean {
    return ranges.some(({ start, end }) => position >= start && position < end);
  }

  const outsideNames = new Set<string>();
  function visitOutside(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) return;
    if (isInsideRange(node.getStart(sf), backendCallRanges)) return;
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

    if (names.length > 0 && !names.some(name => outsideNames.has(name))) {
      replacements.push({
        start: statement.getFullStart(),
        end: statement.getEnd(),
        text: '',
      });
    }
  }

  // Remove the `declare const backend: ...;` shim, if present.
  const declareMatch = /declare\s+const\s+backend\s*:[^;]*;/.exec(code);
  if (declareMatch) {
    replacements.push({
      start: declareMatch.index,
      end: declareMatch.index + declareMatch[0].length,
      text: '',
    });
  }

  registry.unregisterFile(id);
  registry.registerFile(id, entries.map(e => e.endpoint));
  for (const entry of entries) {
    registry.set(entry.endpoint, entry);
  }

  const magic = new RolldownMagicString(code);
  for (const r of replacements) {
    if (r.start === r.end) {
      if (r.start === 0) magic.appendLeft(0, r.text);
      else magic.appendRight(r.start, r.text);
    } else if (r.text === '') {
      magic.remove(r.start, r.end);
    } else {
      magic.overwrite(r.start, r.end, r.text);
    }
  }

  return {
    code: magic.toString(),
    map: magic.generateMap({ source: id, includeContent: true, hires: true }).toString(),
  };
}
