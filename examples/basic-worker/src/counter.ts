// ── Another shared-state group, separate from todos.ts ──
//
// `increment`, `getCount`, and `resetCount` share the `count` variable, so
// they land in their own independent Worker
// (dist/server/functions/counter-*/index.mjs) — grouping is per source
// file, not global, so this Worker is deployed and scaled independently of
// the todos Worker.

let count = 0;

export const increment = $server(() => {
  count += 1;
  return count;
});

export const resetCount = $server(() => {
  count = 0;
  return count;
});

export const getCount = $server(() => count);
