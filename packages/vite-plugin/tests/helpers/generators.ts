import * as fc from 'fast-check';
import type { ServerEntry, WsEntry, RuntimeImport } from '../../src/types';

export { fc };

// --- RegistryOp type for stateful property testing ---

export type RegistryOp =
  | { type: 'set'; endpoint: string; file: string }
  | { type: 'registerFile'; file: string; endpoints: string[] }
  | { type: 'unregisterFile'; file: string }
  | { type: 'clear' };

// --- Primitive generators ---

const reservedIdentifierNames = new Set([
  'abstract',
  'any',
  'as',
  'asserts',
  'async',
  'await',
  'bigint',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'constructor',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'infer',
  'instanceof',
  'interface',
  'keyof',
  'let',
  'module',
  'namespace',
  'never',
  'new',
  'null',
  'number',
  'object',
  'of',
  'package',
  'private',
  'protected',
  'public',
  'readonly',
  'require',
  'return',
  'satisfies',
  'set',
  'static',
  'string',
  'super',
  'switch',
  'symbol',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'unique',
  'unknown',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/**
 * Generates TypeScript identifier names that are safe in declaration and label
 * positions used by the property tests.
 */
export function arbIdentifierName(): fc.Arbitrary<string> {
  return fc
    .stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,14}$/)
    .filter((name) => !reservedIdentifierNames.has(name));
}

/**
 * Generates valid endpoint name strings resembling path segments.
 * Includes slashes, alphanumeric, and occasional special characters.
 */
export function arbEndpointName(): fc.Arbitrary<string> {
  const segment = fc.stringMatching(/^[a-z0-9][a-z0-9\-_]{0,11}$/);

  return fc
    .array(segment, { minLength: 1, maxLength: 4 })
    .map((segments) => segments.join('/'));
}

/**
 * Generates syntactically valid TypeScript expressions.
 * Includes arithmetic, string literals, and arrow functions.
 */
export function arbValidTsExpression(): fc.Arbitrary<string> {
  return fc.oneof(
    // Arithmetic expressions
    fc
      .tuple(fc.integer({ min: -1000, max: 1000 }), fc.constantFrom('+', '-', '*'), fc.integer({ min: -1000, max: 1000 }))
      .map(([a, op, b]) => `${a} ${op} ${b}`),
    // String literals
    fc.string({ minLength: 0, maxLength: 20 }).map((s) => {
      const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
      return `"${escaped}"`;
    }),
    // Arrow functions with type annotations
    arbIdentifierName().map((name) => `(${name}: number) => ${name} + 1`),
    // Async arrow functions
    arbIdentifierName().map((name) => `async (${name}: string) => ${name}.length`),
    // Simple numeric literals
    fc.integer({ min: -10000, max: 10000 }).map((n) => String(n)),
    // Template literals
    fc.constant('`hello ${1 + 2}`'),
    // Array expressions
    fc
      .array(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 5 })
      .map((items) => `[${items.join(', ')}]`),
  );
}

/**
 * Generates RuntimeImport instances with realistic field values.
 */
function arbRuntimeImport(): fc.Arbitrary<RuntimeImport> {
  return fc.record({
    defaultName: fc.option(arbIdentifierName(), { nil: undefined }),
    namespaceName: fc.option(arbIdentifierName(), { nil: undefined }),
    named: fc.array(
      fc.record({
        imported: arbIdentifierName(),
        local: arbIdentifierName(),
      }),
      { minLength: 0, maxLength: 3 },
    ),
    specifier: fc.oneof(
      // Relative imports
      fc
        .tuple(
          fc.constantFrom('./', '../', '../../'),
          arbIdentifierName(),
        )
        .map(([prefix, name]) => `${prefix}${name}`),
      // Package imports
      arbIdentifierName().map((name) => name),
    ),
  });
}

/**
 * Generates ServerEntry instances with realistic fields.
 */
export function arbServerEntry(): fc.Arbitrary<ServerEntry> {
  return fc.record({
    endpoint: arbEndpointName(),
    imports: fc.array(arbRuntimeImport(), { minLength: 0, maxLength: 3 }),
    fnJs: fc.oneof(
      arbIdentifierName().map((p) => `(${p}) => ${p}`),
      arbIdentifierName().map((p) => `async (${p}) => { return ${p}; }`),
      fc.constant('() => 42'),
      fc.constant('(a, b) => a + b'),
    ),
    file: fc
      .tuple(
        fc.constantFrom('src/', 'lib/', 'modules/'),
        arbIdentifierName(),
        fc.constantFrom('.ts', '.tsx'),
      )
      .map(([dir, name, ext]) => `${dir}${name}${ext}`),
    originalName: fc.option(arbIdentifierName(), { nil: undefined }),
    moduleDeclsJs: fc.option(
      fc.oneof(
        fc.constant('const shared = {};'),
        fc.constant('let counter = 0;'),
        arbIdentifierName().map((n) => `const ${n} = [];`),
      ),
      { nil: undefined },
    ),
    hasSiblingCrossRefs: fc.option(fc.boolean(), { nil: undefined }),
  });
}

/**
 * Generates WsEntry instances with realistic fields.
 */
export function arbWsEntry(): fc.Arbitrary<WsEntry> {
  return fc.record({
    endpoint: arbEndpointName(),
    imports: fc.array(arbRuntimeImport(), { minLength: 0, maxLength: 3 }),
    handlersJs: fc.oneof(
      fc.constant('({ onMessage(ws, data) { ws.send(data); } })'),
      fc.constant(
        '({ onOpen(ws) { console.log("open"); }, onClose(ws) { console.log("close"); } })',
      ),
      fc.constant(
        '({ onOpen(ws) {}, onMessage(ws, data) { ws.send(data); }, onClose(ws) {} })',
      ),
    ),
    file: fc
      .tuple(
        fc.constantFrom('src/', 'lib/', 'modules/'),
        arbIdentifierName(),
        fc.constantFrom('.ts', '.tsx'),
      )
      .map(([dir, name, ext]) => `${dir}${name}${ext}`),
    originalName: fc.option(arbIdentifierName(), { nil: undefined }),
    moduleDeclsJs: fc.option(
      fc.oneof(
        fc.constant('const connections = new Set();'),
        fc.constant('let messageCount = 0;'),
        arbIdentifierName().map((n) => `const ${n} = new Map();`),
      ),
      { nil: undefined },
    ),
    hasSiblingCrossRefs: fc.option(fc.boolean(), { nil: undefined }),
  });
}

/**
 * Generates sequences of registry operations for stateful property testing.
 */
export function arbRegistryOps(): fc.Arbitrary<RegistryOp[]> {
  const filePool = fc.constantFrom(
    'src/api.ts',
    'src/handlers.ts',
    'src/routes.ts',
    'lib/services.ts',
    'modules/auth.ts',
  );

  const endpointPool = fc.constantFrom(
    'api/get-users',
    'api/create-user',
    'api/delete-user',
    'auth/login',
    'auth/logout',
    'data/fetch',
    'ws/chat',
    'ws/notifications',
  );

  const op: fc.Arbitrary<RegistryOp> = fc.oneof(
    // set operation
    fc.record({
      type: fc.constant('set' as const),
      endpoint: endpointPool,
      file: filePool,
    }),
    // registerFile operation
    fc.record({
      type: fc.constant('registerFile' as const),
      file: filePool,
      endpoints: fc.array(endpointPool, { minLength: 1, maxLength: 4 }),
    }),
    // unregisterFile operation
    fc.record({
      type: fc.constant('unregisterFile' as const),
      file: filePool,
    }),
    // clear operation
    fc.record({
      type: fc.constant('clear' as const),
    }),
  );

  return fc.array(op, { minLength: 1, maxLength: 20 });
}

/**
 * Generates TypeScript source code containing $server()/$ws() calls.
 */
export function arbTsSource(): fc.Arbitrary<string> {
  const importLine = arbIdentifierName().map(
    (name) => `import { ${name} } from './${name}';`,
  );

  const actionCall = fc
    .tuple(arbIdentifierName(), arbIdentifierName().filter(n => n !== 'if' && n !== 'for' && n !== 'while'))
    .map(
      ([varName, param]) =>
        `const ${varName} = $server((${param}: string) => { return ${param}.toUpperCase(); });`,
    );


  const wsCall = arbIdentifierName().map(
    (varName) =>
      `const ${varName} = $ws({ onMessage(ws, data) { ws.send(data); } });`,
  );

  return fc
    .tuple(
      fc.array(importLine, { minLength: 0, maxLength: 3 }),
      fc.array(
        fc.oneof(serverCall, wsCall),
        { minLength: 1, maxLength: 4 },
      ),
    )
    .map(([imports, handlers]) => [...imports, '', ...handlers].join('\n'));
}
