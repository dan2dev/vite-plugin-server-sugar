import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const functionsDirectory = new URL("../dist/server/functions/", import.meta.url);
const exampleDirectory = new URL("../", import.meta.url);
const entries = await readdir(functionsDirectory, { withFileTypes: true });
const workerDirectories = entries.filter((entry) => entry.isDirectory());
const workerConfigs = workerDirectories
  .map((entry) =>
    join(fileURLToPath(functionsDirectory), entry.name, "wrangler.toml")
  )
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
  fileURLToPath(functionsDirectory),
  todoWorkers[0].name,
  "wrangler.toml",
);

function runWrangler(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("wrangler", args, {
      cwd: fileURLToPath(exampleDirectory),
      stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    });
    if (input !== undefined) child.stdin.end(input);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Wrangler exited after signal ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`Wrangler exited with code ${code}`));
    });
  });
}

const persistArguments = ["--persist-to", ".wrangler/state"];

await runWrangler(
  [
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    todoConfig,
    ...persistArguments,
  ],
  "y\n",
);

const gatewayConfig = fileURLToPath(
  new URL("../dist/server/wrangler.toml", import.meta.url),
);
const configArguments = [gatewayConfig, ...workerConfigs].flatMap((path) => [
  "--config",
  path,
]);

await runWrangler(["dev", ...configArguments, ...persistArguments]);
