import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { processFile } from "../src/core/processor";
import { Registry } from "../src/core/registry";
import { generateBundleContent } from "../src/build/bundle-generator";
import { loadVirtualModule } from "../src/dev-server/virtual-modules";
import { RESOLVED_FILE_PREFIX, WS_RUNTIME_GLOBAL_KEY } from "../src/constants";
import type { ActionEntry, WsEntry } from "../src/types";

/** Extracts the `const __wsConnections ... function __wrapWs(...) {...}` snippet from generated code. */
function extractWrapWsSnippet(code: string): string {
  const start = code.indexOf("const __wsConnections");
  if (start === -1) throw new Error("__wsConnections snippet not found");
  const end = code.indexOf("\n}\n", start) + 2;
  return code.slice(start, end);
}

function withTempRoot<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "ws-test-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("processFile: $ws()", () => {
  test("registers a ws entry and replaces the call with a connect() wrapper", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const code = [
        "export const chat = $ws({",
        "  onOpen(ws) { ws.send('hi'); },",
        "  onMessage(ws, data) { ws.send(data); },",
        "});",
      ].join("\n");

      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();
      const result = processFile(code, file, { registry, wsRegistry, root });

      expect(result).not.toBeNull();
      expect(wsRegistry.size).toBe(1);
      const entry = [...wsRegistry.values()][0]!;
      expect(entry.endpoint).toBe("chat/chat");
      expect(entry.handlersJs).toContain("onOpen");
      expect(entry.handlersJs).toContain("onMessage");

      expect(result!.code).toContain("__wsConnect");
      expect(result!.code).toContain("connect:");
      expect(result!.code).not.toContain("$ws({");
    });
  });

  test("shares module-level state between $action() and $ws() in the same file", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const code = [
        "const messages: string[] = [];",
        "",
        "export const getHistory = $action(() => messages);",
        "",
        "export const chat = $ws({",
        "  onMessage(ws, data) { messages.push(data); },",
        "});",
      ].join("\n");

      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();
      processFile(code, file, { registry, wsRegistry, root });

      const actionEntry = [...registry.values()][0]!;
      const wsEntry = [...wsRegistry.values()][0]!;

      expect(actionEntry.moduleDeclsJs).toContain("messages");
      expect(wsEntry.moduleDeclsJs).toBe(actionEntry.moduleDeclsJs);
    });
  });

  test("ignores $ws() calls without a recognized handler key", () => {
    withTempRoot((root) => {
      const file = join(root, "bad.ts");
      const code = "export const x = $ws({ foo() {} });";

      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();
      const result = processFile(code, file, { registry, wsRegistry, root });

      expect(result).toBeNull();
      expect(wsRegistry.size).toBe(0);
    });
  });
});

describe("generateBundleContent: $ws()", () => {
  test("wires Bun.serve with a ws upgrade handler when ws entries exist", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();
      wsRegistry.set("chat/chat", {
        endpoint: "chat/chat",
        imports: [],
        handlersJs: "({ onOpen(ws) { ws.send('hi'); } })",
        file,
      });

      const code = generateBundleContent(
        registry,
        undefined,
        null,
        join(root, "dist", "server"),
        join(root, "dist", "client"),
        3001,
        wsRegistry,
      );

      expect(code).not.toBeNull();
      expect(code).toContain("__wsHandlers");
      expect(code).toContain("server.upgrade(req");
      expect(code).toContain("ws: {");
      expect(code).toContain("fetch(req, server)");
      expect(code).not.toContain("fetch: (req) => app.fetch(req),");
    });
  });

  test("leaves the action-only Bun.serve call untouched when there are no ws entries", () => {
    withTempRoot((root) => {
      const registry = new Registry<ActionEntry>();
      registry.set("todos/get", {
        endpoint: "todos/get",
        imports: [],
        fnJs: "() => ({ ok: true })",
        file: join(root, "todos.ts"),
      });

      const code = generateBundleContent(
        registry,
        undefined,
        null,
        join(root, "dist", "server"),
        join(root, "dist", "client"),
        3001,
      );

      expect(code).toContain("fetch: (req) => app.fetch(req),");
      expect(code).not.toContain("__wsHandlers");
      expect(code).not.toContain("server.upgrade(req");
    });
  });

  test("combines $action() and $ws() handlers from the same file into one shared IIFE", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();
      const moduleDeclsJs = "const messages = [];";

      registry.set("chat/get-history", {
        endpoint: "chat/get-history",
        imports: [],
        fnJs: "() => messages",
        file,
        originalName: "getHistory",
        moduleDeclsJs,
        hasSiblingCrossRefs: false,
      });
      wsRegistry.set("chat/chat", {
        endpoint: "chat/chat",
        imports: [],
        handlersJs: "({ onMessage(ws, data) { messages.push(data); } })",
        file,
        originalName: "chat",
        moduleDeclsJs,
        hasSiblingCrossRefs: false,
      });

      const code = generateBundleContent(
        registry,
        undefined,
        null,
        join(root, "dist", "server"),
        join(root, "dist", "client"),
        3001,
        wsRegistry,
      );

      expect(code).not.toBeNull();
      // Both handlers must come from the SAME IIFE so `messages` is one shared array.
      const iifeMatch = code!.match(/const \{[^}]*\} = \(\(\) => \{[\s\S]*?\}\)\(\);/);
      expect(iifeMatch).not.toBeNull();
      expect(iifeMatch![0]).toContain("getHistory");
      expect(iifeMatch![0]).toContain("chat");
      expect(iifeMatch![0]).toContain(moduleDeclsJs);
    });
  });

  test("a sibling $action() handler can call <name>.send() to broadcast over the ws", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();
      const moduleDeclsJs = "const history = [];";

      registry.set("chat/get-history", {
        endpoint: "chat/get-history",
        imports: [],
        fnJs: "() => { chat.send({ message: 'hi' }); return history; }",
        file,
        originalName: "getChatHistory",
        moduleDeclsJs,
        hasSiblingCrossRefs: true,
      });
      wsRegistry.set("chat/chat", {
        endpoint: "chat/chat",
        imports: [],
        handlersJs: "({ onMessage(ws, data) { history.push(data); } })",
        file,
        originalName: "chat",
        moduleDeclsJs,
        hasSiblingCrossRefs: true,
      });

      const code = generateBundleContent(
        registry,
        undefined,
        null,
        join(root, "dist", "server"),
        join(root, "dist", "client"),
        3001,
        wsRegistry,
      );

      expect(code).not.toBeNull();
      // getChatHistory can reference chat.send(...) by its original name.
      expect(code).toContain("chat.send({ message: 'hi' })");
      // chat itself is bound through the broadcasting wrapper.
      expect(code).toContain('const chat = __wrapWs("chat/chat",');
      // Bun.serve's ws lifecycle tracks open connections per endpoint.
      expect(code).toContain("__wsConnections.set(ws.data.endpoint, __conns);");
      expect(code).toContain("__wsConnections.get(ws.data.endpoint)?.delete(ws);");
    });
  });

  test("__wrapWs() in the generated bundle actually broadcasts send() to every registered connection", () => {
    withTempRoot((root) => {
      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();
      wsRegistry.set("chat/chat", {
        endpoint: "chat/chat",
        imports: [],
        handlersJs: "({ onOpen(ws) { ws.send('hi'); } })",
        file: join(root, "chat.ts"),
      });

      const code = generateBundleContent(
        registry,
        undefined,
        null,
        join(root, "dist", "server"),
        join(root, "dist", "client"),
        3001,
        wsRegistry,
      )!;

      const snippet = extractWrapWsSnippet(code);
      const { __wsConnections, __wrapWs } = new Function(
        `${snippet}\nreturn { __wsConnections, __wrapWs };`,
      )() as {
        __wsConnections: Map<string, Set<{ send(data: unknown): void }>>;
        __wrapWs: (
          endpoint: string,
          handlers: Record<string, unknown>,
        ) => { send(data: unknown): void };
      };

      const sent: unknown[] = [];
      __wsConnections.set("chat/chat", new Set([{ send: (d) => sent.push(d) }]));

      const chat = __wrapWs("chat/chat", { onOpen() {} });
      chat.send({ message: "hi" });

      expect(sent).toEqual([{ message: "hi" }]);
    });
  });
});

describe("loadVirtualModule (dev): $ws() broadcast", () => {
  test("wraps ws handlers with a globalThis-backed broadcasting send()", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();
      wsRegistry.set("chat/chat", {
        endpoint: "chat/chat",
        imports: [],
        handlersJs: "({ onOpen(ws) { ws.send('hi'); } })",
        file,
      });

      const result = loadVirtualModule(
        RESOLVED_FILE_PREFIX + encodeURIComponent(file),
        registry,
        wsRegistry,
      );

      expect(result).toBeDefined();
      expect(result!.code).toContain(
        `globalThis[${JSON.stringify(WS_RUNTIME_GLOBAL_KEY)}]`,
      );
      expect(result!.code).toContain('__wrapWs("chat/chat",');
    });
  });

  test("the generated __wrapWs() shares its connection registry with dev-server/ws-upgrade.ts via globalThis", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const registry = new Registry<ActionEntry>();
      const wsRegistry = new Registry<WsEntry>();
      wsRegistry.set("chat/chat", {
        endpoint: "chat/chat",
        imports: [],
        handlersJs: "({ onOpen(ws) { ws.send('hi'); } })",
        file,
      });

      const result = loadVirtualModule(
        RESOLVED_FILE_PREFIX + encodeURIComponent(file),
        registry,
        wsRegistry,
      )!;

      const snippet = extractWrapWsSnippet(result.code);
      const globalKey = WS_RUNTIME_GLOBAL_KEY;
      const g = globalThis as Record<string, unknown>;
      delete g[globalKey];

      try {
        const { __wrapWs } = new Function(`${snippet}\nreturn { __wrapWs };`)() as {
          __wrapWs: (
            endpoint: string,
            handlers: Record<string, unknown>,
          ) => { send(data: unknown): void };
        };

        // Simulates dev-server/ws-upgrade.ts registering a connection independently.
        const connections = g[globalKey] as Map<
          string,
          Set<{ send(data: unknown): void }>
        >;
        expect(connections).toBeInstanceOf(Map);
        const sent: unknown[] = [];
        connections.set("chat/chat", new Set([{ send: (d) => sent.push(d) }]));

        const chat = __wrapWs("chat/chat", { onOpen() {} });
        chat.send({ message: "hi" });

        expect(sent).toEqual([{ message: "hi" }]);
      } finally {
        delete g[globalKey];
      }
    });
  });
});
