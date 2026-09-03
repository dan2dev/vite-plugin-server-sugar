import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const databaseName = "basic-worker-todos";

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

function captureWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("wrangler", args, {
      cwd: exampleDirectory,
      stdio: ["inherit", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Wrangler exited after signal ${signal}`));
      else if (code === 0) resolve(output);
      else reject(new Error(`Wrangler exited with code ${code}`));
    });
  });
}

async function findDatabaseId() {
  const output = await captureWrangler(["d1", "list", "--json"]);
  const databases = JSON.parse(output);
  const matches = databases.filter((database) =>
    database.name === databaseName
  );

  if (matches.length > 1) {
    throw new Error(
      `Found multiple D1 databases named ${databaseName}; set CLOUDFLARE_D1_DATABASE_ID to select one.`,
    );
  }

  return matches[0]?.uuid;
}

let databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (databaseId) {
  console.log(
    `[basic-worker] Using D1 database ${databaseId} from CLOUDFLARE_D1_DATABASE_ID.`,
  );
} else {
  databaseId = await findDatabaseId();
  if (!databaseId) {
    console.log(`[basic-worker] Creating D1 database ${databaseName}...`);
    await runWrangler(["d1", "create", databaseName, "--binding", "DB"]);
    databaseId = await findDatabaseId();
  }
}

if (!databaseId) {
  throw new Error(`Could not resolve the UUID for D1 database ${databaseName}.`);
}

const todoConfigSource = await readFile(todoConfig, "utf8");
if (!/^database_id\s*=/m.test(todoConfigSource)) {
  throw new Error(`No D1 database_id setting found in ${todoConfig}`);
}
await writeFile(
  todoConfig,
  todoConfigSource.replace(
    /^database_id\s*=.*$/m,
    `database_id = ${JSON.stringify(databaseId)}`,
  ),
  "utf8",
);
console.log(
  `[basic-worker] Deploying with D1 database ${databaseName} (${databaseId}).`,
);

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
