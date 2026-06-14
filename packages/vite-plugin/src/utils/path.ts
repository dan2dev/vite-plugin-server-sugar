import { sep, relative } from 'node:path';

export function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

export function toImportPath(fromDir: string, target: string): string {
  let path = normalizePath(relative(fromDir, target));
  if (!path.startsWith('.')) path = `./${path}`;
  return path;
}

export function isRelativeImport(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/');
}
