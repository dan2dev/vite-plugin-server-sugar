import ts from 'typescript';

export function transpileTs(source: string): string {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: false,
    },
  });
  // transpileModule may prepend "use strict"; — strip it, then trim the
  // trailing statement semicolon so the result is a plain expression.
  return outputText
    .replace(/^["']use strict["'];\n?/, '')
    .trimEnd()
    .replace(/;$/, '')
    .trimEnd();
}
