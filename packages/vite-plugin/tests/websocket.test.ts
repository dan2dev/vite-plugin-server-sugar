import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { processFile } from "../src/core/processor";
import { Registry } from "../src/core/registry";
import { generateBundleContent } from "../src/build/bundle-generator";
import type { BackendEntry, WebSocketEntry } from "../src/types";

function withTempRoot<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "websocket-test-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("processFile: websocket()", () => {
  test("registers a websocket entry and replaces the call with a connect() wrapper", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const code = [
        "export const chat = websocket({",
        "  onOpen(ws) { ws.send('hi'); },",
        "  onMessage(ws, data) { ws.send(data); },",
        "});",
      ].join("\n");

      const registry = new Registry<BackendEntry>();
      const wsRegistry = new Registry<WebSocketEntry>();
      const result = processFile(code, file, { registry, wsRegistry, root });

      expect(result).not.toBeNull();
      expect(wsRegistry.size).toBe(1);
      const entry = [...wsRegistry.values()][0]!;
      expect(entry.endpoint).toBe("chat/chat");
      expect(entry.handlersJs).toContain("onOpen");
      expect(entry.handlersJs).toContain("onMessage");

      expect(result!.code).toContain("__websocketConnect");
      expect(result!.code).toContain("connect:");
      expect(result!.code).not.toContain("websocket({");
    });
  });

  test("shares module-level state between backend() and websocket() in the same file", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const code = [
        "const messages: string[] = [];",
        "",
        "export const getHistory = backend(() => messages);",
        "",
        "export const chat = websocket({",
        "  onMessage(ws, data) { messages.push(data); },",
        "});",
      ].join("\n");

      const registry = new Registry<BackendEntry>();
      const wsRegistry = new Registry<WebSocketEntry>();
      processFile(code, file, { registry, wsRegistry, root });

      const backendEntry = [...registry.values()][0]!;
      const wsEntry = [...wsRegistry.values()][0]!;

      expect(backendEntry.moduleDeclsJs).toContain("messages");
      expect(wsEntry.moduleDeclsJs).toBe(backendEntry.moduleDeclsJs);
    });
  });

  test("ignores websocket() calls without a recognized handler key", () => {
    withTempRoot((root) => {
      const file = join(root, "bad.ts");
      const code = "export const x = websocket({ foo() {} });";

      const registry = new Registry<BackendEntry>();
      const wsRegistry = new Registry<WebSocketEntry>();
      const result = processFile(code, file, { registry, wsRegistry, root });

      expect(result).toBeNull();
      expect(wsRegistry.size).toBe(0);
    });
  });
});

describe("generateBundleContent: websocket()", () => {
  test("wires Bun.serve with a websocket upgrade handler when ws entries exist", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const registry = new Registry<BackendEntry>();
      const wsRegistry = new Registry<WebSocketEntry>();
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
      expect(code).toContain("__websocketHandlers");
      expect(code).toContain("server.upgrade(req");
      expect(code).toContain("websocket: {");
      expect(code).toContain("fetch(req, server)");
      expect(code).not.toContain("fetch: (req) => app.fetch(req),");
    });
  });

  test("leaves the backend-only Bun.serve call untouched when there are no websocket entries", () => {
    withTempRoot((root) => {
      const registry = new Registry<BackendEntry>();
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
      expect(code).not.toContain("__websocketHandlers");
      expect(code).not.toContain("server.upgrade(req");
    });
  });

  test("combines backend() and websocket() handlers from the same file into one shared IIFE", () => {
    withTempRoot((root) => {
      const file = join(root, "chat.ts");
      const registry = new Registry<BackendEntry>();
      const wsRegistry = new Registry<WebSocketEntry>();
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
});
