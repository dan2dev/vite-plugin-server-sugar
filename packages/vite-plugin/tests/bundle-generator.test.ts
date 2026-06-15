import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateBundleContent } from '../src/build/bundle-generator';
import { Registry } from '../src/core/registry';

/**
 * Bug Condition Exploration Test
 *
 * This test encodes the EXPECTED (fixed) behavior for the generated server code.
 * On UNFIXED code, these assertions will FAIL — confirming the bug exists.
 *
 * Bug: The generated production server uses `new URL('../client/', import.meta.url)`
 * for path resolution. In compiled Bun binaries, `import.meta.url` resolves to a
 * virtual `$bunfs` path, causing all static file lookups to fail with 404.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 */
describe('Bug Condition: Static file path resolution in generated bundle', () => {
  let tempDir: string;
  let serverEntryPath: string;
  let generatedCode: string | null;

  beforeAll(() => {
    // Create a minimal temp server entry file so existsSync passes
    tempDir = join(tmpdir(), `bundle-gen-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    serverEntryPath = join(tempDir, 'server.ts');
    writeFileSync(serverEntryPath, `import { Hono } from 'hono';\nexport default new Hono();\n`);

    // Generate bundle content with minimal config
    const registry = new Registry();
    const serverOutDir = join(tempDir, 'dist', 'server');
    const clientOutDir = join(tempDir, 'dist', 'client');

    generatedCode = generateBundleContent(
      registry,
      'server.ts',
      serverEntryPath,
      serverOutDir,
      clientOutDir,
      3001,
    );
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('generated code is not null', () => {
    expect(generatedCode).not.toBeNull();
  });

  test('generated code imports path utilities (dirname, join, resolve)', () => {
    expect(generatedCode).toContain("import { dirname, join, resolve } from 'path'");
  });

  test('generated code uses process.execPath for __clientRoot resolution', () => {
    expect(generatedCode).toContain('resolve(dirname(process.execPath)');
  });

  test('generated code does NOT use new URL for client root resolution', () => {
    // The API handler uses `new URL(c.req.url)` which is fine.
    // But `new URL(` for client root / file path resolution must NOT be present.
    const lines = generatedCode!.split('\n');
    const clientRootLines = lines.filter(
      (line) => line.includes('__clientRoot') && line.includes('new URL('),
    );
    const filePathLines = lines.filter(
      (line) => line.includes('filePath') && line.includes('new URL('),
    );
    const indexLines = lines.filter(
      (line) => line.includes('index.html') && line.includes('new URL('),
    );

    expect(clientRootLines).toHaveLength(0);
    expect(filePathLines).toHaveLength(0);
    expect(indexLines).toHaveLength(0);
  });

  test('generated code uses join(__clientRoot, ...) for file path resolution', () => {
    expect(generatedCode).toContain('join(__clientRoot,');
  });

  test('generated code contains Cache-Control headers', () => {
    expect(generatedCode).toContain('Cache-Control');
  });

  test('generated code uses safe fetch binding: (req) => app.fetch(req)', () => {
    expect(generatedCode).toContain('(req) => app.fetch(req)');
    // Should NOT contain the unsafe direct reference
    expect(generatedCode).not.toContain('fetch: app.fetch,');
  });
});
