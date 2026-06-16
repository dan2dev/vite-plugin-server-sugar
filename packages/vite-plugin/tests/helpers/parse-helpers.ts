import ts from 'typescript';

/**
 * Attempts to parse code as a JavaScript module using TypeScript's parser.
 * Returns true if the code is syntactically valid (no parse errors).
 */
export function isValidJs(code: string): boolean {
  const sourceFile = ts.createSourceFile(
    'test.js',
    code,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.JS,
  );

  // Check for parse diagnostics
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] })
    .parseDiagnostics;

  if (diagnostics && diagnostics.length > 0) {
    return false;
  }

  // Also check via a program-free approach: look for error nodes in the AST
  let hasError = false;
  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.Unknown) {
      hasError = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return !hasError;
}

/**
 * Counts the number of non-overlapping occurrences of a pattern string in code.
 */
export function countOccurrences(code: string, pattern: string): number {
  if (pattern.length === 0) return 0;

  let count = 0;
  let pos = 0;

  while (true) {
    const idx = code.indexOf(pattern, pos);
    if (idx === -1) break;
    count++;
    pos = idx + pattern.length;
  }

  return count;
}
