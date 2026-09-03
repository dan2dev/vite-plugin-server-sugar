import { appendFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const functionsDirectory = new URL("../dist/server/functions/", import.meta.url);
const entries = await readdir(functionsDirectory, { withFileTypes: true });
const todoWorkers = entries.filter(
  (entry) => entry.isDirectory() && entry.name.startsWith("todos-"),
);

if (todoWorkers.length !== 1) {
  throw new Error(
    `Expected exactly one generated todos Worker, found ${todoWorkers.length}`,
  );
}

// Local Wrangler only needs a stable identifier. Set the real database UUID
// when building for deployment: CLOUDFLARE_D1_DATABASE_ID=<uuid> npm run build
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID
  ?? "00000000-0000-0000-0000-000000000000";
const configPath = join(
  fileURLToPath(functionsDirectory),
  todoWorkers[0].name,
  "wrangler.toml",
);

await appendFile(
  configPath,
  [
    "# Added by scripts/configure-d1.mjs for the todos handlers.",
    "[[d1_databases]]",
    'binding = "DB"',
    'database_name = "basic-worker-todos"',
    `database_id = ${JSON.stringify(databaseId)}`,
    'migrations_dir = "../../../../migrations"',
    "",
  ].join("\n"),
);

console.log(`[basic-worker] Added the D1 binding to ${configPath}`);
