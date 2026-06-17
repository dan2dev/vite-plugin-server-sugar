import ts from 'typescript';

export function collectIdentifierNames(node: ts.Node): Set<string> {
  const names = new Set<string>();

  function visit(child: ts.Node): void {
    if (ts.isIdentifier(child)) {
      names.add(child.text);
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
  return names;
}

/**
 * Whether an identifier is a *reference* to a binding (a value/type it reads)
 * rather than a name in a non-referencing position such as a property key,
 * a member name (`obj.foo`), or an import/export specifier.
 *
 * Used to decide which imported bindings a piece of code actually uses, so we
 * never keep (or pull in) an import just because its name happens to collide
 * with an unrelated property name.
 */
export function isReferenceIdentifier(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (!parent) return true;

  // `obj.foo` — `foo` is a member name, not a reference.
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  // `A.B` qualified type/namespace name — `B` is a member name.
  if (ts.isQualifiedName(parent) && parent.right === id) return false;
  // `{ foo: value }` — the key `foo` is not a reference (the value side is).
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  // `{ foo: localName }` destructuring — `foo` is the source property name.
  if (ts.isBindingElement(parent) && parent.propertyName === id) return false;
  // Member declaration names on classes / interfaces / object types / enums.
  if (
    (ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === id
  ) {
    return false;
  }
  // Import/export specifiers are bindings/aliases, not references.
  if (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent)
  ) {
    return false;
  }
  // Statement labels and `break`/`continue` targets.
  if (ts.isLabeledStatement(parent) && parent.label === id) return false;
  if (
    (ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) &&
    parent.label === id
  ) {
    return false;
  }

  return true;
}

/**
 * Collect the names of every identifier that *references* a binding within
 * `node` (see {@link isReferenceIdentifier}). Property keys and member names
 * are excluded.
 */
export function collectReferencedNames(node: ts.Node): Set<string> {
  const names = new Set<string>();

  function visit(child: ts.Node): void {
    if (ts.isIdentifier(child) && isReferenceIdentifier(child)) {
      names.add(child.text);
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
  return names;
}

function isTypePositionNode(node: ts.Node): boolean {
  return (
    node.kind >= ts.SyntaxKind.FirstTypeNode &&
    node.kind <= ts.SyntaxKind.LastTypeNode
  );
}

/**
 * Like {@link collectReferencedNames}, but skips identifiers in type positions
 * (annotations, type arguments, `as`/`satisfies` types, …) since those are
 * erased at runtime. Used to find genuine *value* references.
 */
export function collectValueReferences(node: ts.Node): Set<string> {
  const names = new Set<string>();

  function visit(child: ts.Node): void {
    if (isTypePositionNode(child)) return;
    if (ts.isIdentifier(child) && isReferenceIdentifier(child)) {
      names.add(child.text);
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
  return names;
}

/**
 * Collect the names a node *binds* in its own scope: parameters (including
 * destructured ones), local `var`/`let`/`const` declarations, named function /
 * class declarations, and `catch` bindings. Property names inside destructuring
 * patterns are intentionally excluded — only the locals that get introduced.
 *
 * Used (alongside imports and known globals) to find identifiers a `$action()`
 * body references but never receives, which would be undefined server-side.
 */
export function collectBoundNames(node: ts.Node): Set<string> {
  const names = new Set<string>();

  function addBindingName(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) {
      names.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) addBindingName(element.name);
    }
  }

  function visit(child: ts.Node): void {
    if (ts.isParameter(child)) {
      addBindingName(child.name);
    } else if (ts.isVariableDeclaration(child)) {
      addBindingName(child.name);
    } else if (
      (ts.isFunctionDeclaration(child) ||
        ts.isFunctionExpression(child) ||
        ts.isClassDeclaration(child) ||
        ts.isClassExpression(child)) &&
      child.name
    ) {
      names.add(child.name.text);
    } else if (ts.isCatchClause(child) && child.variableDeclaration) {
      addBindingName(child.variableDeclaration.name);
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
  return names;
}

export function propertyNameText(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const expression = name.expression;
    if (
      ts.isIdentifier(expression) ||
      ts.isStringLiteral(expression) ||
      ts.isNumericLiteral(expression)
    ) {
      return expression.text;
    }
  }
  return 'computed';
}

export function bindingNameText(name: ts.BindingName): string {
  return ts.isIdentifier(name) ? name.text : 'binding';
}

export function functionNameText(node: ts.Node): string | null {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)) &&
    node.name
  ) {
    return propertyNameText(node.name);
  }
  return null;
}

export function inferBackendLabel(
  call: ts.CallExpression,
  sf: ts.SourceFile,
  fallbackPrefix = '$action',
): string {
  const segments: string[] = [];
  let current: ts.Node = call;

  while (current.parent) {
    const parent = current.parent;

    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      segments.unshift(bindingNameText(parent.name));
      break;
    }

    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      segments.unshift(propertyNameText(parent.name));
      current = parent;
      continue;
    }

    if (ts.isPropertyDeclaration(parent) && parent.initializer === current) {
      segments.unshift(propertyNameText(parent.name));
      current = parent;
      continue;
    }

    if (ts.isArrayLiteralExpression(parent)) {
      const index = parent.elements.findIndex((element) => element === current);
      if (index >= 0) segments.unshift(String(index));
      current = parent;
      continue;
    }

    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isObjectLiteralExpression(parent)
    ) {
      current = parent;
      continue;
    }

    if (ts.isExportAssignment(parent) && parent.expression === current) {
      segments.unshift('default');
      break;
    }

    if (ts.isReturnStatement(parent) && parent.expression === current) {
      segments.unshift('return');
      current = parent;
      continue;
    }

    if (ts.isCallExpression(parent)) {
      const index = parent.arguments.findIndex((arg) => arg === current);
      if (index >= 0) {
        segments.unshift(`arg${index}`);
        current = parent;
        continue;
      }
    }

    if (ts.isConditionalExpression(parent)) {
      if (parent.whenTrue === current) segments.unshift('true');
      if (parent.whenFalse === current) segments.unshift('false');
      if (parent.condition === current) segments.unshift('condition');
      current = parent;
      continue;
    }

    const functionName = functionNameText(parent);
    if (functionName) {
      segments.unshift(functionName);
      break;
    }

    current = parent;
  }

  if (segments.length > 0) return segments.join('.');

  const { line, character } = sf.getLineAndCharacterOfPosition(call.getStart(sf));
  return `${fallbackPrefix}@${line + 1}:${character + 1}`;
}
