import { describe, test, expect } from "bun:test";
import { processFile } from "../src/core/processor";
import { Registry } from "../src/core/registry";

describe("processFile", () => {
  const root = "/root";
  const id = "/root/src/test.ts";

  test("strips module-level declarations used only by handlers", () => {
    const code = `
import { $action } from 'vite-plugin-server-build/action';
const SECRET = "secret-value";
export const getSecret = $action(() => SECRET);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).toContain("__actionFetch");
    expect(result!.code).toContain("virtual:server-build/action-fetch");
    expect(result!.code).not.toContain("SECRET");
    expect(result!.code).not.toContain("secret-value");
  });

  test("strips transitive module-level declarations", () => {
    const code = `
import { $action } from 'vite-plugin-server-build/action';
const A = 1;
const B = A + 1;
export const get = $action(() => B);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).not.toContain("const A = 1");
    expect(result!.code).not.toContain("const B = A + 1");
  });

  test("preserves module-level declarations used by client code", () => {
    const code = `
import { $action } from 'vite-plugin-server-build/action';
const SHARED = "shared-value";
export const get = $action(() => SHARED);
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
import { $action } from 'vite-plugin-server-build/action';
import { readFileSync } from 'node:fs';
const config = readFileSync('config.json');
export const get = $action(() => config);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).not.toContain("import { readFileSync }");
    expect(result!.code).not.toContain("const config =");
  });

  test("strips multiple declarations correctly", () => {
    const code = `
import { $action } from 'vite-plugin-server-build/action';
const A = 1;
const B = 2;
export const getA = $action(() => A);
export const getB = $action(() => B);
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
    // Use code with $action() call to trigger processing
    const result = processFile(code + "\nexport const get = $action(() => {});", id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).toContain("const VAL = 123");
  });

  test("preserves exported interfaces even if not used by client code", () => {
    const code = `
export interface Todo { id: number }
export const getTodos = $action(() => []);
`;

    const registry = new Registry();
    const result = processFile(code, id, { registry, root });

    expect(result).not.toBeNull();
    expect(result!.code).toContain("interface Todo");
  });
});
