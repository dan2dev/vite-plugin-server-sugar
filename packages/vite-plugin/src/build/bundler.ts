import { existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

interface BunBuildApi {
  build(options: Bun.BuildConfig): Promise<Bun.BuildOutput>;
}

export const compileTargets = [
  'bun-darwin-x64',
  'bun-darwin-arm64',
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-linux-x64-musl',
  'bun-linux-arm64-musl',
  'bun-windows-x64',
  'bun-windows-arm64',
] satisfies Bun.Build.CompileTarget[];

const serverSourceFileName = 'server.mts';
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

function executableOutfile(serverOutDir: string, target: Bun.Build.CompileTarget): string {
  return join(serverOutDir, `server-${target}`);
}

function emittedOutfile(outfile: string, target: Bun.Build.CompileTarget): string {
  const windowsOutfile = `${outfile}.exe`;
  if (target.startsWith('bun-windows-') && existsSync(windowsOutfile)) {
    return windowsOutfile;
  }

  return outfile;
}

export function writeServerSource(source: string, serverOutDir: string): string {
  mkdirSync(serverOutDir, { recursive: true });
  const outfile = join(serverOutDir, serverSourceFileName);
  writeFileSync(outfile, source, 'utf-8');
  return outfile;
}

/**
 * Compile the generated server source into standalone Bun executables.
 *
 * npm dependencies (and the configured server entry plus its local imports) are
 * bundled into each executable by Bun. The generated entry must live in the
 * server output directory so generated imports and runtime asset paths computed
 * relative to that directory resolve to the right files.
 */
export async function compileServer(entrypoint: string, serverOutDir: string): Promise<string[]> {
  const bun = (globalThis as { Bun?: BunBuildApi }).Bun;
  if (!bun) {
    throw new Error('Bun.build is required to compile the production server. Run Vite with Bun, e.g. `bunx --bun vite build`.');
  }

  mkdirSync(serverOutDir, { recursive: true });
  const cwd = process.cwd();
  const previousBunArtifacts = bunCompileArtifacts(cwd);
  const outfiles: string[] = [];

  try {
    for (const target of compileTargets) {
      const outfile = executableOutfile(serverOutDir, target);
      const result = await bun.build({
        entrypoints: [entrypoint],
        compile: { target, outfile },
        define: {
          'process.env.NODE_ENV': JSON.stringify('production'),
        },
      });

      if (!result.success) {
        for (const log of result.logs) console.error(log);
        throw new Error(`[server-build] Bun failed to compile the production server for ${target}.`);
      }

      outfiles.push(emittedOutfile(outfile, target));
    }

    return outfiles;
  } finally {
    cleanNewBunCompileArtifacts(cwd, previousBunArtifacts);
  }
}
