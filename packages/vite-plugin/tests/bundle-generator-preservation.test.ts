/**
 * Preservation property tests for generateBundleContent.
 *
 * These tests confirm baseline behaviors that MUST remain unchanged through
 * the bugfix. They are written against the UNFIXED code and all PASS before
 * any modifications are made.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateBundleContent } from "../src/build/bundle-generator";
import { Registry } from "../src/core/registry";
import type { ServerEntry } from "../src/types";

// --- Test Helpers ---

let tempDir: string;
let serverEntryPath: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "preservation-test-"));
  serverEntryPath = join(tempDir, "server.ts");
  writeFileSync(
    serverEntryPath,
    'export default { fetch() { return new Response("ok"); } }',
  );
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeEntry(endpoint: string): ServerEntry {
  return {
    endpoint,
    imports: [],
    fnJs: "() => ({ ok: true })",
    file: join(tempDir, "source.ts"),
  };
}

function makeEntryWithImports(endpoint: string): ServerEntry {
  return {
    endpoint,
    imports: [
      {
        defaultName: "db",
        named: [{ imported: "query", local: "query" }],
        specifier: "./db",
      },
    ],
    fnJs: "(args) => db.query(args)",
    file: join(tempDir, "source.ts"),
  };
}

function generateWithEndpoints(endpoints: string[]): string {
  const registry = new Registry();
  for (const ep of endpoints) {
    registry.set(ep, makeEntry(ep));
  }
  const result = generateBundleContent(
    registry,
    "server.ts",
    serverEntryPath,
    tempDir,
    join(tempDir, "../client"),
    3001,
  );
  expect(result).not.toBeNull();
  return result!;
}

// --- Tests ---

describe("Preservation: Null return", () => {
  /**
   * When serverEntry is undefined and registry is empty, generateBundleContent
   * returns null — indicating no server bundle is needed.
   *
   * **Validates: Requirements 3.6**
   */
  test("returns null when serverEntry is undefined and registry is empty", () => {
    const registry = new Registry();
    const result = generateBundleContent(
      registry,
      undefined,
      null,
      tempDir,
      join(tempDir, "../client"),
      3001,
    );
    expect(result).toBeNull();
  });

  test("returns null when serverEntry is undefined and serverEntryPath is null, even with port variations", () => {
    const registry = new Registry();
    const result = generateBundleContent(
      registry,
      undefined,
      null,
      "/some/output/dir",
      "/some/client/dir",
      8080,
    );
    expect(result).toBeNull();
  });
});

describe("Preservation: Throw on missing entry", () => {
  /**
   * When serverEntry is set but the file doesn't exist on disk, the function
   * throws with a descriptive error message.
   *
   * **Validates: Requirements 3.5**
   */
  test("throws when serverEntry is set but file does not exist", () => {
    const registry = new Registry();
    const nonExistentPath = join(tempDir, "does-not-exist.ts");
    expect(() =>
      generateBundleContent(
        registry,
        "does-not-exist.ts",
        nonExistentPath,
        tempDir,
        join(tempDir, "../client"),
        3001,
      ),
    ).toThrow(/does not exist/);
  });

  test("throws with error mentioning the configured serverEntry name", () => {
    const registry = new Registry();
    const nonExistentPath = join(tempDir, "my-server.ts");
    expect(() =>
      generateBundleContent(
        registry,
        "my-server.ts",
        nonExistentPath,
        tempDir,
        join(tempDir, "../client"),
        3001,
      ),
    ).toThrow("my-server.ts");
  });
});

describe("Preservation: API routing present", () => {
  /**
   * For any valid configuration with endpoints, the generated code includes
   * the POST handler for `/__server-build/*`.
   *
   * **Validates: Requirements 3.1**
   */
  test("generated code includes POST handler for /__server-build/*", () => {
    const code = generateWithEndpoints(["getTodos"]);
    expect(code).toContain("app.post('/__server-build/*'");
  });

  test("generated code includes decodeURIComponent in POST handler", () => {
    const code = generateWithEndpoints(["getTodos"]);
    expect(code).toContain("decodeURIComponent");
  });

  test("POST handler routes to __serverHandlers", () => {
    const code = generateWithEndpoints(["getTodos"]);
    expect(code).toContain("const handler = __serverHandlers[endpoint]");
  });

  test("POST handler returns 404 for unregistered endpoints", () => {
    const code = generateWithEndpoints(["getTodos"]);
    expect(code).toContain("Handler not found for endpoint");
    expect(code).toContain("}, 404)");
  });
});

describe("Preservation: 405 handler present", () => {
  /**
   * Generated code includes the `app.all` 405 method restriction for
   * non-POST requests to API endpoints.
   *
   * **Validates: Requirements 3.4**
   */
  test("generated code includes app.all 405 handler", () => {
    const code = generateWithEndpoints(["addTodo"]);
    expect(code).toContain("app.all('/__server-build/*'");
  });

  test("405 handler returns Method not allowed error", () => {
    const code = generateWithEndpoints(["addTodo"]);
    expect(code).toContain("{ error: 'Method not allowed' }, 405");
  });

  test("405 handler includes Allow: POST header", () => {
    const code = generateWithEndpoints(["addTodo"]);
    expect(code).toContain("Allow: 'POST'");
  });
});

describe("Preservation: Path traversal guard", () => {
  /**
   * Generated code includes canonical path resolution checks that return 404 for
   * traversal attempts outside of the client root.
   *
   * **Validates: Requirements 3.3**
   */
  test("generated code includes canonical traversal check", () => {
    const code = generateWithEndpoints(["getData"]);
    expect(code).toContain("relative(resolvedClientRoot, filePath)");
    expect(code).toContain('relativePath.startsWith("../")');
    expect(code).toContain('relativePath.startsWith("..\\\\")');
    expect(code).toContain("isAbsolute(relativePath)");
  });

  test("path traversal returns 404 Not found", () => {
    const code = generateWithEndpoints(["getData"]);
    expect(code).toContain('return c.text("Not found", 404)');
  });

  test("generated code normalizes slashes before traversal check", () => {
    const code = generateWithEndpoints(["getData"]);
    expect(code).toContain("normalizedPathname = pathname.replace");
  });
});

describe("Preservation: Backend handler registration", () => {
  /**
   * For N registered endpoints, generated code includes all N handler entries
   * in `__serverHandlers`.
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  test("single endpoint is registered in __serverHandlers", () => {
    const code = generateWithEndpoints(["getTodos"]);
    expect(code).toContain("const __serverHandlers = {");
    expect(code).toContain('"getTodos"');
  });

  test("multiple endpoints are all registered in __serverHandlers", () => {
    const endpoints = ["getTodos", "addTodo", "deleteTodo", "updateTodo"];
    const code = generateWithEndpoints(endpoints);
    for (const ep of endpoints) {
      expect(code).toContain(JSON.stringify(ep));
    }
  });

  test("endpoints with special characters are properly quoted", () => {
    const code = generateWithEndpoints(["users/getAll", "data.fetch"]);
    expect(code).toContain('"users/getAll"');
    expect(code).toContain('"data.fetch"');
  });

  test("generated code includes handler const for each endpoint", () => {
    const registry = new Registry();
    const endpoints = ["alpha", "beta", "gamma"];
    for (const ep of endpoints) {
      registry.set(ep, makeEntry(ep));
    }
    const code = generateBundleContent(
      registry,
      "server.ts",
      serverEntryPath,
      tempDir,
      join(tempDir, "../client"),
      3001,
    )!;

    // Each endpoint should have a const declaration for its handler
    for (const ep of endpoints) {
      expect(code).toContain(`__server_${ep}_`);
    }
  });

  test("registry with imports generates correct import statements", () => {
    const registry = new Registry();
    registry.set("withImports", makeEntryWithImports("withImports"));
    const code = generateBundleContent(
      registry,
      "server.ts",
      serverEntryPath,
      tempDir,
      join(tempDir, "../client"),
      3001,
    )!;

    // Should have import statements for the dependencies
    expect(code).toContain("import");
    expect(code).toContain("__dep_");
  });
});

describe("Preservation: Server entry validation", () => {
  /**
   * When a valid serverEntry exists, generated code includes app validation
   * to ensure it exports a Hono app.
   *
   * **Validates: Requirements 3.2**
   */
  test("generated code validates server entry exports a Hono app", () => {
    const code = generateWithEndpoints(["test"]);
    expect(code).toContain("typeof app.fetch !== 'function'");
  });

  test("generated code imports server entry module", () => {
    const code = generateWithEndpoints(["test"]);
    expect(code).toContain("import * as __serverEntry");
  });

  test("generated code uses default or named app export", () => {
    const code = generateWithEndpoints(["test"]);
    expect(code).toContain("__serverEntry.default ?? __serverEntry.app");
  });
});

describe("Preservation: Generated code without server entry", () => {
  /**
   * When no serverEntry is provided but endpoints exist, the function still
   * generates valid code with a standalone Hono app.
   *
   * **Validates: Requirements 3.1**
   */
  test("generates code with standalone Hono when no serverEntry and endpoints exist", () => {
    const registry = new Registry();
    registry.set("standalone", makeEntry("standalone"));
    const code = generateBundleContent(
      registry,
      undefined,
      null,
      tempDir,
      join(tempDir, "../client"),
      3001,
    )!;

    expect(code).not.toBeNull();
    expect(code).toContain("import { Hono } from 'hono'");
    expect(code).toContain("const app = new Hono()");
    // Should still have the API routing
    expect(code).toContain("app.post('/__server-build/*'");
    expect(code).toContain("app.all('/__server-build/*'");
  });
});
