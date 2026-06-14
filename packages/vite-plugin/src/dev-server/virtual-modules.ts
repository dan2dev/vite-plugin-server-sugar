import { Registry } from '../core/registry';
import type { RuntimeImport } from '../types';
import {
  CLIENT_FETCH_EXPORT,
  CLIENT_HELPER_ID,
  RESOLVED_CLIENT_HELPER_ID,
  RESOLVED_PREFIX,
  VIRTUAL_PREFIX
} from '../constants';
import { isRelativeImport, normalizePath, toImportPath } from '../utils/path';
import { dirname, resolve } from 'node:path';

export function runtimeImportSpecifier(
  sourceFile: string,
  specifier: string,
  fromDir: string | null,
): string {
  if (!isRelativeImport(specifier)) return specifier;

  const target = resolve(dirname(sourceFile), specifier);
  if (!fromDir) return normalizePath(target);

  return toImportPath(fromDir, target);
}

function renderNamedImport(imported: string, local: string): string {
  const importedName = /^[A-Za-z_$][\w$]*$/.test(imported)
    ? imported
    : JSON.stringify(imported);

  return imported === local ? importedName : `${importedName} as ${local}`;
}

export function renderRuntimeImport(
  runtimeImport: RuntimeImport,
  sourceFile: string,
  fromDir: string | null,
): string {
  const specifier = JSON.stringify(
    runtimeImportSpecifier(sourceFile, runtimeImport.specifier, fromDir),
  );

  if (runtimeImport.namespaceName) {
    const namespaceImport = `* as ${runtimeImport.namespaceName}`;
    const clause = runtimeImport.defaultName
      ? `${runtimeImport.defaultName}, ${namespaceImport}`
      : namespaceImport;

    return `import ${clause} from ${specifier};`;
  }

  const namedImports = runtimeImport.named
    .map(({ imported, local }) => renderNamedImport(imported, local))
    .join(', ');

  if (runtimeImport.defaultName && namedImports) {
    return `import ${runtimeImport.defaultName}, { ${namedImports} } from ${specifier};`;
  }

  if (runtimeImport.defaultName) {
    return `import ${runtimeImport.defaultName} from ${specifier};`;
  }

  return `import { ${namedImports} } from ${specifier};`;
}

export function resolveVirtualId(id: string): string | undefined {
  if (id === CLIENT_HELPER_ID) {
    return RESOLVED_CLIENT_HELPER_ID;
  }
  if (id.startsWith(VIRTUAL_PREFIX)) {
    return RESOLVED_PREFIX + id.slice(VIRTUAL_PREFIX.length);
  }
}

export function loadVirtualModule(id: string, registry: Registry) {
  if (id === RESOLVED_CLIENT_HELPER_ID) {
    return {
      code: [
        `export async function ${CLIENT_FETCH_EXPORT}(__endpoint, __body) {`,
        `  const __r = await fetch(__endpoint, {`,
        `    method: 'POST',`,
        `    headers: { 'Content-Type': 'application/json' },`,
        `    body: __body,`,
        `  });`,
        `  const __text = await __r.text();`,
        `  if (!__r.ok) {`,
        `    let __message = __text || __r.statusText;`,
        `    try {`,
        `      const __error = JSON.parse(__text);`,
        `      __message = __error?.error || __message;`,
        `    } catch {}`,
        `    throw new Error(__message);`,
        `  }`,
        `  return __text ? JSON.parse(__text) : undefined;`,
        `}`,
        '',
      ].join('\n'),
      map: null,
    };
  }

  if (!id.startsWith(RESOLVED_PREFIX)) return;
  const name = id.slice(RESOLVED_PREFIX.length);
  const entry = registry.get(name);
  if (!entry) return;

  const imports = entry.imports
    .map((runtimeImport) => renderRuntimeImport(runtimeImport, entry.file, null))
    .join('\n');

  return {
    code: `${imports}${imports ? '\n\n' : ''}export default ${entry.fnJs};\n`,
    map: null,
  };
}
