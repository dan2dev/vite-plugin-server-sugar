// ── Two endpoints in the same file with NO shared state ──
//
// Neither handler references module-level state or the other by name, so —
// unlike todos.ts and counter.ts — the plugin does not need to keep them
// together. Each becomes its own independent Worker:
// dist/server/functions/health-get-health/index.mjs and
// dist/server/functions/health-ping/index.mjs.

export const getHealth = $server(() => ({ ok: true, time: Date.now() }));

export const ping = $get(async () => ({ pong: true }));
