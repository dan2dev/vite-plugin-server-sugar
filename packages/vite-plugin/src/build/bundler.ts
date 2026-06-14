import { mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

interface BunBuildResult {
  logs: unknown[];
  success: boolean;
}

interface BunBuildApi {
  build(options: {
    entrypoints: string[];
    compile: {
      outfile: string;
    };
    define?: Record<string, string>;
  }): Promise<BunBuildResult>;
}

const bunCompileArtifactPattern = /^\.[a-f0-9]+-\d+\.bun-build$/;

function bunCompileArtifacts(dir: string): Set<string> {
  return new Set(readdirSync(dir).filter((name) => bunCompileArtifactPattern.test(name)));
}

function cleanNewBunCompileArtifacts(dir: string, before: Set<string>): void {
  for (const name of bunCompileArtifacts(dir)) {
    if (!before.has(name)) {
      rmSync(join(dir, name), { force: true });
    }
  }
}

/**
 * Compile the generated server source into a standalone Bun executable.
 *
 * npm dependencies (and the configured server entry plus its local imports) are
 * bundled into the executable by Bun. The temporary entry is written in the
 * server output directory so generated imports and runtime asset paths computed
 * relative to that directory resolve to the right files.
 */
export async function compileServer(source: string, serverOutDir: string): Promise<string> {
  const bun = (globalThis as { Bun?: BunBuildApi }).Bun;
  if (!bun) {
    throw new Error('Bun.build is required to compile the production server. Run Vite with Bun, e.g. `bunx --bun vite build`.');
  }

  mkdirSync(serverOutDir, { recursive: true });
  const tempEntry = join(serverOutDir, `.server-build-entry-${process.pid}-${Date.now()}.mts`);
  const outfile = join(serverOutDir, 'server');
  const cwd = process.cwd();
  const previousBunArtifacts = bunCompileArtifacts(cwd);
  writeFileSync(tempEntry, source, 'utf-8');

  try {
    const result = await bun.build({
      entrypoints: [tempEntry],
      compile: { outfile },
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    });

    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error('[server-build] Bun failed to compile the production server.');
    }

    return outfile;
  } finally {
    rmSync(tempEntry, { force: true });
    cleanNewBunCompileArtifacts(cwd, previousBunArtifacts);
  }
}
