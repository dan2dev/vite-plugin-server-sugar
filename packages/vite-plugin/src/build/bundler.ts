import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { rolldown } from 'rolldown';

/**
 * Bundle the generated server source into a single self-contained ES module.
 *
 * npm dependencies (and the configured server entry plus its local imports) are
 * inlined, while Node/Bun built-ins (`node:*`) stay external since the runtime
 * provides them. The result no longer depends on the project's `src/` tree or
 * `node_modules`, so the emitted `dist/server/server.js` can run on its own.
 *
 * The temporary entry is written in the server output directory so generated
 * imports computed relative to that directory resolve to the right files.
 */
export async function bundleServer(source: string, serverOutDir: string): Promise<string> {
  mkdirSync(serverOutDir, { recursive: true });
  const tempEntry = join(serverOutDir, `.server-build-entry-${process.pid}-${Date.now()}.mts`);
  writeFileSync(tempEntry, source, 'utf-8');

  try {
    const bundle = await rolldown({
      input: tempEntry,
      platform: 'node',
      onLog: () => {},
    });

    try {
      const { output } = await bundle.generate({ format: 'esm' });
      const chunk = output.find((item) => item.type === 'chunk');
      if (!chunk || chunk.type !== 'chunk') {
        throw new Error('[server-build] server bundle produced no output chunk.');
      }
      return chunk.code;
    } finally {
      await bundle.close();
    }
  } finally {
    rmSync(tempEntry, { force: true });
  }
}
