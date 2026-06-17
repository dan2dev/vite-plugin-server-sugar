import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import type { ViteDevServer } from 'vite';
import { Registry } from '../core/registry';
import type { FetchApp } from '../types';
import { VIRTUAL_PREFIX } from '../constants';

export function headersFromNode(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out.set(name, value);
    } else if (Array.isArray(value)) {
      for (const item of value) out.append(name, item);
    }
  }
  return out;
}

export function requestUrl(req: IncomingMessage): URL {
  const encrypted = Boolean((req.socket as { encrypted?: boolean }).encrypted);
  const protocol = encrypted ? 'https' : 'http';
  const host = req.headers.host ?? 'localhost';
  return new URL(req.url ?? '/', `${protocol}://${host}`);
}

export function hasRequestBody(req: IncomingMessage): boolean {
  const method = req.method?.toUpperCase() ?? 'GET';
  return method !== 'GET' && method !== 'HEAD';
}

function serverArgsFromBody(body: Buffer): unknown[] {
  if (body.length === 0) return [];

  const payload = JSON.parse(body.toString()) as unknown;
  return Array.isArray(payload) ? payload : [payload];
}

export function readNodeBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function nodeRequestToWeb(req: IncomingMessage): Promise<Request> {
  const body = hasRequestBody(req) ? await readNodeBody(req) : undefined;
  return new Request(requestUrl(req).toString(), {
    method: req.method ?? 'GET',
    headers: headersFromNode(req.headers),
    body: (body && body.length > 0) ? body : undefined,
  });
}

export async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

export async function loadServerApp(
  server: ViteDevServer,
  serverEntry: string | undefined,
  serverEntryPath: string | null
): Promise<FetchApp | null> {
  if (!serverEntry || !serverEntryPath) return null;

  if (!existsSync(serverEntryPath)) {
    throw new Error(
      `[server-build] serverEntry '${serverEntry}' was configured but the file does not exist.`,
    );
  }

  const mod = await server.ssrLoadModule(serverEntryPath);
  const app = (mod.default ?? mod.app) as FetchApp | undefined;

  if (!app || typeof app.fetch !== 'function') {
    throw new Error(
      `[server-build] ${serverEntry} must export a Hono app as default export or named 'app' export.`,
    );
  }

  return app;
}

export async function handleGeneratedServerRequest(
  server: ViteDevServer,
  req: IncomingMessage,
  res: ServerResponse,
  endpoint: string,
  registry: Registry
): Promise<void> {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (!registry.has(endpoint)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `No server handler registered: '${endpoint}'` }));
    return;
  }

  try {
    const body = hasRequestBody(req) ? await readNodeBody(req) : Buffer.alloc(0);
    const args = serverArgsFromBody(body);
    const mod = await server.ssrLoadModule(VIRTUAL_PREFIX + endpoint);
    const fn = mod.default as (...args: unknown[]) => unknown;
    const result = await fn(...args);

    if (result === undefined) {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[server-build] Error in handler '${endpoint}': ${msg}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: msg }));
  }
}
