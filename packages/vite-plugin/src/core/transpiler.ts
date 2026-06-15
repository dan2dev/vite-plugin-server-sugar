import ts from 'typescript';

const TRANSPILE_OPTIONS: ts.TranspileOptions = {
  compilerOptions: {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    removeComments: false,
  },
};

/**
 * Transpile a TypeScript *expression* to JS. Strips the trailing semicolon so
 * the result can be used as an inline expression.
 */
export function transpileTs(source: string): string {
  const { outputText } = ts.transpileModule(source, TRANSPILE_OPTIONS);
  // transpileModule may prepend "use strict"; — strip it, then trim the
  // trailing statement semicolon so the result is a plain expression.
  return outputText
    .replace(/^["']use strict["'];\n?/, '')
    .trimEnd()
    .replace(/;$/, '')
    .trimEnd();
}

/**
 * Transpile one or more TypeScript *statements* to JS. Preserves statement
 * terminators. Strips `export` modifiers so the output is usable inside an
 * IIFE or module block without re-exporting.
 */
export function transpileStatements(source: string): string {
  const { outputText } = ts.transpileModule(source, TRANSPILE_OPTIONS);
  return outputText
    .replace(/^["']use strict["'];\n?/, '')
    .replace(/^export default /gm, '')
    .replace(/^export /gm, '')
    .trimEnd();
}
