import { dirname, resolve } from "node:path";

import { Registry } from "../core/registry";
import type { ServerEntry, RuntimeImport, WsEntry, WorkerEntry } from "../types";
import {
  CLIENT_FETCH_EXPORT,
  CLIENT_HELPER_ID,
  CLIENT_HTTP_FETCH_EXPORT,
  CLIENT_HTTP_HELPER_ID,
  CLIENT_WORKER_HELPER_ID,
  CLIENT_WORKER_PROXY_EXPORT,
  CLIENT_WS_CONNECT_EXPORT,
  CLIENT_WS_HELPER_ID,
  RESOLVED_CLIENT_HELPER_ID,
  RESOLVED_CLIENT_HTTP_HELPER_ID,
  RESOLVED_CLIENT_WS_HELPER_ID,
  RESOLVED_CLIENT_WORKER_HELPER_ID,
  RESOLVED_FILE_PREFIX,
  RESOLVED_PREFIX,
  RESOLVED_WORKER_PREFIX,
  RESOLVED_WS_PREFIX,
  VIRTUAL_FILE_PREFIX,
  VIRTUAL_PREFIX,
  VIRTUAL_WORKER_PREFIX,
  VIRTUAL_WS_PREFIX,
  WS_RUNTIME_GLOBAL_KEY,
} from "../constants";
import { serverConstName, wsConstName } from "../utils/crypto";
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

export function virtualServerFileId(file: string): string {
  return VIRTUAL_FILE_PREFIX + encodeURIComponent(file);
}

export function resolveVirtualId(id: string): string | undefined {
  if (id === CLIENT_HELPER_ID) {
    return RESOLVED_CLIENT_HELPER_ID;
  }
  if (id === CLIENT_WS_HELPER_ID) {
    return RESOLVED_CLIENT_WS_HELPER_ID;
  }
  if (id === CLIENT_HTTP_HELPER_ID) {
    return RESOLVED_CLIENT_HTTP_HELPER_ID;
  }
  if (id === CLIENT_WORKER_HELPER_ID) {
    return RESOLVED_CLIENT_WORKER_HELPER_ID;
  }
  if (id.startsWith(VIRTUAL_WORKER_PREFIX)) {
    return RESOLVED_WORKER_PREFIX + id.slice(VIRTUAL_WORKER_PREFIX.length);
  }
  if (id.startsWith(VIRTUAL_FILE_PREFIX)) {
    return RESOLVED_FILE_PREFIX + id.slice(VIRTUAL_FILE_PREFIX.length);
  }
  if (id.startsWith(VIRTUAL_WS_PREFIX)) {
    return RESOLVED_WS_PREFIX + id.slice(VIRTUAL_WS_PREFIX.length);
  }
  if (id.startsWith(VIRTUAL_PREFIX)) {
    return RESOLVED_PREFIX + id.slice(VIRTUAL_PREFIX.length);
  }
}

function serverEntriesForFile(
  registry: Registry<ServerEntry>,
  file: string,
): ServerEntry[] {
  return [...registry.values()].filter((entry) => entry.file === file);
}

function wsEntriesForFile(
  wsRegistry: Registry<WsEntry>,
  file: string,
): WsEntry[] {
  return [...wsRegistry.values()].filter((entry) => entry.file === file);
}

/**
 * Generates the combined per-file module for ALL handlers (server() and
 * ws()) declared in one source file. Both kinds share a single
 * generated module — and therefore a single IIFE instance — so module-level
 * state declared in the file is one shared object, not duplicated per kind.
 */
function combinedFileModuleCode(
  serverEntries: ServerEntry[],
  wsEntries: WsEntry[],
): string {
  const seenImports = new Set<string>();
  const importLines: string[] = [];

  for (const entry of [...serverEntries, ...wsEntries]) {
    for (const runtimeImport of entry.imports) {
      const line = renderRuntimeImport(runtimeImport, entry.file, null);
      if (!seenImports.has(line)) {
        seenImports.add(line);
        importLines.push(line);
      }
    }
  }

  const first = serverEntries[0] ?? wsEntries[0];
  const moduleDeclsJs = first?.moduleDeclsJs ?? "";
  const hasSiblingCrossRefs = first?.hasSiblingCrossRefs ?? false;
  const useIIFE = !!moduleDeclsJs || hasSiblingCrossRefs;

  const allConstNames = [
    ...serverEntries.map((e) => serverConstName(e.endpoint)),
    ...wsEntries.map((e) => wsConstName(e.endpoint)),
  ];

  const lines: string[] = [];
  if (importLines.length > 0) lines.push(...importLines, "");

  if (wsEntries.length > 0) {
    // Dev mode loads this virtual module and dev-server/ws-upgrade.ts (which
    // performs the actual HTTP upgrade) as separate module instances, so the
    // open-connection registry lives on `globalThis` under a shared key —
    // whichever side runs first creates it, the other reuses it.
    lines.push(
      `const __wsConnections = (globalThis[${JSON.stringify(WS_RUNTIME_GLOBAL_KEY)}] ??= new Map());`,
      `function __wrapWs(endpoint, handlers) {`,
      `  return {`,
      `    ...handlers,`,
      `    send(data) {`,
      `      const conns = __wsConnections.get(endpoint);`,
      `      if (!conns) return;`,
      `      for (const ws of conns) ws.send(data);`,
      `    },`,
      `  };`,
      `}`,
      "",
    );
  }

  if (!useIIFE) {
    for (const entry of serverEntries) {
      lines.push(`const ${serverConstName(entry.endpoint)} = ${entry.fnJs};`);
    }
    for (const entry of wsEntries) {
      lines.push(
        `const ${wsConstName(entry.endpoint)} = __wrapWs(${JSON.stringify(entry.endpoint)}, ${entry.handlersJs});`,
      );
    }
  } else {
    lines.push(`const { ${allConstNames.join(", ")} } = (() => {`);

    if (moduleDeclsJs) {
      for (const declLine of moduleDeclsJs.split("\n")) {
        lines.push(declLine ? `  ${declLine}` : "");
      }
    }

    for (const entry of serverEntries) {
      const constName = serverConstName(entry.endpoint);
      const localName = entry.originalName ?? constName;
      lines.push(`  const ${localName} = ${entry.fnJs};`);
    }
    for (const entry of wsEntries) {
      const constName = wsConstName(entry.endpoint);
      const localName = entry.originalName ?? constName;
      lines.push(
        `  const ${localName} = __wrapWs(${JSON.stringify(entry.endpoint)}, ${entry.handlersJs});`,
      );
    }

    lines.push("  return {");
    for (const entry of serverEntries) {
      const constName = serverConstName(entry.endpoint);
      const localName = entry.originalName ?? constName;
      lines.push(`    ${constName}: ${localName},`);
    }
    for (const entry of wsEntries) {
      const constName = wsConstName(entry.endpoint);
      const localName = entry.originalName ?? constName;
      lines.push(`    ${constName}: ${localName},`);
    }
    lines.push("  };", "})();");
  }

  lines.push("", `export { ${allConstNames.join(", ")} };`, "");
  return lines.join("\n");
}

function workerModuleCode(entry: WorkerEntry): string {
  const seenImports = new Set<string>();
  const importLines: string[] = [];

  for (const runtimeImport of entry.imports) {
    const line = renderRuntimeImport(runtimeImport, entry.file, null);
    if (!seenImports.has(line)) {
      seenImports.add(line);
      importLines.push(line);
    }
  }

  const lines: string[] = [];
  if (importLines.length > 0) lines.push(...importLines, "");

  if (entry.siblingServerStubs.length > 0) {
    lines.push(
      `import { ${CLIENT_FETCH_EXPORT} } from ${JSON.stringify(CLIENT_HELPER_ID)};`,
    );
    for (const stub of entry.siblingServerStubs) {
      lines.push(
        `const ${stub.name} = async (...__args) => ${CLIENT_FETCH_EXPORT}(${JSON.stringify(stub.url)}, JSON.stringify(__args));`,
      );
    }
    lines.push("");
  }

  if (entry.siblingWsStubs.length > 0) {
    lines.push(
      `import { ${CLIENT_WS_CONNECT_EXPORT} } from ${JSON.stringify(CLIENT_WS_HELPER_ID)};`,
    );
    for (const stub of entry.siblingWsStubs) {
      lines.push(
        `const ${stub.name} = { connect: (...__args) => ${CLIENT_WS_CONNECT_EXPORT}(${JSON.stringify(stub.url)}, __args) };`,
      );
    }
    lines.push("");
  }

  if (entry.moduleDeclsJs) {
    lines.push(entry.moduleDeclsJs, "");
  }

  // Call the factory once. Promise.resolve() handles both sync and async factories.
  lines.push(`const __ctxPromise = Promise.resolve((${entry.fnJs})());`, "");
  lines.push(
    `self.addEventListener("message", async (e) => {`,
    `  const { id, method, args } = e.data;`,
    `  try {`,
    `    const __ctx = await __ctxPromise;`,
    `    const __fn = __ctx[method];`,
    `    if (typeof __fn !== 'function') {`,
    `      self.postMessage({ id, error: 'Unknown method: ' + method });`,
    `      return;`,
    `    }`,
    `    const result = await __fn(...args);`,
    `    self.postMessage({ id, result });`,
    `  } catch (err) {`,
    `    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });`,
    `  }`,
    `});`,
    "",
  );

  return lines.join("\n");
}

export function loadVirtualModule(
  id: string,
  registry: Registry<ServerEntry>,
  wsRegistry?: Registry<WsEntry>,
  workerRegistry?: Registry<WorkerEntry>,
) {
  if (id === RESOLVED_CLIENT_WORKER_HELPER_ID) {
    return {
      code: [
        `const __workerInstances = new Map();`,
        `export function ${CLIENT_WORKER_PROXY_EXPORT}(url) {`,
        `  return new Proxy({}, {`,
        `    get(_, method) {`,
        `      if (typeof method !== 'string') return undefined;`,
        `      return async (...args) => {`,
        `        let worker = __workerInstances.get(url);`,
        `        if (!worker) {`,
        `          worker = new Worker(url, { type: 'module' });`,
        `          __workerInstances.set(url, worker);`,
        `        }`,
        `        return new Promise((resolve, reject) => {`,
        `          const id = Math.random().toString(36).slice(2);`,
        `          const handler = (e) => {`,
        `            if (e.data.id !== id) return;`,
        `            worker.removeEventListener('message', handler);`,
        `            if (e.data.error) reject(new Error(e.data.error));`,
        `            else resolve(e.data.result);`,
        `          };`,
        `          worker.addEventListener('message', handler);`,
        `          worker.postMessage({ id, method, args });`,
        `        });`,
        `      };`,
        `    }`,
        `  });`,
        `}`,
        "",
      ].join("\n"),
      map: null,
    };
  }

  // Worker virtual module — strip any query string before looking up the entry
  const cleanId = id.split("?")[0];
  if (cleanId.startsWith(RESOLVED_WORKER_PREFIX)) {
    if (!workerRegistry) return;
    const endpoint = cleanId.slice(RESOLVED_WORKER_PREFIX.length);
    const entry = workerRegistry.get(endpoint);
    if (!entry) return;
    return { code: workerModuleCode(entry), map: null };
  }

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

  if (id === RESOLVED_CLIENT_HTTP_HELPER_ID) {
    return {
      code: [
        `export async function ${CLIENT_HTTP_FETCH_EXPORT}(__method, __endpoint, __body, __query, __options) {`,
        `  let __url = __endpoint;`,
        `  if (__query) {`,
        `    const __params = new URLSearchParams(__query);`,
        `    __url += '?' + __params.toString();`,
        `  }`,
        `  const __opts = { method: __method };`,
        `  if (__body !== undefined) {`,
        `    __opts.headers = { 'Content-Type': 'application/json' };`,
        `    __opts.body = JSON.stringify(__body);`,
        `  }`,
        `  if (__options && __options.headers) {`,
        `    __opts.headers = Object.assign(__opts.headers || {}, __options.headers);`,
        `  }`,
        `  const __r = await fetch(__url, __opts);`,
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

  if (id === RESOLVED_CLIENT_WS_HELPER_ID) {
    return {
      code: [
        `export function ${CLIENT_WS_CONNECT_EXPORT}(__endpoint, __args) {`,
        `  const __protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';`,
        `  const __url = new URL(__endpoint, \`\${__protocol}//\${location.host}\`);`,
        `  __url.searchParams.set('args', JSON.stringify(__args));`,
        `  const __socket = new WebSocket(__url);`,
        `  const __messageHandlers = [];`,
        `  const __closeHandlers = [];`,
        `  __socket.addEventListener('message', (__ev) => {`,
        `    let __data;`,
        `    try { __data = JSON.parse(__ev.data); } catch { __data = __ev.data; }`,
        `    for (const __cb of __messageHandlers) __cb(__data);`,
        `  });`,
        `  __socket.addEventListener('close', (__ev) => {`,
        `    for (const __cb of __closeHandlers) __cb(__ev);`,
        `  });`,
        `  return {`,
        `    send(data) { __socket.send(JSON.stringify(data)); },`,
        `    onMessage(cb) { __messageHandlers.push(cb); },`,
        `    onClose(cb) { __closeHandlers.push(cb); },`,
        `    close(...args) { __socket.close(...args); },`,
        `    get readyState() { return __socket.readyState; },`,
        `  };`,
        `}`,
        "",
      ].join("\n"),
      map: null,
    };
  }

  if (id.startsWith(RESOLVED_FILE_PREFIX)) {
    const file = decodeURIComponent(id.slice(RESOLVED_FILE_PREFIX.length));
    const fileServerEntries = serverEntriesForFile(registry, file);
    const fileWsEntries = wsRegistry ? wsEntriesForFile(wsRegistry, file) : [];
    if (fileServerEntries.length === 0 && fileWsEntries.length === 0) return;

    return {
      code: combinedFileModuleCode(fileServerEntries, fileWsEntries),
      map: null,
    };
  }

  if (id.startsWith(RESOLVED_WS_PREFIX)) {
    if (!wsRegistry) return;
    const name = id.slice(RESOLVED_WS_PREFIX.length);
    const entry = wsRegistry.get(name);
    if (!entry) return;

    return {
      code: `export { ${wsConstName(entry.endpoint)} as default } from ${JSON.stringify(virtualServerFileId(entry.file))};\n`,
      map: null,
    };
  }

  if (!id.startsWith(RESOLVED_PREFIX)) return;
  const name = id.slice(RESOLVED_PREFIX.length);
  const entry = registry.get(name);
  if (!entry) return;

  return {
    code: `export { ${serverConstName(entry.endpoint)} as default } from ${JSON.stringify(virtualServerFileId(entry.file))};\n`,
    map: null,
  };
}
