import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  isReferenceIdentifier,
  collectValueReferences,
  collectBoundNames,
  inferBackendLabel,
} from '../../src/utils/ast';

// Helper: parse a code snippet and return the source file
function parse(code: string, fileName = 'test.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

// Helper: find the first identifier with the given text in a source file
function findIdentifier(sf: ts.SourceFile, name: string): ts.Identifier | undefined {
  let result: ts.Identifier | undefined;
  function visit(node: ts.Node): void {
    if (result) return;
    if (ts.isIdentifier(node) && node.text === name) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return result;
}

// Helper: find all identifiers with a given text
function findAllIdentifiers(sf: ts.SourceFile, name: string): ts.Identifier[] {
  const results: ts.Identifier[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === name) {
      results.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return results;
}

// Helper: find the first CallExpression in a source file
function findCallExpression(sf: ts.SourceFile, fnName: string): ts.CallExpression | undefined {
  let result: ts.CallExpression | undefined;
  function visit(node: ts.Node): void {
    if (result) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === fnName
    ) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return result;
}

describe('isReferenceIdentifier', () => {
  it('returns false for property access names (obj.foo)', () => {
    const sf = parse('const x = obj.foo;');
    const ids = findAllIdentifiers(sf, 'foo');
    // `foo` in `obj.foo` is the property access name
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(isReferenceIdentifier(id)).toBe(false);
    }
  });

  it('returns true for the object in a property access (obj.foo)', () => {
    const sf = parse('const x = obj.foo;');
    const id = findIdentifier(sf, 'obj');
    expect(id).toBeDefined();
    expect(isReferenceIdentifier(id!)).toBe(true);
  });

  it('returns false for object literal keys ({ foo: value })', () => {
    const sf = parse('const x = { foo: value };');
    const ids = findAllIdentifiers(sf, 'foo');
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(isReferenceIdentifier(id)).toBe(false);
    }
  });

  it('returns true for object literal values ({ foo: value })', () => {
    const sf = parse('const x = { foo: value };');
    const id = findIdentifier(sf, 'value');
    expect(id).toBeDefined();
    expect(isReferenceIdentifier(id!)).toBe(true);
  });

  it('returns false for destructuring property sources ({ foo: localName })', () => {
    const sf = parse('const { foo: localName } = obj;');
    // In destructuring `{ foo: localName }`, `foo` is the property name (source)
    const ids = findAllIdentifiers(sf, 'foo');
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(isReferenceIdentifier(id)).toBe(false);
    }
  });

  it('returns false for import specifier names', () => {
    const sf = parse('import { foo } from "mod";');
    const id = findIdentifier(sf, 'foo');
    expect(id).toBeDefined();
    expect(isReferenceIdentifier(id!)).toBe(false);
  });

  it('returns false for labeled statements', () => {
    const sf = parse('loop: for (;;) { break loop; }');
    const ids = findAllIdentifiers(sf, 'loop');
    for (const id of ids) {
      expect(isReferenceIdentifier(id)).toBe(false);
    }
  });

  it('returns false for method declaration names', () => {
    const sf = parse('class Foo { bar() {} }');
    const id = findIdentifier(sf, 'bar');
    expect(id).toBeDefined();
    expect(isReferenceIdentifier(id!)).toBe(false);
  });
});

describe('collectValueReferences', () => {
  it('excludes identifiers in type annotations', () => {
    const sf = parse('function fn(x: MyType): ReturnType { return x; }');
    const fnNode = sf.statements[0];
    const refs = collectValueReferences(fnNode);
    // `x` should be included (it's used as a value in the return statement)
    expect(refs.has('x')).toBe(true);
    // `MyType` and `ReturnType` should be excluded (type positions only)
    expect(refs.has('MyType')).toBe(false);
    expect(refs.has('ReturnType')).toBe(false);
  });

  it('excludes identifiers appearing only in type parameter constraints when inside type nodes', () => {
    // Type references inside explicit type annotations are excluded
    const sf = parse('function fn(x: Map<string, MyValue>): void { return; }');
    const fnNode = sf.statements[0];
    const refs = collectValueReferences(fnNode);
    expect(refs.has('MyValue')).toBe(false);
  });

  it('excludes identifiers in type assertion positions', () => {
    const sf = parse('const x = value as SomeType;');
    const stmt = sf.statements[0];
    const refs = collectValueReferences(stmt);
    expect(refs.has('value')).toBe(true);
    expect(refs.has('SomeType')).toBe(false);
  });

  it('includes identifiers that appear as values even if name also appears as type', () => {
    const sf = parse('const x: Foo = Foo.create();');
    const stmt = sf.statements[0];
    const refs = collectValueReferences(stmt);
    // `Foo` appears in type annotation (excluded) AND as value reference in `Foo.create()`
    // The value reference should be included
    expect(refs.has('Foo')).toBe(true);
  });
});

describe('collectBoundNames', () => {
  it('captures variable declarations (const, let, var)', () => {
    const sf = parse('function test() { const a = 1; let b = 2; var c = 3; }');
    const fnNode = sf.statements[0];
    const names = collectBoundNames(fnNode);
    expect(names.has('a')).toBe(true);
    expect(names.has('b')).toBe(true);
    expect(names.has('c')).toBe(true);
  });

  it('captures nested arrow function variable names', () => {
    const sf = parse('function test() { const inner = () => { const deep = 1; }; }');
    const fnNode = sf.statements[0];
    const names = collectBoundNames(fnNode);
    expect(names.has('inner')).toBe(true);
    expect(names.has('deep')).toBe(true);
  });

  it('captures class declarations', () => {
    const sf = parse('function test() { class MyClass {} }');
    const fnNode = sf.statements[0];
    const names = collectBoundNames(fnNode);
    expect(names.has('MyClass')).toBe(true);
  });

  it('captures function parameters including destructured', () => {
    const sf = parse('function test({ id, name }: Args) { const x = 1; }');
    const fnNode = sf.statements[0];
    const names = collectBoundNames(fnNode);
    expect(names.has('id')).toBe(true);
    expect(names.has('name')).toBe(true);
    expect(names.has('x')).toBe(true);
  });

  it('captures catch clause bindings', () => {
    const sf = parse('function test() { try {} catch (err) { const y = 1; } }');
    const fnNode = sf.statements[0];
    const names = collectBoundNames(fnNode);
    expect(names.has('err')).toBe(true);
    expect(names.has('y')).toBe(true);
  });

  it('captures named function declarations at any depth', () => {
    const sf = parse(`
      function outer() {
        function middle() {
          function inner() {}
        }
      }
    `);
    const fnNode = sf.statements[0];
    const names = collectBoundNames(fnNode);
    expect(names.has('middle')).toBe(true);
    expect(names.has('inner')).toBe(true);
  });

  it('captures array destructuring bindings', () => {
    const sf = parse('function test() { const [a, b, ...rest] = arr; }');
    const fnNode = sf.statements[0];
    const names = collectBoundNames(fnNode);
    expect(names.has('a')).toBe(true);
    expect(names.has('b')).toBe(true);
    expect(names.has('rest')).toBe(true);
  });
});

describe('inferBackendLabel', () => {
  it('uses variable name for const assignment', () => {
    const sf = parse('const getTodos = $action(() => []);');
    const call = findCallExpression(sf, '$action')!;
    expect(call).toBeDefined();
    const label = inferBackendLabel(call, sf);
    expect(label).toBe('getTodos');
  });

  it('uses property path for nested property assignment', () => {
    const sf = parse('const api = { todos: { getAll: $action(() => []) } };');
    const call = findCallExpression(sf, '$action')!;
    expect(call).toBeDefined();
    const label = inferBackendLabel(call, sf);
    expect(label).toBe('api.todos.getAll');
  });

  it('falls back to line:col when no naming context available', () => {
    const sf = parse('$action(() => []);');
    const call = findCallExpression(sf, '$action')!;
    expect(call).toBeDefined();
    const label = inferBackendLabel(call, sf);
    expect(label).toMatch(/^\$action@\d+:\d+$/);
  });

  it('handles destructured binding assignments', () => {
    // When assigned to a destructured binding pattern, the label includes
    // 'binding' (from bindingNameText on a non-identifier BindingName)
    // concatenated with the property assignment path
    const sf = parse('const { handler } = { handler: $action(() => []) };');
    const call = findCallExpression(sf, '$action')!;
    expect(call).toBeDefined();
    const label = inferBackendLabel(call, sf);
    // The walk finds PropertyAssignment 'handler' then VariableDeclaration
    // with destructuring pattern → bindingNameText returns 'binding'
    expect(label).toBe('binding.handler');
  });

  it('uses custom fallback prefix', () => {
    const sf = parse('$ws({ onMessage() {} });');
    const call = findCallExpression(sf, '$ws')!;
    expect(call).toBeDefined();
    const label = inferBackendLabel(call, sf, '$ws');
    expect(label).toMatch(/^\$ws@\d+:\d+$/);
  });

  it('handles export default assignment', () => {
    const sf = parse('export default $action(() => []);');
    const call = findCallExpression(sf, '$action')!;
    expect(call).toBeDefined();
    const label = inferBackendLabel(call, sf);
    expect(label).toBe('default');
  });
});
