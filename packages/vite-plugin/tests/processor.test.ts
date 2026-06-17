import { describe, test, expect } from "bun:test";
import { processFile } from "../src/core/processor";
import { Registry } from "../src/core/registry";

describe("processFile", () => {
  const root = "/root";
  const id = "/root/src/test.ts";

  test("strips module-level declarations used only by handlers", () => {
    const code = `
import { backend } from 'vite-plugin-server-build/backend';
const SECRET = "secret-value";
export const getSecret = backend(() => SECRET);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).toContain("__backendFetch");
    expect(result!.code).toContain("virtual:server-build/backend-fetch");
    expect(result!.code).not.toContain("SECRET");
    expect(result!.code).not.toContain("secret-value");
  });

  test("strips transitive module-level declarations", () => {
    const code = `
import { backend } from 'vite-plugin-server-build/backend';
const A = 1;
const B = A + 1;
export const get = backend(() => B);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).not.toContain("const A = 1");
    expect(result!.code).not.toContain("const B = A + 1");
  });

  test("preserves module-level declarations used by client code", () => {
    const code = `
import { backend } from 'vite-plugin-server-build/backend';
const SHARED = "shared-value";
export const get = backend(() => SHARED);
console.log(SHARED);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).toContain('const SHARED = "shared-value"');
    expect(result!.code).toContain('console.log(SHARED)');
  });
  
  test("strips imports used only by stripped declarations", () => {
    const code = `
import { backend } from 'vite-plugin-server-build/backend';
import { readFileSync } from 'node:fs';
const config = readFileSync('config.json');
export const get = backend(() => config);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).not.toContain("import { readFileSync }");
    expect(result!.code).not.toContain("const config =");
  });

  test("strips multiple declarations correctly", () => {
    const code = `
import { backend } from 'vite-plugin-server-build/backend';
const A = 1;
const B = 2;
export const getA = backend(() => A);
export const getB = backend(() => B);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).not.toContain("const A = 1");
    expect(result!.code).not.toContain("const B = 2");
  });

  test("preserves constants used in types that are used by client code", () => {
    const code = `
const VAL = 123;
interface T { a: typeof VAL }
export const x: T = { a: 123 };
`;

    const registry = new Registry();
    // Use code with backend() call to trigger processing
    const result = processFile(code + "\nexport const get = backend(() => {});", id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).toContain("const VAL = 123");
  });

  test("preserves exported interfaces even if not used by client code", () => {
    const code = `
export interface Todo { id: number }
export const getTodos = backend(() => []);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).toContain("interface Todo");
  });
});
