import { dirname, resolve } from "node:path";

import { Registry } from "../core/registry";
import type { BackendEntry, RuntimeImport } from "../types";
import {
  CLIENT_FETCH_EXPORT,
  CLIENT_HELPER_ID,
  RESOLVED_CLIENT_HELPER_ID,
  RESOLVED_FILE_PREFIX,
  RESOLVED_PREFIX,
  VIRTUAL_FILE_PREFIX,
  VIRTUAL_PREFIX,
} from "../constants";
import { backendConstName } from "../utils/crypto";
import { isRelativeImport, normalizePath, toImportPath } from "../utils/path";

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
    .join(", ");

  if (runtimeImport.defaultName && namedImports) {
    return `import ${runtimeImport.defaultName}, { ${namedImports} } from ${specifier};`;
  }

  if (runtimeImport.defaultName) {
    return `import ${runtimeImport.defaultName} from ${specifier};`;
  }

  return `import { ${namedImports} } from ${specifier};`;
}

export function virtualBackendFileId(file: string): string {
  return VIRTUAL_FILE_PREFIX + encodeURIComponent(file);
}

export function resolveVirtualId(id: string): string | undefined {
  if (id === CLIENT_HELPER_ID) {
    return RESOLVED_CLIENT_HELPER_ID;
  }
  if (id.startsWith(VIRTUAL_FILE_PREFIX)) {
    return RESOLVED_FILE_PREFIX + id.slice(VIRTUAL_FILE_PREFIX.length);
  }
  if (id.startsWith(VIRTUAL_PREFIX)) {
    return RESOLVED_PREFIX + id.slice(VIRTUAL_PREFIX.length);
  }
}

function backendEntriesForFile(
  registry: Registry,
  file: string,
): BackendEntry[] {
  return [...registry.values()].filter((entry) => entry.file === file);
}

function backendFileModuleCode(fileEntries: BackendEntry[]): string {
  const seenImports = new Set<string>();
  const importLines: string[] = [];

  for (const entry of fileEntries) {
    for (const runtimeImport of entry.imports) {
      const line = renderRuntimeImport(runtimeImport, entry.file, null);
      if (!seenImports.has(line)) {
        seenImports.add(line);
        importLines.push(line);
      }
    }
  }

  const moduleDeclsJs = fileEntries[0]?.moduleDeclsJs ?? "";
  const hasSiblingCrossRefs = fileEntries[0]?.hasSiblingCrossRefs ?? false;
  const useIIFE = !!moduleDeclsJs || hasSiblingCrossRefs;
  const constNames = fileEntries.map((entry) =>
    backendConstName(entry.endpoint),
  );
  const lines: string[] = [];

  if (importLines.length > 0) lines.push(...importLines, "");

  if (!useIIFE) {
    for (const entry of fileEntries) {
      lines.push(`const ${backendConstName(entry.endpoint)} = ${entry.fnJs};`);
    }
  } else {
    lines.push(`const { ${constNames.join(", ")} } = (() => {`);

    if (moduleDeclsJs) {
      for (const declLine of moduleDeclsJs.split("\n")) {
        lines.push(declLine ? `  ${declLine}` : "");
      }
    }

    for (const entry of fileEntries) {
      const constName = backendConstName(entry.endpoint);
      const localName = entry.originalName ?? constName;
      lines.push(`  const ${localName} = ${entry.fnJs};`);
    }

    lines.push("  return {");
    for (const entry of fileEntries) {
      const constName = backendConstName(entry.endpoint);
      const localName = entry.originalName ?? constName;
      lines.push(`    ${constName}: ${localName},`);
    }
    lines.push("  };", "})();");
  }

  lines.push("", `export { ${constNames.join(", ")} };`, "");
  return lines.join("\n");
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
        "",
      ].join("\n"),
      map: null,
    };
  }

  if (id.startsWith(RESOLVED_FILE_PREFIX)) {
    const file = decodeURIComponent(id.slice(RESOLVED_FILE_PREFIX.length));
    const fileEntries = backendEntriesForFile(registry, file);
    if (fileEntries.length === 0) return;

    return {
      code: backendFileModuleCode(fileEntries),
      map: null,
    };
  }

  if (!id.startsWith(RESOLVED_PREFIX)) return;
  const name = id.slice(RESOLVED_PREFIX.length);
  const entry = registry.get(name);
  if (!entry) return;

  return {
    code: `export { ${backendConstName(entry.endpoint)} as default } from ${JSON.stringify(virtualBackendFileId(entry.file))};\n`,
    map: null,
  };
}
