import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Registry } from '../core/registry';
import type { BackendEntry } from '../types';
import { renderRuntimeImport } from './virtual-modules';
import { API_PREFIX } from '../constants';
import { hasRequestBody, headersFromNode, readNodeBody, requestUrl, writeWebResponse } from './middleware';

export class BunDevServer {
  private child: ChildProcess | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scriptPath: string;

  constructor(
    private readonly port: number,
    private readonly serverEntryPath: string | null,
    cacheDir: string,
  ) {
    mkdirSync(cacheDir, { recursive: true });
    this.scriptPath = join(cacheDir, 'backend-dev-server.ts');
  }

  private generateScript(registry: Registry): string {
    const seenImports = new Set<string>();
    const importLines: string[] = [];
    const preHandlerLines: string[] = [];
    const handlerLines: string[] = [];
    let dhCounter = 0;

    // Group entries by source file so module-level declarations (e.g. `const
    // state = {}`) are shared across all handlers from the same file.
    const entriesByFile = new Map<string, BackendEntry[]>();
    for (const entry of registry.values()) {
      const arr = entriesByFile.get(entry.file) ?? [];
      arr.push(entry);
      entriesByFile.set(entry.file, arr);
    }

    for (const [, fileEntries] of entriesByFile) {
      for (const entry of fileEntries) {
        for (const ri of entry.imports) {
          const line = renderRuntimeImport(ri, entry.file, null);
          if (!seenImports.has(line)) {
            seenImports.add(line);
            importLines.push(line);
          }
        }
      }

      const moduleDeclsJs = fileEntries[0]?.moduleDeclsJs ?? '';

      if (!moduleDeclsJs) {
        for (const entry of fileEntries) {
          handlerLines.push(`  ${JSON.stringify(entry.endpoint)}: ${entry.fnJs},`);
        }
      } else {
        // Wrap all handlers from this file in an IIFE so they share the same
        // module-level state (e.g. a `const state = {}` across handlers).
        const varNames = fileEntries.map(() => `__dh_${dhCounter++}`);

        preHandlerLines.push(
          `const [${varNames.join(', ')}] = (() => {`,
          ...moduleDeclsJs.split('\n').map((l) => (l ? `  ${l}` : '')),
          '  return [',
          ...fileEntries.map((e) => `    ${e.fnJs},`),
          '  ];',
          '})();',
          '',
        );

        for (let i = 0; i < fileEntries.length; i++) {
          handlerLines.push(`  ${JSON.stringify(fileEntries[i].endpoint)}: ${varNames[i]},`);
        }
      }
    }

    const lines: string[] = [];
    if (importLines.length > 0) lines.push(...importLines, '');
    if (this.serverEntryPath) {
      lines.push(`import __serverApp from ${JSON.stringify(this.serverEntryPath)};`, '');
    }
    if (preHandlerLines.length > 0) lines.push(...preHandlerLines);

    lines.push(
      `const __handlers: Record<string, (...args: unknown[]) => unknown> = {`,
      ...handlerLines,
      `};`,
      '',
      `Bun.serve({`,
      `  port: ${this.port},`,
      `  async fetch(req: Request): Promise<Response> {`,
      `    const url = new URL(req.url);`,
      `    const p = url.pathname;`,
      `    if (p.startsWith(${JSON.stringify(API_PREFIX)})) {`,
      `      if (req.method !== 'POST') {`,
      `        return new Response(JSON.stringify({ error: 'Method not allowed' }), {`,
      `          status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' }`,
      `        });`,
      `      }`,
      `      const endpoint = decodeURIComponent(p.slice(${API_PREFIX.length}));`,
      `      const handler = __handlers[endpoint];`,
      `      if (!handler) {`,
      `        return new Response(JSON.stringify({ error: \`No handler: \${endpoint}\` }), {`,
      `          status: 404, headers: { 'Content-Type': 'application/json' }`,
      `        });`,
      `      }`,
      `      const text = await req.text();`,
      `      const raw = text ? JSON.parse(text) : [];`,
      `      const args = Array.isArray(raw) ? raw : [raw];`,
      `      try {`,
      `        const result = await handler(...args);`,
      `        if (result === undefined) return new Response(null, { status: 204 });`,
      `        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });`,
      `      } catch (e) {`,
      `        const msg = e instanceof Error ? e.message : String(e);`,
      `        console.error('[server-build] Handler error:', msg);`,
      `        return new Response(JSON.stringify({ error: msg }), {`,
      `          status: 500, headers: { 'Content-Type': 'application/json' }`,
      `        });`,
      `      }`,
      `    }`,
    );

    if (this.serverEntryPath) {
      lines.push(
        `    if (__serverApp && typeof __serverApp.fetch === 'function') {`,
        `      const r = await __serverApp.fetch(req);`,
        `      if (r.status !== 404) return r;`,
        `    }`,
      );
    }

    lines.push(
      `    return new Response('Not Found', { status: 404 });`,
      `  },`,
      `});`,
    );

    return lines.join('\n');
  }

  private spawnChild(): void {
    this.child = spawn('bun', ['run', this.scriptPath], { stdio: 'inherit' });
    this.child.on('error', (err) =>
      console.error('[server-build] Bun dev server error:', err.message),
    );
  }

  start(registry: Registry): void {
    writeFileSync(this.scriptPath, this.generateScript(registry), 'utf-8');
    this.spawnChild();
  }

  restart(registry: Registry): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.child?.kill('SIGTERM');
      this.child = null;
      writeFileSync(this.scriptPath, this.generateScript(registry), 'utf-8');
      this.spawnChild();
    }, 100);
  }

  stop(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.child?.kill('SIGTERM');
    this.child = null;
  }

  async proxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = requestUrl(req);
    const body = hasRequestBody(req) ? await readNodeBody(req) : undefined;
    const headers = headersFromNode(req.headers);
    headers.delete('host');
    const bunRes = await fetch(
      `http://localhost:${this.port}${url.pathname}${url.search}`,
      { method: req.method ?? 'GET', headers, body: body?.length ? body : undefined },
    );
    await writeWebResponse(res, bunRes);
  }

  async proxyOrNext(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): Promise<void> {
    const url = requestUrl(req);
    const body = hasRequestBody(req) ? await readNodeBody(req) : undefined;
    const headers = headersFromNode(req.headers);
    headers.delete('host');
    const bunRes = await fetch(
      `http://localhost:${this.port}${url.pathname}${url.search}`,
      { method: req.method ?? 'GET', headers, body: body?.length ? body : undefined },
    );
    if (bunRes.status === 404) { next(); return; }
    await writeWebResponse(res, bunRes);
  }
}
