import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.CLOUDFLARE_D1_DATABASE_ID) {
  throw new Error(
    "Set CLOUDFLARE_D1_DATABASE_ID to the UUID returned by `wrangler d1 create basic-worker-todos` before deploying.",
  );
}

const exampleDirectory = fileURLToPath(new URL("../", import.meta.url));
const functionsDirectory = fileURLToPath(
  new URL("../dist/server/functions/", import.meta.url),
);
const entries = await readdir(functionsDirectory, { withFileTypes: true });
const workerDirectories = entries.filter((entry) => entry.isDirectory());
const workerConfigs = workerDirectories
  .map((entry) => join(functionsDirectory, entry.name, "wrangler.toml"))
  .sort();
const todoWorkers = workerDirectories.filter((entry) =>
  entry.name.startsWith("todos-")
);

if (todoWorkers.length !== 1) {
  throw new Error(
    `Expected exactly one generated todos Worker, found ${todoWorkers.length}`,
  );
}
const todoConfig = join(
  functionsDirectory,
  todoWorkers[0].name,
  "wrangler.toml",
);

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("wrangler", args, {
      cwd: exampleDirectory,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Wrangler exited after signal ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`Wrangler exited with code ${code}`));
    });
  });
}

await runWrangler([
  "d1",
  "migrations",
  "apply",
  "DB",
  "--remote",
  "--config",
  todoConfig,
]);

for (const config of workerConfigs) {
  await runWrangler(["deploy", "--config", config]);
}

await runWrangler([
  "deploy",
  "--config",
  join(exampleDirectory, "dist/server/wrangler.toml"),
]);
