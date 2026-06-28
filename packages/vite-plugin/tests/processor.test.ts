import { describe, test, expect } from "bun:test";
import { processFile } from "../src/core/processor";
import { Registry } from "../src/core/registry";

describe("processFile", () => {
  const root = "/root";
  const id = "/root/src/test.ts";

  test("strips module-level declarations used only by handlers", () => {
    const code = `
import { $server } from 'vite-plugin-server-sugar/server';
const SECRET = "secret-value";
export const getSecret = $server(() => SECRET);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).toContain("__serverFetch");
    expect(result!.code).toContain("virtual:server-build/server-fetch");
    expect(result!.code).not.toContain("SECRET");
    expect(result!.code).not.toContain("secret-value");
  });

  test("strips transitive module-level declarations", () => {
    const code = `
import { $server } from 'vite-plugin-server-sugar/server';
const A = 1;
const B = A + 1;
export const get = $server(() => B);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).not.toContain("const A = 1");
    expect(result!.code).not.toContain("const B = A + 1");
  });

  test("preserves module-level declarations used by client code", () => {
    const code = `
import { $server } from 'vite-plugin-server-sugar/server';
const SHARED = "shared-value";
export const get = $server(() => SHARED);
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
import { $server } from 'vite-plugin-server-sugar/server';
import { readFileSync } from 'node:fs';
const config = readFileSync('config.json');
export const get = $server(() => config);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).not.toContain("import { readFileSync }");
    expect(result!.code).not.toContain("const config =");
  });

  test("strips multiple declarations correctly", () => {
    const code = `
import { $server } from 'vite-plugin-server-sugar/server';
const A = 1;
const B = 2;
export const getA = $server(() => A);
export const getB = $server(() => B);
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
    // Use code with $server() call to trigger processing
    const result = processFile(code + "\nexport const get = $server(() => {});", id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).toContain("const VAL = 123");
  });

  test("preserves exported interfaces even if not used by client code", () => {
    const code = `
export interface Todo { id: number }
export const getTodos = $server(() => []);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).toContain("interface Todo");
  });
});
